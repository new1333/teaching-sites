// opcode 指令表：全部 56 条官方指令、151 个官方 opcode。
// 组织方式是「动词 × 状语」：apply 函数是动词（对操作数做什么），
// 寻址函数是状语（操作数从哪来），组合子把它们装配成表项。
// 周期数取官方基础值（跨页/分支成立的加拍不进本课程）。

import type { CPU } from './index'
import { word, toSigned, lo, hi } from '../bits'
import {
  zeroPage, zeroPageX, zeroPageY, absolute, absoluteX, absoluteY,
  indirect, indirectX, indirectY,
} from './addressing'

export interface Inst {
  run: (cpu: CPU) => number // 返回消耗的周期数
}

type Addr = (cpu: CPU) => number
type Apply = (cpu: CPU, m: number) => void
type Run = (cpu: CPU) => number

export const OPCODES: Record<number, Inst> = {}

function def(entries: Record<number, Run>): void {
  for (const k of Object.keys(entries)) OPCODES[Number(k)] = { run: entries[Number(k)] }
}

// ———— 组合子 ————

// 读-改-写族骨架：按寻址取操作数、交给动词、返回周期
const at = (addr: Addr, cycles: number, apply: Apply): Run => (cpu) => {
  apply(cpu, cpu.bus.read(addr(cpu)))
  return cycles
}

// 立即数族：操作数就在指令流里
const imm = (apply: Apply): Run => (cpu) => {
  apply(cpu, cpu.fetch())
  return 2
}

// 存储族：把寄存器写进寻址所得的地址
const store = (addr: Addr, cycles: number, pick: (cpu: CPU) => number): Run => (cpu) => {
  cpu.bus.write(addr(cpu), pick(cpu))
  return cycles
}

// 读-改-写内存族：取数、变换、写回同一格
const rmw = (addr: Addr, cycles: number, mutate: (cpu: CPU, m: number) => number): Run => (cpu) => {
  const a = addr(cpu)
  cpu.bus.write(a, mutate(cpu, cpu.bus.read(a)))
  return cycles
}

// 8 变体读取族（LDA/AND/ORA/EOR/ADC/SBC/CMP 通用布局）
function readerOps(apply: Apply, [opImm, opZp, opZpx, opAbs, opAbsx, opAbsy, opIzx, opIzy]: number[]): void {
  def({
    [opImm]: imm(apply),
    [opZp]: at(zeroPage, 3, apply),
    [opZpx]: at(zeroPageX, 4, apply),
    [opAbs]: at(absolute, 4, apply),
    [opAbsx]: at(absoluteX, 4, apply),
    [opAbsy]: at(absoluteY, 4, apply),
    [opIzx]: at(indirectX, 6, apply),
    [opIzy]: at(indirectY, 5, apply),
  })
}

// 移位族（ASL/LSR/ROL/ROR 通用布局：A / 零页 / 零页,X / 绝对 / 绝对,X）
function shiftOps(
  acc: (cpu: CPU) => void, mutate: (cpu: CPU, m: number) => number,
  [opAcc, opZp, opZpx, opAbs, opAbsx]: number[]
): void {
  def({
    [opAcc]: (cpu) => { acc(cpu); return 2 },
    [opZp]: rmw(zeroPage, 5, mutate),
    [opZpx]: rmw(zeroPageX, 6, mutate),
    [opAbs]: rmw(absolute, 6, mutate),
    [opAbsx]: rmw(absoluteX, 7, mutate),
  })
}

// ———— 动词（apply / mutate）————

const ldaA: Apply = (cpu, m) => { cpu.a = m; cpu.setZN(m) }
const ldxA: Apply = (cpu, m) => { cpu.x = m; cpu.setZN(m) }
const ldyA: Apply = (cpu, m) => { cpu.y = m; cpu.setZN(m) }

function adcA(cpu: CPU, m: number): void {
  const sum = cpu.a + m + (cpu.c ? 1 : 0)
  cpu.c = sum > 0xff
  cpu.v = (~(cpu.a ^ m) & (cpu.a ^ sum) & 0x80) !== 0 // 同号相加变号 = 溢出
  cpu.a = sum & 0xff
  cpu.setZN(cpu.a)
}

const sbcA: Apply = (cpu, m) => adcA(cpu, m ^ 0xff) // 减法 = 加补码

const andA: Apply = (cpu, m) => { cpu.a &= m; cpu.setZN(cpu.a) }
const oraA: Apply = (cpu, m) => { cpu.a |= m; cpu.setZN(cpu.a) }
const eorA: Apply = (cpu, m) => { cpu.a ^= m; cpu.setZN(cpu.a) }

function cmpWith(cpu: CPU, r: number, m: number): void {
  const diff = r - m
  cpu.c = diff >= 0
  cpu.z = (diff & 0xff) === 0
  cpu.n = (diff & 0x80) !== 0
}
const cmpA: Apply = (cpu, m) => cmpWith(cpu, cpu.a, m)
const cpxA: Apply = (cpu, m) => cmpWith(cpu, cpu.x, m)
const cpyA: Apply = (cpu, m) => cmpWith(cpu, cpu.y, m)

