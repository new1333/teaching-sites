<script setup lang="ts">
// 用法示例（自包含演示）：透视投影 vs 正交投影同屏对比。
// 同一个旋转的立方体线框，左画布过 perspective（透视：近大远小）、
// 右画布过 ortho（正交：平行投影仪，远近一样大）。线框只是本演示的
// 道具——立方体的几何与深度教学在第 8 章，这里只借它当「三维物体」。
// 滑杆：fov / near / far / aspect 实时调。正交盒跟随 fov/aspect 同步
// 换尺寸（与透视帐篷在立方体中心深处取同一截面），保证对比公平。
// 顶点按眼空间深度着色：近暖橙、远冷蓝——透视侧橙面肉眼可见地比蓝面
// 大；正交侧两面一样大、对应边始终平行。
// 相机就是 WebGL 的默认姿势：站在原点朝 -Z 看（视图矩阵第 7 章才造，
// 此刻 V = 单位阵）。演示自包含：内联与 companion/src/math/mat4.ts
// 同款的列主序算法，不 import 实验场。
import { onMounted, onUnmounted, ref } from 'vue'

// ---------- 内联迷你 mat4（与 src/math/mat4.ts 同款，列主序） ----------
type M4 = Float32Array

function mMul(a: M4, b: M4): M4 {
  // A·B：坐标先过 B、再过 A（与实验场同一约定）
  const out = new Float32Array(16)
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      out[col * 4 + row] =
        a[0 * 4 + row] * b[col * 4 + 0] +
        a[1 * 4 + row] * b[col * 4 + 1] +
        a[2 * 4 + row] * b[col * 4 + 2] +
        a[3 * 4 + row] * b[col * 4 + 3]
    }
  }
  return out
}

function mTranslate(tx: number, ty: number, tz: number): M4 {
  const m = new Float32Array(16)
  m[0] = 1
  m[5] = 1
  m[10] = 1
  m[15] = 1
  m[12] = tx
  m[13] = ty
  m[14] = tz
  return m
}

function mRotX(rad: number): M4 {
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  const m = new Float32Array(16)
  m[0] = 1
  m[5] = c
  m[6] = s
  m[9] = -s
  m[10] = c
  m[15] = 1
  return m
}

function mRotY(rad: number): M4 {
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  const m = new Float32Array(16)
  m[0] = c
  m[2] = -s
  m[5] = 1
  m[8] = s
  m[10] = c
  m[15] = 1
  return m
}

/** 透视机器：与实验场 perspective 同款——第 4 行 (0,0,-1,0)，w = -z。 */
function mPerspective(fovYRad: number, aspect: number, near: number, far: number): M4 {
  const f = 1 / Math.tan(fovYRad / 2)
  const m = new Float32Array(16)
  m[0] = f / aspect
  m[5] = f
  m[10] = (far + near) / (near - far)
  m[11] = -1
  m[14] = (2 * far * near) / (near - far)
  return m
}

/** 正交机器：与实验场 ortho 同款——第 4 行 (0,0,0,1)，w 恒 1。 */
function mOrtho(l: number, r: number, b: number, t: number, n: number, f: number): M4 {
  const m = new Float32Array(16)
  m[0] = 2 / (r - l)
  m[5] = 2 / (t - b)
  m[10] = -2 / (f - n)
  m[12] = -(r + l) / (r - l)
  m[13] = -(t + b) / (t - b)
  m[14] = -(f + n) / (f - n)
  m[15] = 1
  return m
}

/** 点过机器（w 补 1 进，出口除以 w——透视侧除的是深度 -z）。 */
function xform(m: M4, p: readonly number[]): [number, number, number] {
  const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15]
  return [
    (m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12]) / w,
    (m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13]) / w,
    (m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]) / w,
  ]
}

