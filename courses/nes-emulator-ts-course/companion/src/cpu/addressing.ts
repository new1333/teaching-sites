// 寻址模式：同一个「取操作数」动作的 13 种说法。
// 其中 10 种要算出地址，各是一个函数；implied/accumulator 无操作数、
// immediate 的操作数就是指令流里的字节（cpu.fetch() 直接拿），不走这里。

import type { Bus } from '../bus'
import { word, toSigned } from '../bits'

export interface CpuCore {
  bus: Bus
  pc: number
  x: number
  y: number
  fetch(): number // 取一个操作数字节，PC 顺手指向下一格
}

export function zeroPage(cpu: CpuCore): number {
  return cpu.fetch()
}

export function zeroPageX(cpu: CpuCore): number {
  return (cpu.fetch() + cpu.x) & 0xff // 零页回绕：加完仍锁在 $00-$FF
}

export function zeroPageY(cpu: CpuCore): number {
  return (cpu.fetch() + cpu.y) & 0xff
}

export function absolute(cpu: CpuCore): number {
  const lo = cpu.fetch()
  const hi = cpu.fetch()
  return word(lo, hi)
}

export function absoluteX(cpu: CpuCore): number {
  return (absolute(cpu) + cpu.x) & 0xffff
}

export function absoluteY(cpu: CpuCore): number {
  return (absolute(cpu) + cpu.y) & 0xffff
}

// 间接：指针格存 16 位地址。页边界指针的高字节回绕到页首——真机硬件 bug，照抄
export function indirect(cpu: CpuCore): number {
  const ptrLo = cpu.fetch()
  const ptrHi = cpu.fetch()
  const ptr = word(ptrLo, ptrHi)
  const lo = cpu.bus.read(ptr)
  // $xxFF 的下一格是 $xx00：保留页号，低位 +1 后回绕
  const hi = cpu.bus.read((ptr & 0xff00) | ((ptr + 1) & 0xff))
  return word(lo, hi)
}

// (零页,X)：先加 X 得指针格，再从指针格取 16 位地址
export function indirectX(cpu: CpuCore): number {
  const ptr = (cpu.fetch() + cpu.x) & 0xff
  return word(cpu.bus.read(ptr), cpu.bus.read((ptr + 1) & 0xff))
}

// (零页),Y：先从指针格取 16 位基址，再加 Y
export function indirectY(cpu: CpuCore): number {
  const ptr = cpu.fetch()
  const base = word(cpu.bus.read(ptr), cpu.bus.read((ptr + 1) & 0xff))
  return (base + cpu.y) & 0xffff
}

// 相对：分支专用。单字节补码偏移，目标 = 越过偏移字节后的 PC ± 偏移
export function relative(cpu: CpuCore): number {
  const offset = toSigned(cpu.fetch()) // 先取偏移（fetch 顺带把 PC 越过它）
  return (cpu.pc + offset) & 0xffff
}
