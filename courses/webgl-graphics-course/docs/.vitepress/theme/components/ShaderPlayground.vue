<script setup lang="ts">
// 用法示例（自包含演示）：着色器 Playground——渐变三角形实时渲染。
// textarea 在线编辑片元着色器，防抖 500ms 重编译；编译/链接失败把
// getShaderInfoLog / getProgramInfoLog 原文内联显示在画布下方红色面板，
// 画布保持上一次成功画面（正是「报错被吞」痛点的反面教材）。
import { onMounted, onUnmounted, ref, watch } from 'vue'

const W = 480
const H = 480

// 与实验场 src/geometry/triangle.ts · createTriangle 同一份教学三角形（NDC 坐标）
const TRIANGLE = new Float32Array([-0.6, -0.5, 0, 0.6, -0.5, 0, 0, 0.8, 0])

const DEFAULT_FRAG = `precision mediump float;
varying vec3 v_color;
void main() {
  gl_FragColor = vec4(v_color, 1.0);
}
`
// 顶点着色器只读展示：三顶点各自的颜色经 varying 传送带发往片元
const VERT_SRC = `attribute vec3 a_position;
attribute vec3 a_color;
varying vec3 v_color;
void main() {
  v_color = a_color;
  gl_Position = vec4(a_position, 1.0);
}
`

const fragSrc = ref(DEFAULT_FRAG)
const colorA = ref('#ff0000')
const colorB = ref('#00ff00')
const colorC = ref('#0000ff')
const compileError = ref('')
const compileOk = ref(true)
const glUnavailable = ref(false)
const canvasEl = ref<HTMLCanvasElement | null>(null)

let gl: WebGLRenderingContext | null = null
let loseCtx: { loseContext(): void } | null = null
let prog: WebGLProgram | null = null
let posBuf: WebGLBuffer | null = null
let colBuf: WebGLBuffer | null = null
let aPosition = -1
let aColor = -1
let colorData: Float32Array | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

function compileShader(type: number, src: string): { sh: WebGLShader | null; log: string } {
  const g = gl!
  const sh = g.createShader(type)
  if (!sh) return { sh: null, log: 'createShader 返回 null' }
  g.shaderSource(sh, src)
  g.compileShader(sh)
  if (g.getShaderParameter(sh, g.COMPILE_STATUS)) return { sh, log: '' }
  const log = g.getShaderInfoLog(sh) ?? '(驱动没有给出更多信息)'
  g.deleteShader(sh)
  return { sh: null, log }
}

function fail(msg: string): void {
  compileError.value = msg.trim()
  compileOk.value = false
  // 失败时绝不碰画布：屏幕保持上一次成功编译的画面
}

// 重编译全流程：编译两段着色器 → 链接 → 成功才换程序并重画
function rebuild(): void {
  if (!gl) return
  const g = gl
  const vs = compileShader(g.VERTEX_SHADER, VERT_SRC)
  if (!vs.sh) {
    fail(`顶点着色器编译失败：\n${vs.log}`)
    return
  }
  const fs = compileShader(g.FRAGMENT_SHADER, fragSrc.value)
  if (!fs.sh) {
    fail(`片元着色器编译失败：\n${fs.log}`)
    return
  }
  const p = g.createProgram()
  if (!p) {
    fail('createProgram 返回 null')
    return
  }
  g.attachShader(p, vs.sh)
  g.attachShader(p, fs.sh)
  g.linkProgram(p)
  if (!g.getProgramParameter(p, g.LINK_STATUS)) {
    const log = g.getProgramInfoLog(p) ?? '(驱动没有给出更多信息)'
    fail(`链接失败：\n${log}`)
    g.deleteProgram(p)
    return
  }
  // 成功：换上新程序；旧程序与两段着色器当场销毁
  if (prog) g.deleteProgram(prog)
  g.deleteShader(vs.sh)
  g.deleteShader(fs.sh)
  prog = p
  aPosition = g.getAttribLocation(p, 'a_position')
  aColor = g.getAttribLocation(p, 'a_color')
  compileError.value = ''
  compileOk.value = true
  draw()
}