// ---------- 立方体线框（道具：8 顶点 12 边，几何教学在第 8 章） ----------
const VERTS: ReadonlyArray<readonly number[]> = [
  [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
  [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
]
const EDGES: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 0], // 一张面
  [4, 5], [5, 6], [6, 7], [7, 4], // 对面
  [0, 4], [1, 5], [2, 6], [3, 7], // 连接棱
]

const W = 400
const H = 300
const DIST = 4 // 立方体中心在眼空间的深度（z = -4）

// ---------- 滑杆状态（两画布共用，保证同参数对比） ----------
const fovDeg = ref(70)
const near = ref(1)
const far = ref(20)
const aspect = ref(4 / 3)
const spinning = ref(true)

const nearClip = ref(false)
const farClip = ref(false)
const wNear = ref(0)
const wFar = ref(0)

// ---------- WebGL 装配（每画布一个上下文） ----------
const VS = `
attribute vec3 a_position;
attribute vec3 a_color;
uniform mat4 u_mvp;
varying vec3 v_color;
void main() {
  gl_Position = u_mvp * vec4(a_position, 1.0);
  v_color = a_color;
}
`
const FS = `
precision mediump float;
varying vec3 v_color;
void main() {
  gl_FragColor = vec4(v_color, 1.0);
}
`

interface Panel {
  gl: WebGLRenderingContext
  mvpLoc: WebGLUniformLocation | null
  posBuf: WebGLBuffer
  colBuf: WebGLBuffer
}

function makePanel(canvas: HTMLCanvasElement | null): Panel | null {
  const gl = canvas?.getContext('webgl', { antialias: true })
  if (!gl) return null
  const compile = (type: number, src: string): WebGLShader | null => {
    const sh = gl.createShader(type)
    if (!sh) return null
    gl.shaderSource(sh, src)
    gl.compileShader(sh)
    return sh
  }
  const vs = compile(gl.VERTEX_SHADER, VS)
  const fs = compile(gl.FRAGMENT_SHADER, FS)
  const prog = gl.createProgram()
  if (!vs || !fs || !prog) return null
  gl.attachShader(prog, vs)
  gl.attachShader(prog, fs)
  gl.linkProgram(prog)
  gl.useProgram(prog)
  const posBuf = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuf)
  // 12 条边 × 2 端点 × 3 分量：按边展开顶点（线框画法）
  const lineVerts = new Float32Array(EDGES.length * 6)
  let k = 0
  for (const [a, b] of EDGES) {
    for (const v of [VERTS[a], VERTS[b]]) {
      lineVerts[k++] = v[0]
      lineVerts[k++] = v[1]
      lineVerts[k++] = v[2]
    }
  }
  gl.bufferData(gl.ARRAY_BUFFER, lineVerts, gl.STATIC_DRAW)
  const aPos = gl.getAttribLocation(prog, 'a_position')
  gl.enableVertexAttribArray(aPos)
  gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0)
  const colBuf = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, colBuf)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(EDGES.length * 6), gl.DYNAMIC_DRAW)
  const aCol = gl.getAttribLocation(prog, 'a_color')
  gl.enableVertexAttribArray(aCol)
  gl.vertexAttribPointer(aCol, 3, gl.FLOAT, false, 0, 0)
  return { gl, mvpLoc: gl.getUniformLocation(prog, 'u_mvp'), posBuf, colBuf }
}

const cvPersp = ref<HTMLCanvasElement | null>(null)
const cvOrtho = ref<HTMLCanvasElement | null>(null)
const glError = ref(false)
let panelP: Panel | null = null
let panelO: Panel | null = null
let raf = 0
let last = 0
let angle = 0

/** 近暖橙 → 远冷蓝：颜色随身空间深度实时混（线性插值）。 */
function depthColor(eyeZ: number): [number, number, number] {
  const u = Math.min(Math.max((-eyeZ - (DIST - 1)) / 2, 0), 1)
  const a: readonly [number, number, number] = [1.0, 0.62, 0.25]
  const b: readonly [number, number, number] = [0.36, 0.6, 1.0]
  return [
    a[0] + (b[0] - a[0]) * u,
    a[1] + (b[1] - a[1]) * u,
    a[2] + (b[2] - a[2]) * u,
  ]
}

