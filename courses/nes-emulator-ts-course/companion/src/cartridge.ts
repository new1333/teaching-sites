// iNES 卡带解析：把 .nes 文件字节流拆成 PRG 程序区、CHR 图案区与卡带元信息。

export interface Cartridge {
  prgRom: Uint8Array // 给 CPU 执行的程序
  chrRom: Uint8Array // 给 PPU 用的图案数据
  mapper: number // 卡带换页电路编号（本课程只支持 0 号 NROM）
  mirroring: 'horizontal' | 'vertical' // nametable 镜像方向（画面部分用到）
}

const MAGIC = [0x4e, 0x45, 0x53, 0x1a]

export function parseINES(bytes: Uint8Array): Cartridge {
  for (let i = 0; i < 4; i++) {
    if (bytes[i] !== MAGIC[i]) {
      throw new Error(`not an iNES file: bad magic ${bytes.slice(0, 4).join(',')}`)
    }
  }
  const prgBanks = bytes[4] // 每单位 16KB
  const chrBanks = bytes[5] // 每单位 8KB
  const flags6 = bytes[6]
  const flags7 = bytes[7]
  const mapper = ((flags7 & 0xf0) | (flags6 >> 4)) as number
  const hasTrainer = (flags6 & 0b100) !== 0
  const mirroring = (flags6 & 1) === 1 ? 'vertical' : 'horizontal'

  let offset = 16 + (hasTrainer ? 512 : 0)
  const prgRom = bytes.slice(offset, offset + prgBanks * 0x4000)
  offset += prgBanks * 0x4000
  const chrRom = bytes.slice(offset, offset + chrBanks * 0x2000)

  return { prgRom, chrRom, mapper, mirroring }
}
