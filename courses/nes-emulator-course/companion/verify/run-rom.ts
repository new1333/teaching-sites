// 作者侧验证:在完整整机(Nes)上运行真实测试 ROM。
// 用法:npx tsx verify/run-rom.ts <rom.nes> [帧数] [--ppu]
// 输出:测试结果单元($0200/$0201 风格)与帧缓冲统计(非底色像素占比、颜色数)
import { readFileSync } from 'node:fs'
import { parseINES } from '../src/ines.js'
import { Nes } from '../src/nes.js'
import { rgbOf } from '../src/palette.js'

const file = process.argv[2]
const frames = Number(process.argv[3] ?? 60)

const cart = parseINES(readFileSync(file))
if (cart.mapper !== 0) {
  console.log(`${file}: mapper=${cart.mapper},本课程整机只实现 NROM,跳过`)
  process.exit(0)
}

const nes = new Nes(cart.mirroring)
// NROM:$8000-$FFFF ← PRG(16K 镜像 / 32K 直通);CHR 挂到 PPU
const mask = cart.prgRom.length === 16384 ? 0x3fff : 0x7fff
nes.bus.cartRead = (a) => cart.prgRom[a & mask]
if (cart.chrRom) {
  nes.ppu.chr = {
    read: (a) => cart.chrRom![a & 0x1fff],
    write: () => {},
  }
}
nes.cpu.reset()

let err: Error | undefined
let f = 0
for (; f < frames; f++) {
  try {
    nes.runFrame()
  } catch (e) {
    err = e as Error
    break
  }
}

const ram = nes.bus.ram
const hex = (v: number) => '$' + v.toString(16).padStart(2, '0')
console.log(`--- ${file}(${f} 帧${err ? ',异常中断' : ''})`)
if (err) console.log(`  异常: ${err.message}`)
console.log(`  $02=${hex(ram[2])} $03=${hex(ram[3])} | $0200=${hex(ram[0x200])} $0201=${hex(ram[0x201])}`)

// 帧缓冲统计:非 universal 色像素占比与出现的系统色数
const fb = nes.ppu.frameBuffer
const colors = new Set<number>()
let painted = 0
for (let i = 0; i < 256 * 240; i++) {
  const r = fb[i * 3], g = fb[i * 3 + 1], b = fb[i * 3 + 2]
  if (r | g | b) painted++
  colors.add((r << 16) | (g << 8) | b)
}
console.log(`  画面:非纯黑像素 ${((painted / (256 * 240)) * 100).toFixed(1)}%,颜色数 ${colors.size}`)

if (process.argv.includes('--ppu')) {
  // 打印 $2002 相关状态快照,便于诊断卡死的轮询循环
  console.log(`  PPU: scanline=${nes.ppu.scanline} dot=${nes.ppu.dot} vblank=${nes.ppu.vblank} ctrl=${hex(nes.ppu.ctrl)} mask=${hex(nes.ppu.mask)}`)
}
void rgbOf