function draw(panel: Panel, mvp: M4): void {
  const { gl } = panel
  gl.viewport(0, 0, W, H)
  gl.clearColor(0.05, 0.07, 0.09, 1)
  gl.clear(gl.COLOR_BUFFER_BIT)
  gl.uniformMatrix4fv(panel.mvpLoc, false, mvp)
  gl.drawArrays(gl.LINES, 0, EDGES.length * 2)
}

function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.05)
  if (last > 0 && spinning.value) angle += dt * 0.7
  last = now

  // 模型矩阵 M = T·Ry·Rx（坐标先过 Rx、再 Ry、最后 T 摆到 z=-4）
  const M = mMul(
    mTranslate(0, 0, -DIST),
    mMul(mRotY(angle), mRotX(angle * 0.62)),
  )

  // 按眼空间深度给 8 个顶点配色，顺带读出 w 的范围与裁剪状态
  const colors = new Float32Array(VERTS.length * 3)
  let minZ = -DIST
  let maxZ = -DIST
  for (let i = 0; i < VERTS.length; i++) {
    const e = xform(M, VERTS[i])
    minZ = Math.min(minZ, e[2])
    maxZ = Math.max(maxZ, e[2])
    const c = depthColor(e[2])
    colors[i * 3] = c[0]
    colors[i * 3 + 1] = c[1]
    colors[i * 3 + 2] = c[2]
  }
  wNear.value = -maxZ // 最近的顶点：w = -z 最小
  wFar.value = -minZ
  nearClip.value = maxZ > -near.value
  farClip.value = minZ < -far.value

  // 展开成边端点顺序的色数组（与顶点缓冲同一展开）
  const lineCols = new Float32Array(EDGES.length * 6)
  let k = 0
  for (const [a, b] of EDGES) {
    for (const i of [a, b]) {
      lineCols[k++] = colors[i * 3]
      lineCols[k++] = colors[i * 3 + 1]
      lineCols[k++] = colors[i * 3 + 2]
    }
  }

  const fovRad = (fovDeg.value * Math.PI) / 180
  // 左：透视帐篷。右：正交盒——在立方体中心深处（z=-DIST）与帐篷同截面
  const P = mPerspective(fovRad, aspect.value, near.value, far.value)
  const halfH = Math.tan(fovRad / 2) * DIST
  const halfW = halfH * aspect.value
  const O = mOrtho(-halfW, halfW, -halfH, halfH, near.value, far.value)

  if (panelP) {
    panelP.gl.bindBuffer(panelP.gl.ARRAY_BUFFER, panelP.colBuf)
    panelP.gl.bufferData(panelP.gl.ARRAY_BUFFER, lineCols, panelP.gl.DYNAMIC_DRAW)
    draw(panelP, mMul(P, M))
  }
  if (panelO) {
    panelO.gl.bindBuffer(panelO.gl.ARRAY_BUFFER, panelO.colBuf)
    panelO.gl.bufferData(panelO.gl.ARRAY_BUFFER, lineCols, panelO.gl.DYNAMIC_DRAW)
    draw(panelO, mMul(O, M))
  }
  raf = requestAnimationFrame(frame)
}

onMounted(() => {
  panelP = makePanel(cvPersp.value)
  panelO = makePanel(cvOrtho.value)
  if (!panelP || !panelO) {
    glError.value = true
    return
  }
  raf = requestAnimationFrame(frame)
})
onUnmounted(() => {
  cancelAnimationFrame(raf)
  for (const p of [panelP, panelO]) {
    if (!p) continue
    p.gl.getExtension('WEBGL_lose_context')?.loseContext()
  }
})
</script>

