// 手柄：$4016 移位寄存器协议。程序写 1 再写 0（strobe）锁存当前按键快照，
// 此后连读 8 次、每次吐一位（A B Select Start Up Down Left Right），之后恒 1。

export type ButtonName = 'A' | 'B' | 'Select' | 'Start' | 'Up' | 'Down' | 'Left' | 'Right'

const ORDER: ButtonName[] = ['A', 'B', 'Select', 'Start', 'Up', 'Down', 'Left', 'Right']

export class Controller {
  private buttons = new Set<ButtonName>()
  private shifter = 0

  setButton(name: ButtonName, pressed: boolean): void {
    if (pressed) this.buttons.add(name)
    else this.buttons.delete(name)
  }

  write(val: number): void {
    if ((val & 1) === 1) {
      // strobe 高电平：把 8 个键态打包进移位寄存器
      this.shifter = 0
      for (let i = 0; i < 8; i++) {
        if (this.buttons.has(ORDER[i])) this.shifter |= 1 << i
      }
    }
    // strobe 落回 0：快照保持，等待被逐位移出
  }

  read(): number {
    const bit = this.shifter & 1
    this.shifter = (this.shifter >> 1) | 0x80 // 移空的位补 1（真机行为）
    return bit
  }
}
