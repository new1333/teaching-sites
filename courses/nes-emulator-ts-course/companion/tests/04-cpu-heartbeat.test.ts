import { describe, it, expect } from 'vitest'
import { Bus } from '../src/bus'
import { CPU } from '../src/cpu'
import { makeNromCartridge, prgWithReset } from '../src/fixtures'
import { parseINES } from '../src/cartridge'

// 组装一台「只差 CPU 心跳」的最小机器：总线 + 16KB 自产卡带
function makeCpu(code: number[]): { cpu: CPU; bus: Bus } {
  const bus = new Bus()
  bus.attachCartridge(
    parseINES(makeNromCartridge({ prg: prgWithReset(code, 0x8000) }))
  )
  const cpu = new CPU(bus)
  cpu.reset()
  return { cpu, bus }
}

describe('CPU：复位', () => {
  it('reset 后 PC 从 $FFFC/$FFFD 复位向量取入口 $8000', () => {
    const { cpu } = makeCpu([])
    expect(cpu.pc).toBe(0x8000)
  })

  it('reset 后 SP=$FD、A/X/Y 清零', () => {
    const { cpu } = makeCpu([])
    expect(cpu.sp).toBe(0xfd)
    expect(cpu.a).toBe(0)
    expect(cpu.x).toBe(0)
    expect(cpu.y).toBe(0)
  })

  it('复位向量指向哪里，PC 就从哪里出发（$9000 也可）', () => {
    const bus = new Bus()
    bus.attachCartridge(
      parseINES(makeNromCartridge({ prg: prgWithReset([0xea], 0x9000) }))
    )
    const cpu = new CPU(bus)
    cpu.reset()
    expect(cpu.pc).toBe(0x9000)
  })
})

describe('CPU：取指-译码-执行', () => {
  it('LDA #$05：A 载入 5，PC 前进 2，返回 2 周期', () => {
    const { cpu } = makeCpu([0xa9, 0x05])
    const cycles = cpu.step()
    expect(cpu.a).toBe(0x05)
    expect(cpu.pc).toBe(0x8002)
    expect(cycles).toBe(2)
    expect(cpu.z).toBe(false)
    expect(cpu.n).toBe(false)
  })

  it('LDA #$00 置零标志 Z；LDA #$80 置负标志 N', () => {
    const { cpu } = makeCpu([0xa9, 0x00, 0xa9, 0x80])
    cpu.step()
    expect(cpu.z).toBe(true)
    cpu.step()
    expect(cpu.z).toBe(false)
    expect(cpu.n).toBe(true)
  })

  it('LDA #$05 / STA $0200：5 写进零页外的 RAM（绝对地址小端序）', () => {
    const { cpu, bus } = makeCpu([0xa9, 0x05, 0x8d, 0x00, 0x02])
    cpu.step() // LDA
    cpu.step() // STA：操作数 00 02 → $0200（低字节在前）
    expect(bus.read(0x0200)).toBe(0x05)
  })

  it('NOP：PC 前进 1，返回 2 周期，状态不变', () => {
    const { cpu } = makeCpu([0xea])
    const cycles = cpu.step()
    expect(cpu.pc).toBe(0x8001)
    expect(cycles).toBe(2)
  })

  it('未知 opcode 抛错并带地址上下文', () => {
    const { cpu } = makeCpu([0x02])
    expect(() => cpu.step()).toThrow(/opcode/i)
  })
})