<template>
  <div class="demo-projection-compare">
    <div class="controls">
      <label>fov <input v-model.number="fovDeg" type="range" min="20" max="140" step="1"> <span class="val">{{ fovDeg }}°</span></label>
      <label>near <input v-model.number="near" type="range" min="0.5" max="5" step="0.1"> <span class="val">{{ near.toFixed(1) }}</span></label>
      <label>far <input v-model.number="far" type="range" min="4.5" max="20" step="0.5"> <span class="val">{{ far.toFixed(1) }}</span></label>
      <label>aspect <input v-model.number="aspect" type="range" min="0.5" max="2" step="0.01"> <span class="val">{{ aspect.toFixed(2) }}</span></label>
      <label class="toggle"><input v-model="spinning" type="checkbox"> 旋转</label>
    </div>
    <p v-if="glError" class="err">这个浏览器/环境拿不到 WebGL 上下文，演示无法启动。</p>
    <div class="panels" v-else>
      <div class="panel">
        <p class="panel-title">透视投影 perspective(fov, aspect, near, far)</p>
        <canvas ref="cvPersp" :width="W" :height="H"></canvas>
        <ul class="stats">
          <li>近面 <b>w = {{ wNear.toFixed(2) }}</b>、远面 <b>w = {{ wFar.toFixed(2) }}</b>（w = -z，透视除法除的就是它）。</li>
          <li>fov 拉大 = 广角镜头：立方体显得更远更小、边缘线条向中心收。</li>
          <li>near 拉到 3 以上：最前的角先进帐篷外（被 near 平面切掉）。</li>
        </ul>
      </div>
      <div class="panel">
        <p class="panel-title">正交投影 ortho(±halfW, ±halfH, near, far)</p>
        <canvas ref="cvOrtho" :width="W" :height="H"></canvas>
        <ul class="stats">
          <li><b>w 恒 1</b>——第 4 行是 (0,0,0,1)，透视除法除 1 原样。</li>
          <li>橙面与蓝面一样大：平行投影仪，远近不缩；对应边始终平行。</li>
          <li>正交盒与左边的帐篷在立方体中心深处取同一截面，对比才公平。</li>
        </ul>
      </div>
    </div>
    <p class="hint">
      橙 = 近（w 小）、蓝 = 远（w 大）。裁剪状态：
      <span :class="{ on: nearClip }">{{ nearClip ? 'near 正在切前角' : 'near 未切到' }}</span> ·
      <span :class="{ on: farClip }">{{ farClip ? 'far 正在切后角' : 'far 未切到' }}</span>
      （画布 400×300，aspect 滑杆偏离 1.33 时立方体会被压扁/拉宽——圆变椭圆的同款账）
    </p>
  </div>
</template>

<style scoped>
.demo-projection-compare {
  margin: 16px 0;
}
.controls {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 18px;
  color: #e6edf3;
  font-size: 13px;
  align-items: center;
}
.controls label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.controls .val {
  min-width: 44px;
  color: #79c0ff;
  font-variant-numeric: tabular-nums;
}
.panels {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  margin-top: 10px;
}
.panel {
  flex: 1 1 300px;
  border: 1px solid #30363d;
  border-radius: 8px;
  padding: 12px;
  background: #010409;
}
.panel-title {
  margin: 0 0 8px;
  font-weight: 600;
  color: #e6edf3;
  font-size: 14px;
}
canvas {
  width: 100%;
  height: auto;
  border-radius: 6px;
  display: block;
}
.stats {
  margin: 10px 0 0;
  padding-left: 18px;
  color: #8b949e;
  font-size: 13px;
  line-height: 1.7;
}
.stats b {
  color: #e6edf3;
  font-variant-numeric: tabular-nums;
}
.hint {
  margin: 10px 0 0;
  color: #8b949e;
  font-size: 12px;
}
.hint .on {
  color: #f0883e;
}
.err {
  color: #f85149;
  font-size: 13px;
}
</style>
