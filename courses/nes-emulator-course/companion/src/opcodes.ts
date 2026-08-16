// 官方 6502 指令表:151 个合法 opcode。
// 每条 = { 助记符, 寻址模式, 基础周期, 是否跨页加成, 是否分支, 行为 }。
// operand 语义:imm/rel 传「值」,其余内存类模式传「地址」,imp/acc 无操作数。

import type { Cpu, Mode } from './cpu.js'

export interface OpInfo {
  mn: string
  mode: Mode
  cycles: number
  /** 读类指令跨页时 +1 周期(写类指令本就多花,不计入) */
  pageCross?: boolean
  /** 分支指令:跳转成功再 +1,跨页再 +1 */
  branch?: boolean
  run: (c: Cpu, operand: number) => void
}

type Row = Record<number, OpInfo>

const entry = (
  mn: string,
  mode: Mode,
  cycles: number,
  run: OpInfo['run'],
  pageCross = false,
  branch = false,
): OpInfo => ({
  mn,
  mode,
  cycles,
  ...(pageCross ? { pageCross: true } : {}),
  ...(branch ? { branch: true } : {}),
  run,
})

// 读型家族的 8 种模式排布(imm, zp, zpX, abs, absX, absY, indX, indY)
const READ_MODES: [Mode, number, boolean][] = [
  ['zp', 3, false],
  ['zpX', 4, false],
  ['abs', 4, false],
  ['absX', 4, true],
  ['absY', 4, true],
  ['indX', 6, false],
  ['indY', 5, true],
]

// codes 首位是 imm 操作码,后 7 位对应 READ_MODES;fn 拿到的是「内存值或立即数」
function readFamily(codes: number[], mn: string, fn: (c: Cpu, v: number) => void): Row {
  const out: Row = {}
  out[codes[0]] = entry(mn, 'imm', 2, (c, v) => fn(c, v))
  READ_MODES.forEach(([mode, cycles, pc], i) => {
    out[codes[i + 1]] = entry(mn, mode, cycles, (c, a) => fn(c, c.mem.read(a)), pc)
  })
  return out
}

// 写型家族(STA):全部地址模式,operand 是地址
function writeFamily(codes: number[], mn: string, modes: [Mode, number][], write: (c: Cpu, a: number) => void): Row {
  const out: Row = {}
  modes.forEach(([mode, cycles], i) => {
    out[codes[i]] = entry(mn, mode, cycles, write)
  })
  return out
}

// 读-改-写家族(移位/增减):读内存、变换(顺带置标志)、写回
function rmwFamily(codes: number[], mn: string, fn: (c: Cpu, v: number) => number): Row {
  const out: Row = {}
  const modes: [Mode, number][] = [
    ['zp', 5],
    ['zpX', 6],
    ['abs', 6],
    ['absX', 7],
  ]
  modes.forEach(([mode, cycles], i) => {
    out[codes[i]] = entry(mn, mode, cycles, (c, a) => {
      const nv = fn(c, c.mem.read(a))
      c.mem.write(a, nv)
    })
  })
  return out
}

