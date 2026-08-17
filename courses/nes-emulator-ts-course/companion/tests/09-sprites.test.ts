import { describe, it, expect } from 'vitest'
import { PPU } from '../src/ppu'

const full = (v: number) => new Array<number>(8).fill(v)

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

// 条纹 tile：每行 3 2 1 0 循环（含透明像素），用于翻转与遮挡断言
const striped = { lo: full(0xaa), hi: full(0xcc) }
// 实心 tile：全 1 号色
const solid1 = { lo: full(0xff), hi: full(0x00) }
// 实心 tile：全 2 号色
const solid2 = { lo: full(0x00), hi: full(0xff) }

const chr = makeChr({ 1: solid1, 2: solid2, 3: striped, 4: striped })

// 装机：透明背景（全 tile 0）+ 精灵调色板 0 = [x 16 27 18]，可选背景与 OAM
function spriteFixture(opts: {
  oam?: number[] // 256 字节 OAM 内容
  bg?: (i: number) => number // nametable 布局（缺省全 0）
  ctrlExtra?: number
  drawBackground?: boolean
}): PPU {
  const ppu = new PPU('horizontal', chr)
  ppu.ctrl = opts.ctrlExtra ?? 0
  // 调色板：背景 0 = [0F 01 02 03]；精灵 0 = [x 16 27 18]
  const pal = [0x0f, 0x01, 0x02, 0x03, 0x0f, 0x11, 0x12, 0x13, 0x0f, 0x21, 0x22, 0x23, 0x0f, 0x31, 0x32, 0x33,
    0x0f, 0x16, 0x27, 0x18, 0x0f, 0x0f, 0x0f, 0x0f, 0x0f, 0x0f, 0x0f, 0x0f, 0x0f, 0x0f, 0x0f, 0x0f]
  for (let i = 0; i < 32; i++) ppu.paletteRam[i] = pal[i]
  for (let i = 0; i < 960; i++) ppu.vram[i] = opts.bg?.(i) ?? 0
  for (let i = 0; i < 64; i++) ppu.vram[0x3c0 + i] = 0
  const oam = opts.oam ?? []
  for (let i = 0; i < 256; i++) ppu.oam[i] = oam[i] ?? 0
  if (opts.drawBackground ?? true) ppu.renderBackground()
  return ppu
}

// OAM 项快捷构造：[Y, tile, attr, X]
const sprite = (y: number, tile: number, attr: number, x: number, at = 0): number[] => {
  const arr: number[] = []
  arr[at * 4] = y
  arr[at * 4 + 1] = tile
  arr[at * 4 + 2] = attr
  arr[at * 4 + 3] = x
  return arr
}

const px = (frame: number[], x: number, y: number): number => frame[y * 256 + x]

describe('精灵：位置与图案', () => {
  it('画在 (X, Y+1)：真机精灵 Y 少一格的偏移', () => {
    const ppu = spriteFixture({ oam: sprite(10, 1, 0, 20) })
    ppu.renderSprites()
    expect(px(ppu.frameBuffer, 20, 10)).toBe(0x0f) // Y 行本身：还在上方
    expect(px(ppu.frameBuffer, 20, 11)).toBe(0x16) // Y+1 起才是精灵
  })

  it('透明像素（色号 0）不覆盖背景', () => {
    // 背景 (0,0) 格放实心 tile 1（1 号色）；精灵条纹 tile 3 叠在 (0,1) 起
    const oam = new Array<number>(256).fill(0)
    oam[0] = 0 // Y=0 → 显示从扫描线 1 起
    oam[1] = 3
    oam[2] = 0
    oam[3] = 0
    const ppu = spriteFixture({ oam, bg: i => (i === 0 ? 1 : 0) })
    ppu.renderSprites()
    expect(px(ppu.frameBuffer, 0, 1)).toBe(0x18) // 精灵色号 3 → 精灵调色板 0 的 3 号色
    expect(px(ppu.frameBuffer, 1, 1)).toBe(0x27) // 精灵色号 2
    expect(px(ppu.frameBuffer, 3, 1)).toBe(0x01) // 精灵透明 → 背景的 1 号色
  })

  it('优先级位 bit5=1：精灵躲到背景后面', () => {
    // 背景实心 + 精灵实心、优先级=1 → 背景赢；把背景那格清成透明 → 精灵可见
    const solid = spriteFixture({ oam: sprite(0, 1, 0b100000, 0), bg: () => 1 })
    solid.renderSprites()
    expect(px(solid.frameBuffer, 0, 1)).toBe(0x01) // 背景实心：精灵被挡
    const hole = spriteFixture({ oam: sprite(0, 1, 0b100000, 0), bg: () => 0 })
    hole.renderSprites()
    expect(px(hole.frameBuffer, 0, 1)).toBe(0x16) // 背景透明：精灵露出
  })

  it('OAM 序号小的精灵压在序号大的上面', () => {
    // sprite0（1 号色 tile）与 sprite1（2 号色 tile）重叠于扫描线 1
    const oam = new Array<number>(256).fill(0)
    oam[0] = 0; oam[1] = 1; oam[2] = 0; oam[3] = 0    // sprite0 在 (0,1) 起
    oam[4] = 0; oam[5] = 2; oam[6] = 0; oam[7] = 4    // sprite1 在 (4,1) 起，与 sprite0 重叠
    const ppu = spriteFixture({ oam })
    ppu.renderSprites()
    expect(px(ppu.frameBuffer, 4, 1)).toBe(0x16) // 重叠处：sprite0 盖住 sprite1
    expect(px(ppu.frameBuffer, 0, 1)).toBe(0x16) // sprite0 自己的区域
  })
})