function draw(): void {
  if (!gl || !prog || !colorData) return
  const g = gl
  g.viewport(0, 0, W, H)
  g.clearColor(0.05, 0.067, 0.09, 1)
  g.clear(g.COLOR_BUFFER_BIT)
  g.useProgram(prog)
  g.bindBuffer(g.ARRAY_BUFFER, posBuf)
  if (aPosition >= 0) {
    g.enableVertexAttribArray(aPosition)
    g.vertexAttribPointer(aPosition, 3, g.FLOAT, false, 0, 0)
  }
  g.bindBuffer(g.ARRAY_BUFFER, colBuf)
  g.bufferData(g.ARRAY_BUFFER, colorData, g.DYNAMIC_DRAW) // 改颜色只重传这块小缓冲
  if (aColor >= 0) {
    g.enableVertexAttribArray(aColor)
    g.vertexAttribPointer(aColor, 3, g.FLOAT, false, 0, 0)
  }
  g.drawArrays(g.TRIANGLES, 0, 3)
}

// 三顶点颜色改动：只更新颜色缓冲并重画，着色器程序原样复用
function onColorChange(): void {
  if (!colorData) return
  const [r1, g1, b1] = hexToRgb(colorA.value)
  const [r2, g2, b2] = hexToRgb(colorB.value)
  const [r3, g3, b3] = hexToRgb(colorC.value)
  colorData.set([r1, g1, b1, r2, g2, b2, r3, g3, b3])
  draw()
}

// 「注入编译错误」：复刻「一片黑 + 报错被吞」——塞一个明显语法错误
function injectError(): void {
  const src = fragSrc.value
  const broken = src.replace('gl_FragColor = vec4(v_color, 1.0);', 'gl_FragColor = vec4(v_color 1.0)')
  fragSrc.value = broken === src ? `${src}\nfloat oops = ;\n` : broken
  if (debounceTimer) clearTimeout(debounceTimer)
  rebuild() // 按钮触发即时重编译，不等防抖
}

function resetFrag(): void {
  fragSrc.value = DEFAULT_FRAG
  if (debounceTimer) clearTimeout(debounceTimer)
  rebuild()
}

// 静态场景按需重绘（改码/改色才画），没有 rAF 循环需要清理
watch(fragSrc, () => {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(rebuild, 500)
})

onMounted(() => {
  const c = canvasEl.value
  if (!c) return
  c.width = W
  c.height = H
  gl = c.getContext('webgl', { alpha: false, antialias: true, depth: false, preserveDrawingBuffer: true }) as
    WebGLRenderingContext | null
  if (!gl) {
    glUnavailable.value = true
    return
  }
  loseCtx = gl.getExtension('WEBGL_lose_context')
  colorData = new Float32Array(9)
  posBuf = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuf)
  gl.bufferData(gl.ARRAY_BUFFER, TRIANGLE, gl.STATIC_DRAW)
  colBuf = gl.createBuffer()
  onColorChange() // 先填好颜色数据（draw 因程序未建而空转）
  rebuild() // 首次编译 + 首帧
})

onUnmounted(() => {
  if (debounceTimer) clearTimeout(debounceTimer)
  loseCtx?.loseContext()
  gl = null
  prog = null
  posBuf = null
  colBuf = null
  colorData = null
})
</script>

