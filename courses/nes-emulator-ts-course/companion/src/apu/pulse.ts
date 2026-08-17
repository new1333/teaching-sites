// Pulse 方波通道（pulse1/pulse2 各一个实例）：
// 定时器决定音高、占空比决定音色、包络决定音量走势、sweep 决定弯音、
// 长度计数器决定何时自动收声。

const DUTY_TABLE = [
  [0, 1, 0, 0, 0, 0, 0, 0], // 12.5%
  [0, 1, 0, 0, 0, 0, 1, 0], // 25%
  [0, 1, 1, 1, 1, 1, 1, 0], // 50%
  [1, 0, 0, 0, 0, 0, 0, 1], // 25%（反相）
]

// 长度表：$4003 高 5 位索引 → half 节拍数
const LENGTH_TABLE = [
  10, 254, 20, 2, 40, 4, 80, 6, 160, 8, 60, 10, 14, 12, 26, 14,
  20, 16, 40, 18, 80, 20, 160, 22, 60, 24, 14, 26, 30, 28, 20, 30,
]

export class Pulse {
  enabled = false

  // $4000
  private duty = 0
  private haltLength = false
  private constantVolume = false
  private volumeOrDiv = 0

  // $4001 sweep
  private sweepEnabled = false
  private sweepPeriod = 0
  private sweepNegate = false
  private sweepShift = 0
  private sweepReload = false
  private sweepDivider = 0

  // $4002/$4003 定时器（音高）：sweep 直接改 reload，下次重载生效
  timer = 0
  timerReload = 0

  length = 0

  // 包络
  private envelopeStart = false
  private envelopeDivider = 0
  private decay = 0

  private dutyIndex = 0

  writeReg(reg: 0 | 1 | 2 | 3, val: number): void {
    val &= 0xff
    switch (reg) {
      case 0:
        this.duty = (val >> 6) & 3
        this.haltLength = (val & 0x20) !== 0
        this.constantVolume = (val & 0x10) !== 0
        this.volumeOrDiv = val & 0x0f
        break
      case 1:
        this.sweepEnabled = (val & 0x80) !== 0
        this.sweepPeriod = ((val >> 4) & 7) + 1
        this.sweepNegate = (val & 0x08) !== 0
        this.sweepShift = val & 7
        this.sweepReload = true
        break
      case 2:
        this.timerReload = (this.timerReload & 0x700) | val
        break
      case 3:
        this.length = LENGTH_TABLE[(val >> 3) & 0x1f]
        this.timerReload = (this.timerReload & 0xff) | ((val & 7) << 8)
        this.timer = this.timerReload
        this.dutyIndex = 0
        // 包络从头开始：立即满音量，之后按 quarter 节拍衰减
        this.decay = 15
        this.envelopeDivider = this.volumeOrDiv
        this.envelopeStart = false
        break
    }
  }

  // 帧序列器 quarter 节拍：包络走一格
  clockQuarter(): void {
    if (this.envelopeStart) {
      this.envelopeStart = false
      this.decay = 15
      this.envelopeDivider = this.volumeOrDiv
    } else if (this.envelopeDivider > 0) {
      this.envelopeDivider--
    } else {
      this.envelopeDivider = this.volumeOrDiv
      if (this.decay > 0) this.decay-- // 衰到 0 就停（halt 时循环重启不实现）
    }
  }

  // 帧序列器 half 节拍：长度倒数、sweep 弯音
  clockHalf(): void {
    if (!this.haltLength && this.length > 0) this.length--
    if (this.sweepReload) {
      this.sweepDivider = this.sweepPeriod // 写 $4001 后的第一拍只重载
      this.sweepReload = false
      return
    }
    this.sweepDivider--
    if (this.sweepDivider <= 0) {
      this.sweepDivider = this.sweepPeriod
      if (this.sweepEnabled && this.sweepShift > 0) {
        const delta = this.timerReload >> this.sweepShift
        const target = this.sweepNegate
          ? this.timerReload - delta - 1
          : this.timerReload + delta
        if (target >= 8 && target <= 0x7ff) this.timerReload = target
      }
    }
  }

  // 序列发生器走一步（每 (timerReload+1)×2 个 CPU 周期一步）
  clockSequence(): void {
    this.dutyIndex = (this.dutyIndex + 1) & 7
  }

  // 当前电平：静音条件全避开后，占空比位 × 音量（0-15）
  emit(): number {
    if (!this.enabled || this.length === 0) return 0
    if (this.timerReload < 8 || this.timerReload > 0x7ff) return 0 // 禁区
    const bit = DUTY_TABLE[this.duty][this.dutyIndex]
    if (bit === 0) return 0
    return this.constantVolume ? this.volumeOrDiv : this.decay
  }
}
