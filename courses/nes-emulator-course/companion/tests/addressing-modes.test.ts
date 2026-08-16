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

describe('基础寻址:零页与绝对', () => {
  it('零页:STA $10 写到 0x0010', () => {
    const { cpu, ram } = makeCpu([
      0xa9, 0x42, // LDA #$42
      0x85, 0x10, // STA $10
    ])
    cpu.step()
    cpu.step()
    expect(ram[0x0010]).toBe(0x42)
  })

  it('绝对,X:LDA $0300,X 读 0x0305', () => {
    const { cpu, ram } = makeCpu([
      0xa2, 0x05, // LDX #$05
      0xbd, 0x00, 0x03, // LDA $0300,X
    ])
    ram[0x0305] = 0x42
    cpu.step()
    cpu.step()
    expect(cpu.A).toBe(0x42)
  })

  it('绝对,Y:STA $0300,Y 写 0x0305', () => {
    const { cpu, ram } = makeCpu([
      0xa0, 0x05, // LDY #$05
      0xa9, 0x77, // LDA #$77
      0x99, 0x00, 0x03, // STA $0300,Y
    ])
    cpu.step()
    cpu.step()
    cpu.step()
    expect(ram[0x0305]).toBe(0x77)
  })
})

describe('零页绕回:高字节不进位', () => {
  it('zp,X:STA $FF,X 在 X=5 时写到 0x0004(不是 0x0104)', () => {
    const { cpu, ram } = makeCpu([
      0xa2, 0x05, // LDX #$05
      0xa9, 0x33, // LDA #$33
      0x95, 0xff, // STA $FF,X
    ])
    cpu.step()
    cpu.step()
    cpu.step()
    expect(ram[0x0004]).toBe(0x33)
    expect(ram[0x0104]).toBe(0)
  })

  it('zp,Y:STX $FF,Y 在 Y=3 时写到 0x0002', () => {
    const { cpu, ram } = makeCpu([
      0xa0, 0x03, // LDY #$03
      0xa2, 0x77, // LDX #$77
      0x96, 0xff, // STX $FF,Y
    ])
    cpu.step()
    cpu.step()
    cpu.step()
    expect(ram[0x0002]).toBe(0x77)
  })
})

describe('间接寻址', () => {
  it('(zp,X):指针表在零页,先加 X 再读 16 位目标', () => {
    const { cpu, ram } = makeCpu([
      0xa2, 0x02, // LDX #$02
      0xa1, 0x10, // LDA ($10,X)
    ])
    ram[0x0012] = 0x00 // 指针低字节
    ram[0x0013] = 0x05 // 指针高字节 → 目标 $0500
    ram[0x0500] = 0x33
    cpu.step()
    cpu.step()
    expect(cpu.A).toBe(0x33)
  })

  it('(zp,X):指针本身也绕回——指针 $FF + X=1 落在 $00', () => {
    const { cpu, ram } = makeCpu([
      0xa2, 0x01, // LDX #$01
      0xa1, 0xff, // LDA ($FF,X) → 指针地址 u8($FF+1)=$00
    ])
    ram[0x0000] = 0x34 // 低字节
    ram[0x0001] = 0x12 // 高字节 → 目标 $1234
    ram[0x1234] = 0x55
    cpu.step()
    cpu.step()
    expect(cpu.A).toBe(0x55)
  })

  it('(zp),Y:目标地址加 Y 时正常进位(不绕回)', () => {
    const { cpu, ram } = makeCpu([
      0xa0, 0x20, // LDY #$20
      0xb1, 0x20, // LDA ($20),Y
    ])
    ram[0x0020] = 0xf0 // 基地址 $02F0
    ram[0x0021] = 0x02
    ram[0x0310] = 0x66 // $02F0 + $20 = $0310,跨页
    cpu.step()
    cpu.step()
    expect(cpu.A).toBe(0x66)
  })

  it('(zp),Y 写入:STA ($20),Y', () => {
    const { cpu, ram } = makeCpu([
      0xa0, 0x10, // LDY #$10
      0xa9, 0x88, // LDA #$88
      0x91, 0x20, // STA ($20),Y
    ])
    ram[0x0020] = 0x05
    ram[0x0021] = 0x03 // 基地址 $0305
    cpu.step()
    cpu.step()
    cpu.step()
    expect(ram[0x0315]).toBe(0x88)
  })

  it('JMP (abs) 正常路径:跳到指针指向的地址', () => {
    const { cpu, ram } = makeCpu([
      0x6c, 0x00, 0x10, // JMP ($1000)
    ])
    ram[0x1000] = 0x34
    ram[0x1001] = 0x12
    cpu.step()
    expect(cpu.PC).toBe(0x1234)
  })

  it('JMP ($xxFF) 页绕回 bug:高字节从本页第 0 字节取(不是下一页)', () => {
    const { cpu, ram } = makeCpu([
      0x6c, 0xff, 0x10, // JMP ($10FF)
    ])
    ram[0x10ff] = 0xcd // 低字节正常取 $10FF
    ram[0x1000] = 0xab // 高字节取 $1000——硬件 bug,不读 $1100
    ram[0x1100] = 0x99 // 干扰项:如果实现错了会读到它
    cpu.step()
    expect(cpu.PC).toBe(0xabcd)
  })
})

describe('相对寻址:分支跳转', () => {
  it('BEQ 条件成立时按带符号偏移跳转(向前)', () => {
    const { cpu } = makeCpu([
      0xa9, 0x00, // LDA #$00 → Z=1
      0xf0, 0x02, // BEQ +2
      0xa9, 0x11, // 会被跳过
      0xa9, 0x77, // $8006:落点
    ])
    cpu.step() // LDA
    cpu.step() // BEQ
    expect(cpu.PC).toBe(0x8006)
    cpu.step()
    expect(cpu.A).toBe(0x77)
  })

  it('BEQ 条件不成立时顺序执行', () => {
    const { cpu } = makeCpu([
      0xa9, 0x01, // LDA #$01 → Z=0
      0xf0, 0x02, // BEQ +2(不跳)
      0xa9, 0x11, // $8004:顺序执行到这
    ])
    cpu.step()
    cpu.step()
    expect(cpu.PC).toBe(0x8004)
    cpu.step()
    expect(cpu.A).toBe(0x11)
  })

  it('负偏移向后跳(偏移按带符号数解释)', () => {
    const { cpu } = makeCpu([
      0xa9, 0x00, // $8000: LDA #$00 → Z=1
      0xf0, 0xfc, // $8002: BEQ -4 → PC 过操作数后是 $8004,目标 $8004-4=$8000
    ])
    cpu.step() // LDA
    cpu.step() // BEQ
    expect(cpu.PC).toBe(0x8000)
  })
})
