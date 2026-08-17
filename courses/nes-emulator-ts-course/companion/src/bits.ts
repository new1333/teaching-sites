// 字节与位运算工具：第 1 章的数字语言落地成代码，全书所有模块的公共地基。

export function toHex(n: number): string {
  return (n & 0xff).toString(16).toUpperCase().padStart(2, '0')
}

export function toHex16(n: number): string {
  return (n & 0xffff).toString(16).toUpperCase().padStart(4, '0')
}

export function lo(word: number): number {
  return word & 0xff
}

export function hi(word: number): number {
  return (word >> 8) & 0xff
}

export function word(lo: number, hi: number): number {
  return ((hi & 0xff) << 8) | (lo & 0xff)
}

export function toSigned(n: number): number {
  return (n << 24) >> 24
}

export function readBit(n: number, bit: number): number {
  return (n >> bit) & 1
}

export function writeBit(n: number, bit: number, v: boolean | number): number {
  const mask = 1 << bit
  return v ? n | mask : n & ~mask
}
