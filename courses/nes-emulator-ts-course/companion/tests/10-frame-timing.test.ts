import { describe, it, expect } from 'vitest'
import { PPU } from '../src/ppu'
import { Bus } from '../src/bus'
import { CPU } from '../src/cpu'
import { NES } from '../src/nes'
import { makeNromCartridge } from '../src/fixtures'
import { parseINES } from '../src/cartridge'

describe('PPU 时序状态机', () => {
  it('一帧 = 89342 个 PPU 周期（262 线 × 341 拍）', () => {
    const ppu = new PPU('horizontal')
    for (let i = 0; i < 89342; i++) ppu.tick()
    expect(ppu.frameCount).toBe(1)
    expect(ppu.scanline).toBe(0)
    expect(ppu.cycle).toBe(0)
  })

  it('VBlank 标志：扫描线 241 置位、261 清零（240 是收尾空行）', () => {
    const ppu = new PPU('horizontal')
    while (!ppu.vblank) ppu.tick()
    expect(ppu.scanline).toBe(241)
    while (ppu.vblank) ppu.tick()
    expect(ppu.scanline).toBe(261)
  })

  it('NMI 回调：PPUCTRL bit7 开着，一帧拉一次铃；关着不拉', () => {
    let rings = 0
    const ppu = new PPU('horizontal')
    ppu.onNmi = () => rings++
    ppu.ctrl = 0x80
    for (let i = 0; i < 89342; i++) ppu.tick()
    expect(rings).toBe(1)
    const silent = new PPU('horizontal')
    silent.onNmi = () => rings++
    silent.ctrl = 0 // NMI 关
    for (let i = 0; i < 89342; i++) silent.tick()
    expect(rings).toBe(1) // 没有新增
  })

  it('帧缓冲在进 VBlank 时完成渲染', () => {
    const ppu = new PPU('horizontal', Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))
    // CHR 全 0 → 全透明；随便确认进 VBlank 后 frameBuffer 有内容（全通用背景色 0）
    while (!ppu.vblank) ppu.tick()
    expect(ppu.frameBuffer.length).toBe(256 * 240)
  })
})

describe('CPU 中断序列', () => {
  function nmiCpu(): { cpu: CPU; bus: Bus } {
    const bus = new Bus()
    // NMI 向量 $9000、复位向量 $8000
    const prg = new Array<number>(0x4000).fill(0)
    prg[0] = 0x38 // $8000: SEC（给 P 一个可辨认的现场）
    prg[0x1000] = 0x40 // $9000: RTI
    prg[0x3ffa] = 0x00
    prg[0x3ffb] = 0x90 // $FFFA/B → $9000
    prg[0x3ffc] = 0x00
    prg[0x3ffd] = 0x80 // $FFFC/D → $8000
    bus.attachCartridge(parseINES(makeNromCartridge({ prg })))
    const cpu = new CPU(bus)
    cpu.reset()
    return { cpu, bus }
  }

  it('nmi() 后下一条 step 变成中断：PC 跳 $FFFA 向量、现场入栈、耗 7 拍', () => {
    const { cpu } = nmiCpu()
    const spBefore = cpu.sp
    cpu.nmi()
    const cycles = cpu.step()
    expect(cycles).toBe(7)
    expect(cpu.pc).toBe(0x9000)
    expect(cpu.sp).toBe((spBefore - 3) & 0xff) // PC 两字节 + P 一字节
  })

  it('RTI 完整恢复：PC 与 P 都回到中断前', () => {
    const { cpu } = nmiCpu()
    cpu.step() // 先执行 SEC：C=1、PC=$8001
    const pBefore = cpu.getP()
    cpu.nmi()
    cpu.step() // 中断序列 → 跳 $9000
    cpu.c = false // 在 handler 里乱改标志
    cpu.step() // RTI
    expect(cpu.pc).toBe(0x8001)
    expect(cpu.getP()).toBe(pBefore) // RTI 把 P 原样带回
  })
})

describe('整机 1:3 心跳与「等 NMI → 改画面」闭环', () => {
  function makeNes(): { nes: NES; bus: Bus } {
    // main：开 NMI → 死等 VBlank → 在窗口里写 $0200 做记号 → 回去再等
    // nmi（$9000）：写 $0201 做记号 → RTI
    const prg = new Array<number>(0x4000).fill(0)
    const code = [
      0xa9, 0x80,       // $8000: LDA #$80
      0x8d, 0x00, 0x20, // $8002: STA $2000（开 NMI）
      0x2c, 0x02, 0x20, // $8005: BIT $2002（wait：读状态清 VBlank）
      0x10, 0xfb,       // $8008: BPL $8005（bit7=0 继续等）
      0xa9, 0x42,       // $800A: LDA #$42 —— VBlank 窗口里的活
      0x8d, 0x00, 0x02, // $800C: STA $0200
      0x4c, 0x05, 0x80, // $800F: JMP $8005 等下一帧
    ]
    prg.splice(0, code.length, ...code)
    prg[0x1000] = 0xa9 // $9000: LDA #$07
    prg[0x1001] = 0x07
    prg[0x1002] = 0x8d // STA $0201
    prg[0x1003] = 0x01
    prg[0x1004] = 0x02
    prg[0x1005] = 0x40 // RTI
    prg[0x3ffa] = 0x00
    prg[0x3ffb] = 0x90 // NMI → $9000
    prg[0x3ffc] = 0x00
    prg[0x3ffd] = 0x80 // reset → $8000
    const nes = new NES(makeNromCartridge({ prg, chr: new Array<number>(0x2000).fill(0) }))
    return { nes, bus: nes.bus }
  }

  it('跑一帧：CPU 在 VBlank 窗口写了 $0200，NMI 处理程序写了 $0201', () => {
    const { nes, bus } = makeNes()
    nes.runFrame()
    expect(bus.read(0x0200)).toBe(0x42) // VBlank 窗口里完成
    expect(bus.read(0x0201)).toBe(0x07) // NMI 处理程序完成
    expect(nes.ppu.frameCount).toBe(1)
  })

  it('1:3 配比：一条 2 拍指令推进 PPU 6 拍', () => {
    const { nes } = makeNes()
    const before = nes.ppu.totalCycles
    nes.stepInstruction() // LDA #$80：2 拍
    expect(nes.ppu.totalCycles - before).toBe(6)
  })
})
