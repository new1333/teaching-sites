// 6502 CPU:寄存器、复位、取指-译码-执行循环、13 种寻址模式,以及全部官方指令。
// 内存由外部注入(read/write 回调),CPU 本体不关心地址路由。

import { u8, u16, i8 } from './util.js'
import { OPS, type OpInfo } from './opcodes.js'

export interface CpuMemory {
  read(addr: number): number
  write(addr: number, val: number): void
}

// P 寄存器的标志位
export const FLAG_C = 0x01
export const FLAG_Z = 0x02
export const FLAG_I = 0x04
export const FLAG_D = 0x08
export const FLAG_B = 0x10
export const FLAG_U = 0x20 // 上电后恒为 1 的「恒置位」
export const FLAG_V = 0x40
export const FLAG_N = 0x80

export type Mode =
  | 'imp' // 隐含:操作数在寄存器里,如 INX
  | 'acc' // 累加器:如 ASL A
  | 'imm' // 立即数:操作码后跟 1 字节值
  | 'zp' // 零页:1 字节地址,高字节恒为 $00
  | 'zpX' // 零页,X:先加 X,再绕回零页(高字节不进位)
  | 'zpY' // 零页,Y:同上
  | 'abs' // 绝对:2 字节地址
  | 'absX' // 绝对,X
  | 'absY' // 绝对,Y
  | 'ind' // 间接:2 字节指针地址(仅 JMP 使用)
  | 'indX' // (零页,X):指针表先加 X 再绕回,读 16 位目标
  | 'indY' // (零页),Y:先读 16 位基地址,再加 Y(正常进位)
  | 'rel' // 相对:1 字节带符号偏移(分支指令使用)

export class Cpu {
  A = 0
  X = 0
  Y = 0
  SP = 0xfd
  PC = 0
  P = FLAG_I | FLAG_U

  /** 寻址阶段记录:本次取操作数是否跨页(供周期加成) */
  private pageCrossed = false
  /** 分支阶段记录:本次分支是否跳转成功(供周期加成) */
  private branchTaken = false

  constructor(readonly mem: CpuMemory) {}

  reset(): void {
    this.SP = 0xfd
    this.P = FLAG_I | FLAG_U
    this.A = 0
    this.X = 0
    this.Y = 0
    // 真机上电第一件事:从 $FFFC/$FFFD 读复位向量,而不是从 0 开始
    this.PC = this.read16(0xfffc)
  }

  step(): number {
    const at = this.PC
    const opcode = this.fetch8()
    const op = OPS[opcode]
    if (!op) {
      throw new Error(`未知 opcode $${u8(opcode).toString(16).padStart(2, '0')} @ $${at.toString(16)}`)
    }
    this.pageCrossed = false
    this.branchTaken = false
    const operand = this.operand(op.mode)
    op.run(this, operand)
    return this.cyclesOf(op)
  }

  private cyclesOf(op: OpInfo): number {
    let cycles = op.cycles
    if (op.pageCross && this.pageCrossed) cycles++
    if (op.branch && this.branchTaken) {
      cycles++
      if (this.pageCrossed) cycles++
    }
    return cycles
  }

  /** 按寻址模式取操作数:返回地址(内存类)或值(imm/rel) */
  private operand(mode: Mode): number {
    switch (mode) {
      case 'imp':
      case 'acc':
        return 0
      case 'imm':
        return this.fetch8()
      case 'zp':
        return this.fetch8()
      case 'zpX': {
        // 零页绕回:$FF + 1 = $00,不进位到第二页
        return u8(this.fetch8() + this.X)
      }
      case 'zpY':
        return u8(this.fetch8() + this.Y)
      case 'abs':
        return this.fetch16()
      case 'absX':
        return this.indexed(this.fetch16(), this.X)
      case 'absY':
        return this.indexed(this.fetch16(), this.Y)
      case 'ind':
        // JMP 间接寻址:指针 +1 只翻转低字节——6502 著名硬件 bug
        return this.read16NoPageWrap(this.fetch16())
      case 'indX': {
        const p = u8(this.fetch8() + this.X) // 指针表项绕回零页
        return this.read16ZpWrap(p)
      }
      case 'indY': {
        const base = this.read16ZpWrap(this.fetch8()) // 基地址来自零页(自身绕回)
        const addr = u16(base + this.Y) // 但加 Y 是 16 位正常进位
        this.pageCrossed = (base & 0xff00) !== (addr & 0xff00)
        return addr
      }
      case 'rel':
        return this.fetch8()
    }
  }

  /** 绝对地址 + 变址:16 位正常进位,并记录是否跨页 */
  private indexed(base: number, index: number): number {
    const addr = u16(base + index)
    this.pageCrossed = (base & 0xff00) !== (addr & 0xff00)
    return addr
  }

  /** 读 16 位:高字节地址不跨页(仅 JMP 间接寻址) */
  private read16NoPageWrap(p: number): number {
    const lo = this.mem.read(p)
    const hi = this.mem.read((p & 0xff00) | ((p + 1) & 0xff))
    return lo | (hi << 8)
  }

  /** 读 16 位:指针在零页内绕回((zp,X) 与 (zp) 的取基地址阶段) */
  private read16ZpWrap(p: number): number {
    const lo = this.mem.read(p)
    const hi = this.mem.read(u8(p + 1))
    return lo | (hi << 8)
  }

  // ---- 运算与标志位 ----

