import { describe, it, expect } from 'vitest'
import { parseINES } from '../src/ines.js'

// 测试自构 .nes 字节串:16 字节头 + [trainer] + PRG + CHR
function buildRom(opts: {
  prgBanks?: number
  chrBanks?: number
  flags6?: number
  flags7?: number
  trainer?: boolean
  prgFill?: number
}): Uint8Array {
  const prgBanks = opts.prgBanks ?? 2
  const chrBanks = opts.chrBanks ?? 1
  const flags6 =
    (opts.flags6 ?? 0) | (opts.trainer ? 0x04 : 0)
  const flags7 = opts.flags7 ?? 0
  const total =
    16 + (opts.trainer ? 512 : 0) + prgBanks * 16384 + chrBanks * 8192
  const rom = new Uint8Array(total)
  rom.set([0x4e, 0x45, 0x53, 0x1a], 0) // 'N' 'E' 'S' 0x1A
  rom[4] = prgBanks
  rom[5] = chrBanks
  rom[6] = flags6
  rom[7] = flags7
  let off = 16
  if (opts.trainer) {
    rom.fill(0xaa, off, off + 512)
    off += 512
  }
  rom.fill(opts.prgFill ?? 0x11, off, off + prgBanks * 16384)
  off += prgBanks * 16384
  if (chrBanks > 0) rom.fill(0x22, off, off + chrBanks * 8192)
  return rom
}

describe('parseINES:基础解析', () => {
  it('拆出 PRG/CHR 长度与默认镜像(mapper 0, flags6=0 → 水平镜像)', () => {
    const cart = parseINES(buildRom({ flags6: 0 }))
    expect(cart.prgRom).toHaveLength(2 * 16384)
    expect(cart.chrRom).toHaveLength(8192)
    expect(cart.mapper).toBe(0)
    expect(cart.mirroring).toBe('horizontal')
  })

  it('flags6 bit0=1 → 垂直镜像', () => {
    const cart = parseINES(buildRom({ flags6: 0x01 }))
    expect(cart.mirroring).toBe('vertical')
  })

  it('flags6 bit3=1 → 四屏镜像(优先于 bit0)', () => {
    const cart = parseINES(buildRom({ flags6: 0x09 }))
    expect(cart.mirroring).toBe('fourScreen')
  })

  it('PRG 内容从头部之后开始(不受 CHR 位置影响)', () => {
    const cart = parseINES(buildRom({ prgFill: 0x7f }))
    expect(cart.prgRom[0]).toBe(0x7f)
    expect(cart.prgRom[cart.prgRom.length - 1]).toBe(0x7f)
    expect(cart.chrRom?.[0]).toBe(0x22)
  })
})

describe('parseINES:trainer 与 mapper 号', () => {
  it('有 trainer 时跳过 512 字节再读 PRG', () => {
    const rom = buildRom({ trainer: true })
    const cart = parseINES(rom)
    expect(cart.prgRom).toHaveLength(2 * 16384)
    expect(cart.prgRom[0]).toBe(0x11) // 不是 trainer 的 0xaa
  })

  it('mapper 号 = flags7 高 4 位 << 4 | flags6 高 4 位', () => {
    // flags6 高 nibble=2(低 4 位 mapper),flags7 高 nibble=3(高 4 位 mapper)
    const cart = parseINES(buildRom({ flags6: 0x20, flags7: 0x30 }))
    expect(cart.mapper).toBe(0x32)
  })

  it('NES 2.0 头(flags7 bit2-3=10)时 mapper 取 12 位(加 flags8 低 nibble)', () => {
    // flags6 高 nibble=2,flags7 高 nibble=3 且 bit2-3=10(0x38),flags8 低 nibble=2
    const rom = buildRom({ flags6: 0x20, flags7: 0x38 })
    rom[8] = 0x02
    const cart = parseINES(rom)
    expect(cart.mapper).toBe(0x232)
  })
})

describe('parseINES:CHR-RAM 与错误处理', () => {
  it('chrBanks=0 → chrRom 为 null(CHR-RAM 卡带)', () => {
    const cart = parseINES(buildRom({ chrBanks: 0 }))
    expect(cart.chrRom).toBeNull()
  })

  it('魔数错误 → 抛错并说明原因', () => {
    const bad = buildRom({})
    bad[0] = 0x00
    expect(() => parseINES(bad)).toThrow(/magic|iNES/i)
  })

  it('文件截断(长度不足)→ 抛错', () => {
    const rom = buildRom({})
    expect(() => parseINES(rom.slice(0, rom.length - 100))).toThrow(/长度|截断|truncat/i)
  })
})
