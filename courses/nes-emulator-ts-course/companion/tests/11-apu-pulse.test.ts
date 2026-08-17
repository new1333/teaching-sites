import { describe, it, expect } from 'vitest'
import { APU } from '../src/apu'
import { Pulse } from '../src/apu/pulse'

// 跑 N 个 CPU 周期的 APU
function run(apu: APU, cpuCycles: number): void {
  let left = cpuCycles
  while (left > 0) {
    const n = Math.min(left, 100)
    apu.tick(n)
    left -= n
  }
}

describe('Pulse 通道：占空比与音量', () => {
  function armedPulse(): Pulse {
    const p = new Pulse()
    p.enabled = true
    p.writeReg(0, 0b10011111) // duty 2(50%)、halt=0、恒定音量=15
    p.writeReg(2, 0x40) // timer 低 8 位（任意非禁区值）
    p.writeReg(3, 0x00) // 长度 index 0（10）、timer 高 3 位 0、载入长度/重载定时器
    return p
  }

  it('四种占空比各自的 8 步序列（1 处输出音量、0 处静音）', () => {
    const seq = (duty: number): number[] => {
      const p = new Pulse()
      p.enabled = true
      p.writeReg(0, (duty << 6) | 0b00011111)
      p.writeReg(2, 0x40)
      p.writeReg(3, 0x00)
      const out: number[] = []
      for (let i = 0; i < 8; i++) {
        out.push(p.emit()) // 当前步的电平
        p.clockSequence()  // 走到下一步
      }
      return out.map(v => (v > 0 ? 1 : 0))
    }
    expect(seq(0)).toEqual([0, 1, 0, 0, 0, 0, 0, 0]) // 12.5%
    expect(seq(1)).toEqual([0, 1, 0, 0, 0, 0, 1, 0]) // 25%
    expect(seq(2)).toEqual([0, 1, 1, 1, 1, 1, 1, 0]) // 50%
    expect(seq(3)).toEqual([1, 0, 0, 0, 0, 0, 0, 1]) // 25%（反相）
  })

  it('恒定音量模式：emit 输出 15 或 0', () => {
    const p = armedPulse()
    expect(p.emit()).toBeLessThanOrEqual(15)
    expect([0, 15]).toContain(p.emit())
  })

  it('长度计数器：非 halt 时按 half 节拍倒数，到 0 静音', () => {
    const p = armedPulse() // 长度 10
    for (let i = 0; i < 10; i++) p.clockHalf() // 10 个 half 节拍耗尽
    expect(p.emit()).toBe(0)
  })

  it('halt 位挂着长度不走', () => {
    const p = new Pulse()
    p.enabled = true
    p.writeReg(0, 0b10111111) // halt=1（bit5），其余照常出声
    p.writeReg(2, 0x40)
    p.writeReg(3, 0x00) // 长度 10
    for (let i = 0; i < 50; i++) p.clockHalf()
    expect(p.length).toBe(10) // 50 个 half 节拍过去，长度纹丝不动
  })

  it('包络衰减：恒定音量关闭时，音量从 15 逐级走低', () => {
    const p = new Pulse()
    p.enabled = true
    p.writeReg(0, 0b11000000) // duty 3（首步为 1）、halt/恒定音量全关、divider=0（每拍衰减）
    p.writeReg(2, 0x40)
    p.writeReg(3, 0x00)
    const v0 = p.emit()
    const vols: number[] = []
    for (let i = 0; i < 16; i++) {
      p.clockQuarter()
      vols.push(p.emit())
    }
    expect(v0).toBe(15)
    expect(vols[0]).toBe(14) // 第一个 quarter 节拍后音量降一档
    expect(vols[15]).toBeLessThanOrEqual(1)
  })

  it('sweep：negate + shift=1，half 节拍把 reload 拉低（音高上扬）', () => {
    const p = new Pulse()
    p.enabled = true
    p.writeReg(0, 0b10011111)
    p.writeReg(1, 0b10001001) // sweep 开、period=1、negate=1、shift=1
    p.writeReg(2, 0x00)
    p.writeReg(3, 0x03) // timer 高 3 位 = 3 → reload ≈ 0x300
    const timer0 = p.timerReload
    p.clockHalf() // 第一个 half 节拍：重载 sweep divider，不动 timer
    expect(p.timerReload).toBe(timer0)
    p.clockHalf() // 第二个 half 节拍：divider 归零，sweep 执行（negate 方向还多减 1）
    expect(p.timerReload).toBe(timer0 - (timer0 >> 1) - 1)
  })
})

describe('APU：帧序列器与输出', () => {
  it('$4015 读：通道启用且长度未耗尽 → bit0 置位；耗尽后清零', () => {
    const apu = new APU()
    apu.writeReg(0x4015, 0x01) // 启用 pulse1
    apu.writeReg(0x4000, 0b10011111)
    apu.writeReg(0x4002, 0xfd)
    apu.writeReg(0x4003, 0x00) // 载入长度（index 0 → 10）
    expect(apu.readReg(0x4015) & 1).toBe(1)
    // half 节拍每 14914 个 CPU 周期一次（每帧两次）：长度 10 耗尽
    run(apu, 10 * 14914 + 200)
    expect(apu.readReg(0x4015) & 1).toBe(0)
  })

  it('启用并装载的通道：跑一帧后采样缓冲非空且非全零', () => {
    const apu = new APU()
    apu.writeReg(0x4015, 0x01)
    apu.writeReg(0x4000, 0b10011111) // duty 2、恒定音量 15
    apu.writeReg(0x4002, 0xfd) // timer ≈ 253 → 约 440Hz（A4）
    apu.writeReg(0x4003, 0x00)
    run(apu, 89342 / 3) // 一帧的 CPU 周期数
    expect(apu.sampleBuffer.length).toBeGreaterThan(100)
    const peak = Math.max(...apu.sampleBuffer.map(Math.abs))
    expect(peak).toBeGreaterThan(0.05)
  })

  it('没启用的通道：缓冲接近全零', () => {
    const apu = new APU()
    run(apu, 89342 / 3)
    const peak = Math.max(...apu.sampleBuffer.map(Math.abs), 0)
    expect(peak).toBe(0)
  })

  it('帧序列器 quarter 节拍驱动包络：一帧内衰减可闻（音量从 15 降档）', () => {
    const apu = new APU()
    apu.writeReg(0x4015, 0x01)
    apu.writeReg(0x4000, 0b11000000) // duty 3（首步为 1）、包络模式、divider=0
    apu.writeReg(0x4002, 0xfd)
    apu.writeReg(0x4003, 0x00)
    run(apu, 7457) // 一个 quarter 节拍过后：包络已衰减一档
    const later = apu.sampleBuffer.slice(-50).map(Math.abs).reduce((a, b) => a + b, 0) / 50
    const early = apu.sampleBuffer.slice(0, 50).map(Math.abs).reduce((a, b) => a + b, 0) / 50
    expect(early).toBeGreaterThan(0)
    expect(later).toBeLessThan(early)
  })
})
