// 浏览器试机台：把 NES.frame() 交出的帧缓冲画上 canvas、音频采样排进扬声器、
// 键盘接到手柄——课程所有零件在浏览器里的最后一块拼图。

import { NES } from './nes'
import { parseINES } from './cartridge'
import type { ButtonName } from './controller'
import { demoRom } from './demoRom'

// 2C02 视觉调色板：NES 色号 0-63 → 屏幕上的 RGB（各模拟器通用的一组近似值）
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

// ---------- 画面 ----------
const screen = document.getElementById('screen') as HTMLCanvasElement
const ctx = screen.getContext('2d')!
const image = ctx.createImageData(256, 240)

function draw(frameBuffer: number[]): void {
  const d = image.data
  for (let i = 0; i < 256 * 240; i++) {
    const rgb = PALETTE[frameBuffer[i] & 0x3f] // 帧缓冲存的是 NES 色号，查表换成 RGB
    d[i * 4] = (rgb >> 16) & 0xff
    d[i * 4 + 1] = (rgb >> 8) & 0xff
    d[i * 4 + 2] = rgb & 0xff
    d[i * 4 + 3] = 255
  }
  ctx.putImageData(image, 0, 0)
}

// ---------- 音频 ----------
// APU 每 40 个 CPU 周期采一个样：1789773 / 40 ≈ 44744Hz
const SAMPLE_RATE = 1789773 / 40
let audio: AudioContext | null = null
let nextTime = 0
let muted = false

function ensureAudio(): void {
  if (!audio) audio = new AudioContext()
  if (audio.state === 'suspended') void audio.resume() // 浏览器规定：先有用户手势才许出声
}

function playSamples(samples: number[]): void {
  if (!audio || muted || samples.length === 0) return
  const buf = audio.createBuffer(1, samples.length, SAMPLE_RATE)
  const ch = buf.getChannelData(0)
  for (let i = 0; i < samples.length; i++) {
    ch[i] = (samples[i] - 0.5) * 1.2 // 课程混音输出以 0.5 为中心，先去直流再放大
  }
  const src = audio.createBufferSource()
  src.buffer = buf
  src.connect(audio.destination)
  const now = audio.currentTime
  if (nextTime < now + 0.02) nextTime = now + 0.02 // 排队至少压 20ms，防卡顿
  if (nextTime > now + 0.25) nextTime = now + 0.02 // 页面掉帧积压了就追上进度
  src.start(nextTime)
  nextTime += samples.length / SAMPLE_RATE
}

// ---------- 键盘 → 手柄 ----------
// 同时匹配 code（物理键，区分左右 Shift）与 key（符号名，兜底合成事件不带 code）
const KEYMAP: Record<string, ButtonName> = {
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  KeyX: 'A',
  KeyZ: 'B',
  Enter: 'Start',
  Shift: 'Select',
  ShiftLeft: 'Select',
  ShiftRight: 'Select',
}
const held = new Set<ButtonName>()
// 极短按键（按下与抬起落在同一帧间隙里）也至少要让模拟器看到一帧
let latched = new Set<ButtonName>()

window.addEventListener('keydown', e => {
  const b = KEYMAP[e.code] ?? KEYMAP[e.key]
  if (!b) return
  e.preventDefault() // 别让方向键滚动页面
  ensureAudio()
  held.add(b)
  latched.add(b)
})
window.addEventListener('keyup', e => {
  const b = KEYMAP[e.code] ?? KEYMAP[e.key]
  if (!b) return
  held.delete(b)
})

function buttons(): Partial<Record<ButtonName, boolean>> {
  const out: Partial<Record<ButtonName, boolean>> = {}
  for (const b of held) out[b] = true
  for (const b of latched) out[b] = true
  return out
}
function releaseLatches(): void {
  latched = new Set()
}

// 窗口失焦或页面隐藏时 keyup 可能永远收不到——清空按键，否则马里奥会一直跑
window.addEventListener('blur', () => held.clear())
document.addEventListener('visibilitychange', () => {
  if (document.hidden) held.clear()
})

// ---------- 卡带装卸 ----------
const statusEl = document.getElementById('status')!
const cartEl = document.getElementById('cart')!
let cartName = '内置试机带'
let currentRom: Uint8Array = demoRom() // 记住当前插着的卡带，重置时原样重插
let nes = new NES(currentRom)

