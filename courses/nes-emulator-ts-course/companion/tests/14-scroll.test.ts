import { describe, it, expect } from 'vitest'
import { PPU } from '../src/ppu'

// 滚动：$2005/$2006 写进暂存指针 t，预取线（261）整体抄进 v 并定格为渲染起点，
// 背景从「相机位置」逐像素采样——屏幕右缘跨入相邻 nametable（方向由卡带镜像决定）。

function makeChr(): Uint8Array {
  const chr = new Uint8Array(0x2000)
  for (let y = 0; y < 8; y++) {
    chr[1 * 16 + y] = 0xff // tile 1：整块色号 1
    chr[2 * 16 + y] = 0xff
    chr[2 * 16 + 8 + y] = 0xff // tile 2：整块色号 3
    chr[3 * 16 + y] = 0x20 // tile 3：每行只有第 3 个像素（x=2）是色号 1，其余透明
  }
  return chr
}

function makePpu(): PPU {
  const ppu = new PPU('vertical', makeChr())
  ppu.paletteRam[0] = 0x0f // 通用背景色：黑
  ppu.paletteRam[1] = 0x01 // 色号 1 → 深蓝
  ppu.paletteRam[3] = 0x03 // 色号 3 → 深绿
  return ppu
}

// 摆一块 nametable：指定列用 tileA，其余用 tile B
function ntColumn(ppu: PPU, table: 0 | 1, cols: number[], tileA: number, tileB: number): void {
  const base = table * 0x400
  for (let r = 0; r < 30; r++) {
    for (let c = 0; c < 32; c++) ppu.vram[base + r * 32 + c] = cols.includes(c) ? tileA : tileB
  }
}

// 走到预取线：t 装载进 v、渲染起点定格
function armCamera(ppu: PPU): void {
  while (ppu.scanline !== 261) ppu.tick()
  ppu.tick()
}

describe('滚动：$2005 写 t、预取线抄进 v', () => {
  it('tile 粒度偏移：X=16（2 块 tile）→ 第 2 列占屏幕前 8 像素', () => {
    const ppu = makePpu()
    ntColumn(ppu, 0, [2], 1, 2) // 第 2 列 tile 1（色 0x01），其余 tile 2（色 0x03）
    ppu.writeReg(5, 16) // 第一拍 X：coarse X = 2（像素 16 = 2 块 tile）
    ppu.writeReg(5, 0) // 第二拍 Y = 0
    armCamera(ppu)
    ppu.renderBackground()
    expect(ppu.frameBuffer[0]).toBe(0x01) // 屏幕左缘 = 第 2 列起点
    expect(ppu.frameBuffer[7]).toBe(0x01) // 第 2 列占满前 8 像素
    expect(ppu.frameBuffer[8]).toBe(0x03) // 第 9 像素起是第 3 列
    expect(ppu.frameBuffer[256]).toBe(0x01) // 第二行同样从第 2 列开始
  })

  it('像素粒度偏移（fineX）：X=0x13（2 块 + 3 像素）→ 点像素对到屏幕第 7 格', () => {
    const ppu = makePpu()
    ntColumn(ppu, 0, [0, 1, 2, 3, 4], 3, 2) // 前 5 列都是「只有 x=2 一个色点」的 tile 3
    ppu.writeReg(5, 0x13) // coarse 2 + fine 3
    ppu.writeReg(5, 0)
    armCamera(ppu)
    ppu.renderBackground()
    // 相机指着第 2 列的第 3 像素：屏幕 sx 对应源像素 x3+sx。色点在每块 tile 的 x2，
    // 第 2 列的 x2 已在屏幕左外，下一个色点是第 3 列 x2 → 屏幕 sx = 5 + 2 = 7，
    // 再下一个是第 4 列 x2 → sx = 15
    expect(ppu.frameBuffer[6]).toBe(0x0f) // 透明落通用背景色
    expect(ppu.frameBuffer[7]).toBe(0x01) // 第 3 列的色点
    expect(ppu.frameBuffer[14]).toBe(0x0f) // 第 4 列色点前一格仍透明
    expect(ppu.frameBuffer[15]).toBe(0x01) // 第 4 列的色点：色点以 8 像素步距重复
  })

  it('跨 nametable：第 31 列起步 → 屏幕左缘 nt0、第 8 像素起来自 nt1', () => {
    const ppu = makePpu()
    ntColumn(ppu, 0, [31], 1, 2) // nt0 第 31 列 tile 1
    ntColumn(ppu, 1, [0], 1, 2) // nt1 第 0 列 tile 1（垂直镜像：两块物理独立）
    ppu.writeReg(5, 31 * 8) // coarse X = 31
    ppu.writeReg(5, 0)
    armCamera(ppu)
    ppu.renderBackground()
    expect(ppu.frameBuffer[7]).toBe(0x01) // nt0 第 31 列占屏幕前 8 像素
    expect(ppu.frameBuffer[8]).toBe(0x01) // 第 8 像素起进入 nt1 第 0 列（也是 tile 1）
    expect(ppu.frameBuffer[16]).toBe(0x03) // 第 16 像素起是 nt1 第 1 列
  })

  it('Y 滚动：Y=16 → 屏幕顶行来自 nametable 第 2 行', () => {
    const ppu = makePpu()
    for (let r = 0; r < 30; r++) for (let c = 0; c < 32; c++) ppu.vram[r * 32 + c] = r === 2 ? 1 : 2
    ppu.writeReg(5, 0)
    ppu.writeReg(5, 16) // Y 滚 2 块 tile
    armCamera(ppu)
    ppu.renderBackground()
    expect(ppu.frameBuffer[0]).toBe(0x01) // 屏幕首行 = nametable 第 2 行
    expect(ppu.frameBuffer[256 * 7]).toBe(0x01) // 第 2 行占屏幕前 8 行
    expect(ppu.frameBuffer[256 * 8]).toBe(0x03) // 第 9 行起是第 3 行
  })

  it('$2006 地址写覆盖滚动位、v 立即同步：$2007 定址照常自增', () => {
    const ppu = makePpu()
    ppu.writeReg(5, 0x40) // X：coarse X = 8 写进 t
    ppu.writeReg(5, 0) // Y：补齐两拍（$2005/$2006 共用节奏开关，真机约定成对写）
    ppu.writeReg(6, 0x20)
    ppu.writeReg(6, 0x00) // 两拍后 t = v = $2000：低 8 位被清，滚动位不残留
    ppu.writeReg(7, 0x42)
    expect(ppu.vram[0]).toBe(0x42) // $2007 按 v 定址
    ppu.writeReg(7, 0x43)
    expect(ppu.vram[1]).toBe(0x43) // 步长 1 自增正常
  })

  it('读 $2002 重置两拍节奏：一次 $2005 后跟 $2006 高位，不会错拍', () => {
    const ppu = makePpu()
    ppu.writeReg(5, 0x10) // 只写了 X（第一拍）
    ppu.readReg(2) // 读状态：节奏归零
    ppu.writeReg(6, 0x23) // 现在这是高位拍，不会误当 Y 拍
    ppu.writeReg(6, 0x45)
    ppu.writeReg(7, 0x99)
    expect(ppu.vram[0x345]).toBe(0x99) // $2345 经垂直镜像折叠的物理偏移 0x345
  })
})
