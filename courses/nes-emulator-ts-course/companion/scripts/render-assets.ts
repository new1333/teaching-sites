// 生成课程正文用的静态资产：两张 PNG（手工编码，零依赖）+ 两段 WAV（裸 PCM16）。
// 数据全部来自实验场真实代码：帧截图跑的是 NES + demoRom，音频跑的是真 APU 通道。
// 运行：cd companion && npx vite-node scripts/render-assets.ts
// 产物写到 ../docs/assets/，正文用相对路径引用（vite 打包资产，聚合站 base 安全）。

import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { APU } from '../src/apu'
import { NES } from '../src/nes'
import { demoRom } from '../src/demoRom'

const OUT = '../docs/assets'

// 2C02 视觉调色板（与 src/main.ts 同一张表）：NES 色号 0-63 → RGB
const PALETTE = [
  0x666666, 0x002a88, 0x1412a7, 0x3b00a4, 0x5c007e, 0x6e0040, 0x6c0600, 0x561d00,
  0x453a00, 0x1e5300, 0x005800, 0x00513d, 0x004e66, 0x000000, 0x000000, 0x000000,
  0xadadad, 0x155fd9, 0x4240ff, 0x7527fe, 0xa01acc, 0xb71e7b, 0xb53120, 0x994e00,
  0x6b6d00, 0x388700, 0x0c9300, 0x008f42, 0x00788e, 0x000000, 0x000000, 0x000000,
  0xfffeff, 0x64b0ff, 0x9290ff, 0xc676ff, 0xf36aff, 0xfe6ecc, 0xfe8170, 0xea9e22,
  0xbcbe00, 0x88d800, 0x5ce430, 0x45e082, 0x48cdde, 0x4f4f4f, 0x000000, 0x000000,
  0xfffeff, 0xc0dfff, 0xd3d2ff, 0xe8c8ff, 0xfbc2ff, 0xfec5ea, 0xf2d3b1, 0xe4d18e,
  0xcfd37f, 0xb7e37e, 0xa9ee9e, 0xa0eec4, 0xa3e7e9, 0xa5a5a5, 0x000000, 0x000000,
]

// ---------- PNG（最小编码器：真彩色、无滤波、zlib IDAT） ----------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(data.length + 12)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length)
  return out
}

function encodePng(width: number, height: number, rgb: Uint8Array): Buffer {
  const stride = width * 3 + 1
  const raw = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0 // filter: none
    for (let x = 0; x < width * 3; x++) raw[y * stride + 1 + x] = rgb[y * width * 3 + x]
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // truecolor
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

function colorToRgb(color: number): [number, number, number] {
  return [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff]
}

// ---------- WAV（PCM16 单声道） ----------

function encodeWav(samples: number[], rate: number): Buffer {
  const buf = Buffer.alloc(44 + samples.length * 2)
  buf.write('RIFF', 0, 'ascii')
  buf.writeUInt32LE(36 + samples.length * 2, 4)
  buf.write('WAVE', 8, 'ascii')
  buf.write('fmt ', 12, 'ascii')
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20) // PCM
  buf.writeUInt16LE(1, 22) // mono
  buf.writeUInt32LE(rate, 24)
  buf.writeUInt32LE(rate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36, 'ascii')
  buf.writeUInt32LE(samples.length * 2, 40)
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]))
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2)
  }
  return buf
}

// ---------- 音频：驱动真 APU，采出样本流 ----------

const SAMPLE_RATE = 44744 // 1789773 / 40 ≈ 44.7kHz，取整给 WAV 头

function runApu(apu: APU, seconds: number): number[] {
  const target = Math.round((1789773 / 40) * seconds)
  const out: number[] = []
  while (out.length < target) {
    apu.tick(1)
    if (apu.sampleBuffer.length >= 2048) out.push(...apu.sampleBuffer.splice(0))
  }
  out.push(...apu.sampleBuffer.splice(0))
  return out.slice(0, target)
}

function pulseNote(apu: APU, $4000: number): void {
  apu.writeReg(0x4015, 1)
  apu.writeReg(0x4000, $4000)
  apu.writeReg(0x4002, 253 & 0xff) // A4 = 440Hz 的定时器低字节
  apu.writeReg(0x4003, (((253 >> 8) & 7) << 3) | 1) // 高 3 位 + 重载（发新音符）
}

