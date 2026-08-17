// Triangle 三角波通道：32 步序列的「圆锯」低音声部。
// 与方波不同：没有音量旋钮（输出 0-15 固定幅度），靠线性计数器做开关。

const SEQUENCE = [
  15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0,
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
]

const LENGTH_TABLE = [
  10, 254, 20, 2, 40, 4, 80, 6, 160, 8, 60, 10, 14, 12, 26, 14,
  20, 16, 40, 18, 80, 20, 160, 22, 60, 24, 14, 26, 30, 28, 20, 30,
]

export class Triangle {
  enabled = false
  private control = false // $4008 bit7：true = 线性计数器重载闸挂着
  private linearReload = 0 // 7 位重载值
  private linearCounter = 0
  length = 0
  timer = 0
  private timerReload = 0
  private index = 0

  writeReg(reg: 0 | 1 | 2 | 3, val: number): void {
    val &= 0xff
    switch (reg) {
      case 0: // $4008
        this.control = (val & 0x80) !== 0
        this.linearReload = val & 0x7f
        break
      case 2: // $400A
        this.timerReload = (this.timerReload & 0x700) | val
        break
      case 3: // $400B
        this.length = LENGTH_TABLE[(val >> 3) & 0x1f]
        this.timerReload = (this.timerReload & 0xff) | ((val & 7) << 8)
        this.timer = this.timerReload
        this.linearCounter = this.linearReload // 重新装载线性计数器
        break
    }
  }

  // quarter 节拍：线性计数器倒数（control 挂着时持续重载）
  clockQuarter(): void {
    if (this.control) this.linearCounter = this.linearReload
    else if (this.linearCounter > 0) this.linearCounter--
  }

  // half 节拍：长度倒数
  clockHalf(): void {
    if (!this.control && this.length > 0) this.length--
  }

  // 每 (timer+1) 个 CPU 周期走一步
  tickSequence(): void {
    if (this.timer <= 0) {
      this.timer = this.timerReload
      if (this.linearCounter > 0 && this.length > 0) {
        this.index = (this.index + 1) & 31
      }
    } else {
      this.timer--
    }
  }

  currentOutput(): number {
    if (!this.enabled || this.length === 0 || this.linearCounter === 0) return 0
    return SEQUENCE[this.index]
  }
}
