// Noise 噪声通道：15 位 LFSR 转盘摇出「沙沙」声——打击乐声部。
// 包络与长度机制与方波同款。

const LENGTH_TABLE = [
  10, 254, 20, 2, 40, 4, 80, 6, 160, 8, 60, 10, 14, 12, 26, 14,
  20, 16, 40, 18, 80, 20, 160, 22, 60, 24, 14, 26, 30, 28, 20, 30,
]

// NTSC 噪声周期表（CPU 周期/步）：从激光枪的「滋」到鼓的「沙」
const PERIOD_TABLE = [4, 8, 16, 32, 64, 96, 128, 160, 202, 254, 380, 508, 762, 1016, 2034, 4068]

export class Noise {
  enabled = false
  mode = false // $400E bit7：true = 短序列（金属感）
  lfsr = 1 // 15 位移位寄存器，任何非零初值都行

  private haltLength = false
  private constantVolume = false
  private volumeOrDiv = 0
  private decay = 0
  private envelopeDivider = 0
  private period = PERIOD_TABLE[0]
  private periodCounter = 0
  length = 0

  writeReg(reg: 0 | 1 | 2 | 3, val: number): void {
    val &= 0xff
    switch (reg) {
      case 0: // $400C
        this.haltLength = (val & 0x20) !== 0
        this.constantVolume = (val & 0x10) !== 0
        this.volumeOrDiv = val & 0x0f
        break
      case 2: // $400E
        this.mode = (val & 0x80) !== 0
        this.period = PERIOD_TABLE[val & 0x0f]
        break
      case 3: // $400F
        this.length = LENGTH_TABLE[(val >> 3) & 0x1f]
        this.decay = 15 // 包络重启：立即满音量
        this.envelopeDivider = this.volumeOrDiv
        break
    }
  }

  clockQuarter(): void {
    if (this.envelopeDivider > 0) this.envelopeDivider--
    else {
      this.envelopeDivider = this.volumeOrDiv
      if (this.decay > 0) this.decay--
    }
  }

  clockHalf(): void {
    if (!this.haltLength && this.length > 0) this.length--
  }

  // 齿轮转一格：反馈位由 bit0 异或 bit1（短序列改用 bit6）
  clockLfsr(): void {
    const feedback = this.mode
      ? (this.lfsr ^ (this.lfsr >> 6)) & 1
      : (this.lfsr ^ (this.lfsr >> 1)) & 1
    this.lfsr = ((this.lfsr >> 1) | (feedback << 14)) & 0x7fff
  }

  // APU 每 CPU 周期调用：按周期表节奏摇转盘
  tick(): void {
    if (this.periodCounter <= 0) {
      this.periodCounter = this.period
      this.clockLfsr()
    } else {
      this.periodCounter--
    }
  }

  emit(): number {
    if (!this.enabled || this.length === 0) return 0
    const bit = (~this.lfsr) & 1 // 位为 0 时才输出（噪声占空感）
    if (bit === 0) return 0
    return this.constantVolume ? this.volumeOrDiv : this.decay
  }
}
