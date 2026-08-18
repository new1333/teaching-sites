<script setup lang="ts">
// 用法示例（自包含演示）：同屏对比 Canvas 2D 逐粒子 fillRect 与 WebGL 一次 drawArrays。
// 两边画的是同一批粒子（同一份确定性随机数据）；读数为各侧每帧绘制耗时的滚动平均。
import { onMounted, onUnmounted, ref } from 'vue'

const MAX = 500_000
const W = 640
const H = 360

const count = ref(20_000)
const stat2d = ref('—')
const statGl = ref('—')
const canvas2d = ref<HTMLCanvasElement | null>(null)
const canvasGl = ref<HTMLCanvasElement | null>(null)

let raf = 0
let data: Float32Array | null = null // 每粒子 4 个数：x0、y0、vx、vy
let ctx2d: CanvasRenderingContext2D | null = null
let gl: WebGLRenderingContext | null = null
let loseCtx: { loseContext(): void } | null = null
let uTime: WebGLUniformLocation | null = null
let ms2d = -1
let msGl = -1
let lastUi = 0

// 黑盒预告：WebGL 侧的着色器与接线第 2 章才逐行拆解，本章只让它跑起来
const VERT = `
attribute vec4 a_data; // (x0, y0, vx, vy)
uniform float u_time;
void main() {
  vec2 p = mod(a_data.xy + a_data.zw * u_time + 1.0, 2.0) - 1.0; // 漂移并绕回 [-1,1]
  gl_Position = vec4(p, 0.0, 1.0);
  gl_PointSize = 2.0;
}
`
const FRAG = `
precision mediump float;
uniform vec3 u_color;
void main() { gl_FragColor = vec4(u_color, 1.0); }
`

// 确定性随机数（mulberry32）：两边共用同一份种子，保证画的是同一批粒子
function makeRandom(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function draw2d(t: number): void {
  if (!ctx2d || !data) return
  const ctx = ctx2d
  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = '#7dd3fc'
  const halfW = W / 2
  const halfH = H / 2
  const n = count.value
  for (let i = 0; i < n; i++) {
    const o = i * 4
    let x = (data[o] + data[o + 2] * t + 1) % 2
    if (x < 0) x += 2
    let y = (data[o + 1] + data[o + 3] * t + 1) % 2
    if (y < 0) y += 2
    ctx.fillRect(((x - 1) * halfW) | 0, ((1 - y) * halfH) | 0, 2, 2)
  }
}

function drawGl(t: number): void {
  if (!gl) return
  gl.clear(gl.COLOR_BUFFER_BIT)
  gl.uniform1f(uTime, t)
  gl.drawArrays(gl.POINTS, 0, count.value) // 粒子数只改这个数字，显存数据从不重传
}

function fmt(ms: number): string {
  if (ms <= 0) return '—'
  const fps = 1000 / ms
  return fps >= 60
    ? `≥60 fps · 每帧 ${ms.toFixed(1)}ms`
    : `${fps.toFixed(0)} fps · 每帧 ${ms.toFixed(0)}ms`
}

function initGl(canvas: HTMLCanvasElement): boolean {
  gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false }) as WebGLRenderingContext | null
  if (!gl) gl = canvas.getContext('experimental-webgl') as WebGLRenderingContext | null
  if (!gl || !data) return false
  loseCtx = gl.getExtension('WEBGL_lose_context')
  const compile = (type: number, src: string): WebGLShader | null => {
    const sh = gl!.createShader(type)
    if (!sh) return null
    gl!.shaderSource(sh, src)
    gl!.compileShader(sh)
    return sh
  }
  const vs = compile(gl.VERTEX_SHADER, VERT)
  const fs = compile(gl.FRAGMENT_SHADER, FRAG)
  if (!vs || !fs) return false
  const prog = gl.createProgram()
  if (!prog) return false
  gl.attachShader(prog, vs)
  gl.attachShader(prog, fs)
  gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false
  gl.useProgram(prog)
  const buf = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW) // 一次上传：最多 50 万粒子的全部数据
  const loc = gl.getAttribLocation(prog, 'a_data')
  gl.enableVertexAttribArray(loc)
  gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, 0, 0)
  uTime = gl.getUniformLocation(prog, 'u_time')
  gl.uniform3f(gl.getUniformLocation(prog, 'u_color'), 0.49, 0.827, 0.988)
  gl.clearColor(0.05, 0.067, 0.09, 1)
  gl.viewport(0, 0, W, H)
  return true
}

