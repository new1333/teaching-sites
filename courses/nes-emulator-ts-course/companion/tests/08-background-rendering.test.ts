import { describe, it, expect } from 'vitest'
import { PPU } from '../src/ppu'

// 造一批已知图案的 CHR：tile n 的低平面、高平面按需注入
// 每块 tile 占 16 字节：前 8 字节低平面（8 行），后 8 字节高平面
function makeChr(tiles: Record<number, { lo: number[]; hi: number[] }>): Uint8Array {
  const chr = new Uint8Array(0x2000)
  for (const [n_, planes] of Object.entries(tiles)) {
    const n = Number(n_)
    for (let y = 0; y < 8; y++) {
      chr[n * 16 + y] = planes.lo[y]
      chr[n * 16 + 8 + y] = planes.hi[y]
    }
  }
  return chr
}

const full = (v: number) => new Array<number>(8).fill(v)

// 装一台带已知图案的 PPU：默认调色板 bg0 = [0F 01 02 03]、bg1 = [0F 11 12 13]
function renderFixture(opts: {
  chr: Uint8Array
  nt?: (i: number) => number // nametable 0 的 960 格布局
  attr?: (i: number) => number // 属性表 64 格
  ctrlExtra?: number
  palette?: number[] // 32 格调色板（缺省自动填两组背景色）
}): number[] {
  const ppu = new PPU('horizontal', opts.chr)
  ppu.ctrl = opts.ctrlExtra ?? 0
  const pal = opts.palette ?? [
    0x0f, 0x01, 0x02, 0x03, // 背景调色板 0
    0x0f, 0x11, 0x12, 0x13, // 背景调色板 1
    0x0f, 0x21, 0x22, 0x23, 0x0f, 0x31, 0x32, 0x33,
    0x0f, 0x0f, 0x0f, 0x0f, 0x0f, 0x0f, 0x0f, 0x0f,
    0x0f, 0x0f, 0x0f, 0x0f, 0x0f, 0x0f, 0x0f, 0x0f,
  ]
  for (let i = 0; i < 32; i++) ppu.paletteRam[i] = pal[i]
  for (let i = 0; i < 960; i++) ppu.vram[i] = opts.nt?.(i) ?? 0
  for (let i = 0; i < 64; i++) ppu.vram[0x3c0 + i] = opts.attr?.(i) ?? 0
  return ppu.renderBackground()
}

const px = (frame: number[], x: number, y: number): number => frame[y * 256 + x]

describe('背景渲染：图块 → 像素', () => {
  const chr = makeChr({
    1: { lo: full(0xff), hi: full(0x00) }, // 全 1 号色
    3: { lo: full(0xaa), hi: full(0xcc) }, // 逐像素 3 2 1 0 循环
  })

  it('tile 1 在 (0,0)、调色板 0：整块 8×8 全是 1 号色 0x01', () => {
    const frame = renderFixture({ chr, nt: i => (i === 0 ? 1 : 0) })
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++) expect(px(frame, x, y)).toBe(0x01)
  })

  it('空 nametable 区域（tile 0 全零图案）：落通用背景色 0x0F', () => {
    const frame = renderFixture({ chr, nt: () => 0 })
    expect(px(frame, 100, 100)).toBe(0x0f)
  })

  it('位平面合并：tile 3 每行像素序列 3 2 1 0（调色板 0 色 03 02 01 0F）', () => {
    const frame = renderFixture({ chr, nt: i => (i === 0 ? 3 : 0) })
    expect(px(frame, 0, 0)).toBe(0x03)
    expect(px(frame, 1, 0)).toBe(0x02)
    expect(px(frame, 2, 0)).toBe(0x01)
    expect(px(frame, 3, 0)).toBe(0x0f) // 色号 0 → 通用背景色
    expect(px(frame, 4, 0)).toBe(0x03) // 循环
  })

  it('属性表：32×32 像素区选调色板——bits2-3 管右侧象限 → 调色板 1', () => {
    // 属性格 0 覆盖 (0,0)-(31,31)：tile 列 0-1 左象限、列 2-3 右象限
    const frame = renderFixture({
      chr,
      nt: i => (i === 0 || i === 2 ? 1 : 0),
      attr: () => 0x04,
    })
    expect(px(frame, 0, 0)).toBe(0x01) // 左象限（列 0）：调色板 0
    expect(px(frame, 16, 0)).toBe(0x11) // 右象限（列 2）：调色板 1
  })

  it('PPUCTRL bit4 选 $1000 图案表：图案放右半区才取得到', () => {
    const chrRight = new Uint8Array(0x2000)
    // tile 1 在 $1000 表：偏移 0x1000 + 1*16
    for (let y = 0; y < 8; y++) {
      chrRight[0x1000 + 16 + y] = 0xff // 低平面全 1
      chrRight[0x1000 + 16 + 8 + y] = 0x00
    }
    const frame = renderFixture({ chr: chrRight, nt: i => (i === 0 ? 1 : 0), ctrlExtra: 0x10 })
    expect(px(frame, 0, 0)).toBe(0x01)
    // 对照：不置 bit4（用 $0000 表）时该处没有图案 → 背景色
    const frameLeft = renderFixture({ chr: chrRight, nt: i => (i === 0 ? 1 : 0) })
    expect(px(frameLeft, 0, 0)).toBe(0x0f)
  })

  it('30 行 × 32 列整屏渲染：61440 像素全有着落', () => {
    const frame = renderFixture({ chr, nt: () => 1 })
    expect(frame.length).toBe(256 * 240)
    // 最后一格 (255,239) 也是 1 号色
    expect(px(frame, 255, 239)).toBe(0x01)
  })
})
