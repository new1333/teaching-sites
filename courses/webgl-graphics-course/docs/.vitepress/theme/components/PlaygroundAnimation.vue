<script setup lang="ts">
// 用法示例（自包含演示）：动画 Playground——uniform 与渲染循环。
// 三角形旋转 + 颜色呼吸全部由 uniform 驱动（u_angle / u_time / u_speed /
// u_phase）；滑杆只改 uniform，顶点缓冲在初始化后不再重传（计数器可视化）。
// 开关「CPU 重算 + 重传缓冲」切到反面教材模式：每帧 JS 重算 9 个分量、
// 整块 bufferData 重传——缓冲重传计数开始狂奔，画面却一模一样。
// 第二块小 canvas 画缓动对比：lerp 直线 vs smoothstep 的 S 曲线 + 同步动点。
import { onMounted, onUnmounted, ref } from 'vue'

const W = 480
const H = 360
const EASE_W = 480
const EASE_H = 210

// 与实验场 src/geometry/triangle.ts · createTriangle 同一份教学三角形
// （演示里每顶点只存 x/y，z 恒 0，所以是 6 个分量）
const BASE = new Float32Array([-0.6, -0.5, 0.6, -0.5, 0, 0.8])

// 顶点着色器：旋转发生在 GPU 里——JS 每帧只送一个新的角度 uniform
const VERT_SRC = `attribute vec2 a_position;
uniform float u_angle;
void main() {
  float c = cos(u_angle);
  float s = sin(u_angle);
  vec2 p = vec2(a_position.x * c - a_position.y * s,
                a_position.x * s + a_position.y * c);
  gl_Position = vec4(p, 0.0, 1.0);
}
`
// 片元着色器：颜色呼吸 = 两个颜色按 sin 波形 mix（GLSL 内建 mix 就是 lerp）
const FRAG_SRC = `precision mediump float;
uniform float u_time;
uniform float u_speed;
uniform float u_phase;
void main() {
  float breath = 0.5 + 0.5 * sin(u_time * u_speed + u_phase);
  vec3 cold = vec3(0.20, 0.55, 0.95);
  vec3 warm = vec3(0.95, 0.35, 0.30);
  gl_FragColor = vec4(mix(cold, warm, breath), 1.0);
}
`

const speed = ref(1.0)
const phase = ref(0)
const wireframe = ref(false)
const cpuMode = ref(false)
const paused = ref(false)
const glUnavailable = ref(false)
const canvasEl = ref<HTMLCanvasElement | null>(null)
const easeEl = ref<HTMLCanvasElement | null>(null)

// 面板读数（每 10 帧刷新一次，避免每帧触发 DOM 更新）
const statAngle = ref(0)
const statFps = ref(0)
const statUniformThisFrame = ref(0)
const statUploadThisFrame = ref(0)
const statUploadTotal = ref(0)

let gl: WebGLRenderingContext | null = null
let loseCtx: { loseContext(): void } | null = null
let easeCtx: CanvasRenderingContext2D | null = null
let prog: WebGLProgram | null = null
let buf: WebGLBuffer | null = null
let aPosition = -1
let uAngle = -1
let uTime = -1
let uSpeed = -1
let uPhase = -1
const scratch = new Float32Array(6)
let raf = 0
let last = 0
let tAcc = 0 // 累计时间（秒）——增量时间逐帧累加，帧率不匀也等速
let angle = 0 // 累计角度（弧度）
let fpsSmoothed = 0
let frameCount = 0
let uploadsThisFrame = 0
let uniformThisFrame = 0
let uploadTotal = 0

function compileShader(type: number, src: string): WebGLShader {
  const g = gl!
  const sh = g.createShader(type)!
  g.shaderSource(sh, src)
  g.compileShader(sh)
  if (!g.getShaderParameter(sh, g.COMPILE_STATUS))
    throw new Error(g.getShaderInfoLog(sh) ?? '着色器编译失败')
  return sh
}