describe('精灵：翻转与 8x16', () => {
  it('水平翻转：条纹 3 2 1 0 变 0 1 2 3', () => {
    const oam = new Array<number>(256).fill(0)
    oam[0] = 0; oam[1] = 4; oam[2] = 0b01000000; oam[3] = 0 // H 翻转，显示从行 1 起
    const ppu = spriteFixture({ oam })
    ppu.renderSprites()
    expect(px(ppu.frameBuffer, 0, 1)).toBe(0x0f) // 原第 4 像素（色号 0）翻到最左：透明
    expect(px(ppu.frameBuffer, 3, 1)).toBe(0x18) // 原第 1 像素（3 号色）翻到第 4 位
  })

  it('8x16 模式：偶数 tile 基址，上下两块图案', () => {
    // ctrl bit5=1；tile 2（偶基址）→ 上半 tile 2、下半 tile 3
    const oam = new Array<number>(256).fill(0)
    oam[0] = 0; oam[1] = 2; oam[2] = 0; oam[3] = 0
    const ppu = spriteFixture({ oam, ctrlExtra: 0x20 })
    ppu.renderSprites()
    // 行 1-8 是 tile 2（全 2 号色 0x27），行 9-16 是 tile 3（条纹首像素 3 号色 0x18）
    expect(px(ppu.frameBuffer, 0, 1)).toBe(0x27)
    expect(px(ppu.frameBuffer, 1, 1)).toBe(0x27)
    expect(px(ppu.frameBuffer, 0, 9)).toBe(0x18)
  })

  it('每条扫描线最多 8 个：第 9 个精灵不画', () => {
    const oam = new Array<number>(256).fill(0)
    for (let s = 0; s < 9; s++) {
      oam[s * 4] = 0 // 全部压在扫描线 1
      oam[s * 4 + 1] = s === 8 ? 2 : 1 // 前 8 个用 1 号色 tile，第 9 个用 2 号色
      oam[s * 4 + 2] = 0
      oam[s * 4 + 3] = s * 8 // 各占一列
    }
    const ppu = spriteFixture({})
    ppu.oam.set(oam)
    ppu.renderBackground()
    ppu.renderSprites()
    expect(px(ppu.frameBuffer, 0, 1)).toBe(0x16) // sprite0 画了
    expect(px(ppu.frameBuffer, 8 * 8, 1)).toBe(0x0f) // sprite8（第 9 个）被裁
  })
})

describe('sprite 0 hit', () => {
  it('0 号精灵与背景非透明像素重叠时置位', () => {
    const ppu = spriteFixture({ oam: sprite(0, 1, 0, 0), bg: () => 1 })
    ppu.renderSprites()
    expect(ppu.sprite0Hit).toBe(true)
  })

  it('背景全透明时不置位', () => {
    const ppu = spriteFixture({ oam: sprite(0, 1, 0, 0), bg: () => 0 })
    ppu.renderSprites()
    expect(ppu.sprite0Hit).toBe(false)
  })

  it('非 0 号精灵重叠不置位', () => {
    const ppu = spriteFixture({ oam: sprite(0, 1, 0, 0, 1), bg: () => 1 })
    ppu.renderSprites()
    expect(ppu.sprite0Hit).toBe(false)
  })
})