const OPS: Row = {
  // ---- 算术 / 逻辑(ADC AND CMP EOR ORA SBC + LDA 共用读型排布)----
  ...readFamily([0x69, 0x65, 0x75, 0x6d, 0x7d, 0x79, 0x61, 0x71], 'ADC', (c, m) => c.adc(m)),
  ...readFamily([0x29, 0x25, 0x35, 0x2d, 0x3d, 0x39, 0x21, 0x31], 'AND', (c, m) => c.andA(m)),
  ...readFamily([0xc9, 0xc5, 0xd5, 0xcd, 0xdd, 0xd9, 0xc1, 0xd1], 'CMP', (c, m) => c.cmpVal(c.A, m)),
  ...readFamily([0x49, 0x45, 0x55, 0x4d, 0x5d, 0x59, 0x41, 0x51], 'EOR', (c, m) => c.eorA(m)),
  ...readFamily([0xa9, 0xa5, 0xb5, 0xad, 0xbd, 0xb9, 0xa1, 0xb1], 'LDA', (c, v) => c.loadA(v)),
  ...readFamily([0x09, 0x05, 0x15, 0x0d, 0x1d, 0x19, 0x01, 0x11], 'ORA', (c, m) => c.oraA(m)),
  ...readFamily([0xe9, 0xe5, 0xf5, 0xed, 0xfd, 0xf9, 0xe1, 0xf1], 'SBC', (c, m) => c.sbc(m)),

  // ---- LDX / LDY / BIT / CPX / CPY(读型,模式子集)----
  0xa2: entry('LDX', 'imm', 2, (c, v) => { c.X = v; c.setZN(v) }),
  0xa6: entry('LDX', 'zp', 3, (c, a) => { c.X = c.mem.read(a); c.setZN(c.X) }),
  0xb6: entry('LDX', 'zpY', 4, (c, a) => { c.X = c.mem.read(a); c.setZN(c.X) }),
  0xae: entry('LDX', 'abs', 4, (c, a) => { c.X = c.mem.read(a); c.setZN(c.X) }),
  0xbe: entry('LDX', 'absY', 4, (c, a) => { c.X = c.mem.read(a); c.setZN(c.X) }, true),

  0xa0: entry('LDY', 'imm', 2, (c, v) => { c.Y = v; c.setZN(v) }),
  0xa4: entry('LDY', 'zp', 3, (c, a) => { c.Y = c.mem.read(a); c.setZN(c.Y) }),
  0xb4: entry('LDY', 'zpX', 4, (c, a) => { c.Y = c.mem.read(a); c.setZN(c.Y) }),
  0xac: entry('LDY', 'abs', 4, (c, a) => { c.Y = c.mem.read(a); c.setZN(c.Y) }),
  0xbc: entry('LDY', 'absX', 4, (c, a) => { c.Y = c.mem.read(a); c.setZN(c.Y) }, true),

  0x24: entry('BIT', 'zp', 3, (c, a) => c.bit(c.mem.read(a))),
  0x2c: entry('BIT', 'abs', 4, (c, a) => c.bit(c.mem.read(a))),
  0xe0: entry('CPX', 'imm', 2, (c, m) => c.cmpVal(c.X, m)),
  0xe4: entry('CPX', 'zp', 3, (c, a) => c.cmpVal(c.X, c.mem.read(a))),
  0xec: entry('CPX', 'abs', 4, (c, a) => c.cmpVal(c.X, c.mem.read(a))),
  0xc0: entry('CPY', 'imm', 2, (c, m) => c.cmpVal(c.Y, m)),
  0xc4: entry('CPY', 'zp', 3, (c, a) => c.cmpVal(c.Y, c.mem.read(a))),
  0xcc: entry('CPY', 'abs', 4, (c, a) => c.cmpVal(c.Y, c.mem.read(a))),

  // ---- 存储 ----
  ...writeFamily([0x85, 0x95, 0x8d, 0x9d, 0x99, 0x81, 0x91], 'STA', [
    ['zp', 3], ['zpX', 4], ['abs', 4], ['absX', 5], ['absY', 5], ['indX', 6], ['indY', 6],
  ], (c, a) => c.mem.write(a, c.A)),
  0x86: entry('STX', 'zp', 3, (c, a) => c.mem.write(a, c.X)),
  0x96: entry('STX', 'zpY', 4, (c, a) => c.mem.write(a, c.X)),
  0x8e: entry('STX', 'abs', 4, (c, a) => c.mem.write(a, c.X)),
  0x84: entry('STY', 'zp', 3, (c, a) => c.mem.write(a, c.Y)),
  0x94: entry('STY', 'zpX', 4, (c, a) => c.mem.write(a, c.Y)),
  0x8c: entry('STY', 'abs', 4, (c, a) => c.mem.write(a, c.Y)),

  // ---- 移位 / 旋转 / 增减(累加器 + 读改写)----
  0x0a: entry('ASL', 'acc', 2, (c) => { c.A = c.shift('asl', c.A) }),
  ...rmwFamily([0x06, 0x16, 0x0e, 0x1e], 'ASL', (c, v) => c.shift('asl', v)),
  0x4a: entry('LSR', 'acc', 2, (c) => { c.A = c.shift('lsr', c.A) }),
  ...rmwFamily([0x46, 0x56, 0x4e, 0x5e], 'LSR', (c, v) => c.shift('lsr', v)),
  0x2a: entry('ROL', 'acc', 2, (c) => { c.A = c.shift('rol', c.A) }),
  ...rmwFamily([0x26, 0x36, 0x2e, 0x3e], 'ROL', (c, v) => c.shift('rol', v)),
  0x6a: entry('ROR', 'acc', 2, (c) => { c.A = c.shift('ror', c.A) }),
  ...rmwFamily([0x66, 0x76, 0x6e, 0x7e], 'ROR', (c, v) => c.shift('ror', v)),
  ...rmwFamily([0xe6, 0xf6, 0xee, 0xfe], 'INC', (c, v) => c.bump(v, 1)),
  ...rmwFamily([0xc6, 0xd6, 0xce, 0xde], 'DEC', (c, v) => c.bump(v, -1)),

  // ---- 分支 ----
  0x90: entry('BCC', 'rel', 2, (c, o) => c.branch((c.P & 0x01) === 0, o), false, true),
  0xb0: entry('BCS', 'rel', 2, (c, o) => c.branch((c.P & 0x01) !== 0, o), false, true),
  0xf0: entry('BEQ', 'rel', 2, (c, o) => c.branch((c.P & 0x02) !== 0, o), false, true),
  0x30: entry('BMI', 'rel', 2, (c, o) => c.branch((c.P & 0x80) !== 0, o), false, true),
  0xd0: entry('BNE', 'rel', 2, (c, o) => c.branch((c.P & 0x02) === 0, o), false, true),
  0x10: entry('BPL', 'rel', 2, (c, o) => c.branch((c.P & 0x80) === 0, o), false, true),
  0x50: entry('BVC', 'rel', 2, (c, o) => c.branch((c.P & 0x40) === 0, o), false, true),
  0x70: entry('BVS', 'rel', 2, (c, o) => c.branch((c.P & 0x40) !== 0, o), false, true),

  // ---- 跳转 / 子程序 / 中断 ----
  0x4c: entry('JMP', 'abs', 3, (c, a) => { c.PC = a }),
  0x6c: entry('JMP', 'ind', 5, (c, a) => { c.PC = a }),
  0x20: entry('JSR', 'abs', 6, (c, a) => c.jsr(a)),
  0x60: entry('RTS', 'imp', 6, (c) => c.rts()),
  0x40: entry('RTI', 'imp', 6, (c) => c.rti()),
  0x00: entry('BRK', 'imp', 7, (c) => c.interrupt(0xfffe, true)),

  // ---- 栈 ----
  0x48: entry('PHA', 'imp', 3, (c) => c.push8(c.A)),
  0x08: entry('PHP', 'imp', 3, (c) => c.push8(c.P | 0x10 | 0x20)), // PHP 压栈时 B/U 恒置位
  0x68: entry('PLA', 'imp', 4, (c) => c.loadA(c.pull8())),
  0x28: entry('PLP', 'imp', 4, (c) => { c.P = (c.pull8() & ~0x10) | 0x20 }),

  // ---- 标志位 ----
  0x18: entry('CLC', 'imp', 2, (c) => c.setFlag(0x01, false)),
  0xd8: entry('CLD', 'imp', 2, (c) => c.setFlag(0x08, false)),
  0x58: entry('CLI', 'imp', 2, (c) => c.setFlag(0x04, false)),
  0xb8: entry('CLV', 'imp', 2, (c) => c.setFlag(0x40, false)),
  0x38: entry('SEC', 'imp', 2, (c) => c.setFlag(0x01, true)),
  0xf8: entry('SED', 'imp', 2, (c) => c.setFlag(0x08, true)),
  0x78: entry('SEI', 'imp', 2, (c) => c.setFlag(0x04, true)),

  // ---- 传送 / 增减寄存器 / NOP ----
  0xaa: entry('TAX', 'imp', 2, (c) => { c.X = c.A; c.setZN(c.X) }),
  0xa8: entry('TAY', 'imp', 2, (c) => { c.Y = c.A; c.setZN(c.Y) }),
  0xba: entry('TSX', 'imp', 2, (c) => { c.X = c.SP; c.setZN(c.X) }),
  0x8a: entry('TXA', 'imp', 2, (c) => { c.A = c.X; c.setZN(c.A) }),
  0x9a: entry('TXS', 'imp', 2, (c) => { c.SP = c.X }), // TXS 不动标志
  0x98: entry('TYA', 'imp', 2, (c) => { c.A = c.Y; c.setZN(c.A) }),
  0xe8: entry('INX', 'imp', 2, (c) => { c.X = c.bump(c.X, 1) }),
  0xc8: entry('INY', 'imp', 2, (c) => { c.Y = c.bump(c.Y, 1) }),
  0xca: entry('DEX', 'imp', 2, (c) => { c.X = c.bump(c.X, -1) }),
  0x88: entry('DEY', 'imp', 2, (c) => { c.Y = c.bump(c.Y, -1) }),
  0xea: entry('NOP', 'imp', 2, () => {}),
}

export { OPS }
