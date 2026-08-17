import { describe, it, expect } from 'vitest'
import { NES } from '../src/nes'
import { demoRom } from '../src/demoRom'

// 浏览器试机台的内置卡带：开机出棋盘 + 笑脸，方向键推动。
// 这里在 node 侧把同一张卡带跑通，页面端的画面与手柄闭环就有了回归保障。

describe('内置试机带', () => {
  function boot(): NES {
    const nes = new NES(demoRom())
    for (let i = 0; i < 5; i++) nes.frame() // 初始化 + 几帧 NMI
    return nes
  }

  it('开机画面：棋盘背景两色 + 笑脸精灵的白与红', () => {
    const nes = boot()
    const colors = new Set(nes.ppu.frameBuffer)
    expect(colors.has(0x21)).toBe(true) // 棋盘格底色
    expect(colors.has(0x12)).toBe(true) // 棋盘格点阵色
    expect(colors.has(0x30)).toBe(true) // 笑脸轮廓（白）
    expect(colors.has(0x16)).toBe(true) // 笑脸五官（红）
  })

  it('NMI + OAM DMA 闭环：0 号精灵就位、其余藏屏外', () => {
    const nes = boot()
    expect(nes.ppu.oam[0]).toBe(123) // Y
    expect(nes.ppu.oam[1]).toBe(3) // tile 3 = 笑脸
    expect(nes.ppu.oam[3]).toBe(124) // X
    expect(nes.ppu.oam[4]).toBe(0xf0) // 1 号精灵 Y 在屏幕外
  })

  it('手柄读序：按 Right 每帧 2 像素，30 帧 X 从 124 走到 184', () => {
    const nes = boot()
    for (let i = 0; i < 30; i++) nes.frame({ Right: true })
    expect(nes.ppu.oam[3]).toBe(184)
  })

  it('松开 Right 改按 Up：X 停住、Y 每帧 2 像素上移', () => {
    const nes = boot()
    for (let i = 0; i < 30; i++) nes.frame({ Right: true })
    for (let i = 0; i < 10; i++) nes.frame({ Right: false, Up: true })
    expect(nes.ppu.oam[3]).toBe(184) // X 不再动
    expect(nes.ppu.oam[0]).toBe(103) // 123 - 2×10
  })
})