function uploadBase(): void {
  // 演示里唯一需要碰缓冲的时刻：模式切换回 uniform 版时把顶点还原成原始姿态
  const g = gl!
  g.bindBuffer(g.ARRAY_BUFFER, buf)
  g.bufferData(g.ARRAY_BUFFER, BASE, gl!.STATIC_DRAW)
  uploadTotal++
}

// 缓动对比小图：lerp 直线 vs smoothstep 曲线，动点同步走
function drawEase(t01: number): void {
  const ctx = easeCtx
  if (!ctx) return
  const padL = 46
  const padR = 14
  const padT = 18
  const padB = 30
  const iw = EASE_W - padL - padR
  const ih = EASE_H - padT - padB
  const x = (t: number) => padL + t * iw
  const y = (v: number) => padT + (1 - v) * ih
  ctx.clearRect(0, 0, EASE_W, EASE_H)
  ctx.fillStyle = '#0d1117'
  ctx.fillRect(0, 0, EASE_W, EASE_H)
  // 网格与坐标轴（t 与 v 都在 [0,1]）
  ctx.strokeStyle = '#21262d'
  ctx.lineWidth = 1
  for (let i = 0; i <= 4; i++) {
    const gx = padL + (iw * i) / 4
    ctx.beginPath()
    ctx.moveTo(gx, padT)
    ctx.lineTo(gx, padT + ih)
    ctx.stroke()
    const gy = padT + (ih * i) / 4
    ctx.beginPath()
    ctx.moveTo(padL, gy)
    ctx.lineTo(padL + iw, gy)
    ctx.stroke()
  }
  ctx.fillStyle = '#8b949e'
  ctx.font = '11px ui-monospace, monospace'
  ctx.fillText('t →', padL + iw - 18, padT + ih + 22)
  ctx.fillText('1', padL - 12, padT + 4)
  ctx.fillText('0', padL - 12, padT + ih + 4)
  // 两条曲线：lerp（v=t）与 smoothstep（v=t²(3−2t)）
  const curves: Array<{ color: string; f: (t: number) => number }> = [
    { color: '#58a6ff', f: (t) => t },
    { color: '#3fb950', f: (t) => t * t * (3 - 2 * t) },
  ]
  for (const c of curves) {
    ctx.strokeStyle = c.color
    ctx.lineWidth = 2
    ctx.beginPath()
    for (let i = 0; i <= 60; i++) {
      const t = i / 60
      const px = x(t)
      const py = y(c.f(t))
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)
    }
    ctx.stroke()
  }
  // 当前 t 的竖线 + 两个动点（同一时刻、两种进度）
  ctx.strokeStyle = '#30363d'
  ctx.setLineDash([4, 4])
  ctx.beginPath()
  ctx.moveTo(x(t01), padT)
  ctx.lineTo(x(t01), padT + ih)
  ctx.stroke()
  ctx.setLineDash([])
  for (const c of curves) {
    ctx.fillStyle = c.color
    ctx.beginPath()
    ctx.arc(x(t01), y(c.f(t01)), 5, 0, Math.PI * 2)
    ctx.fill()
  }
  // 图例
  ctx.fillStyle = '#58a6ff'
  ctx.fillText('lerp：匀速直线', padL + 6, padT + 14)
  ctx.fillStyle = '#3fb950'
  ctx.fillText('smoothstep：缓入缓出', padL + 6, padT + 30)
}

