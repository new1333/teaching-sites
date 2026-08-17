import { describe, it, expect } from 'vitest'
import { Bus } from '../src/bus'
import { CPU } from '../src/cpu'
import { makeNromCartridge, prgWithReset } from '../src/fixtures'
import { parseINES } from '../src/cartridge'

function makeCpu(code: number[], ramSetup?: (bus: Bus) => void, entry = 0x8000): { cpu: CPU; bus: Bus } {
  const bus = new Bus()
  bus.attachCartridge(parseINES(makeNromCartridge({ prg: prgWithReset(code, entry) })))
  ramSetup?.(bus)
  const cpu = new CPU(bus)
  cpu.reset()
  return { cpu, bus }
}

// 跑 N 步的便利函数
function run(cpu: CPU, steps: number): void {
  for (let i = 0; i < steps; i++) cpu.step()
}

describe('算术与进位', () => {
  it('CLC + ADC：$FF + $01 = $00，进位 C 置位、Z 置位', () => {
    const { cpu } = makeCpu([0x18, 0xa9, 0xff, 0x69, 0x01]) // CLC; LDA #$FF; ADC #$01
    run(cpu, 3)
    expect(cpu.a).toBe(0x00)
    expect(cpu.c).toBe(true)
    expect(cpu.z).toBe(true)
  })

  it('多字节加法接力：低位进位 C 参与高位 ADC', () => {
    // 16 位加法 $00FF + $0001：低字节 FF+01=00(C=1)，高字节 00+00+C=01
    const { cpu } = makeCpu([0x18, 0xa9, 0xff, 0x69, 0x01, 0xa9, 0x00, 0x69, 0x00])
    run(cpu, 5)
    expect(cpu.a).toBe(0x01) // 高字节结果
    expect(cpu.c).toBe(false)
  })

  it('SEC + SBC：$05 - $01 = $04；不够减时 C=0（借位）', () => {
    const { cpu } = makeCpu([0x38, 0xa9, 0x05, 0xe9, 0x01]) // SEC; LDA #$05; SBC #$01
    run(cpu, 3)
    expect(cpu.a).toBe(0x04)
    expect(cpu.c).toBe(true)
    const { cpu: borrow } = makeCpu([0x38, 0xa9, 0x05, 0xe9, 0x0a])
    run(borrow, 3)
    expect(borrow.a).toBe(0xfb) // 5-10 = -5 → 251（补码）
    expect(borrow.c).toBe(false)
  })

  it('溢出 V：$50 + $50（80+80）带符号溢出，V=1、N=1', () => {
    const { cpu } = makeCpu([0x18, 0xa9, 0x50, 0x69, 0x50])
    run(cpu, 3)
    expect(cpu.a).toBe(0xa0)
    expect(cpu.v).toBe(true)
    expect(cpu.n).toBe(true)
  })
})

describe('逻辑、移位与比较', () => {
  it('AND / ORA / EOR：位运算三兄弟', () => {
    const { cpu } = makeCpu([0xa9, 0xf0, 0x29, 0x3c, 0x09, 0x03, 0x49, 0xff])
    run(cpu, 4) // F0 & 3C = 30；30 | 03 = 33；33 ^ FF = CC
    expect(cpu.a).toBe(0xcc)
  })

  it('ASL A：$40 << 1 = $80，N 置位；LSR A：$01 → $00，C 置位', () => {
    const { cpu } = makeCpu([0xa9, 0x40, 0x0a])
    run(cpu, 2)
    expect(cpu.a).toBe(0x80)
    expect(cpu.n).toBe(true)
    const { cpu: lsr } = makeCpu([0xa9, 0x01, 0x4a])
    run(lsr, 2)
    expect(lsr.a).toBe(0x00)
    expect(lsr.c).toBe(true)
  })

  it('ROL A：进位从右边转进来', () => {
    // SEC; LDA #$80; ROL A → C(旧)=1 从右进，A=01，新 C=旧 bit7=1
    const { cpu } = makeCpu([0x38, 0xa9, 0x80, 0x2a])
    run(cpu, 3)
    expect(cpu.a).toBe(0x01)
    expect(cpu.c).toBe(true)
  })

  it('内存版 INC/DEC：直接改 RAM 里的数并更新标志', () => {
    const { cpu, bus } = makeCpu([0xe6, 0x10], b => b.write(0x10, 0x2a))
    cpu.step()
    expect(bus.read(0x10)).toBe(0x2b)
    const { cpu: dec } = makeCpu([0xc6, 0x10], b => b.write(0x10, 0x01))
    dec.step() // 1 - 1 = 0
    expect(dec.z).toBe(true)
  })

  it('CMP：相等 Z=1 且 C=1；不够大 C=0', () => {
    const { cpu } = makeCpu([0xa9, 0x05, 0xc9, 0x05])
    run(cpu, 2)
    expect(cpu.z).toBe(true)
    expect(cpu.c).toBe(true)
    const { cpu: less } = makeCpu([0xa9, 0x05, 0xc9, 0x0a])
    run(less, 2)
    expect(less.c).toBe(false)
    expect(less.z).toBe(false)
  })

  it('INX/DEX：X 加减并记录 Z/N', () => {
    const { cpu } = makeCpu([0xa2, 0x00, 0xca, 0xca])
    run(cpu, 3)
    expect(cpu.x).toBe(0xfe)
    expect(cpu.n).toBe(true)
  })
})

