<script setup lang="ts">
// 用法示例（自包含演示）：轨道相机雏形 + MVP 三矩阵面板。
// 经度/纬度/半径三根滑杆驱动 eye（target 固定在原点）——相机沿球面绕场景
// 转，实时换视角。M、V、P 三个 4×4 数值面板实时显示（列主序标注）。up
// 倾斜滑杆把头顶方向绕视线转一个角度——画面跟着歪头。
// 演示自包含：内联与 companion/src/math/mat4.ts 同款的列主序算法，不
// import 实验场。深度测试第 8 章才讲：本演示全部画线框（LINES），线条
// 不靠遮挡关系成立，谁先画谁后画不打架。
import { computed, onMounted, onUnmounted, ref } from 'vue'

// ---------- 内联迷你 vec3（与 src/math/vec3.ts 同款约定） ----------
type V3 = readonly [number, number, number]

function vSub(b: V3, a: V3): [number, number, number] {
  return [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
}
function vDot(a: V3, b: V3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
function vCross(a: V3, b: V3): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]
}
function vNorm(v: V3): [number, number, number] {
  const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
  if (len === 0) return [0, 0, 0]
  return [v[0] / len, v[1] / len, v[2] / len]
}

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

function mIdentity(): M4 {
  const m = new Float32Array(16)
  m[0] = 1
  m[5] = 1
  m[10] = 1
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

/** 视图机器：与实验场 lookAt 同款——三根正交基 f/s/u 装旋转，第 4 列 = -R·eye。 */
function mLookAt(eye: V3, center: V3, up: V3): M4 {
  const f = vNorm(vSub(center, eye))
  const s = vNorm(vCross(f, up))
  const u = vCross(s, f)
  const m = new Float32Array(16)
  m[0] = s[0]
  m[1] = u[0]
  m[2] = -f[0]
  m[4] = s[1]
  m[5] = u[1]
  m[6] = -f[1]
  m[8] = s[2]
  m[9] = u[2]
  m[10] = -f[2]
  m[12] = -vDot(s, eye)
  m[13] = -vDot(u, eye)
  m[14] = vDot(f, eye)
  m[15] = 1
  return m
}

// ---------- 线框道具（盒子/四棱锥/地面网格，几何教学在第 8 章） ----------
function boxEdges(hx: number, hy: number, hz: number): number[] {
  const v: V3[] = [
    [-hx, -hy, -hz], [hx, -hy, -hz], [hx, hy, -hz], [-hx, hy, -hz],
    [-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz],
  ]
  const e: ReadonlyArray<readonly [number, number]> = [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ]
  const out: number[] = []
  for (const [a, b] of e) out.push(...v[a], ...v[b])
  return out
}

function pyramidEdges(half: number, height: number): number[] {
  const b: V3[] = [
    [-half, 0, -half], [half, 0, -half], [half, 0, half], [-half, 0, half],
  ]
  const apex: V3 = [0, height, 0]
  const out: number[] = []
  for (let i = 0; i < 4; i++) {
    out.push(...b[i], ...b[(i + 1) % 4]) // 底边一圈
    out.push(...b[i], ...apex) // 四条斜棱
  }
  return out
}

function gridLines(half: number, step: number): number[] {
  const out: number[] = []
  for (let i = -half; i <= half; i += step) {
    out.push(i, 0, -half, i, 0, half)
    out.push(-half, 0, i, half, 0, i)
  }
  return out
}

const W = 440
const H = 330
const TARGET: V3 = [0, 0, 0] // 轨道中心：永远看原点

// ---------- 滑杆状态 ----------
const lon = ref(35) // 经度：绕 Y 的水平角，0° = 相机在 +Z
const lat = ref(18) // 纬度：俯仰角，限 ±80°（90° 时 up 与视线平行，退化）
const radius = ref(10)
const tilt = ref(0) // up 倾斜：头顶方向绕视线转的角度（歪头）
const spin = ref(true)

/** 眼位：球坐标（经度/纬度/半径）→ 世界坐标。 */
const eyePos = computed<[number, number, number]>(() => {
  const lo = (lon.value * Math.PI) / 180
  const la = (lat.value * Math.PI) / 180
  const r = radius.value
  return [
    r * Math.cos(la) * Math.sin(lo),
    r * Math.sin(la),
    r * Math.cos(la) * Math.cos(lo),
  ]
})

/** 歪头后的 up：先把 (0,1,0) 扶正成相机的真头顶 u，再绕视线 f 转 tilt。 */
const upVec = computed<[number, number, number]>(() => {
  const f = vNorm(vSub(TARGET, eyePos.value))
  const s = vNorm(vCross(f, [0, 1, 0]))
  const u = vCross(s, f)
  const t = (tilt.value * Math.PI) / 180
  return [
    u[0] * Math.cos(t) + s[0] * Math.sin(t),
    u[1] * Math.cos(t) + s[1] * Math.sin(t),
    u[2] * Math.cos(t) + s[2] * Math.sin(t),
  ]
})

const viewMat = computed<M4>(() => mLookAt(eyePos.value, TARGET, upVec.value))
const projMat = computed<M4>(() => mPerspective((60 * Math.PI) / 180, W / H, 0.5, 60))
const matM = ref<M4>(mTranslate(0, 0.75, 0)) // 主角立方体的模型矩阵（每帧更新）

// ---------- WebGL 装配 ----------
const VS = `
attribute vec3 a_position;
uniform mat4 u_mvp;
void main() {
  gl_Position = u_mvp * vec4(a_position, 1.0);
}
`
const FS = `
precision mediump float;
uniform vec3 u_color;
void main() {
  gl_FragColor = vec4(u_color, 1.0);
}
`

interface Obj {
  verts: number[]
  color: readonly [number, number, number]
  model: () => M4
  hero: boolean
  buf: WebGLBuffer | null
  count: number
}

const cv = ref<HTMLCanvasElement | null>(null)
const glError = ref(false)
let gl: WebGLRenderingContext | null = null
let mvpLoc: WebGLUniformLocation | null = null
let colLoc: WebGLUniformLocation | null = null
let objects: Obj[] = []
let raf = 0
let last = 0
let angle = 0

/** 面板取数：数学排布第 row 行第 col 列 = 数组第 col*4+row 个数（列主序）。 */
function fmt(m: M4, row: number, col: number): string {
  return m[col * 4 + row].toFixed(2)
}

onMounted(() => {
  const ctx = cv.value?.getContext('webgl', { antialias: true })
  if (!ctx) {
    glError.value = true
    return
  }
  gl = ctx
  const compile = (type: number, src: string): WebGLShader | null => {
    const sh = gl!.createShader(type)
    if (!sh) return null
    gl!.shaderSource(sh, src)
    gl!.compileShader(sh)
    return sh
  }
  const vs = compile(gl.VERTEX_SHADER, VS)
  const fs = compile(gl.FRAGMENT_SHADER, FS)
  const prog = gl.createProgram()
  if (!vs || !fs || !prog) {
    glError.value = true
    return
  }
  gl.attachShader(prog, vs)
  gl.attachShader(prog, fs)
  gl.linkProgram(prog)
  gl.useProgram(prog)
  const aPos = gl.getAttribLocation(prog, 'a_position')
  gl.enableVertexAttribArray(aPos)
  mvpLoc = gl.getUniformLocation(prog, 'u_mvp')
  colLoc = gl.getUniformLocation(prog, 'u_color')

  objects = [
    // 地面网格：M = 单位阵（顶点本来就按世界坐标手摆）
    { verts: gridLines(4, 1), color: [0.32, 0.36, 0.42], model: mIdentity, hero: false, buf: null, count: 0 },
    // 主角立方体：M = T·Ry——自转开着时 M 面板每帧都在变
    { verts: boxEdges(0.75, 0.75, 0.75), color: [1.0, 0.62, 0.25], model: () => mMul(mTranslate(0, 0.75, 0), mRotY(angle)), hero: true, buf: null, count: 0 },
    // 青色四棱锥
    { verts: pyramidEdges(0.7, 1.4), color: [0.36, 0.8, 0.85], model: () => mTranslate(-2.5, 0, -1.5), hero: false, buf: null, count: 0 },
    // 紫色立柱
    { verts: boxEdges(0.25, 1, 0.25), color: [0.75, 0.6, 1.0], model: () => mTranslate(2.5, 1, -2.5), hero: false, buf: null, count: 0 },
    // 绿色小锥：站在 z=+5——默认相机（原点朝 -Z）看不到的那位
    { verts: pyramidEdges(0.4, 0.9), color: [0.5, 0.9, 0.45], model: () => mTranslate(1.8, 0, 5), hero: false, buf: null, count: 0 },
  ]
  for (const o of objects) {
    o.buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, o.buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(o.verts), gl.STATIC_DRAW)
    o.count = o.verts.length / 3
  }

  const frame = (now: number): void => {
    const dt = Math.min((now - last) / 1000, 0.05)
    if (last > 0 && spin.value) angle += dt * 0.5
    last = now
    gl!.viewport(0, 0, W, H)
    gl!.clearColor(0.05, 0.07, 0.09, 1)
    gl!.clear(gl!.COLOR_BUFFER_BIT)
    for (const o of objects) {
      const M = o.model()
      if (o.hero) matM.value = M
      // 三台机器串联：坐标先过 M、再过 V、最后过 P（与 multiply 约定一致）
      const mvp = mMul(projMat.value, mMul(viewMat.value, M))
      gl!.uniformMatrix4fv(mvpLoc, false, mvp)
      gl!.uniform3f(colLoc, o.color[0], o.color[1], o.color[2])
      gl!.bindBuffer(gl.ARRAY_BUFFER, o.buf)
      gl!.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0)
      gl!.drawArrays(gl.LINES, 0, o.count)
    }
    raf = requestAnimationFrame(frame)
  }
  raf = requestAnimationFrame(frame)
})
onUnmounted(() => {
  cancelAnimationFrame(raf)
  gl?.getExtension('WEBGL_lose_context')?.loseContext()
})
</script>

