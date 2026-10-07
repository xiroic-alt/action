// Exercise the production creator; device round-trips remain the integration test.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = fs.readFileSync(path.join(root, 'native/bilinet/src/BiliNet.cpp'), 'utf8')
const at = source.indexOf('setObjectCreator([]() {')
if (at < 0) throw new Error('Missing production creator')
const begin = source.indexOf('[]()', at)
let end = source.indexOf('{', begin), depth = 1
for (end++; depth && end < source.length; end++) {
  if (source[end] === '{') depth++
  if (source[end] === '}') depth--
}
const creator = source.slice(begin, end)
// The seam keeps context flags and creator-owned refs; the production SDK is
// exercised on device. A freestanding WASM binary avoids requiring MSVC here.
const program = [
  'typedef __SIZE_TYPE__ Size;',
  'alignas(16) static unsigned char arena[16384]; static Size used = 0;',
  'void* operator new(Size n) { void* p = arena + used; used += (n + 15) & ~Size(15); return p; }',
  'struct BiliNet {',
  '  unsigned ctx = 0; int manualRefs = 0;',
  '  void REF() { ++manualRefs; }',
  '  void attach(unsigned v) { ctx = v | 1; }',
  '  void disable() { ctx &= ~1u; }',
  '  void detach() { ctx = 0; }',
  '  bool disabled() const { return !(ctx & 1); }',
  '};',
  'extern "C" int run() {',
  '  auto create = ' + creator + ';',
  '  BiliNet* first = create(); first->attach(0x1000); first->disable();',
  '  BiliNet* next = create();',
  '  if (next == first) return 1;',
  '  next->attach(0x2000); first->detach();',
  '  if (next->disabled() || next->manualRefs || first->manualRefs) return 2;',
  '  for (int i = 0; i < 32; ++i) {',
  '    next->disable(); BiliNet* later = create();',
  '    if (later == next || later->manualRefs) return 3;',
  '    later->attach(0x3000 + i * 16); next->detach();',
  '    if (later->disabled()) return 4;',
  '    next = later;',
  '  }',
  '  return 0;',
  '}',
  'int main() { return run(); }'
].join(String.fromCharCode(10))
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bilinet-lifecycle-'))
try {
  const src = path.join(temp, 'creator.cpp')
  const wasm = process.platform === 'win32'
  const exe = path.join(temp, wasm ? 'creator.wasm' : 'creator')
  fs.writeFileSync(src, program)
  const cxx = process.env.CXX || (wasm ? 'C:/Program Files/LLVM/bin/clang++.exe' : 'g++')
  const args = ['-std=c++11', '-fno-exceptions', '-fno-rtti', '-fno-threadsafe-statics', src, '-o', exe]
  if (wasm) args.push('--target=wasm32', '-nostdlib', '-Wl,--no-entry', '-Wl,--export=run')
  const c = spawnSync(cxx, args, { encoding: 'utf8', timeout: 30000 })
  if (c.error || c.status !== 0) throw new Error(c.stderr || String(c.error))
  const verdict = wasm
    ? (await WebAssembly.instantiate(fs.readFileSync(exe))).instance.exports.run()
    : spawnSync(exe, [], { timeout: 10000 }).status
  if (verdict !== 0) {
    const reasons = { 1: 'reused disabled native instance across contexts', 2: 'late teardown or extra reference affects new instance', 3: 'subsequent creator shared state', 4: 'late finalizer disabled current context' }
    throw new Error('NATIVE-LIFECYCLE FAIL: ' + (reasons[verdict] || verdict))
  }
  console.log('NATIVE-LIFECYCLE PASSED: independent objects, isolated late teardown, SDK-owned refs')
} finally { fs.rmSync(temp, { recursive: true, force: true }) }
