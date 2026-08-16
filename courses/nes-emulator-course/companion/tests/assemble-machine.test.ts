import { describe, it, expect } from 'vitest'
import { Nes } from '../src/nes.js'
import { rgbOf } from '../src/palette.js'

// 自制「Hello 图块」测试卡带:iNES 头 + 手写 6502 程序。
// 程序:等 2 次 vblank → 上传调色板/CHR-RAM 图案/命名表 → 开 NMI 与背景 → 主循环空转;
//      NMI 例程读手柄,按住 A 时把格 (2,0) 改成瓦片 2。
export function buildRom(): Uint8Array {
  const prg = new Uint8Array(0x4000)
  const p = (off: number, bytes: number[]) => prg.set(bytes, off)
  p(0x0000, [0x78, 0xd8, 0xa2, 0xff, 0x9a]) // SEI CLD LDX #$FF TXS
  p(0x0005, [0x2c, 0x02, 0x20, 0x10, 0xfb]) // w1: BIT $2002; BPL w1
  p(0x000a, [0x2c, 0x02, 0x20, 0x10, 0xfb]) // w2: BIT $2002; BPL w2
  // 调色板:$3F00 黑 / $3F01 蓝 / $3F02 红
  p(0x000f, [0xa9, 0x3f, 0x8d, 0x06, 0x20, 0xa9, 0x00, 0x8d, 0x06, 0x20])
  p(0x0019, [0xa9, 0x0f, 0x8d, 0x07, 0x20])
  p(0x001e, [0xa9, 0x21, 0x8d, 0x07, 0x20])
  p(0x0023, [0xa9, 0x16, 0x8d, 0x07, 0x20])
  // CHR-RAM 瓦片 1($0010):低平面 8×$F0,高平面 8×$00(左 4 像素 = 1)
  p(0x0028, [0xa9, 0x00, 0x8d, 0x06, 0x20, 0xa9, 0x10, 0x8d, 0x06, 0x20])
  for (let i = 0; i < 8; i++) p(0x0032 + i * 5, [0xa9, 0xf0, 0x8d, 0x07, 0x20])
  for (let i = 0; i < 8; i++) p(0x0052 + i * 5, [0xa9, 0x00, 0x8d, 0x07, 0x20])
  // CHR-RAM 瓦片 2($0020):低平面 8×$0F(右 4 像素 = 1)
  p(0x0072, [0xa9, 0x00, 0x8d, 0x06, 0x20, 0xa9, 0x20, 0x8d, 0x06, 0x20])
  for (let i = 0; i < 8; i++) p(0x007c + i * 5, [0xa9, 0x0f, 0x8d, 0x07, 0x20])
  for (let i = 0; i < 8; i++) p(0x009c + i * 5, [0xa9, 0x00, 0x8d, 0x07, 0x20])
  // 命名表格 (0,0) = 瓦片 1;开 NMI 与背景
  p(0x00bc, [0xa9, 0x20, 0x8d, 0x06, 0x20, 0xa9, 0x00, 0x8d, 0x06, 0x20])
  p(0x00c6, [0xa9, 0x01, 0x8d, 0x07, 0x20])
  p(0x00cb, [0xa9, 0x80, 0x8d, 0x00, 0x20]) // PPUCTRL:NMI on
  p(0x00d0, [0xa9, 0x0a, 0x8d, 0x01, 0x20]) // PPUMASK:背景 + 最左 8 像素
  p(0x00d5, [0x4c, 0xd5, 0x80]) // main: JMP main
  // NMI 例程($9000):读手柄 A 键,按住则写格 (2,0) = 瓦片 2;
  // 末尾重写 $2006 恢复滚动——$2006 残留会改 t,下帧画面会竖移(真机行为)
  p(0x1000, [0xa9, 0x01, 0x8d, 0x16, 0x40]) // strobe on
  p(0x1005, [0xa9, 0x00, 0x8d, 0x16, 0x40]) // strobe off
  p(0x100a, [0xad, 0x16, 0x40]) // LDA $4016(A 键位)
  p(0x100d, [0xf0, 0x0f]) // BEQ restore($901E)
  p(0x100f, [0xa9, 0x20, 0x8d, 0x06, 0x20, 0xa9, 0x02, 0x8d, 0x06, 0x20]) // PPUADDR $2002
  p(0x1019, [0xa9, 0x02, 0x8d, 0x07, 0x20]) // 格 (2,0) = 瓦片 2
  p(0x101e, [0xa9, 0x20, 0x8d, 0x06, 0x20, 0xa9, 0x00, 0x8d, 0x06, 0x20]) // restore: PPUADDR $2000
  p(0x1028, [0x40]) // RTI
  p(0x1029, [0x40]) // IRQ 桩: RTI
  // 向量:NMI=$9000 复位=$8000 IRQ=$9029
  p(0x3ffa, [0x00, 0x90, 0x00, 0x80, 0x29, 0x90])
  // iNES 头:1 块 PRG(16K,镜像到 $C000)、0 块 CHR(CHR-RAM)、水平镜像
  const rom = new Uint8Array(16 + 0x4000)
  rom.set([0x4e, 0x45, 0x53, 0x1a, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
  rom.set(prg, 16)
  return rom
}

export const px = (nes: Nes, x: number, y: number) => {
  const i = (y * 256 + x) * 3
  const fb = nes.ppu.frameBuffer
  return `${fb[i]},${fb[i + 1]},${fb[i + 2]}`
}

describe('整机组装:从 .nes 字节到画面', () => {
  it('16K PRG 镜像到 $C000,Nes.loadRom 装载并复位', () => {
    const nes = new Nes()
    nes.loadRom(buildRom())
    expect(nes.bus.read(0x8000)).toBe(0x78)
    expect(nes.bus.read(0xc000)).toBe(0x78) // 镜像
    expect(nes.cpu.PC).toBe(0x8000)
  })

  it('非 NROM 卡带拒绝装载并说明原因', () => {
    const nes = new Nes()
    const rom = buildRom()
    rom[6] = 0x10 // mapper 低 nibble = 1
    expect(() => nes.loadRom(rom)).toThrow(/mapper/)
  })

  it('端到端:程序上传 CHR-RAM/调色板/命名表,画面出现瓦片 1', () => {
    const nes = new Nes()
    nes.loadRom(buildRom())
    nes.runFrame()
    nes.runFrame()
    nes.runFrame()
    const blue = rgbOf(0x21).join(',')
    const black = rgbOf(0x0f).join(',')
    expect(px(nes, 0, 0)).toBe(blue) // 瓦片 1 左半(CHR-RAM 里程序写的图案)
    expect(px(nes, 3, 0)).toBe(blue)
    expect(px(nes, 4, 0)).toBe(black)
    expect(px(nes, 16, 0)).toBe(black) // 格 (2,0) 还是空白
  })

  it('端到端:按住 A,NMI 例程读到按键并把格 (2,0) 换成瓦片 2', () => {
    const nes = new Nes()
    nes.loadRom(buildRom())
    nes.runFrame()
    nes.runFrame()
    nes.runFrame()
    const blue = rgbOf(0x21).join(',')
    const black = rgbOf(0x0f).join(',')
    nes.setButton(0, 'A', true)
    nes.runFrame()
    nes.runFrame()
    expect(px(nes, 20, 0)).toBe(blue) // 瓦片 2 右半(低平面 $0F)
    expect(px(nes, 23, 0)).toBe(blue)
    expect(px(nes, 16, 0)).toBe(black) // 左半透明
    expect(px(nes, 0, 0)).toBe(blue) // 原画面不受影响
  })

  it('CHR-ROM 卡带:图案只读,PPU 侧写入被忽略', () => {
    const nes = new Nes()
    const base = buildRom()
    const rom = new Uint8Array(base.length + 0x2000) // 追加 8K CHR-ROM
    rom.set(base)
    rom[5] = 1 // 1 块 CHR-ROM
    const chr = new Uint8Array(0x2000)
    chr[0x30] = 0xff // 瓦片 3 低平面:全 1
    rom.set(chr, 16 + 0x4000)
    nes.loadRom(rom)
    expect(nes.ppu.ppuRead(0x0030)).toBe(0xff)
    nes.ppu.ppuWrite(0x0030, 0x00) // CHR-ROM 写无效
    expect(nes.ppu.ppuRead(0x0030)).toBe(0xff)
  })
})
