<script setup lang="ts">
// 用法示例（自包含演示）：轨道相机与漫游相机，同一场景两块画布。
// 左画布＝轨道：拖拽改方位角/极角、滚轮改半径（球坐标出眼位，target 固定，
// 极角收进 [1°, 90°]）。右画布＝漫游：WASD/方向键沿相机自己的前/右基向量
// 移动（增量时间缩放），拖拽改 yaw/pitch；「错误顺序」开关把 pitch 挪到
// 世界 X 轴上（R_x·R_y），复刻开章「拖过 180° 后垂直拖动方向反转」的翻车。
// 演示自包含：内联与 companion/src/scene/camera.ts 同款算法，不 import
// 实验场。物体为固定面色深浅的实心方块（无光照），遮挡由深度测试把关。
import { onMounted, onUnmounted, ref } from 'vue'

// ---------- 内联迷你 vec3（与 src/math/vec3.ts 同款约定） ----------
type V3 = readonly [number, number, number]

function vAdd(a: V3, b: V3): [number, number, number] {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}
function vSub(b: V3, a: V3): [number, number, number] {
  return [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
}
function vScale(v: V3, k: number): [number, number, number] {
  return [v[0] * k, v[1] * k, v[2] * k]
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
const rad = (deg: number): number => (deg * Math.PI) / 180
const clampDeg = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)

// ---------- 内联相机（与 src/scene/camera.ts 同款约定：度数进、手性同 rotY） ----------

/** 球坐标 → 轨道眼位：方位角绕 Y（0°=+Z、90°=+X），极角从 +Y 量起，收进 [1°, 90°]。 */
function orbitEyeDemo(azDeg: number, polDeg: number, r: number, target: V3): V3 {
  const az = rad(azDeg)
  const po = rad(clampDeg(polDeg, 1, 90))
  return [
    target[0] + r * Math.sin(po) * Math.sin(az),
    target[1] + r * Math.cos(po),
    target[2] + r * Math.sin(po) * Math.cos(az),
  ]
}

/** yaw/pitch → 相机基向量：先 pitch 后 yaw 的固定顺序（R_y·R_x·(0,0,-1)）。 */
function viewBasisDemo(yawDeg: number, pitchDeg: number): { forward: V3; right: V3; up: V3 } {
  const yaw = rad(yawDeg)
  const pitch = rad(clampDeg(pitchDeg, -89, 89))
  const forward: V3 = [
    -Math.cos(pitch) * Math.sin(yaw),
    Math.sin(pitch),
    -Math.cos(pitch) * Math.cos(yaw),
  ]
  const right = vNorm(vCross(forward, [0, 1, 0]))
  const up = vCross(right, forward)
  return { forward, right, up }
}

/** 痛点复刻：把 pitch 挪到世界 X 轴（R_x·R_y·(0,0,-1)）——转身后「点头」就翻车。 */
function wrongBasis(yawDeg: number, pitchDeg: number): { forward: V3; right: V3; up: V3 } {
  const yaw = rad(yawDeg)
  const pitch = rad(clampDeg(pitchDeg, -89, 89))
  const forward: V3 = [-Math.sin(yaw), Math.sin(pitch) * Math.cos(yaw), -Math.cos(pitch) * Math.cos(yaw)]
  const right = vNorm(vCross(forward, [0, 1, 0]))
  const up = vCross(right, forward)
  return { forward, right, up }
}

// ---------- 内联迷你 mat4（与 src/math/mat4.ts 同款，列主序） ----------
type M4 = Float32Array

function mMul(a: M4, b: M4): M4 {
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

// ---------- 场景道具：地面网格 + 实心方块（pos3 + color3 交错，固定面色深浅） ----------
function gridVerts(half: number, step: number): number[] {
  const out: number[] = []
  const c = 0.3
  for (let i = -half; i <= half; i += step) {
    out.push(i, 0, -half, c, c, c + 0.06, i, 0, half, c, c, c + 0.06)
    out.push(-half, 0, i, c, c, c + 0.06, half, 0, i, c, c, c + 0.06)
  }
  return out
}

/** 实心方块 36 顶点：六个面各配固定深浅（无光照，深浅只为看清棱角与遮挡）。 */
function boxVerts(hx: number, hy: number, hz: number, base: readonly [number, number, number]): number[] {
  // 每面：从外看逆时针四角 + 该面的明暗系数（顶 1.0、+Z 0.85、+X 0.7、
  // -X 0.55、-Z 0.45、底 0.35）——缠绕方向与背面剔除第 8 章的账一致。
  const faces: { n: V3; v: V3[]; k: number }[] = [
    { n: [0, 1, 0], v: [[-hx, hy, hz], [-hx, hy, -hz], [hx, hy, -hz], [hx, hy, hz]], k: 1.0 },
    { n: [0, 0, 1], v: [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]], k: 0.85 },
    { n: [1, 0, 0], v: [[hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz]], k: 0.7 },
    { n: [-1, 0, 0], v: [[-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz]], k: 0.55 },
    { n: [0, 0, -1], v: [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]], k: 0.45 },
    { n: [0, -1, 0], v: [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz]], k: 0.35 },
  ]
  const out: number[] = []
  for (const f of faces) {
    const idx = [0, 1, 2, 0, 2, 3]
    for (const i of idx) {
      out.push(f.v[i][0], f.v[i][1], f.v[i][2], base[0] * f.k, base[1] * f.k, base[2] * f.k)
    }
  }
  return out
}