<template>
  <div class="shader-playground">
    <div class="sp-canvas-wrap">
      <canvas ref="canvasEl" class="sp-canvas"></canvas>
      <p v-if="glUnavailable" class="sp-gl-missing">当前浏览器不支持 WebGL，演示不可用。</p>
      <div class="sp-status" :class="compileOk ? 'sp-ok' : 'sp-bad'">
        <span class="sp-dot"></span>
        <span v-if="compileOk">编译通过 · 三顶点颜色经 varying 插值铺成渐变</span>
        <span v-else>编译失败 · 画布保持上一次成功画面——不看重绘日志的话，这里就是「一片黑」现场</span>
      </div>
    </div>

    <div class="sp-controls">
      <label class="sp-color">
        顶点 A
        <input v-model="colorA" type="color" @input="onColorChange" />
      </label>
      <label class="sp-color">
        顶点 B
        <input v-model="colorB" type="color" @input="onColorChange" />
      </label>
      <label class="sp-color">
        顶点 C
        <input v-model="colorC" type="color" @input="onColorChange" />
      </label>
      <button class="sp-btn sp-btn-danger" type="button" @click="injectError">注入编译错误</button>
      <button class="sp-btn" type="button" @click="resetFrag">恢复默认</button>
    </div>

    <label class="sp-label" for="sp-frag">片元着色器（GLSL，可编辑——改完停 0.5 秒自动重编译）</label>
    <textarea
      id="sp-frag"
      v-model="fragSrc"
      class="sp-textarea"
      rows="7"
      spellcheck="false"
    ></textarea>

    <pre v-if="compileError" class="sp-error">{{ compileError }}</pre>

    <details class="sp-vert">
      <summary>顶点着色器（本章只读：位置直通 + 颜色上传送带）</summary>
      <pre class="sp-vert-src">{{ VERT_SRC }}</pre>
    </details>
  </div>
</template>

<style scoped>
.shader-playground {
  margin: 16px 0;
}
.sp-canvas-wrap {
  max-width: 480px;
}
.sp-canvas {
  display: block;
  width: 100%;
  height: auto;
  background: #0d1117;
  border: 1px solid #21262d;
  border-radius: 8px;
}
.sp-gl-missing {
  font-size: 13px;
  color: #f85149;
  padding: 8px 0;
}
.sp-status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  margin-top: 8px;
  font-size: 12px;
  border-radius: 6px;
  border: 1px solid #21262d;
  color: #8b949e;
}
.sp-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: none;
}
.sp-ok .sp-dot {
  background: #3fb950;
}
.sp-bad .sp-dot {
  background: #f85149;
}
.sp-bad {
  color: #f85149;
  border-color: #f8514966;
}
.sp-controls {
  display: flex;
  align-items: center;
  gap: 14px;
  margin: 12px 0;
  font-size: 14px;
  flex-wrap: wrap;
}
.sp-color {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--vp-c-text-2, #8b949e);
}
.sp-color input[type='color'] {
  width: 34px;
  height: 26px;
  padding: 0;
  border: 1px solid #21262d;
  border-radius: 4px;
  background: none;
  cursor: pointer;
}
.sp-btn {
  font-size: 13px;
  padding: 5px 12px;
  border-radius: 6px;
  border: 1px solid #21262d;
  background: var(--vp-button-alt-bg, #161b22);
  color: var(--vp-c-text-1, inherit);
  cursor: pointer;
}
.sp-btn-danger {
  border-color: #f8514966;
  color: #f85149;
}
.sp-label {
  display: block;
  font-size: 12px;
  color: var(--vp-c-text-2, #8b949e);
  margin-bottom: 6px;
}
.sp-textarea {
  width: 100%;
  box-sizing: border-box;
  font-family: var(--vp-font-family-mono, ui-monospace, monospace);
  font-size: 13px;
  line-height: 1.6;
  color: #c9d1d9;
  background: #0d1117;
  border: 1px solid #21262d;
  border-radius: 8px;
  padding: 10px 12px;
  resize: vertical;
  tab-size: 2;
}
.sp-error {
  margin-top: 10px;
  padding: 10px 12px;
  font-family: var(--vp-font-family-mono, ui-monospace, monospace);
  font-size: 12.5px;
  line-height: 1.6;
  white-space: pre-wrap;
  color: #ffb1ad;
  background: #2d1114;
  border: 1px solid #f8514966;
  border-radius: 8px;
}
.sp-vert {
  margin-top: 10px;
  font-size: 13px;
  color: var(--vp-c-text-2, #8b949e);
}
.sp-vert summary {
  cursor: pointer;
}
.sp-vert-src {
  margin-top: 8px;
  padding: 10px 12px;
  font-size: 12.5px;
  line-height: 1.6;
  color: #c9d1d9;
  background: #0d1117;
  border: 1px solid #21262d;
  border-radius: 8px;
  overflow-x: auto;
}
</style>