  adc(m: number): void {
    // 2A03 砍掉了 BCD,SED 置位也不影响——始终按二进制算
    const sum = this.A + m + (this.P & FLAG_C ? 1 : 0)
    this.P = (this.P & ~(FLAG_C | FLAG_V)) | (sum > 0xff ? FLAG_C : 0)
    if (~(this.A ^ m) & (this.A ^ sum) & 0x80) this.P |= FLAG_V
    this.loadA(u8(sum))
  }

  sbc(m: number): void {
    // 减法 = 加「取反的操作数」,借位进位共用一套逻辑
    this.adc(m ^ 0xff)
  }

  cmpVal(reg: number, m: number): void {
    this.P = (this.P & ~FLAG_C) | (reg >= m ? FLAG_C : 0)
    this.setZN(u8(reg - m))
  }

  andA(m: number): void {
    this.loadA(this.A & m)
  }

  oraA(m: number): void {
    this.loadA(this.A | m)
  }

  eorA(m: number): void {
    this.loadA(this.A ^ m)
  }

  bit(m: number): void {
    // Z 来自 A 与操作数的与;N/V 直接抄操作数的第 7/6 位
    this.P = (this.P & ~(FLAG_Z | FLAG_N | FLAG_V))
      | ((this.A & m) === 0 ? FLAG_Z : 0)
      | (m & 0xc0)
  }

  /** 移位/旋转:置 C 与 N/Z,返回新值 */
  shift(kind: 'asl' | 'lsr' | 'rol' | 'ror', v: number): number {
    const cIn = this.P & FLAG_C ? 1 : 0
    let nv = v
    let cOut = 0
    switch (kind) {
      case 'asl': cOut = v & 0x80; nv = (v << 1) & 0xff; break
      case 'lsr': cOut = v & 0x01; nv = v >> 1; break
      case 'rol': cOut = v & 0x80; nv = ((v << 1) | cIn) & 0xff; break
      case 'ror': cOut = v & 0x01; nv = (v >> 1) | (cIn << 7); break
    }
    this.P = (this.P & ~FLAG_C) | (cOut ? FLAG_C : 0)
    this.setZN(nv)
    return nv
  }

  /** 增减 1 并置 N/Z(INC/DEC/INX/...共用) */
  bump(v: number, delta: 1 | -1): number {
    const nv = u8(v + delta)
    this.setZN(nv)
    return nv
  }

  setFlag(bit: number, on: boolean): void {
    this.P = on ? this.P | bit : this.P & ~bit
  }

  // ---- 栈($0100-$01FF,SP 预递减)----

  push8(v: number): void {
    this.mem.write(0x0100 | this.SP, u8(v))
    this.SP = u8(this.SP - 1)
  }

  pull8(): number {
    this.SP = u8(this.SP + 1)
    return this.mem.read(0x0100 | this.SP)
  }

  push16(v: number): void {
    this.push8(v >> 8)
    this.push8(v & 0xff)
  }

  pull16(): number {
    const lo = this.pull8()
    return lo | (this.pull8() << 8)
  }

  // ---- 跳转 / 子程序 / 中断 ----

  jsr(a: number): void {
    // 压栈的是「JSR 最后一个字节」的地址(PC 已过操作数,故 -1)
    this.push16(u16(this.PC - 1))
    this.PC = a
  }

  rts(): void {
    this.PC = u16(this.pull16() + 1)
  }

  rti(): void {
    this.P = (this.pull8() & ~FLAG_B) | FLAG_U
    this.PC = this.pull16()
  }

  /** 中断序列:压 PC(与返回点)、压 P、置 I、跳向量 */
  interrupt(vector: number, isBrk: boolean): void {
    // BRK 的返回点是「操作码后第 2 字节」;硬件中断的返回点是当前 PC
    this.push16(isBrk ? u16(this.PC + 1) : this.PC)
    this.push8(this.P | (isBrk ? FLAG_B : 0))
    this.setFlag(FLAG_I, true)
    this.PC = this.read16(vector)
  }

  /** 不可屏蔽中断:不受 I 标志屏蔽,向量 $FFFA */
  nmi(): void {
    this.interrupt(0xfffa, false)
  }

  /** 可屏蔽中断:被 I 标志屏蔽时静默忽略,向量 $FFFE(本课程无中断源,预留给扩展) */
  irq(): void {
    if (!(this.P & FLAG_I)) this.interrupt(0xfffe, false)
  }

  // ---- 基础设施 ----

  branch(taken: boolean, offset: number): void {
    this.branchTaken = taken
    if (!taken) return
    const from = this.PC // PC 已越过操作数
    const target = u16(from + i8(offset))
    this.pageCrossed = (from & 0xff00) !== (target & 0xff00)
    this.PC = target
  }

  loadA(v: number): void {
    this.A = v
    this.setZN(v)
  }

  setZN(v: number): void {
    this.P = (this.P & ~(FLAG_Z | FLAG_N)) | (v === 0 ? FLAG_Z : 0) | (v & 0x80 ? FLAG_N : 0)
  }

  fetch8(): number {
    const v = this.mem.read(this.PC)
    this.PC = u16(this.PC + 1)
    return v
  }

  fetch16(): number {
    const lo = this.fetch8()
    return lo | (this.fetch8() << 8)
  }

  read16(addr: number): number {
    return this.mem.read(addr) | (this.mem.read(u16(addr + 1)) << 8)
  }
}
