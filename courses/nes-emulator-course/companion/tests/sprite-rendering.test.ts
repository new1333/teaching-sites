import { describe, it, expect } from 'vitest'
import { Bus } from '../src/bus.js'
import { Ppu } from '../src/ppu.js'
import { rgbOf } from '../src/palette.js'

// 场景:瓦片 1 低平面 0xF0(左 4 像素=1),高平面 0
function makeMachine() {
  const ppu = new Ppu('horizontal')
  const bus = new Bus(ppu)
  for (let r = 0; r < 16; r++) ppu.ppuWrite(0x0010 + r, r < 8 ? 0xf0 : 0x00)
  ppu.ppuWrite(0x3f00, 0x0f) // universal
  ppu.ppuWrite(0x3f01, 0x21) // 背景调色板 0 color1 = 浅蓝
  ppu.ppuWrite(0x3f11, 0x16) // 精灵调色板 0 color1 = 红
  return { ppu, bus }
}

const px = (ppu: Ppu, x: number, y: number) => {
  const i = (y * 256 + x) * 3
  return `${ppu.frameBuffer[i]},${ppu.frameBuffer[i + 1]},${ppu.frameBuffer[i + 2]}`
}

const runFrame = (ppu: Ppu) => {
  let t = 0
  while (t++ < 89342) if (ppu.tick()) break
}

/** 帧内推进到指定扫描线(观察 STATUS 标志用:标志在预渲染行被清) */
const tickToLine = (ppu: Ppu, target: number) => {
  let guard = 0
  while (ppu.scanline < target && guard++ < 89342) ppu.tick()
}

describe('精灵基础:位置、调色板与翻转', () => {
  it('精灵画在 y+1 行、x 列,瓦片左半 4 像素不透明', () => {
    const { ppu, bus } = makeMachine()
    // OAM:精灵 0:y=10, tile=1, attr=0, x=5
    bus.write(0x2003, 0x00)
    bus.write(0x2004, 10)
    bus.write(0x2004, 1)
    bus.write(0x2004, 0)
    bus.write(0x2004, 5)
    ppu.cpuWrite(1, 0x1e) // 背景+精灵全开,含最左 8 像素
    runFrame(ppu)
    runFrame(ppu)
    const red = rgbOf(0x16).join(',')
    const black = rgbOf(0x0f).join(',')
    expect(px(ppu, 5, 11)).toBe(red) // y+1 行开始
    expect(px(ppu, 8, 11)).toBe(red) // 左半 4 像素
    expect(px(ppu, 9, 11)).toBe(black) // 右半透明
    expect(px(ppu, 5, 10)).toBe(black) // y 行还没到
    expect(px(ppu, 5, 18)).toBe(red) // 第 8 行(仍在精灵内)
    expect(px(ppu, 5, 19)).toBe(black) // 精灵下方
  })

  it('水平翻转(attr bit6):图案左右镜像', () => {
    const { ppu, bus } = makeMachine()
    bus.write(0x2003, 0x00)
    bus.write(0x2004, 10)
    bus.write(0x2004, 1)
    bus.write(0x2004, 0x40) // hflip
    bus.write(0x2004, 5)
    ppu.cpuWrite(1, 0x1e)
    runFrame(ppu)
    runFrame(ppu)
    const red = rgbOf(0x16).join(',')
    const black = rgbOf(0x0f).join(',')
    expect(px(ppu, 5, 11)).toBe(black) // 原左半现在是透明
    expect(px(ppu, 9, 11)).toBe(red) // 原右半现在是不透明
    expect(px(ppu, 12, 11)).toBe(red)
  })
})

