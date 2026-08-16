// demo 入口:选本地 .nes(NROM)→ canvas 60fps 渲染,键盘当一手柄。
// 键位:方向键 = 十字键;Z = A;X = B;Enter = Start;右 Shift = Select。
import { Nes } from '../src/nes.js'
import type { NesButton } from '../src/controller.js'

const machine = new Nes()
const canvas = document.getElementById('screen') as HTMLCanvasElement
const ctx = canvas.getContext('2d')!
const image = ctx.createImageData(256, 240)
const status = document.getElementById('status')!
let romLoaded = false

document.getElementById('rom')!.addEventListener('change', async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  try {
    machine.loadRom(new Uint8Array(await file.arrayBuffer()))
    romLoaded = true
    status.textContent = `运行中:${file.name}`
  } catch (err) {
    status.textContent = `装载失败:${(err as Error).message}`
  }
})

const KEY_MAP: Record<string, NesButton> = {
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  KeyZ: 'A',
  KeyX: 'B',
  Enter: 'Start',
  ShiftRight: 'Select',
}

window.addEventListener('keydown', (e) => {
  const b = KEY_MAP[e.code]
  if (b && romLoaded) {
    machine.setButton(0, b, true)
    e.preventDefault()
  }
})
window.addEventListener('keyup', (e) => {
  const b = KEY_MAP[e.code]
  if (b && romLoaded) {
    machine.setButton(0, b, false)
    e.preventDefault()
  }
})

function frame(): void {
  if (romLoaded) {
    const fb = machine.runFrame()
    const d = image.data
    for (let i = 0, j = 0; i < fb.length; i += 3, j += 4) {
      d[j] = fb[i]
      d[j + 1] = fb[i + 1]
      d[j + 2] = fb[i + 2]
      d[j + 3] = 255
    }
    ctx.putImageData(image, 0, 0)
  }
  requestAnimationFrame(frame)
}
frame()
