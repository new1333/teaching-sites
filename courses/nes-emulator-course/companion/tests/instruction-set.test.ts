import { describe, it, expect } from 'vitest'
import { Cpu } from '../src/cpu.js'

function makeCpu(program: number[], org = 0x8000) {
  const ram = new Uint8Array(0x10000)
  ram.set(program, org)
  ram[0xfffc] = org & 0xff
  ram[0xfffd] = org >> 8
  const cpu = new Cpu({ read: (a) => ram[a], write: (a, v) => { ram[a] = v } })
  cpu.reset()
  return { cpu, ram }
}

const F = { C: 0x01, Z: 0x02, I: 0x04, V: 0x40, N: 0x80 }

describe('算术与标志位:N/V/Z/C 真值', () => {
  it('ADC $7F+$01:有符号溢出 → V=1,N=1,C=0', () => {
    const { cpu } = makeCpu([
      0xa9, 0x7f, // LDA #$7F
      0x69, 0x01, // ADC #$01
    ])
    cpu.step()
    cpu.step()
    expect(cpu.A).toBe(0x80)
    expect(cpu.P & F.N).toBe(F.N)
    expect(cpu.P & F.V).toBe(F.V)
    expect(cpu.P & F.C).toBe(0)
  })

  it('ADC $FF+$01:无符号进位 → C=1,Z=1,V=0', () => {
    const { cpu } = makeCpu([
      0xa9, 0xff, // LDA #$FF
      0x69, 0x01, // ADC #$01
    ])
    cpu.step()
    cpu.step()
    expect(cpu.A).toBe(0x00)
    expect(cpu.P & F.C).toBe(F.C)
    expect(cpu.P & F.Z).toBe(F.Z)
    expect(cpu.P & F.V).toBe(0)
  })

  it('ADC 带进位入:先 SEC 再 ADC #$00 → A=$01', () => {
    const { cpu } = makeCpu([
      0xa9, 0x00, // LDA #$00
      0x38, // SEC
      0x69, 0x00, // ADC #$00
    ])
    cpu.step()
    cpu.step()
    cpu.step()
    expect(cpu.A).toBe(0x01)
  })

  it('SBC $00-$01(先 SEC,无借位入)→ A=$FF,C=0,N=1', () => {
    const { cpu } = makeCpu([
      0xa9, 0x00, // LDA #$00
      0x38, // SEC
      0xe9, 0x01, // SBC #$01
    ])
    cpu.step()
    cpu.step()
    cpu.step()
    expect(cpu.A).toBe(0xff)
    expect(cpu.P & F.C).toBe(0)
    expect(cpu.P & F.N).toBe(F.N)
  })

  it('SBC 有符号下溢:$80-$01(先 SEC)→ V=1,C=1', () => {
    const { cpu } = makeCpu([
      0xa9, 0x80, // LDA #$80
      0x38, // SEC
      0xe9, 0x01, // SBC #$01
    ])
    cpu.step()
    cpu.step()
    cpu.step()
    expect(cpu.A).toBe(0x7f)
    expect(cpu.P & F.V).toBe(F.V)
    expect(cpu.P & F.C).toBe(F.C)
  })

  it('CMP 相等 → C=1,Z=1;小于 → C=0,N=1', () => {
    const eq = makeCpu([0xa9, 0x50, 0xc9, 0x50]).cpu
    eq.step()
    eq.step()
    expect(eq.P & F.C).toBe(F.C)
    expect(eq.P & F.Z).toBe(F.Z)

    const lt = makeCpu([0xa9, 0x50, 0xc9, 0x51]).cpu
    lt.step()
    lt.step()
    expect(lt.P & F.C).toBe(0)
    expect(lt.P & F.N).toBe(F.N)
  })

  it('BIT:V/N 来自内存操作数,Z 来自 A 与操作数的与', () => {
    const { cpu, ram } = makeCpu([0x24, 0x10]) // BIT $10
    ram[0x10] = 0xc0
    cpu.step()
    expect(cpu.P & F.V).toBe(F.V)
    expect(cpu.P & F.N).toBe(F.N)
    expect(cpu.P & F.Z).toBe(F.Z) // A=0 & 0xC0 = 0
  })
})

describe('移位与旋转', () => {
  it('ASL A:$80 → A=$00,C=1,Z=1', () => {
    const { cpu } = makeCpu([0xa9, 0x80, 0x0a])
    cpu.step()
    cpu.step()
    expect(cpu.A).toBe(0x00)
    expect(cpu.P & F.C).toBe(F.C)
    expect(cpu.P & F.Z).toBe(F.Z)
  })

  it('ROL A:C=1 入低位:$40 → $81,C=0', () => {
    const { cpu } = makeCpu([0xa9, 0x40, 0x38, 0x2a])
    cpu.step()
    cpu.step()
    cpu.step()
    expect(cpu.A).toBe(0x81)
    expect(cpu.P & F.C).toBe(0)
  })

  it('ROR A:$01,C=0 → A=$00,C=1', () => {
    const { cpu } = makeCpu([0xa9, 0x01, 0x6a])
    cpu.step()
    cpu.step()
    expect(cpu.A).toBe(0x00)
    expect(cpu.P & F.C).toBe(F.C)
  })

  it('INC 零页回绕:$FF + 1 → $00,Z=1', () => {
    const { cpu, ram } = makeCpu([0xe6, 0xff]) // INC $FF
    ram[0xff] = 0xff
    cpu.step()
    expect(ram[0xff]).toBe(0x00)
    expect(cpu.P & F.Z).toBe(F.Z)
  })

  it('DEC 绝对地址:内存减一并写回', () => {
    const { cpu, ram } = makeCpu([0xce, 0x00, 0x03]) // DEC $0300
    ram[0x0300] = 0x10
    cpu.step()
    expect(ram[0x0300]).toBe(0x0f)
  })
})

