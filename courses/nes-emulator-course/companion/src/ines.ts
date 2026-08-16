// iNES 格式解析:把 .nes 文件拆成卡带数据结构。
// 格式:16 字节头 + [512 字节 trainer] + PRG-ROM + CHR-ROM(可缺席)。

export type Mirroring = 'horizontal' | 'vertical' | 'fourScreen'

export interface Cartridge {
  prgRom: Uint8Array
  /** null 表示卡带上没有图案 ROM,PPU 侧用可写的 CHR-RAM 代替 */
  chrRom: Uint8Array | null
  mapper: number
  mirroring: Mirroring
}

export function parseINES(data: Uint8Array): Cartridge {
  if (data.length < 16) throw new Error('iNES:文件太短,连 16 字节头都不够')
  if (data[0] !== 0x4e || data[1] !== 0x45 || data[2] !== 0x53 || data[3] !== 0x1a) {
    throw new Error('iNES:magic 错误,不是 .nes 文件')
  }

  const prgBanks = data[4]
  const chrBanks = data[5]
  const flags6 = data[6]
  const flags7 = data[7]

  // flags7 的 bit2-3 是格式版本:00 = iNES,10 = NES 2.0,其余视为 iNES(历史文件很脏)
  const isNes20 = (flags7 & 0x0c) === 0x08

  // mapper 号低 4 位在 flags6 高 nibble,高 4 位在 flags7 高 nibble;
  // NES 2.0 再加 flags8 低 nibble(第 8-11 位)
  let mapper = (flags7 & 0xf0) | (flags6 >> 4)
  if (isNes20) mapper |= (data[8] & 0x0f) << 8

  // 镜像:bit3 四屏优先;否则 bit0 决定水平/垂直
  const mirroring: Mirroring =
    flags6 & 0x08 ? 'fourScreen' : flags6 & 0x01 ? 'vertical' : 'horizontal'

  let off = 16
  if (flags6 & 0x04) off += 512 // trainer,模拟器用不到,整体跳过

  const prgSize = prgBanks * 16384
  const chrSize = chrBanks * 8192
  if (off + prgSize + chrSize > data.length) {
    throw new Error(`iNES:文件被截断,声明 ${prgSize} 字节 PRG + ${chrSize} 字节 CHR,实际读不满`)
  }

  const prgRom = data.slice(off, off + prgSize)
  off += prgSize
  const chrRom = chrBanks > 0 ? data.slice(off, off + chrSize) : null

  return { prgRom, chrRom, mapper, mirroring }
}
