// MD5 (RFC 1321) —— wbi 签名要用, 而设备 QuickJS 20200705 没有字符串 hash
//
// 为什么手写: 固件 crypto 只给 hashFile, 不给字符串; QuickJS 也没有 crypto.subtle.
// wbi 签名是拿 md5 结果做校验的, 错一位服务端就判签名失败, 所以这里按 RFC 1321 逐轮实现,
// 并用标准测试向量在门禁里钉死 (空串 / 'abc' / 中文).
//
// 32 位运算: 全程用 |0 保持 int32 语义; QuickJS 的位运算就是 32 位, 与 C 一致.

const S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
]
const K = []
for (let i = 0; i < 64; i++) K.push(Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296))

function rotl(x, c) { return (x << c) | (x >>> (32 - c)) }

function utf8Bytes(str) {
  const bytes = []
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i)
    // 代理对: 组合成一个码点再编码
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
      const c2 = str.charCodeAt(i + 1)
      if (c2 >= 0xdc00 && c2 <= 0xdfff) { c = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00); i++ }
    }
    if (c < 0x80) bytes.push(c)
    else if (c < 0x800) { bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f)) }
    else if (c < 0x10000) { bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f)) }
    else { bytes.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f)) }
  }
  return bytes
}

function hexWord(n) {
  let s = ''
  for (let i = 0; i < 4; i++) s += ('0' + ((n >>> (i * 8)) & 0xff).toString(16)).slice(-2)
  return s
}

/** 计算 UTF-8 字符串的 MD5, 返回 32 位小写十六进制 */
export function md5(str) {
  const bytes = utf8Bytes(String(str == null ? '' : str))
  const bitLen = bytes.length * 8
  bytes.push(0x80)
  while (bytes.length % 64 !== 56) bytes.push(0)
  for (let i = 0; i < 8; i++) bytes.push(Math.floor(bitLen / Math.pow(2, i * 8)) & 0xff)

  const w = []
  for (let i = 0; i < bytes.length; i += 4) {
    w.push(bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] << 24))
  }

  let a = 0x67452301, b = 0xefcdab89, c = 0x98badcfe, d = 0x10325476
  for (let k = 0; k < w.length; k += 16) {
    const aa = a, bb = b, cc = c, dd = d
    for (let i = 0; i < 64; i++) {
      let f, g
      if (i < 16) { f = (b & c) | (~b & d); g = i }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16 }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16 }
      else { f = c ^ (b | ~d); g = (7 * i) % 16 }
      const tmp = d
      d = c
      c = b
      b = (b + rotl((a + f + K[i] + w[k + g]) | 0, S[i])) | 0
      a = tmp
    }
    a = (a + aa) | 0
    b = (b + bb) | 0
    c = (c + cc) | 0
    d = (d + dd) | 0
  }
  return hexWord(a) + hexWord(b) + hexWord(c) + hexWord(d)
}