function frame(now: number): void {
  raf = requestAnimationFrame(frame)
  if (!gl || !prog) return
  if (!last) last = now
  // 增量时间：与上一帧的毫秒差。上限 100ms——切后台回来时不许一步跨很远
  const dtRaw = (now - last) / 1000
  const dt = Math.min(dtRaw, 0.1)
  last = now
  if (dtRaw > 0 && !paused.value) fpsSmoothed = fpsSmoothed * 0.9 + (1 / dtRaw) * 0.1 // 仅用于面板读数；暂停时一并冻结
  if (!paused.value) {
    tAcc += dt
    angle += speed.value * dt
  }

  const g = gl
  g.viewport(0, 0, W, H)
  g.clearColor(0.05, 0.067, 0.09, 1)
  g.clear(g.COLOR_BUFFER_BIT)
  g.useProgram(prog)

  uploadsThisFrame = 0
  uniformThisFrame = 0
  if (cpuMode.value) {
    // 反面教材：JS 每帧重算 6 个分量并整块重传缓冲，旋转在 CPU 里做完
    const c = Math.cos(angle)
    const s = Math.sin(angle)
    for (let i = 0; i < 3; i++) {
      const px = BASE[i * 2]
      const py = BASE[i * 2 + 1]
      scratch[i * 2] = px * c - py * s
      scratch[i * 2 + 1] = px * s + py * c
    }
    g.bindBuffer(g.ARRAY_BUFFER, buf)
    g.bufferData(g.ARRAY_BUFFER, scratch, g.DYNAMIC_DRAW)
    uploadsThisFrame = 1
    uploadTotal++
    g.uniform1f(uAngle, 0) // 旋转已在 CPU 做完，着色器置零
    uniformThisFrame++
  } else {
    // 正解：只送一个新的角度 uniform，缓冲纹丝不动
    g.uniform1f(uAngle, angle)
    uniformThisFrame++
  }
  g.uniform1f(uTime, tAcc)
  g.uniform1f(uSpeed, speed.value)
  g.uniform1f(uPhase, phase.value)
  uniformThisFrame += 3

  g.bindBuffer(g.ARRAY_BUFFER, buf)
  if (aPosition >= 0) {
    g.enableVertexAttribArray(aPosition)
    g.vertexAttribPointer(aPosition, 2, g.FLOAT, false, 0, 0)
  }
  g.drawArrays(wireframe.value ? g.LINE_LOOP : g.TRIANGLES, 0, 3)

  // 缓动小图与面板读数：动点 2 秒走一个来回
  drawEase((tAcc % 2) / 2)
  frameCount++
  if (frameCount % 10 === 0) {
    statAngle.value = angle % (Math.PI * 2)
    statFps.value = Math.round(fpsSmoothed)
    statUniformThisFrame.value = uniformThisFrame
    statUploadThisFrame.value = uploadsThisFrame
    statUploadTotal.value = uploadTotal
  }
}

function resetBuffers(): void {
  // 切回 uniform 模式时把缓冲里的顶点还原成原始姿态（这是仅有的另一次重传）
  uploadBase()
}

onMounted(() => {
  const c = canvasEl.value
  const e = easeEl.value
  if (!c || !e) return
  c.width = W
  c.height = H
  e.width = EASE_W
  e.height = EASE_H
  easeCtx = e.getContext('2d')
  gl = c.getContext('webgl', { alpha: false, antialias: true, depth: false }) as
    WebGLRenderingContext | null
  if (!gl) {
    glUnavailable.value = true
    return
  }
  const g = gl
  loseCtx = g.getExtension('WEBGL_lose_context')
  try {
    const vs = compileShader(g.VERTEX_SHADER, VERT_SRC)
    const fs = compileShader(g.FRAGMENT_SHADER, FRAG_SRC)
    prog = g.createProgram()
    g.attachShader(prog, vs)
    g.attachShader(prog, fs)
    g.linkProgram(prog)
    if (!g.getProgramParameter(prog, g.LINK_STATUS))
      throw new Error(g.getProgramInfoLog(prog) ?? '链接失败')
    g.deleteShader(vs)
    g.deleteShader(fs)
  } catch (err) {
    glUnavailable.value = true
    console.error(err)
    return
  }
  aPosition = g.getAttribLocation(prog, 'a_position')
  uAngle = g.getUniformLocation(prog, 'u_angle')
  uTime = g.getUniformLocation(prog, 'u_time')
  uSpeed = g.getUniformLocation(prog, 'u_speed')
  uPhase = g.getUniformLocation(prog, 'u_phase')
  buf = g.createBuffer()
  uploadBase() // 演示一生唯一一次正经上传（此后 uniform 模式不再碰缓冲）
  raf = requestAnimationFrame(frame)
})

onUnmounted(() => {
  cancelAnimationFrame(raf)
  raf = 0
  loseCtx?.loseContext()
  loseCtx = null
  gl = null
  prog = null
  buf = null
  easeCtx = null
})
</script>