function reportCart(): void {
  cartEl.textContent = `卡带：${cartName}（NROM）`
}

function loadCart(bytes: Uint8Array, name: string): void {
  let mapper: number
  try {
    mapper = parseINES(bytes).mapper
  } catch (err) {
    statusEl.textContent = `「${name}」不是 iNES 文件：${(err as Error).message}`
    return
  }
  if (mapper !== 0) {
    statusEl.textContent = `「${name}」是 mapper ${mapper} 卡带——本课程整机只装了 0 号 NROM 的直通卡槽`
    return
  }
  currentRom = bytes
  nes = new NES(bytes)
  cartName = name
  reportCart()
  statusEl.textContent = `已装上「${name}」，开机`
}

const romInput = document.getElementById('romFile') as HTMLInputElement
romInput.addEventListener('change', () => {
  const file = romInput.files?.[0]
  if (!file) return
  void file.arrayBuffer().then(buf => loadCart(new Uint8Array(buf), file.name))
  romInput.value = '' // 同名文件重选也能触发 change
})

// 拖一张 .nes 到页面上也能换卡带
document.body.addEventListener('dragover', e => e.preventDefault())
document.body.addEventListener('drop', e => {
  e.preventDefault()
  const file = e.dataTransfer?.files[0]
  if (!file) return
  void file.arrayBuffer().then(buf => loadCart(new Uint8Array(buf), file.name))
})

// URL 参数 ?rom=名字：从 public/roms/ 插卡（把 .nes 放进那个目录即可分享链接）
const romParam = new URLSearchParams(location.search).get('rom')
if (romParam) {
  void fetch(`/roms/${encodeURIComponent(romParam)}`)
    .then(res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.arrayBuffer()
    })
    .then(buf => loadCart(new Uint8Array(buf), romParam))
    .catch(err => {
      statusEl.textContent = `「${romParam}」装卡失败：${(err as Error).message}`
    })
}

document.getElementById('reset')!.addEventListener('click', () => {
  nes = new NES(currentRom) // 重开一台整机 = 拔卡重插再上电
  statusEl.textContent = '已按下重置键'
})

document.getElementById('mute')!.addEventListener('click', () => {
  muted = !muted
  ;(document.getElementById('mute') as HTMLButtonElement).textContent = muted ? '取消静音' : '静音'
})

// ---------- 主循环：按真实时间跑出精确 60fps ----------
// 累积器：把 rAF 间隔折算成 16.67ms 的整帧——高刷屏隔拍补帧、掉帧时追帧，
// 模拟器速度始终贴着真机，不随屏幕刷新率漂移
const FRAME_MS = 1000 / 60
let lastT = 0
let acc = 0
let runs = 0
let fpsAt = 0

function tick(t: number): void {
  requestAnimationFrame(tick)
  if (!lastT) {
    lastT = t
    return
  }
  acc += t - lastT
  lastT = t
  if (acc > 100) acc = 100 // 后台标签页积了几秒就丢弃，回前台不必连跑追帧
  while (acc >= FRAME_MS) {
    acc -= FRAME_MS
    const { frameBuffer, samples } = nes.frame(buttons())
    releaseLatches() // 极短按键已让本帧看到，下一帧恢复真实状态
    draw(frameBuffer)
    playSamples(samples)
    runs++
  }
  if (t - fpsAt >= 1000) {
    document.getElementById('fps')!.textContent = `${runs} fps`
    // 调机参考：画面上有内容的像素数（黑屏过场≈1k、满屏画面≈59k）
    let lit = 0
    for (const v of nes.ppu.frameBuffer) if (v !== 0x0f && v !== 0) lit++
    document.getElementById('pix')!.textContent = `画面 ${lit} px`
    runs = 0
    fpsAt = t
  }
}

reportCart()
requestAnimationFrame(tick)

// 调机兜底：主循环若抛异常，fps 会停更——把错误亮在状态栏而不是静默失败
window.addEventListener('error', e => {
  document.getElementById('status')!.textContent = `运行错误：${e.message}（${e.filename}:${e.lineno}）`
})