// 两块画布共享同一场景（各自一份顶点数据，内容一致）
interface Prop {
  verts: number[]
  model: M4
  buf: WebGLBuffer | null
  count: number
  mode: number
}
const SCENE: { verts: number[]; at: V3; color: readonly [number, number, number] }[] = [
  { verts: boxVerts(0.75, 0.75, 0.75, [1.0, 0.62, 0.25]), at: [0, 0.75, 0], color: [1.0, 0.62, 0.25] },
  { verts: boxVerts(0.35, 1.25, 0.35, [0.36, 0.8, 0.85]), at: [2.6, 1.25, -2.5], color: [0.36, 0.8, 0.85] },
  { verts: boxVerts(0.9, 0.4, 0.9, [0.75, 0.6, 1.0]), at: [-2.6, 0.4, -1.5], color: [0.75, 0.6, 1.0] },
  { verts: boxVerts(1.5, 0.55, 0.5, [0.5, 0.9, 0.45]), at: [0, 0.55, 5], color: [0.5, 0.9, 0.45] },
]

const W = 430
const H = 310
const ORBIT_TARGET: V3 = [0, 0.8, 0]

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

// ---------- 相机状态与读数 ----------
const az = ref(35)
const pol = ref(65)
const radius = ref(10)
const yaw = ref(0)
const pitch = ref(0)
const walkEye = ref<[number, number, number]>([0, 1.6, 7])
const wrongOrder = ref(false)
const walkHover = ref(false)
const glError = ref(false)

function resetOrbit(): void {
  az.value = 35
  pol.value = 65
  radius.value = 10
}
function resetWalk(): void {
  yaw.value = 0
  pitch.value = 0
  walkEye.value = [0, 1.6, 7]
}
const fmt3 = (v: V3): string => v.map((x) => x.toFixed(2)).join(', ')

// ---------- WebGL 装配（两块画布各一个上下文，共用一份着色器源码） ----------
const orbitCv = ref<HTMLCanvasElement | null>(null)
const walkCv = ref<HTMLCanvasElement | null>(null)
let raf = 0
let last = 0
const keys = new Set<string>()

interface Viewport {
  gl: WebGLRenderingContext
  props: Prop[]
  mvpLoc: WebGLUniformLocation | null
  aPos: number
  aCol: number
}

function makeViewport(gl: WebGLRenderingContext): Viewport {
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
  if (!vs || !fs || !prog) throw new Error('shader')
  gl.attachShader(prog, vs)
  gl.attachShader(prog, fs)
  gl.linkProgram(prog)
  gl.useProgram(prog)
  const aPos = gl.getAttribLocation(prog, 'a_position')
  const aCol = gl.getAttribLocation(prog, 'a_color')
  gl.enableVertexAttribArray(aPos)
  gl.enableVertexAttribArray(aCol)
  const mvpLoc = gl.getUniformLocation(prog, 'u_mvp')
  const props: Prop[] = [
    { verts: gridVerts(8, 1), model: mTranslate(0, 0, 0), buf: null, count: 0, mode: gl.LINES },
    ...SCENE.map((o) => ({
      verts: o.verts,
      model: mTranslate(o.at[0], o.at[1], o.at[2]),
      buf: null as WebGLBuffer | null,
      count: 0,
      mode: gl.TRIANGLES,
    })),
  ]
  for (const p of props) {
    p.buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, p.buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(p.verts), gl.STATIC_DRAW)
    p.count = p.verts.length / 6
  }
  return { gl, props, mvpLoc, aPos, aCol }
}

