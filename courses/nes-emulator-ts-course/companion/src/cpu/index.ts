// CPU 6502：寄存器、标志位与取指-译码-执行心跳。指令实现在 instructions.ts 的
// OPCODES 表里，逐章长全。

import type { Bus } from '../bus'
import { word, toHex, toHex16, hi, lo } from '../bits'
import { OPCODES } from './instructions'

export class CPU {
  // 三个通用寄存器 + 程序计数器 + 栈指针
  a = 0 // 累加器：算术逻辑的主工作台
  x = 0 // 变址寄存器 X
  y = 0 // 变址寄存器 Y
  pc = 0 // 程序计数器：下一条指令的门牌
  sp = 0xfd // 栈指针：指向 RAM $0100-$01FF 的栈顶

  // 六个标志位：CPU 的便签
  n = false // negative：结果最高位是 1（按补码读就是负数）
  z = false // zero：结果是 0
  c = false // carry：进位/借位
  v = false // overflow：带符号溢出
  i = true // interrupt disable：屏蔽可屏蔽中断
  d = false // decimal：十进制模式（NES 的 6502 没实现，保留位）

  constructor(readonly bus: Bus) {}

  reset(): void {
    this.a = this.x = this.y = 0
    this.sp = 0xfd
    this.i = true
    // 开机第一件事：到 $FFFC/$FFFD 读复位向量（低字节在前）
    this.pc = word(this.bus.read(0xfffc), this.bus.read(0xfffd))
  }

  // 取一个字节（指令或操作数），PC 顺手指向下一格
  fetch(): number {
    return this.bus.read(this.pc++ & 0xffff)
  }

  // 栈在 RAM $0100-$01FF：SP 先减后压、先弹后加（6502 栈向下长）
  push(v: number): void {
    this.bus.write(0x100 | this.sp, v & 0xff)
    this.sp = (this.sp - 1) & 0xff
  }

  pop(): number {
    this.sp = (this.sp + 1) & 0xff
    return this.bus.read(0x100 | this.sp)
  }

  // P 寄存器打包/解包：NV1BDIZC（bit5 恒 1，B 位只在入栈时有意义）
  getP(breakFlag = false): number {
    return (
      (this.n ? 0x80 : 0) | (this.v ? 0x40 : 0) | 0x20 |
      (breakFlag ? 0x10 : 0) | (this.d ? 0x08 : 0) |
      (this.i ? 0x04 : 0) | (this.z ? 0x02 : 0) | (this.c ? 0x01 : 0)
    )
  }

  setP(v: number): void {
    this.n = (v & 0x80) !== 0
    this.v = (v & 0x40) !== 0
    this.d = (v & 0x08) !== 0
    this.i = (v & 0x04) !== 0
    this.z = (v & 0x02) !== 0
    this.c = (v & 0x01) !== 0
  }

  // 装入类指令顺手更新的两张便签
  setZN(val: number): void {
    this.z = val === 0
    this.n = (val & 0x80) !== 0
  }

  private nmiPending = false // VBlank 拉过的铃，下条指令前处理

  nmi(): void {
    this.nmiPending = true
  }

  step(): number {
    if (this.nmiPending) {
      // 中断序列：现场入栈 → 关中断 → 跳 $FFFA/$FFFB 的 NMI 处理程序
      this.nmiPending = false
      this.push(hi(this.pc))
      this.push(lo(this.pc))
      this.push(this.getP(false))
      this.i = true
      this.pc = word(this.bus.read(0xfffa), this.bus.read(0xfffb))
      return 7
    }
    const opcode = this.fetch()
    const inst = OPCODES[opcode]
    if (!inst) {
      throw new Error(`unknown opcode ${toHex(opcode)} at ${toHex16(this.pc - 1)}`)
    }
    return inst.run(this)
  }
}