describe('精灵与背景的优先级', () => {
  it('attr bit5=0:精灵在背景前,红盖蓝;精灵透明处露背景', () => {
    const { ppu, bus } = makeMachine()
    // 背景用瓦片 3:低平面全 1(8 像素全不透明,浅蓝)
    for (let r = 0; r < 8; r++) ppu.ppuWrite(0x0030 + r, 0xff)
    ppu.ppuWrite(0x2000, 0x03)
    bus.write(0x2003, 0x00)
    bus.write(0x2004, 0) // y=0 → 显示在第 1 行
    bus.write(0x2004, 1) // 瓦片 1:左 4 像素不透明
    bus.write(0x2004, 0x00) // 前景
    bus.write(0x2004, 0)
    ppu.cpuWrite(1, 0x1e)
    runFrame(ppu)
    runFrame(ppu)
    expect(px(ppu, 0, 1)).toBe(rgbOf(0x16).join(',')) // 精灵不透明 → 红
    expect(px(ppu, 4, 1)).toBe(rgbOf(0x21).join(',')) // 精灵透明 → 露背景蓝
  })

  it('attr bit5=1:精灵在背景后,蓝盖红(精灵完全不可见)', () => {
    const { ppu, bus } = makeMachine()
    for (let r = 0; r < 8; r++) ppu.ppuWrite(0x0030 + r, 0xff)
    ppu.ppuWrite(0x2000, 0x03)
    bus.write(0x2003, 0x00)
    bus.write(0x2004, 0)
    bus.write(0x2004, 1)
    bus.write(0x2004, 0x20) // 背景后
    bus.write(0x2004, 0)
    ppu.cpuWrite(1, 0x1e)
    runFrame(ppu)
    runFrame(ppu)
    expect(px(ppu, 0, 1)).toBe(rgbOf(0x21).join(',')) // 背景不透明 → 背景赢
    expect(px(ppu, 4, 1)).toBe(rgbOf(0x21).join(',')) // 背景仍不透明
  })
})

describe('sprite 0 hit', () => {
  it('精灵 0 与背景不透明像素重叠 → STATUS bit6 置位', () => {
    const { ppu, bus } = makeMachine()
    ppu.ppuWrite(0x2000, 0x01) // 背景不透明(左 4 像素)
    bus.write(0x2003, 0x00)
    bus.write(0x2004, 0)
    bus.write(0x2004, 1)
    bus.write(0x2004, 0)
    bus.write(0x2004, 0)
    ppu.cpuWrite(1, 0x1e)
    runFrame(ppu)
    runFrame(ppu)
    tickToLine(ppu, 20) // 第 3 帧过第 1 行之后
    expect(ppu.sprite0Hit).toBe(1)
  })

  it('不重叠(或透明重叠)不置位', () => {
    const { ppu, bus } = makeMachine()
    ppu.ppuWrite(0x2000, 0x01) // 背景 (0,0) 不透明
    bus.write(0x2003, 0x00)
    bus.write(0x2004, 0)
    bus.write(0x2004, 1)
    bus.write(0x2004, 0)
    bus.write(0x2004, 100) // x=100,背景那里是空白 → 不重叠
    ppu.cpuWrite(1, 0x1e)
    runFrame(ppu)
    runFrame(ppu)
    tickToLine(ppu, 20)
    expect(ppu.sprite0Hit).toBe(0)
  })
})

describe('每线 8 精灵限制与 OAM DMA', () => {
  it('同一行第 9 个精灵不渲染,溢出标志置位', () => {
    const { ppu, bus } = makeMachine()
    for (let s = 0; s < 9; s++) {
      bus.write(0x2003, s * 4)
      bus.write(0x2004, 10) // y
      bus.write(0x2004, 1) // tile
      bus.write(0x2004, 0)
      bus.write(0x2004, s * 12) // x 错开:0,12,24,...
    }
    ppu.cpuWrite(1, 0x1e)
    runFrame(ppu)
    runFrame(ppu)
    const red = rgbOf(0x16).join(',')
    expect(px(ppu, 0, 11)).toBe(red) // 第 1 个(x=0)
    expect(px(ppu, 7 * 12, 11)).toBe(red) // 第 8 个(x=84)
    expect(px(ppu, 7 * 12 + 1, 11)).toBe(red)
    // 第 9 个(x=96)被丢弃
    expect(px(ppu, 96, 11)).toBe(rgbOf(0x0f).join(','))
    tickToLine(ppu, 20)
    expect(ppu.spriteOverflow).toBe(1)
  })

  it('$4014 DMA:整页 256 字节搬进 OAM', () => {
    const { ppu, bus } = makeMachine()
    for (let i = 0; i < 256; i++) bus.write(0x0200 + i, i ^ 0x5a)
    bus.write(0x4014, 0x02) // 源页 $0200
    expect(bus.runPendingDma()).toBe(true)
    for (let i = 0; i < 256; i++) expect(ppu.oam[i]).toBe(i ^ 0x5a)
    expect(bus.runPendingDma()).toBe(false) // 一次性
  })

  it('DMA 从 OAMADDR=0 开始写;$2004 写也会推进 OAMADDR', () => {
    const { ppu, bus } = makeMachine()
    bus.write(0x2003, 0x00)
    bus.write(0x2004, 0x42)
    expect(ppu.oamAddr).toBe(1)
    bus.write(0x2003, 0x00)
    bus.write(0x4014, 0x02)
    bus.runPendingDma()
    expect(ppu.oamAddr).toBe(0) // 256 字节后回卷
  })
})
