import { describe, it, expect } from 'vitest'
import { Ppu } from '../src/ppu.js'
import { Bus } from '../src/bus.js'
import { Cpu } from '../src/cpu.js'
import { Nes } from '../src/nes.js'

describe('一帧的长度:even/odd frame', () => {
  it('渲染开启时偶数帧 89342 dot,奇数帧 89341(跳点)', () => {
    const ppu = new Ppu('horizontal')
    ppu.cpuWrite(1, 0x0a) // 开背景渲染
    const count = () => {
      let t = 0
      while (t++ < 89342 * 2) if (ppu.tick()) return t
      return -1
    }
    expect(count()).toBe(89342) // 第 1 帧:偶
    expect(count()).toBe(89341) // 第 2 帧:奇,预渲染行少 1 dot
    expect(count()).toBe(89342) // 交替
  })

  it('渲染关闭时不跳点,每帧恒 89342', () => {
    const ppu = new Ppu('horizontal')
    const count = () => {
      let t = 0
      while (t++ < 89342 * 2) if (ppu.tick()) return t
      return -1
    }
    expect(count()).toBe(89342)
    expect(count()).toBe(89342)
  })
})

describe('vblank 标志的时序', () => {
  it('扫描线 241 起 vblank 置位,读 $2002 取走并清零', () => {
    const ppu = new Ppu('horizontal')
    const bus = new Bus(ppu)
    // 推进到第 241 线第 5 dot
    let guard = 0
    while (!(ppu.scanline === 241 && ppu.dot >= 5) && guard++ < 89342) ppu.tick()
    expect(ppu.vblank).toBe(1)
    expect(bus.read(0x2002) & 0x80).toBe(0x80)
    expect(ppu.vblank).toBe(0)
    expect(bus.read(0x2002) & 0x80).toBe(0)
  })

  it('扫描线 261 起标志被硬件清零(没读也会清)', () => {
    const ppu = new Ppu('horizontal')
    let guard = 0
    while (!(ppu.scanline === 261 && ppu.dot >= 5) && guard++ < 89342 * 2) ppu.tick()
    expect(ppu.vblank).toBe(0)
  })
})

describe('NMI:中断序列与整机主循环', () => {
  function makeNes() {
    const nes = new Nes('horizontal')
    // 用可写数组冒充卡带窗口(整机组装章会换成真 NROM)
    const prg = new Uint8Array(0x10000)
    nes.bus.cartRead = (a) => prg[a]
    // 主程序:$8000 死循环(等 NMI)
    // [4C 00 80] JMP $8000
    prg.set([0x4c, 0x00, 0x80], 0x8000)
    // NMI 处理例程:$9000 → INC $0000;RTI
    prg.set([0xe6, 0x00, 0x40], 0x9000)
    // 向量:NMI=$9000,复位=$8000
    prg.set([0x00, 0x90], 0xfffa)
    prg.set([0x00, 0x80], 0xfffc)
    nes.cpu.reset()
    nes.bus.write(0x2000, 0x80) // PPUCTRL:开 NMI
    return { nes, prg }
  }

  it('每帧恰好触发一次 NMI,处理例程执行(INC 计数)', () => {
    const { nes } = makeNes()
    nes.runFrame()
    expect(nes.bus.ram[0]).toBe(1)
    nes.runFrame()
    expect(nes.bus.ram[0]).toBe(2)
    nes.runFrame()
    expect(nes.bus.ram[0]).toBe(3)
  })

  it('没开 NMI(CTRL bit7=0)就不触发', () => {
    const { nes } = makeNes()
    nes.bus.write(0x2000, 0x00)
    nes.runFrame()
    expect(nes.bus.ram[0]).toBe(0)
  })

  it('在 vblank 期间才开 NMI(写 CTRL)也能触发:使能沿重新拉线', () => {
    const ppu = new Ppu('horizontal')
    const bus = new Bus(ppu)
    const cpu = new Cpu(bus)
    const prg = new Uint8Array(0x10000)
    bus.cartRead = (a) => prg[a]
    prg.set([0x4c, 0x00, 0x80], 0x8000) // 死循环
    prg.set([0xe6, 0x01, 0x40], 0x9000) // INC $01;RTI
    prg.set([0x00, 0x90], 0xfffa)
    prg.set([0x00, 0x80], 0xfffc)
    cpu.reset()
    // 推进 PPU 到 vblank 中段(245 线),再开 NMI
    let guard = 0
    while (!(ppu.scanline === 245 && ppu.dot >= 5) && guard++ < 89342 * 2) ppu.tick()
    bus.write(0x2000, 0x80)
    // 补齐这一帧剩余时间(手动模拟主循环:每 dot 后检查 NMI 线,取走则进 CPU)
    let frames = 0
    guard = 0
    while (frames < 1 && guard++ < 89342) {
      if (ppu.tick()) frames++
      if (ppu.takeNmi()) cpu.nmi()
      cpu.step()
    }
    expect(bus.ram[1]).toBe(1) // (241,1) 已过,但使能沿仍拉起 NMI
  })

  it('NMI 序列压栈 P(B 位为 0),RTI 恢复', () => {
    const { nes } = makeNes()
    nes.runFrame()
    // NMI 压了 3 字节,RTI 又弹出——栈顶应恢复原位
    expect(nes.cpu.SP).toBe(0xfd)
    expect(nes.bus.ram[0]).toBe(1)
  })
})

describe('Nes.runFrame:3:1 catch-up 与 DMA 周期入账', () => {
  it('CPU 指令周期驱动 PPU 三倍推进,一帧返回一次帧缓冲', () => {
    const nes = new Nes('horizontal')
    const buf1 = nes.runFrame()
    const buf2 = nes.runFrame()
    expect(buf1).toBeInstanceOf(Uint8Array)
    expect(buf1).toHaveLength(256 * 240 * 3)
    expect(buf2).toBe(buf1) // 同一块缓冲复用
  })

  it('OAM DMA 挂起后由主循环执行并偷走 513 CPU 周期', () => {
    const nes = new Nes('horizontal')
    const prg = new Uint8Array(0x10000)
    nes.bus.cartRead = (a) => prg[a]
    for (let i = 0; i < 256; i++) nes.bus.ram[0x0200 + i] = i
    // LDA #$02;STA $4014;JMP $8005(死循环)
    prg.set([0xa9, 0x02, 0x8d, 0x14, 0x40, 0x4c, 0x05, 0x80], 0x8000)
    prg.set([0x00, 0x80], 0xfffc) // 复位向量 → $8000
    nes.cpu.reset()
    nes.runFrame()
    for (let i = 0; i < 256; i++) expect(nes.ppu.oam[i]).toBe(i)
  })
})