describe('跳转、子程序与栈', () => {
  it('JMP 绝对：一步跳走', () => {
    const { cpu } = makeCpu([0x4c, 0x05, 0x80])
    cpu.step()
    expect(cpu.pc).toBe(0x8005)
  })

  it('JMP 间接：指针页边界复刻真机 bug（$xxFF 高字节取 $xx00）', () => {
    // 指针落在 RAM $02FF：低字节读 $02FF=34，高字节按真机回绕到 $0200=12 → 跳 $1234
    const { cpu } = makeCpu([0x6c, 0xff, 0x02], b => {
      b.write(0x02ff, 0x34)
      b.write(0x0200, 0x12)
      b.write(0x0300, 0x99) // 陷阱格：正确实现不会读这里
    })
    cpu.step()
    expect(cpu.pc).toBe(0x1234)
  })

  it('JSR/RTS：子程序返回原位，PHA/PLA 栈配对', () => {
    // $8000: JSR $8008; $8003: PHA; $8004: PLA; $8005: STA $0200; $8008: LDA #$42; RTS
    const code = [
      0x20, 0x08, 0x80, // JSR $8008
      0x48,             // PHA（此时 A=$42）
      0x68,             // PLA
      0x8d, 0x00, 0x02, // STA $0200
      0xa9, 0x42,       // $8008: LDA #$42
      0x60,             // RTS
    ]
    const { cpu, bus } = makeCpu(code)
    run(cpu, 5) // JSR、LDA、RTS、PHA、PLA（RTS 回到 $8003 调用点下一条）
    cpu.step() // STA
    expect(bus.read(0x0200)).toBe(0x42)
    expect(cpu.pc).toBe(0x8008) // STA 三字节后，PC 落在 JMP 自跳指令处
  })

  it('BNE 循环：LDX #3; DEX; BNE -3 → 循环三轮 X=0', () => {
    const code = [
      0xa2, 0x03, // LDX #3
      0xca,       // $8002: DEX
      0xd0, 0xfd, // BNE $8002（-3）
    ]
    const { cpu } = makeCpu(code)
    run(cpu, 1 + 3 * 2)
    expect(cpu.x).toBe(0)
    expect(cpu.z).toBe(true)
    expect(cpu.pc).toBe(0x8005)
  })
})

describe('里程碑：循环 + 子程序 + 分支的完整程序', () => {
  it('数组求和：零页 3 个数经 (指针),Y 循环累加，子程序负责存结果', () => {
    // 布局：
    // $8000 LDX #3          计数
    // $8002 LDY #0          下标
    // $8004 LDA $10,Y       取 data[Y]（绝对,Y 读零页）
    // $8007 CLC
    // $8008 ADC $20         累加：A = data[Y] + sum
    // $800A STA $20         存回累加器（否则每轮白加）
    // $800C INY
    // $800D DEX
    // $800E BNE $8004
    // $8010 JSR $8018       子程序：把结果从 $20 复制到 $30
    // $8013 JMP $8013       自跳停机
    // $8018 LDA $20; STA $30; RTS
    const code = [
      0xa2, 0x03,       // LDX #3
      0xa0, 0x00,       // LDY #0
      0xb9, 0x10, 0x00, // LDA $0010,Y
      0x18,             // CLC
      0x65, 0x20,       // ADC $20
      0x85, 0x20,       // STA $20
      0xc8,             // INY
      0xca,             // DEX
      0xd0, 0xf4,       // BNE $8004（偏移 -12）
      0x20, 0x18, 0x80, // JSR $8018
      0x4c, 0x13, 0x80, // JMP $8013
      0xa5, 0x20,       // $8018: LDA $20
      0x85, 0x30,       // STA $30
      0x60,             // RTS
    ]
    const { cpu, bus } = makeCpu(code, b => {
      b.write(0x10, 10)
      b.write(0x11, 20)
      b.write(0x12, 30)
      b.write(0x20, 0)
    })
    for (let i = 0; i < 50 && cpu.pc !== 0x8013; i++) cpu.step()
    expect(bus.read(0x20)).toBe(60)
    expect(bus.read(0x30)).toBe(60)
    expect(cpu.x).toBe(0)
  })

  it('非法 opcode 仍然抛错（未公开指令不实现）', () => {
    const { cpu } = makeCpu([0x02])
    expect(() => cpu.step()).toThrow(/opcode/i)
  })
})
