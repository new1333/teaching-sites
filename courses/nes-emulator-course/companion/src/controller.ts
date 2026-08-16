// 手柄:一个 8 位移位寄存器的串行输入。
// 读取顺序:A B Select Start Up Down Left Right;读满 8 位后硬件恒返回 1。

export type NesButton = 'A' | 'B' | 'Select' | 'Start' | 'Up' | 'Down' | 'Left' | 'Right'

const BUTTON_ORDER: NesButton[] = ['A', 'B', 'Select', 'Start', 'Up', 'Down', 'Left', 'Right']

class Pad {
  /** 当前物理按键状态(位序同 BUTTON_ORDER) */
  state = 0
  /** 移位寄存器里的快照 */
  snapshot = 0
  /** 已移出的位数 */
  index = 0
  strobe = false

  press(button: NesButton, down: boolean): void {
    const bit = 1 << BUTTON_ORDER.indexOf(button)
    this.state = down ? this.state | bit : this.state & ~bit
  }

  setStrobe(on: boolean): void {
    this.strobe = on
    // 高电平期间寄存器持续重载;落到低电平时定格的就是「此刻」的按键状态
    this.snapshot = this.state
    if (on) this.index = 0
  }

  read(): number {
    if (this.strobe) return this.state & 1 // 高电平期间读:恒为 A 键(不消耗位序)
    if (this.index >= 8) return 1 // 移空后硬件恒返回 1
    return (this.snapshot >> this.index++) & 1
  }
}

export class Controller {
  private pads = [new Pad(), new Pad()]

  setButton(player: 0 | 1, button: NesButton, down: boolean): void {
    this.pads[player].press(button, down)
  }

  /** $4016/$4017 读:D0 = 移位输出(高 7 位为 open bus,简化为 0) */
  cpuRead(addr: number): number {
    return addr === 0x4016 ? this.pads[0].read() : this.pads[1].read()
  }

  /** 只有写 $4016 的 bit0 是 strobe;$4017 的写被忽略 */
  cpuWrite(addr: number, val: number): void {
    if (addr !== 0x4016) return
    const on = (val & 1) === 1
    for (const p of this.pads) p.setStrobe(on)
  }
}
