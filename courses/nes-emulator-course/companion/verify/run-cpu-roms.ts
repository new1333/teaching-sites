// 作者侧验证:用真实测试 ROM 验证 CPU 核心(第 5 章节点)。
// 内存路由:RAM 2K 镜像 + PPU 桩($2002 交替返回 80/00 让轮询循环能退出)+ NROM PRG 窗口。
// 用法:npx tsx verify/run-cpu-roms.ts <rom.nes> [pcHex]  (pcHex 如 C000 表示强制入口)
import { readFileSync } from 'node:fs'
import { Cpu } from '../src/cpu.js'
import { parseINES } from '../src/ines.js'

const file = process.argv[2]
const forcePc = process.argv[3] ? parseInt(process.argv[3], 16) : undefined

const cart = parseINES(readFileSync(file))
if (cart.mapper !== 0) {
  console.log(`${file}: mapper=${cart.mapper},跳过(本课程只实现 NROM)`)
  process.exit(0)
}

const ram = new Uint8Array(0x800)
let ppuReads = 0
const prg = cart.prgRom
const prgMask = prg.length === 16384 ? 0x3fff : 0x7fff

const cpu = new Cpu({
  read(a) {
    if (a < 0x2000) return ram[a & 0x07ff]
    if (a < 0x4000) {
      // PPU 桩:STATUS 交替给出「vblank 置位/清零」,让任何轮询循环都能推进
      if ((a & 7) === 2) return ++ppuReads % 2 ? 0x80 : 0x00
      return 0
    }
    if (a >= 0x8000) return prg[a & prgMask]
    return 0
  },
  write(a, v) {
    if (a < 0x2000) ram[a & 0x07ff] = v
  },
})

cpu.reset()
if (forcePc !== undefined) cpu.PC = forcePc

let instr = 0
let stalled = 0
let lastPc = -1
let err: Error | undefined
const MAX = 5_000_000
while (instr < MAX) {
  const before = cpu.PC
  try {
    cpu.step()
  } catch (e) {
    err = e as Error
    break
  }
  instr++
  if (cpu.PC === before) {
    if (++stalled >= 4) break // 死循环 = 测试结束
  } else {
    stalled = 0
  }
  lastPc = cpu.PC
}

const hex = (v: number) => '$' + v.toString(16).padStart(4, '0')
console.log(`--- ${file}`)
console.log(`  指令数 ${instr},停机 PC ${hex(cpu.PC)}${lastPc !== cpu.PC ? '' : ''}`)
if (err) console.log(`  异常: ${err.message}`)
console.log(`  $02=${ram[0x02]} $03=${ram[0x03]} | $0200=${ram[0x0200]} $0201=${ram[0x0201]}(hex ${hex(ram[0x0200])}/${hex(ram[0x0201])})`)