function silence(apu: APU, seconds: number): number[] {
  apu.writeReg(0x4015, 0)
  return runApu(apu, seconds)
}

// 占空比对比：同一音高 A4 依次 12.5% / 25% / 50%（halt + 恒定音量 15）
function renderDuty(): number[] {
  const apu = new APU()
  const seg: number[] = []
  for (const duty of [0, 1, 2]) {
    pulseNote(apu, (duty << 6) | 0x20 | 0x10 | 15)
    seg.push(...runApu(apu, 0.4))
    seg.push(...silence(apu, 0.12))
  }
  return seg.map(v => v * 2.2) // 峰值 15/60=0.25，放大到 ~0.55
}

// 包络对比：divider=0（每 quarter 拍掉一档，短促打击）与 divider=10（慢十倍，风琴尾音）
function renderEnvelope(): number[] {
  const apu = new APU()
  const seg: number[] = []
  for (const div of [0, 10]) {
    pulseNote(apu, (2 << 6) | 0x20 | div) // duty 50% + halt + 包络模式
    seg.push(...runApu(apu, div === 0 ? 0.5 : 1.1))
    seg.push(...silence(apu, 0.15))
  }
  return seg.map(v => v * 2.2)
}

// ---------- 图片 ----------

// 一行 8 个像素的色号：低平面字节 + 高平面字节合并
function tileRow(lo: number, hi: number): number[] {
  const row: number[] = []
  for (let bit = 7; bit >= 0; bit--) row.push((((hi >> bit) & 1) << 1) | ((lo >> bit) & 1))
  return row
}

// 第 8 章手绘图块：tile 1（整块 1 号色）与 tile 3（3-2-1-0 条纹），放大 16 倍并排。
// 配色取课程 64 色里对比明显的一组（黑/红/绿/白）作示意，色号本身与测试一致。
function renderTiles(): Buffer {
  const SCALE = 16
  const M = 8 // 边距
  const GAP = 24
  const w = M + 8 * SCALE + GAP + 8 * SCALE + M
  const h = M + 8 * SCALE + M
  const rgb = new Uint8Array(w * h * 3).fill(0x2b)
  const demo = [0x0f, 0x16, 0x2a, 0x30] // 色号 0-3 → 黑/红/绿/白（示意配色）
  const tiles: number[][][] = [] // 每个 tile 8 行 × 8 色号
  for (let r = 0; r < 8; r++) tiles.push([tileRow(0xff, 0x00), tileRow(0xaa, 0xcc)])
  for (let t = 0; t < 2; t++) {
    const x0 = M + t * (8 * SCALE + GAP)
    for (let r = 0; r < 8; r++) {
      const colors = tiles[r][t]
      for (let c = 0; c < 8; c++) {
        const [rr, gg, bb] = colorToRgb(PALETTE[demo[colors[c]]])
        for (let dy = 0; dy < SCALE; dy++)
          for (let dx = 0; dx < SCALE; dx++) {
            const x = x0 + c * SCALE + dx
            const y = M + r * SCALE + dy
            const i = (y * w + x) * 3
            rgb[i] = rr
            rgb[i + 1] = gg
            rgb[i + 2] = bb
          }
      }
    }
  }
  return encodePng(w, h, rgb)
}

// 终章开机画面：真整机 + 内置试机带跑 5 帧，帧缓冲逐像素上色
function renderFirstFrame(): Buffer {
  const nes = new NES(demoRom())
  for (let i = 0; i < 5; i++) nes.frame()
  const rgb = new Uint8Array(256 * 240 * 3)
  for (let i = 0; i < 256 * 240; i++) {
    const [r, g, b] = colorToRgb(PALETTE[nes.ppu.frameBuffer[i] & 0x3f])
    rgb[i * 3] = r
    rgb[i * 3 + 1] = g
    rgb[i * 3 + 2] = b
  }
  return encodePng(256, 240, rgb)
}

// ---------- 出产物 ----------

mkdirSync(OUT, { recursive: true })
writeFileSync(`${OUT}/ch8-tiles.png`, renderTiles())
writeFileSync(`${OUT}/ch12-first-frame.png`, renderFirstFrame())
writeFileSync(`${OUT}/ch11-duty.wav`, encodeWav(renderDuty(), SAMPLE_RATE))
writeFileSync(`${OUT}/ch11-envelope.wav`, encodeWav(renderEnvelope(), SAMPLE_RATE))
console.log('assets written to', OUT)