function draw(vp: Viewport | null, view: M4, proj: M4): void {
  if (!vp) return
  const { gl, props, mvpLoc, aPos, aCol } = vp
  gl.viewport(0, 0, W, H)
  gl.clearColor(0.05, 0.07, 0.09, 1)
  gl.enable(gl.DEPTH_TEST)
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
  const pv = mMul(proj, view)
  for (const p of props) {
    gl.uniformMatrix4fv(mvpLoc, false, mMul(pv, p.model))
    gl.bindBuffer(gl.ARRAY_BUFFER, p.buf)
    // 取料格式固定：pos3 + color3 交错，步长 24 字节，color 偏移 12 字节
    gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 24, 0)
    gl.vertexAttribPointer(aCol, 3, gl.FLOAT, false, 24, 12)
    gl.drawArrays(p.mode, 0, p.count)
  }
}

let orbitVp: Viewport | null = null
let walkVp: Viewport | null = null

onMounted(() => {
  const g1 = orbitCv.value?.getContext('webgl', { antialias: true })
  const g2 = walkCv.value?.getContext('webgl', { antialias: true })
  if (!g1 || !g2) {
    glError.value = true
    return
  }
  orbitVp = makeViewport(g1)
  walkVp = makeViewport(g2)

  const proj = mPerspective(rad(60), W / H, 0.1, 80)

  // 轨道画布：拖拽改角度、滚轮改半径
  const oc = orbitCv.value!
  let dragging = false
  let lx = 0
  let ly = 0
  oc.addEventListener('pointerdown', (e) => {
    dragging = true
    lx = e.clientX
    ly = e.clientY
    oc.setPointerCapture(e.pointerId)
  })
  oc.addEventListener('pointermove', (e) => {
    if (!dragging) return
    az.value -= (e.clientX - lx) * 0.4
    // 极角当场收进 [1°, 90°]（读数所见即所得；orbitEyeDemo 内还会再收一次）
    pol.value = Math.min(90, Math.max(1, pol.value + (e.clientY - ly) * 0.4))
    lx = e.clientX
    ly = e.clientY
  })
  oc.addEventListener('pointerup', () => {
    dragging = false
  })
  oc.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault()
      radius.value = Math.min(30, Math.max(3, radius.value * Math.exp(-e.deltaY * 0.001)))
    },
    { passive: false },
  )

  // 漫游画布：悬停接管键盘，拖拽改 yaw/pitch
  const wc = walkCv.value!
  wc.addEventListener('pointerenter', () => {
    walkHover.value = true
  })
  wc.addEventListener('pointerleave', () => {
    walkHover.value = false
  })
  let wdrag = false
  wc.addEventListener('pointerdown', (e) => {
    wdrag = true
    lx = e.clientX
    ly = e.clientY
    wc.setPointerCapture(e.pointerId)
  })
  wc.addEventListener('pointermove', (e) => {
    if (!wdrag) return
    yaw.value -= (e.clientX - lx) * 0.25
    // 俯仰角当场收进 ±89°（读数所见即所得；viewBasisDemo 内还会再收一次）
    pitch.value = Math.min(89, Math.max(-89, pitch.value - (e.clientY - ly) * 0.25))
    lx = e.clientX
    ly = e.clientY
  })
  wc.addEventListener('pointerup', () => {
    wdrag = false
  })

  const onKeyDown = (e: KeyboardEvent): void => {
    if (!walkHover.value) return
    keys.add(e.code)
    if (e.code.startsWith('Arrow')) e.preventDefault()
  }
  const onKeyUp = (e: KeyboardEvent): void => {
    keys.delete(e.code)
  }
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)

  const frame = (now: number): void => {
    const dt = Math.min((now - last) / 1000, 0.05)
    if (last > 0) {
      // 漫游移动：沿相机自己的前/右基向量，步长用增量时间缩放（第 3 章）
      const basis = wrongOrder.value
        ? wrongBasis(yaw.value, pitch.value)
        : viewBasisDemo(yaw.value, pitch.value)
      const step = 3 * dt
      let move: [number, number, number] = [0, 0, 0]
      if (keys.has('KeyW') || keys.has('ArrowUp')) move = vAdd(move, vScale(basis.forward, step))
      if (keys.has('KeyS') || keys.has('ArrowDown')) move = vAdd(move, vScale(basis.forward, -step))
      if (keys.has('KeyD') || keys.has('ArrowRight')) move = vAdd(move, vScale(basis.right, step))
      if (keys.has('KeyA') || keys.has('ArrowLeft')) move = vAdd(move, vScale(basis.right, -step))
      walkEye.value = vAdd(walkEye.value, move)
    }
    last = now

    // 轨道：球坐标出眼位，target 固定交给 lookAt（第 7 章的机器）
    const eye = orbitEyeDemo(az.value, pol.value, radius.value, ORBIT_TARGET)
    const vOrbit = mLookAt(eye, ORBIT_TARGET, [0, 1, 0])
    draw(orbitVp, vOrbit, proj)

    // 漫游：基向量出朝向，center = eye + forward，up 用基向量的 up
    const basis = wrongOrder.value
      ? wrongBasis(yaw.value, pitch.value)
      : viewBasisDemo(yaw.value, pitch.value)
    const vWalk = mLookAt(walkEye.value, vAdd(walkEye.value, basis.forward), basis.up)
    draw(walkVp, vWalk, proj)

    raf = requestAnimationFrame(frame)
  }
  raf = requestAnimationFrame(frame)

  removeKeys = () => {
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
  }
})

