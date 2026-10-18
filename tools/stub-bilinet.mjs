// bilinet 桩件 —— 全内存实现, 供离线门禁使用
//
// 语义与真实 native 保持一致的地方: 同步/异步两套、返回字符串 body、dbQuery 返回 JSON 字符串.
// 不模拟的地方: 真实网络与真实 sqlite (门禁不该依赖它们).
const disk = new Map()
let dbOpen = false

export const bilinet = {
  httpGet: () => '',
  httpGetAsync: async () => '',
  httpPost: () => '',
  httpPostAsync: async () => '',
  readFile: (p) => (disk.has(p) ? disk.get(p) : ''),
  writeFile: (p, v) => { disk.set(p, String(v)); return true },
  mkdirs: () => true,
  exists: (p) => disk.has(p),
  stat: () => '{}',
  readdir: () => '[]',
  rm: (p) => { disk.delete(p); return true },
  exec: () => '',
  execAsync: async () => '',
  dbOpen: (p) => { dbOpen = true; return true },
  dbExec: () => true,
  dbQuery: () => '[]',
  dbClose: () => true
}

export default bilinet
export const __disk = disk
