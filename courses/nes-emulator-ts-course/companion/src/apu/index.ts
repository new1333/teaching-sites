// APU：寄存器分发（$4000-$4017）、帧序列器（quarter/half 节拍）、
// 四通道混音输出采样流。

import { Pulse } from './pulse'
import { Triangle } from './triangle'
import { Noise } from './noise'

const QUARTER = 7457 // CPU 周期间隔：quarter 节拍（包络/线性计数器）
const HALF = 7457 // half 节拍（长度与 sweep）与 quarter 同点位触发（四步模式）

export class APU {
  readonly pulse1 = new Pulse()
  readonly pulse2 = new Pulse()
  readonly triangle = new Triangle()
  readonly noise = new Noise()
  readonly sampleBuffer: number[] = []

  private cycleInFrame = 0 // 帧序列器内的 CPU 周期位置
  private sampleAccum = 0
  private static readonly SAMPLE_EVERY = 40 // 每 40 个 CPU 周期采一个样（≈44.7kHz）

  writeReg(addr: number, val: number): void {
    val &= 0xff
    if (addr === 0x4015) {
      this.pulse1.enabled = (val & 1) !== 0
      this.pulse2.enabled = (val & 2) !== 0
      this.triangle.enabled = (val & 4) !== 0
      this.noise.enabled = (val & 8) !== 0
      if (!this.pulse1.enabled) this.pulse1.length = 0
      if (!this.pulse2.enabled) this.pulse2.length = 0
      if (!this.triangle.enabled) this.triangle.length = 0
      if (!this.noise.enabled) this.noise.length = 0
      return
    }
    if (addr === 0x4017) return // 帧序列器模式：本课程固定四步模式，忽略
    if (addr < 0x4004) this.pulse1.writeReg((addr - 0x4000) as 0 | 1 | 2 | 3, val)
    else if (addr < 0x4008) this.pulse2.writeReg((addr - 0x4004) as 0 | 1 | 2 | 3, val)
    else if (addr < 0x400c) this.triangle.writeReg((addr - 0x4008) as 0 | 1 | 2 | 3, val)
    else if (addr < 0x4010) this.noise.writeReg((addr - 0x400c) as 0 | 1 | 2 | 3, val)
  }

  readReg(addr: number): number {
    if (addr === 0x4015) {
      return (
        (this.pulse1.length > 0 ? 1 : 0) |
        (this.pulse2.length > 0 ? 2 : 0) |
        (this.triangle.length > 0 ? 4 : 0) |
        (this.noise.length > 0 ? 8 : 0)
      )
    }
    return 0
  }

  // 每条 CPU 指令后喂进来它的周期数；帧序列器按位置打节拍，采样按累计出流
  tick(cpuCycles: number): void {
    for (let i = 0; i < cpuCycles; i++) {
      this.cycleInFrame++

      // 四步帧序列器：每 7457 个 CPU 周期一拍。
      // 第 1/3 拍是 quarter（包络），第 2/4 拍是 quarter + half（再加长度与 sweep）
      if (this.cycleInFrame % QUARTER === 0) {
        this.pulse1.clockQuarter()
        this.pulse2.clockQuarter()
        this.triangle.clockQuarter()
        this.noise.clockQuarter()
        if ((this.cycleInFrame / QUARTER) % 2 === 0) {
          this.pulse1.clockHalf()
          this.pulse2.clockHalf()
          this.triangle.clockHalf()
          this.noise.clockHalf()
        }
      }

      // 各通道的序列发生器
      if ((this.cycleInFrame & 1) === 0) {
        for (const ch of [this.pulse1, this.pulse2]) {
          if (ch.timer <= 0) {
            ch.timer = ch.timerReload
            ch.clockSequence()
          } else {
            ch.timer--
          }
        }
      }
      this.triangle.tickSequence() // 三角波按 CPU 周期率走
      this.noise.tick() // 噪声按周期表摇 LFSR

      this.sampleAccum++
      if (this.sampleAccum >= APU.SAMPLE_EVERY) {
        this.sampleAccum = 0
        this.sampleBuffer.push(this.mix())
      }
      if (this.cycleInFrame >= QUARTER * 4) this.cycleInFrame = 0
    }
  }

  // 简化线性混音：四路电平（0-15）求和归一
  private mix(): number {
    return (this.pulse1.emit() + this.pulse2.emit() + this.triangle.currentOutput() + this.noise.emit()) / 60
  }
}