describe('栈与中断', () => {
  it('PHA/PLA:A 压栈弹出后恢复', () => {
    const { cpu } = makeCpu([
      0xa9, 0x5a, // LDA #$5A
      0x48, // PHA
      0xa9, 0x00, // LDA #$00
      0x68, // PLA
    ])
    for (let i = 0; i < 4; i++) cpu.step()
    expect(cpu.A).toBe(0x5a)
  })

  it('PHP/PLP:标志位经栈往返(C 被恢复)', () => {
    const { cpu } = makeCpu([
      0x38, // SEC
      0x08, // PHP
      0x18, // CLC
      0x28, // PLP
    ])
    for (let i = 0; i < 4; i++) cpu.step()
    expect(cpu.P & F.C).toBe(F.C)
  })

  it('BRK:压栈 P 带 B 标志,经 RTI 后现场恢复、回到 BRK 后第三字节', () => {
    const { cpu, ram } = makeCpu([
      0xa9, 0x42, // $8000: LDA #$42
      0x00, // $8002: BRK
      0xea, // $8003: BRK 的签名字节(被跳过)
      0xa9, 0x77, // $8004: 返回点
    ])
    // IRQ/BRK 向量指向 $9000 的 RTI
    ram[0xfffe] = 0x00
    ram[0xffff] = 0x90
    ram[0x9000] = 0x40 // RTI
    cpu.step() // LDA
    cpu.step() // BRK
    expect(cpu.P & F.I).toBe(F.I) // 中断内 I 置位
    // 栈上压入的 P 带 B 标志(位于 $01FB,SP 复位 $FD 压 3 字节后指向 $FA)
    expect(ram[0x01fb] & 0x10).toBe(0x10)
    cpu.step() // RTI
    expect(cpu.PC).toBe(0x8004)
    cpu.step()
    expect(cpu.A).toBe(0x77)
  })

  it('JSR/RTS:调用子程序并返回下一条指令', () => {
    const { cpu, ram } = makeCpu([
      0xa9, 0x01, // $8000: LDA #$01
      0x20, 0x00, 0x90, // $8002: JSR $9000
      0xa9, 0x02, // $8005: 返回点
    ])
    ram[0x9000] = 0xe8 // INX
    ram[0x9001] = 0x60 // RTS
    cpu.step() // LDA
    cpu.step() // JSR
    expect(cpu.PC).toBe(0x9000)
    cpu.step() // INX
    cpu.step() // RTS
    expect(cpu.PC).toBe(0x8005)
    expect(cpu.X).toBe(1)
  })
})

describe('周期计数', () => {
  it('LDA abs,X 不跨页 4 周期,跨页 5 周期', () => {
    const samePage = makeCpu([0xa2, 0x10, 0xbd, 0x00, 0x03]).cpu // $0300+$10 不跨
    samePage.step()
    expect(samePage.step()).toBe(4)

    const crossPage = makeCpu([0xa2, 0x10, 0xbd, 0xf8, 0x02]).cpu // $02F8+$10=$0308 跨页
    crossPage.step()
    expect(crossPage.step()).toBe(5)
  })

  it('分支:不跳 2 周期,同页跳 3 周期,跨页跳 4 周期', () => {
    const notTaken = makeCpu([0xa9, 0x01, 0xf0, 0x02]).cpu // Z=0 不跳
    notTaken.step()
    expect(notTaken.step()).toBe(2)

    const takenSame = makeCpu([0xa9, 0x00, 0xf0, 0x02]).cpu // $8004 → $8006 同页
    takenSame.step()
    expect(takenSame.step()).toBe(3)

    const takenCross = makeCpu(
      [
        0xa9, 0x00, // LDA #$00 → Z=1
        0xf0, 0x7f, // BEQ +$7F:PC 过操作数后 $80FC → $817B,跨入 $81 页
      ],
      0x80f8,
    ).cpu
    takenCross.step()
    expect(takenCross.step()).toBe(4)
  })

  it('JMP 间接寻址 5 周期,JSR 6 周期', () => {
    const jmp = makeCpu([0x6c, 0x00, 0x10]).cpu
    expect(jmp.step()).toBe(5)
    const jsr = makeCpu([0x20, 0x00, 0x90]).cpu
    expect(jsr.step()).toBe(6)
  })
})
