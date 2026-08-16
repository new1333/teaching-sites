const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** 字符串 → UTF-8 字节数组(码点切分,代理对安全) */
function utf8ToBytes(str: string): number[] {
  const bytes: number[] = []
  for (const ch of str) {
    const cp = ch.codePointAt(0)!
    if (cp < 0x80) {
      bytes.push(cp)
    }
    else if (cp < 0x800) {
      bytes.push(0xC0 | (cp >> 6), 0x80 | (cp & 0x3F))
    }
    else if (cp < 0x10000) {
      bytes.push(0xE0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F))
    }
    else {
      bytes.push(
        0xF0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3F),
        0x80 | ((cp >> 6) & 0x3F),
        0x80 | (cp & 0x3F),
      )
    }
  }
  return bytes
}

function bytesToUtf8(bytes: number[]): string {
  let out = ''
  let i = 0
  while (i < bytes.length) {
    const b = bytes[i]!
    if (b < 0x80) {
      out += String.fromCharCode(b)
      i += 1
    }
    else if (b < 0xE0) {
      out += String.fromCharCode(((b & 0x1F) << 6) | (bytes[i + 1]! & 0x3F))
      i += 2
    }
    else if (b < 0xF0) {
      out += String.fromCharCode(((b & 0x0F) << 12) | ((bytes[i + 1]! & 0x3F) << 6) | (bytes[i + 2]! & 0x3F))
      i += 3
    }
    else {
      const cp = ((b & 0x07) << 18) | ((bytes[i + 1]! & 0x3F) << 12) | ((bytes[i + 2]! & 0x3F) << 6) | (bytes[i + 3]! & 0x3F)
      out += String.fromCodePoint(cp)
      i += 4
    }
  }
  return out
}

/** Base64 编码:先 UTF-8 再 3 字节 → 4 字符,缺位补 = */
export function utf8ToBase64(input: string): string {
  const bytes = utf8ToBytes(input)
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!
    const b1 = bytes[i + 1]
    const b2 = bytes[i + 2]
    out += ALPHABET[b0 >> 2]
    out += ALPHABET[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)]
    out += b1 === undefined ? '=' : ALPHABET[((b1 & 0x0F) << 2) | ((b2 ?? 0) >> 6)]
    out += b2 === undefined ? '=' : ALPHABET[b2 & 0x3F]
  }
  return out
}

/** Base64 解码:6 bit 累积成字节流,再按 UTF-8 还原 */
export function base64ToUtf8(input: string): string {
  let acc = 0
  let bits = 0
  const bytes: number[] = []
  for (const ch of input) {
    if (ch === '=')
      break
    const v = ALPHABET.indexOf(ch)
    if (v < 0)
      continue
    acc = (acc << 6) | v
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes.push((acc >> bits) & 0xFF)
    }
  }
  return bytesToUtf8(bytes)
}
