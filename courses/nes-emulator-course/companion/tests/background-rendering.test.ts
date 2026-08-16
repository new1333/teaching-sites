import { describe, it, expect } from 'vitest'
import { Ppu } from '../src/ppu.js'
import { rgbOf } from '../src/palette.js'

// 迷你场景:图块表放两个瓦片,命名表 0 的 (0,0) 画瓦片 1,其余空白
function makePpu(mirroring: 'horizontal' | 'vertical' = 'horizontal') {
  const ppu = new Ppu(mirroring)
  // 瓦片 1:低平面每行 0xF0(左 4 像素=1),高平面全 0 → 左半 value1,右半 value0
  for (let r = 0; r < 8; r++) {
    ppu.ppuWrite(0x0010 + r, 0xf0)
    ppu.ppuWrite(0x0018 + r, 0x00)
  }
  // 瓦片 2:低平面每行 0x0F(右 4 像素=1) → 右半 value1
  for (let r = 0; r < 8; r++) ppu.ppuWrite(0x0020 + r, 0x0f)
  ppu.ppuWrite(0x2000, 0x01) // 命名表 0 格 (0,0) = 瓦片 1
  // 调色板:universal=$0F(近黑),背景调色板0 的 color1=$21(浅蓝),color2=$16(红)
  ppu.ppuWrite(0x3f00, 0x0f)
  ppu.ppuWrite(0x3f01, 0x21)
  ppu.ppuWrite(0x3f02, 0x16)
  return ppu
}

function runFrame(ppu: Ppu): number {
  let ticks = 0
  while (ticks < 89342 * 2) {
    ticks++
    if (ppu.tick()) break
  }
  return ticks
}

/** 跑两帧再断言:第 0 行的开头两块瓦片由预渲染行预取,冷启动第一帧取不到——真机行为 */
function runTwoFrames(ppu: Ppu): void {
  runFrame(ppu)
  runFrame(ppu)
}

const px = (ppu: Ppu, x: number, y: number) => {
  const i = (y * 256 + x) * 3
  return `${ppu.frameBuffer[i]},${ppu.frameBuffer[i + 1]},${ppu.frameBuffer[i + 2]}`
}

describe('背景渲染:基础流水线', () => {
  it('开背景后,瓦片 1 的左半 4 像素是调色板 color1,右半与周围是 universal', () => {
    const ppu = makePpu()
    ppu.cpuWrite(1, 0x0a) // 开背景 + 显示最左 8 像素 // PPUMASK:开背景
    runTwoFrames(ppu)
    const blue = rgbOf(0x21).join(',')
    const black = rgbOf(0x0f).join(',')
    expect(px(ppu, 0, 0)).toBe(blue)
    expect(px(ppu, 1, 0)).toBe(blue)
    expect(px(ppu, 3, 0)).toBe(blue)
    expect(px(ppu, 4, 0)).toBe(black) // 瓦片右半透明
    expect(px(ppu, 7, 0)).toBe(black)
    expect(px(ppu, 8, 0)).toBe(black) // 格 (1,0) 空白瓦片
    expect(px(ppu, 0, 7)).toBe(blue) // 瓦片第 8 行仍是同图案
    expect(px(ppu, 0, 8)).toBe(black) // 下一格是空白瓦片
  })

  it('渲染关闭时整帧都是 universal 颜色', () => {
    const ppu = makePpu()
    runFrame(ppu)
    const black = rgbOf(0x0f).join(',')
    expect(px(ppu, 0, 0)).toBe(black)
    expect(px(ppu, 128, 120)).toBe(black)
  })

  it('一帧 89342 个 dot(偶数帧;奇数帧跳点在帧时序章引入并验证)', () => {
    const ppu = makePpu()
    ppu.cpuWrite(1, 0x0a) // 开背景 + 显示最左 8 像素
    const ticks = runFrame(ppu)
    expect(ticks).toBe(89342)
  })
})

describe('fine-X 与命名表选择', () => {
  it('fine-X=3:屏幕第一个像素取自瓦片内第 4 个像素(px3)', () => {
    const ppu = makePpu()
    ppu.cpuWrite(5, 0x03) // 第一次写 $2005:fine-X=3,coarse-X=0
    ppu.cpuWrite(1, 0x0a) // 开背景 + 显示最左 8 像素
    runTwoFrames(ppu)
    const blue = rgbOf(0x21).join(',')
    const black = rgbOf(0x0f).join(',')
    // 瓦片 1 低平面 0xF0:px0-3 = 1。fine-X=3 时屏幕 x=0 画的是 px3(蓝),
    // x=1 起画 px4-7(透明)——若 fine-X 没生效,x=1 会仍是蓝
    expect(px(ppu, 0, 0)).toBe(blue)
    expect(px(ppu, 1, 0)).toBe(black)
    expect(px(ppu, 2, 0)).toBe(black)
  })

  it('选命名表 1(垂直镜像):画面第一个格来自物理表 1', () => {
    const ppu = makePpu('vertical')
    ppu.ppuWrite(0x2400, 0x02) // 命名表 1 的格 (0,0) = 瓦片 2(右半为 1)
    ppu.cpuWrite(0, 0x01) // PPUCTRL bit0:基命名表 = 1
    ppu.cpuWrite(1, 0x0a) // 开背景 + 显示最左 8 像素
    runTwoFrames(ppu)
    const blue = rgbOf(0x21).join(',')
    const black = rgbOf(0x0f).join(',')
    expect(px(ppu, 0, 0)).toBe(black)
    expect(px(ppu, 3, 0)).toBe(black)
    expect(px(ppu, 4, 0)).toBe(blue) // 瓦片 2 右半
    expect(px(ppu, 7, 0)).toBe(blue)
  })
})

describe('属性表:16×16 象限选调色板', () => {
  it('属性字节低 2 位=01 → 左上象限用调色板 1 的 color1', () => {
    const ppu = makePpu()
    ppu.ppuWrite(0x3f05, 0x16) // 背景调色板 1 的 color1 = 红
    ppu.ppuWrite(0x23c0, 0x01) // 属性表(0,0) 字节:左上象限 palette 1
    ppu.cpuWrite(1, 0x0a) // 开背景 + 显示最左 8 像素
    runTwoFrames(ppu)
    const red = rgbOf(0x16).join(',')
    expect(px(ppu, 0, 0)).toBe(red)
    expect(px(ppu, 3, 0)).toBe(red)
    expect(px(ppu, 2, 7)).toBe(red) // 同一瓦片的另一行
    expect(px(ppu, 16, 0)).not.toBe(red) // 下一象限的属性字节未写,是调色板 0 的浅蓝
  })
})