onMounted(() => {
  data = new Float32Array(MAX * 4)
  const rnd = makeRandom(20260818)
  for (let i = 0; i < MAX; i++) {
    const o = i * 4
    data[o] = rnd() * 2 - 1
    data[o + 1] = rnd() * 2 - 1
    data[o + 2] = (rnd() * 2 - 1) * 0.06
    data[o + 3] = (rnd() * 2 - 1) * 0.06
  }
  const c2 = canvas2d.value
  const cg = canvasGl.value
  if (c2) {
    c2.width = W
    c2.height = H
    ctx2d = c2.getContext('2d')
  }
  let glOk = false
  if (cg) {
    cg.width = W
    cg.height = H
    glOk = initGl(cg)
  }
  if (!glOk) statGl.value = '当前浏览器不支持 WebGL'

  const t0 = performance.now()
  const loop = (now: number) => {
    raf = requestAnimationFrame(loop)
    const t = (now - t0) / 1000
    let a = performance.now()
    draw2d(t)
    const d2 = performance.now() - a
    a = performance.now()
    drawGl(t)
    const dg = performance.now() - a
    ms2d = ms2d < 0 ? d2 : ms2d * 0.9 + d2 * 0.1
    msGl = msGl < 0 ? dg : msGl * 0.9 + dg * 0.1
    if (now - lastUi > 250) {
      lastUi = now
      stat2d.value = fmt(ms2d)
      if (glOk) statGl.value = fmt(msGl)
    }
  }
  raf = requestAnimationFrame(loop)
})

onUnmounted(() => {
  cancelAnimationFrame(raf)
  loseCtx?.loseContext()
  gl = null
  ctx2d = null
  data = null
})
</script>

<template>
  <div class="demo-particles">
    <div class="demo-pc-controls">
      <label for="demo-pc-count">粒子数</label>
      <input
        id="demo-pc-count"
        v-model.number="count"
        type="range"
        min="10000"
        max="500000"
        step="1000"
      />
      <span class="demo-pc-count-val">{{ count.toLocaleString('en-US') }}</span>
    </div>
    <div class="demo-pc-row">
      <div class="demo-pc-panel">
        <canvas ref="canvas2d" class="demo-pc-canvas"></canvas>
        <div class="demo-pc-stats">
          <span>Canvas 2D · 逐粒子 fillRect</span>
          <span class="demo-pc-num">{{ stat2d }}</span>
        </div>
      </div>
      <div class="demo-pc-panel">
        <canvas ref="canvasGl" class="demo-pc-canvas"></canvas>
        <div class="demo-pc-stats">
          <span>WebGL · 一次 drawArrays</span>
          <span class="demo-pc-num">{{ statGl }}</span>
        </div>
      </div>
    </div>
    <p class="demo-pc-note">
      两边画同一批粒子；读数是各侧每帧绘制耗时的滚动平均换算出的等效帧率（60
      是多数屏幕的刷新上限）。WebGL 侧本章当黑盒，下一章逐行拆。
    </p>
  </div>
</template>

<style scoped>
.demo-particles {
  margin: 16px 0;
}
.demo-pc-controls {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
  font-size: 14px;
}
.demo-pc-controls input[type='range'] {
  flex: 1;
}
.demo-pc-count-val {
  font-family: var(--vp-font-family-mono, ui-monospace, monospace);
  min-width: 7ch;
  text-align: right;
}
.demo-pc-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
@media (max-width: 720px) {
  .demo-pc-row {
    grid-template-columns: 1fr;
  }
}
.demo-pc-panel {
  background: #0d1117;
  border: 1px solid #21262d;
  border-radius: 8px;
  overflow: hidden;
}
.demo-pc-canvas {
  display: block;
  width: 100%;
  height: auto;
  background: #0d1117;
}
.demo-pc-stats {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  font-size: 12px;
  color: #8b949e;
  border-top: 1px solid #21262d;
}
.demo-pc-num {
  font-family: var(--vp-font-family-mono, ui-monospace, monospace);
  color: #7dd3fc;
  white-space: nowrap;
}
.demo-pc-note {
  font-size: 12px;
  color: var(--vp-c-text-2, #8b949e);
  margin-top: 8px;
}
</style>