const bitA: Apply = (cpu, m) => {
  cpu.z = (cpu.a & m) === 0
  cpu.n = (m & 0x80) !== 0 // N/V 直接来自操作数，这是 BIT 的特殊之处
  cpu.v = (m & 0x40) !== 0
}

const incM = (cpu: CPU, m: number) => { const v = (m + 1) & 0xff; cpu.setZN(v); return v }
const decM = (cpu: CPU, m: number) => { const v = (m - 1) & 0xff; cpu.setZN(v); return v }

function setAfterShift(cpu: CPU, v: number): void {
  cpu.setZN(v)
}

const aslM = (cpu: CPU, m: number) => { cpu.c = (m & 0x80) !== 0; const v = (m << 1) & 0xff; setAfterShift(cpu, v); return v }
const lsrM = (cpu: CPU, m: number) => { cpu.c = (m & 1) !== 0; const v = m >> 1; setAfterShift(cpu, v); return v }
const rolM = (cpu: CPU, m: number) => { const oldC = cpu.c ? 1 : 0; cpu.c = (m & 0x80) !== 0; const v = ((m << 1) | oldC) & 0xff; setAfterShift(cpu, v); return v }
const rorM = (cpu: CPU, m: number) => { const oldC = cpu.c ? 0x80 : 0; cpu.c = (m & 1) !== 0; const v = (m >> 1) | oldC; setAfterShift(cpu, v); return v }

// ———— 装表 ————

// 读取 + 算逻族（8 变体布局）
readerOps(ldaA, [0xa9, 0xa5, 0xb5, 0xad, 0xbd, 0xb9, 0xa1, 0xb1]) // LDA
readerOps(andA, [0x29, 0x25, 0x35, 0x2d, 0x3d, 0x39, 0x21, 0x31]) // AND
readerOps(oraA, [0x09, 0x05, 0x15, 0x0d, 0x1d, 0x19, 0x01, 0x11]) // ORA
readerOps(eorA, [0x49, 0x45, 0x55, 0x4d, 0x5d, 0x59, 0x41, 0x51]) // EOR
readerOps(adcA, [0x69, 0x65, 0x75, 0x6d, 0x7d, 0x79, 0x61, 0x71]) // ADC
readerOps(sbcA, [0xe9, 0xe5, 0xf5, 0xed, 0xfd, 0xf9, 0xe1, 0xf1]) // SBC
readerOps(cmpA, [0xc9, 0xc5, 0xd5, 0xcd, 0xdd, 0xd9, 0xc1, 0xd1]) // CMP

// LDX / LDY（变体较少：imm / 零页(+X/Y) / 绝对(+X/Y)）
def({
  0xa2: imm(ldxA), 0xa6: at(zeroPage, 3, ldxA), 0xb6: at(zeroPageY, 4, ldxA),
  0xae: at(absolute, 4, ldxA), 0xbe: at(absoluteY, 4, ldxA),
  0xa0: imm(ldyA), 0xa4: at(zeroPage, 3, ldyA), 0xb4: at(zeroPageX, 4, ldyA),
  0xac: at(absolute, 4, ldyA), 0xbc: at(absoluteX, 4, ldyA),
})

// STA / STX / STY
def({
  0x85: store(zeroPage, 3, c => c.a), 0x95: store(zeroPageX, 4, c => c.a),
  0x8d: store(absolute, 4, c => c.a), 0x9d: store(absoluteX, 5, c => c.a),
  0x99: store(absoluteY, 5, c => c.a), 0x81: store(indirectX, 6, c => c.a),
  0x91: store(indirectY, 6, c => c.a),
  0x86: store(zeroPage, 3, c => c.x), 0x96: store(zeroPageY, 4, c => c.x),
  0x8e: store(absolute, 4, c => c.x),
  0x84: store(zeroPage, 3, c => c.y), 0x94: store(zeroPageX, 4, c => c.y),
  0x8c: store(absolute, 4, c => c.y),
})

// 比较（CPX/CPY）与 BIT
def({
  0xe0: imm(cpxA), 0xe4: at(zeroPage, 3, cpxA), 0xec: at(absolute, 4, cpxA),
  0xc0: imm(cpyA), 0xc4: at(zeroPage, 3, cpyA), 0xcc: at(absolute, 4, cpyA),
  0x24: at(zeroPage, 3, bitA), 0x2c: at(absolute, 4, bitA),
})

// INC / DEC（内存读改写）
def({
  0xe6: rmw(zeroPage, 5, incM), 0xf6: rmw(zeroPageX, 6, incM),
  0xee: rmw(absolute, 6, incM), 0xfe: rmw(absoluteX, 7, incM),
  0xc6: rmw(zeroPage, 5, decM), 0xd6: rmw(zeroPageX, 6, decM),
  0xce: rmw(absolute, 6, decM), 0xde: rmw(absoluteX, 7, decM),
})