let removeKeys: (() => void) | null = null
onUnmounted(() => {
  cancelAnimationFrame(raf)
  removeKeys?.()
  removeKeys = null
  orbitVp?.gl.getExtension('WEBGL_lose_context')?.loseContext()
  walkVp?.gl.getExtension('WEBGL_lose_context')?.loseContext()
})
</script>

<template>
  <div class="demo-orbitwalk">
    <p v-if="glError" class="err">这个浏览器/环境拿不到 WebGL 上下文，演示无法启动。</p>
    <template v-else>
      <div class="panes">
        <div class="pane">
          <p class="pane-title">轨道模式：拖拽转向 · 滚轮缩放</p>
          <canvas ref="orbitCv" :width="W" :height="H" class="cv"></canvas>
          <ul class="stats">
            <li>方位角 {{ az.toFixed(1) }}° · 极角 {{ pol.toFixed(1) }}° · 半径 {{ radius.toFixed(2) }}</li>
            <li>eye = ({{ fmt3(orbitEyeDemo(az, pol, radius, ORBIT_TARGET)) }})，target 固定 (0, 0.8, 0)</li>
          </ul>
          <button class="btn" @click="resetOrbit">复位轨道</button>
        </div>
        <div class="pane">
          <p class="pane-title">漫游模式：WASD / 方向键移动 · 拖拽转头</p>
          <canvas ref="walkCv" :width="W" :height="H" class="cv" :class="{ hot: walkHover }"></canvas>
          <ul class="stats">
            <li>yaw {{ yaw.toFixed(1) }}° · pitch {{ pitch.toFixed(1) }}°</li>
            <li>eye = ({{ fmt3(walkEye) }})</li>
          </ul>
          <div class="walkrow">
            <label class="toggle"><input v-model="wrongOrder" type="checkbox"> 错误顺序（世界轴点头）</label>
            <button class="btn" @click="resetWalk">复位漫游</button>
          </div>
        </div>
      </div>
      <p class="hint">
        两块画布共享同一场景：地面网格加四个实心方块（固定面色深浅、无光照），遮挡由深度测试把关。
        轨道画布按住拖拽改变方位角与极角（极角自动收进 [1°, 90°]，穿不过极点也钻不进地下），滚轮沿视线进退（改半径）。
        漫游画布鼠标悬停后接管键盘：W/S 沿 forward、A/D 沿 right（增量时间缩放，抬着头按 W 会离地——移动严格沿基向量）。
        勾选「错误顺序」复刻开章翻车：先水平拖过 180°，再垂直拖动，画面朝反方向转。
      </p>
    </template>
  </div>
</template>

<style scoped>
.demo-orbitwalk {
  margin: 16px 0;
}
.panes {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
}
.pane {
  flex: 1 1 320px;
  min-width: 0;
}
.pane-title {
  margin: 0 0 6px;
  color: #e6edf3;
  font-size: 13px;
  font-weight: 600;
}
.cv {
  width: 100%;
  max-width: 430px;
  height: auto;
  border-radius: 6px;
  display: block;
  border: 1px solid #30363d;
  cursor: grab;
  touch-action: none;
}
.cv.hot {
  border-color: #79c0ff;
}
.stats {
  margin: 8px 0 0;
  padding-left: 18px;
  color: #8b949e;
  font-size: 13px;
  line-height: 1.7;
  font-variant-numeric: tabular-nums;
}
.btn {
  margin-top: 8px;
  background: #21262d;
  color: #e6edf3;
  border: 1px solid #30363d;
  border-radius: 6px;
  padding: 4px 12px;
  font-size: 12px;
  cursor: pointer;
}
.btn:hover {
  border-color: #79c0ff;
}
.walkrow {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 8px;
}
.toggle {
  color: #e6edf3;
  font-size: 13px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.hint {
  margin: 12px 0 0;
  color: #8b949e;
  font-size: 12px;
  line-height: 1.7;
}
.err {
  color: #f85149;
  font-size: 13px;
}
</style>
