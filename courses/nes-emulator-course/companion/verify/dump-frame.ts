// 作者侧工具:把整机帧缓冲写成 PNG(无依赖手写 PNG:zlib + IHDR/IDAT/IEND)。
// 用法:npx tsx verify/dump-frame.ts <rom.nes> <帧数> <输出.png>
import { readFileSync, writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { parseINES } from '../src/ines.js'
import { Nes } from '../src/nes.js'

const [file, framesArg, out] = process.argv.slice(2)
const frames = Number(framesArg ?? 60)

const cart = parseINES(readFileSync(file))
const nes = new Nes(cart.mirroring)
const mask = cart.prgRom.length === 16384 ? 0x3fff : 0x7fff
nes.bus.cartRead = (a) => cart.prgRom[a & mask]
if (cart.chrRom) {
  nes.ppu.chr = { read: (a) => cart.chrRom![a & 0x1fff], write: () => {} }
}
nes.cpu.reset()
for (let i = 0; i < frames; i++) nes.runFrame()

const fb = nes.ppu.frameBuffer
const W = 256
const H = 240
const raw = Buffer.alloc((W * 3 + 1) * H)
for (let y = 0; y < H; y++) {
  raw[y * (W * 3 + 1)] = 0 // filter: none
  for (let x = 0; x < W; x++) {
    const s = (y * W + x) * 3
    const d = y * (W * 3 + 1) + 1 + x * 3
    raw[d] = fb[s]
    raw[d + 1] = fb[s + 1]
    raw[d + 2] = fb[s + 2]
  }
}

const crc32 = (buf: Buffer): number => {
  let c: number
  const table: number[] = []
  for (let n = 0; n < 256; n++) {
    c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  let crc = 0xffffffff
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

const chunk = (type: string, data: Buffer): Buffer => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(W, 0)
ihdr.writeUInt32BE(H, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 2 // color type: truecolor
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
])
writeFileSync(out, png)
console.log(`已导出 ${out}(${frames} 帧,${png.length} 字节)`)