<template>
  <div class="demo-lookat">
    <div class="controls">
      <label>经度 <input v-model.number="lon" type="range" min="-180" max="180" step="1"> <span class="val">{{ lon }}°</span></label>
      <label>纬度 <input v-model.number="lat" type="range" min="-80" max="80" step="1"> <span class="val">{{ lat }}°</span></label>
      <label>半径 <input v-model.number="radius" type="range" min="4" max="24" step="0.5"> <span class="val">{{ radius.toFixed(1) }}</span></label>
      <label>歪头 <input v-model.number="tilt" type="range" min="-75" max="75" step="1"> <span class="val">{{ tilt }}°</span></label>
      <label class="toggle"><input v-model="spin" type="checkbox"> 立方体自转</label>
    </div>
    <p v-if="glError" class="err">这个浏览器/环境拿不到 WebGL 上下文，演示无法启动。</p>
    <template v-else>
      <canvas ref="cv" :width="W" :height="H"></canvas>
      <ul class="stats">
        <li>eye = ({{ eyePos.map((v) => v.toFixed(2)).join(', ') }})，up = ({{ upVec.map((v) => v.toFixed(2)).join(', ') }})，target 固定 (0, 0, 0)——经度/纬度/半径推着眼位走球面，轨道雏形。</li>
        <li>V 面板最右一列（第 4 列）= −R·eye：把相机搬回原点的那三个数，随滑杆实时变。</li>
        <li>绿色小锥站在 z=+5：默认相机（原点朝 -Z）时它在背后，什么也看不见；现在绕轨道一圈，哪一面都看得见。</li>
      </ul>
      <div class="panels">
        <div class="mat-panel">
          <p class="mat-title">M 模型矩阵（主角立方体）</p>
          <table class="mat">
            <tr v-for="row in 4" :key="row">
              <td v-for="col in 4" :key="col">{{ fmt(matM, row - 1, col - 1) }}</td>
            </tr>
          </table>
          <p class="mat-note">T·Ry：自转时每帧变</p>
        </div>
        <div class="mat-panel">
          <p class="mat-title">V 视图矩阵</p>
          <table class="mat">
            <tr v-for="row in 4" :key="row">
              <td v-for="col in 4" :key="col">{{ fmt(viewMat, row - 1, col - 1) }}</td>
            </tr>
          </table>
          <p class="mat-note">lookAt(eye, 原点, up)</p>
        </div>
        <div class="mat-panel">
          <p class="mat-title">P 投影矩阵</p>
          <table class="mat">
            <tr v-for="row in 4" :key="row">
              <td v-for="col in 4" :key="col">{{ fmt(projMat, row - 1, col - 1) }}</td>
            </tr>
          </table>
          <p class="mat-note">fov 60°、near 0.5、far 60</p>
        </div>
      </div>
      <p class="hint">
        三个面板按数学排布显示、并按 M、V、P 顺序并排；数组本身是列主序——面板第 1 列的 4 个数 = 数组前 4 个数。
        歪头滑杆绕视线转 up：画面整个跟着转（V 的旋转部分在变，P 不动）。
        纬度被限制在 ±80°：拉到 90° 时 up=(0,1,0) 与视线平行，lookAt 退化、画面消失——正文「为什么崩」一节手算过这笔账。
      </p>
    </template>
  </div>
</template>

<style scoped>
.demo-lookat {
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
canvas {
  width: 100%;
  max-width: 440px;
  height: auto;
  border-radius: 6px;
  display: block;
  margin-top: 10px;
}
.stats {
  margin: 10px 0 0;
  padding-left: 18px;
  color: #8b949e;
  font-size: 13px;
  line-height: 1.7;
}
.panels {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 12px;
}
.mat-panel {
  flex: 1 1 170px;
  border: 1px solid #30363d;
  border-radius: 8px;
  padding: 10px;
  background: #010409;
}
.mat-title {
  margin: 0 0 6px;
  font-weight: 600;
  color: #e6edf3;
  font-size: 13px;
}
.mat {
  border-collapse: collapse;
  font-family: ui-monospace, monospace;
  font-size: 12px;
  color: #79c0ff;
}
.mat td {
  padding: 2px 7px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  min-width: 52px;
}
.mat-note {
  margin: 6px 0 0;
  color: #8b949e;
  font-size: 12px;
}
.hint {
  margin: 10px 0 0;
  color: #8b949e;
  font-size: 12px;
}
.err {
  color: #f85149;
  font-size: 13px;
}
</style>