<template>
  <div class="pa">
    <canvas ref="canvasEl" class="pa-canvas"></canvas>
    <p v-if="glUnavailable" class="pa-missing">当前浏览器不支持 WebGL，动画演示不可用。</p>

    <div class="pa-controls">
      <label class="pa-slider">
        旋转速度 {{ speed.toFixed(1) }} rad/s（uniform u_speed）
        <input v-model.number="speed" type="range" min="0" max="3" step="0.1" />
      </label>
      <label class="pa-slider">
        呼吸相位 {{ phase.toFixed(2) }}（uniform u_phase）
        <input v-model.number="phase" type="range" min="0" max="6.28" step="0.01" />
      </label>
    </div>

    <div class="pa-controls">
      <label class="pa-check">
        <input v-model="wireframe" type="checkbox" />
        线框模式（看 3 个顶点怎么连成三角形）
      </label>
      <label class="pa-check">
        <input v-model="cpuMode" type="checkbox" @change="!cpuMode && resetBuffers()" />
        反面教材：CPU 重算顶点 + 每帧重传缓冲
      </label>
      <button class="pa-btn" type="button" @click="paused = !paused">
        {{ paused ? '继续' : '暂停' }}
      </button>
    </div>

    <div class="pa-stats">
      <span>约 {{ statFps }} fps</span>
      <span>当前角度 {{ statAngle.toFixed(2) }} rad</span>
      <span class="pa-good">本帧 uniform 写入：{{ statUniformThisFrame }} 次</span>
      <span :class="cpuMode ? 'pa-bad' : 'pa-good'">
        本帧 buffer 重传：{{ statUploadThisFrame }} 次（累计 {{ statUploadTotal }}）
      </span>
    </div>
    <p class="pa-hint">
      勾上反面教材再看这一行：画面一模一样，缓冲重传从 0 变 1——放大到 10 万粒子，每帧重传的就是 30 万个分量。
    </p>

    <canvas ref="easeEl" class="pa-ease"></canvas>
    <p class="pa-hint">
      下图两个动点同一时刻出发：lerp 匀速走完全程；smoothstep 两端慢、中间快（斜率为 0 起步与收尾）。
    </p>
  </div>
</template>

<style scoped>
.pa {
  margin: 16px 0;
}
.pa-canvas {
  display: block;
  width: 100%;
  max-width: 480px;
  height: auto;
  background: #0d1117;
  border: 1px solid #21262d;
  border-radius: 8px;
}
.pa-missing {
  font-size: 13px;
  color: #f85149;
  padding: 8px 0;
}
.pa-controls {
  display: flex;
  align-items: center;
  gap: 14px;
  margin: 12px 0 6px;
  font-size: 13px;
  flex-wrap: wrap;
  color: var(--vp-c-text-2, #8b949e);
}
.pa-slider {
  display: inline-flex;
  flex-direction: column;
  gap: 2px;
}
.pa-slider input[type='range'] {
  width: 170px;
  accent-color: #58a6ff;
}
.pa-check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}
.pa-btn {
  font-size: 13px;
  padding: 5px 12px;
  border-radius: 6px;
  border: 1px solid #21262d;
  background: var(--vp-button-alt-bg, #161b22);
  color: var(--vp-c-text-1, inherit);
  cursor: pointer;
}
.pa-stats {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  margin: 10px 0 4px;
  padding: 8px 10px;
  font-size: 12px;
  font-family: var(--vp-font-family-mono, ui-monospace, monospace);
  border: 1px solid #21262d;
  border-radius: 6px;
  color: #8b949e;
  max-width: 480px;
}
.pa-good {
  color: #3fb950;
}
.pa-bad {
  color: #f85149;
}
.pa-hint {
  font-size: 12.5px;
  color: var(--vp-c-text-2, #8b949e);
  margin: 6px 0;
  max-width: 640px;
}
.pa-ease {
  display: block;
  width: 100%;
  max-width: 480px;
  height: auto;
  border: 1px solid #21262d;
  border-radius: 8px;
  margin-top: 12px;
}
</style>