// 移位旋转（含累加器模式）
shiftOps(cpu => { cpu.a = aslM(cpu, cpu.a) }, aslM, [0x0a, 0x06, 0x16, 0x0e, 0x1e]) // ASL
shiftOps(cpu => { cpu.a = lsrM(cpu, cpu.a) }, lsrM, [0x4a, 0x46, 0x56, 0x4e, 0x5e]) // LSR
shiftOps(cpu => { cpu.a = rolM(cpu, cpu.a) }, rolM, [0x2a, 0x26, 0x36, 0x2e, 0x3e]) // ROL
shiftOps(cpu => { cpu.a = rorM(cpu, cpu.a) }, rorM, [0x6a, 0x66, 0x76, 0x6e, 0x7e]) // ROR

// 寄存器自增自减与传送
def({
  0xe8: c => { c.x = (c.x + 1) & 0xff; c.setZN(c.x); return 2 }, // INX
  0xc8: c => { c.y = (c.y + 1) & 0xff; c.setZN(c.y); return 2 }, // INY
  0xca: c => { c.x = (c.x - 1) & 0xff; c.setZN(c.x); return 2 }, // DEX
  0x88: c => { c.y = (c.y - 1) & 0xff; c.setZN(c.y); return 2 }, // DEY
  0xaa: c => { c.x = c.a; c.setZN(c.x); return 2 }, // TAX
  0xa8: c => { c.y = c.a; c.setZN(c.y); return 2 }, // TAY
  0x8a: c => { c.a = c.x; c.setZN(c.a); return 2 }, // TXA
  0x98: c => { c.a = c.y; c.setZN(c.a); return 2 }, // TYA
  0xba: c => { c.x = c.sp; c.setZN(c.x); return 2 }, // TSX
  0x9a: c => { c.sp = c.x; return 2 }, // TXS（不动标志，这是例外）
})

// 栈操作
def({
  0x48: c => { c.push(c.a); return 3 }, // PHA
  0x08: c => { c.push(c.getP(true)); return 3 }, // PHP
  0x68: c => { c.a = c.pop(); c.setZN(c.a); return 4 }, // PLA
  0x28: c => { c.setP(c.pop()); return 4 }, // PLP
})

// 跳转
def({
  0x4c: c => { c.pc = absolute(c); return 3 }, // JMP abs
  0x6c: c => { c.pc = indirect(c); return 5 }, // JMP (ind)
  0x20: c => { // JSR：压「返回地址-1」，RTS 弹出后 +1 回到下一条
    const target = absolute(c)
    const ret = (c.pc - 1) & 0xffff
    c.push(hi(ret))
    c.push(lo(ret))
    c.pc = target
    return 6
  },
  0x60: c => { // RTS
    const l = c.pop()
    const h = c.pop()
    c.pc = (word(l, h) + 1) & 0xffff
    return 6
  },
  0x40: c => { // RTI：弹 P、弹 PC（不 +1）
    c.setP(c.pop())
    const l = c.pop()
    const h = c.pop()
    c.pc = word(l, h)
    return 6
  },
  0x00: c => { // BRK：软件中断，走 IRQ 向量（第 10 章与中断机制会师）
    c.push(hi(c.pc))
    c.push(lo(c.pc))
    c.push(c.getP(true))
    c.i = true
    c.pc = word(c.bus.read(0xfffe), c.bus.read(0xffff))
    return 7
  },
})

// 分支：条件成立才改 PC（偏移字节无论跳不跳都要吃掉）
function branchOn(cond: (cpu: CPU) => boolean): Run {
  return (cpu) => {
    const off = toSigned(cpu.fetch())
    if (cond(cpu)) cpu.pc = (cpu.pc + off) & 0xffff
    return 2
  }
}
def({
  0x90: branchOn(c => !c.c), // BCC
  0xb0: branchOn(c => c.c), // BCS
  0xf0: branchOn(c => c.z), // BEQ
  0xd0: branchOn(c => !c.z), // BNE
  0x30: branchOn(c => c.n), // BMI
  0x10: branchOn(c => !c.n), // BPL
  0x50: branchOn(c => !c.v), // BVC
  0x70: branchOn(c => c.v), // BVS
})

// 标志位开关
def({
  0x18: c => { c.c = false; return 2 }, // CLC
  0x38: c => { c.c = true; return 2 }, // SEC
  0x58: c => { c.i = false; return 2 }, // CLI
  0x78: c => { c.i = true; return 2 }, // SEI
  0xb8: c => { c.v = false; return 2 }, // CLV
  0xd8: c => { c.d = false; return 2 }, // CLD
  0xf8: c => { c.d = true; return 2 }, // SED
  0xea: () => 2, // NOP
})
