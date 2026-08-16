import { describe, it, expect } from 'vitest'
import { Cpu } from '../src/cpu.js'

// 平坦 64KB 内存 + 把程序放在 $8000,复位向量指向 $8000
function makeCpu(program: number[], org = 0x8000) {
  const ram = new Uint8Array(0x10000)
  ram.set(program, org)
  ram[0xfffc] = org & 0xff
  ram[0xfffd] = org >> 8
  const cpu = new Cpu({ read: (a) => ram[a], write: (a, v) => { ram[a] = v } })
  cpu.reset()
  return { cpu, ram }
}

describe('Cpu.reset:复位与寄存器初始值', () => {
  it('从 $FFFC/$FFFD 读复位向量,PC 指向程序起点', () => {
    const { cpu } = makeCpu([0xa9, 0x05]) // LDA #$05
    expect(cpu.PC).toBe(0x8000)
  })

  it('复位后 A/X/Y 清零、SP=$FD、I 标志置位', () => {
    const { cpu } = makeCpu([])
    expect(cpu.A).toBe(0)
    expect(cpu.X).toBe(0)
    expect(cpu.Y).toBe(0)
    expect(cpu.SP).toBe(0xfd)
    expect(cpu.P & 0x04).toBe(0x04) // FLAG_I
  })
})

describe('Cpu.step:取指执行与标志位', () => {
  it('LDA 立即数装入 A,消耗 2 周期', () => {
    const { cpu } = makeCpu([0xa9, 0x05]) // LDA #$05
    const cycles = cpu.step()
    expect(cpu.A).toBe(0x05)
    expect(cycles).toBe(2)
  })

  it('LDA #$00 置 Z 标志;LDA #$80 置 N 标志', () => {
    const z = makeCpu([0xa9, 0x00]).cpu
    z.step()
    expect(z.P & 0x02).toBe(0x02) // FLAG_Z

    const n = makeCpu([0xa9, 0x80]).cpu
    n.step()
    expect(n.P & 0x80).toBe(0x80) // FLAG_N
    expect(n.P & 0x02).toBe(0) // 且 Z 清
  })

  it('LDA 绝对地址从内存取值', () => {
    const { cpu, ram } = makeCpu([0xad, 0x00, 0x03]) // LDA $0300
    ram[0x0300] = 0x99
    cpu.step()
    expect(cpu.A).toBe(0x99)
  })

  it('LDX/LDY 立即数各自装入 X/Y', () => {
    const { cpu } = makeCpu([
      0xa2, 0x11, // LDX #$11
      0xa0, 0x22, // LDY #$22
    ])
    cpu.step()
    cpu.step()
    expect(cpu.X).toBe(0x11)
    expect(cpu.Y).toBe(0x22)
  })

  it('STA 绝对地址把 A 写进内存', () => {
    const { cpu, ram } = makeCpu([
      0xa9, 0x42, // LDA #$42
      0x8d, 0x00, 0x03, // STA $0300
    ])
    cpu.step()
    cpu.step()
    expect(ram[0x0300]).toBe(0x42)
  })

  it('JMP 绝对地址改变 PC,后续从新地址取指', () => {
    const { cpu } = makeCpu([
      0x4c, 0x06, 0x80, // JMP $8006
      0x00, 0x00, 0x00, // 填充
      0xa9, 0x77, // $8006: LDA #$77
    ])
    cpu.step() // JMP
    expect(cpu.PC).toBe(0x8006)
    cpu.step() // LDA #$77
    expect(cpu.A).toBe(0x77)
  })

  it('未知 opcode 抛错,错误信息带地址', () => {
    const { cpu } = makeCpu([0x02]) // 非官方 opcode
    let err: Error | undefined
    try {
      cpu.step()
    } catch (e) {
      err = e as Error
    }
    expect(err).toBeInstanceOf(Error)
    expect(err?.message).toMatch(/opcode/i)
    expect(err?.message).toMatch(/8000/i)
  })
})
