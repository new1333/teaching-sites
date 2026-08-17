import { describe, it, expect } from 'vitest'
import { Bus } from '../src/bus'
import { CPU } from '../src/cpu'
import {
  zeroPage, zeroPageX, zeroPageY, absolute, absoluteX, absoluteY,
  indirect, indirectX, indirectY, relative,
} from '../src/cpu/addressing'
import { makeNromCartridge, prgWithReset } from '../src/fixtures'
import { parseINES } from '../src/cartridge'

// 装一台最小机器：code 放 $8000（复位向量已指好），ramSetup 预置 RAM
function makeCpu(code: number[], ramSetup?: (bus: Bus) => void, regs?: { x?: number; y?: number }): CPU {
  const bus = new Bus()
  bus.attachCartridge(parseINES(makeNromCartridge({ prg: prgWithReset(code, 0x8000) })))
  ramSetup?.(bus)
  const cpu = new CPU(bus)
  cpu.reset()
  if (regs?.x !== undefined) cpu.x = regs.x
  if (regs?.y !== undefined) cpu.y = regs.y
  return cpu
}

describe('寻址模式：地址计算（第 5 章）', () => {
  it('零页：操作数本身就是 $00-$FF 内的门牌', () => {
    const cpu = makeCpu([0x05])
    expect(zeroPage(cpu)).toBe(0x05)
  })

  it('零页,X：$10 + X=5 → $15；基址 $FF + X=3 回绕到 $02（不进位）', () => {
    expect(zeroPageX(makeCpu([0x10], undefined, { x: 5 }))).toBe(0x15)
    expect(zeroPageX(makeCpu([0xff], undefined, { x: 3 }))).toBe(0x02)
  })

  it('零页,Y：$10 + Y=2 → $12', () => {
    expect(zeroPageY(makeCpu([0x10], undefined, { y: 2 }))).toBe(0x12)
  })

  it('绝对：两字节小端序拼地址', () => {
    expect(absolute(makeCpu([0x34, 0x12]))).toBe(0x1234)
  })

  it('绝对,X / 绝对,Y：16 位加变址，可跨页', () => {
    expect(absoluteX(makeCpu([0xff, 0x12], undefined, { x: 2 }))).toBe(0x1301)
    expect(absoluteY(makeCpu([0x00, 0x20], undefined, { y: 0x10 }))).toBe(0x2010)
  })

  it('间接：指针格 $0800 存 30 05 → 地址 $0530', () => {
    const cpu = makeCpu([0x00, 0x08], bus => {
      bus.write(0x0800, 0x30)
      bus.write(0x0801, 0x05)
    })
    expect(indirect(cpu)).toBe(0x0530)
  })

  it('间接（JMP 陷阱）：指针 $00FF 的高字节从 $0000 取——真机页回绕 bug', () => {
    const cpu = makeCpu([0xff, 0x00], bus => {
      bus.write(0x00ff, 0x34) // 低字节：$00FF 正常
      bus.write(0x0100, 0x99) // 陷阱格：真机不会读这里
      bus.write(0x0000, 0x12) // 高字节：页首
    })
    expect(indirect(cpu)).toBe(0x1234)
  })

  it('(零页,X)：指针表在 $40+X，先加 X 再取指针', () => {
    const cpu = makeCpu([0x40], bus => {
      bus.write(0x43, 0x50) // 指针落在 $40+3
      bus.write(0x44, 0x03)
    }, { x: 3 })
    expect(indirectX(cpu)).toBe(0x0350)
  })

  it('(零页),Y：指针在 $40，加 Y 变址', () => {
    const cpu = makeCpu([0x40], bus => {
      bus.write(0x40, 0x50)
      bus.write(0x41, 0x03)
    }, { y: 1 })
    expect(indirectY(cpu)).toBe(0x0351)
  })

  it('(零页),Y 陷阱：指针 $FF 的高字节回绕到 $0000', () => {
    const cpu = makeCpu([0xff], bus => {
      bus.write(0x00ff, 0x30)
      bus.write(0x0100, 0x99) // 陷阱格：真机不读
      bus.write(0x0000, 0x02)
    }, { y: 0 })
    expect(indirectY(cpu)).toBe(0x0230)
  })

  it('相对：PC 越过单字节偏移后，按补码加减——$FC 即 -4', () => {
    const cpu = makeCpu([0xfc]) // fetch 后 pc=0x8001
    expect(relative(cpu)).toBe(0x8001 - 4)
    const cpu2 = makeCpu([0x03]) // +3
    expect(relative(cpu2)).toBe(0x8001 + 3)
  })
})

describe('寻址模式：接入指令表（LDA 全家 8 个变体）', () => {
  const cases: Array<[string, number[], (bus: Bus) => void, { x?: number; y?: number }, number]> = [
    ['LDA #imm', [0xa9, 0x42], () => {}, {}, 0x42],
    ['LDA 零页', [0xa5, 0x05], b => b.write(0x05, 0x42), {}, 0x42],
    ['LDA 零页,X（回绕）', [0xb5, 0xff], b => b.write(0x02, 0x77), { x: 3 }, 0x77],
    ['LDA 绝对', [0xad, 0x00, 0x02], b => b.write(0x0200, 0x55), {}, 0x55],
    ['LDA 绝对,X', [0xbd, 0x00, 0x02], b => b.write(0x0201, 0x66), { x: 1 }, 0x66],
    ['LDA 绝对,Y', [0xb9, 0x00, 0x02], b => b.write(0x0202, 0x88), { y: 2 }, 0x88],
    ['LDA (零页,X)', [0xa1, 0x40], b => {
      b.write(0x43, 0x50); b.write(0x44, 0x03); b.write(0x0350, 0x66)
    }, { x: 3 }, 0x66],
    ['LDA (零页),Y', [0xb1, 0x40], b => {
      b.write(0x40, 0x50); b.write(0x41, 0x03); b.write(0x0351, 0x77)
    }, { y: 1 }, 0x77],
  ]

  for (const [name, code, ram, regs, expected] of cases) {
    it(`${name}：A 装到 ${expected.toString(16)}`, () => {
      const cpu = makeCpu(code, ram, regs)
      cpu.step()
      expect(cpu.a).toBe(expected)
    })
  }

  it('LDA 装入后照常记录 Z/N 便签', () => {
    const cpu = makeCpu([0xa5, 0x05], b => b.write(0x05, 0x00), {})
    cpu.step()
    expect(cpu.z).toBe(true)
  })
})
