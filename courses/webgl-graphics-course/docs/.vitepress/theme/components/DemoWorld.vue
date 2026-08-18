<script setup lang="ts">
// 用法示例（自包含演示）：全书终点——一个可漫游的 3D 小世界。
// 结构与 companion/src/world/world.ts 的 createWorld 同款（组件内联，不 import
// 实验场）：mulberry32 种子随机数驱动「地面 + 自发光太阳 + 柱廊 + 房子」的
// 程序化布局，每件物体挂 Phong 材质参数包（baseColor/ambient/diffuseK/
// specularK/shininess/emissive）；渲染走「渲染清单」——遍历收集 (mesh,
// world, material) 三元组，一个循环统一画（drawElements + 深度测试 +
// 背面剔除）。片元着色器里三步收尾：Phong 三件套 → 自发光 → 距离雾
// mix(lit, fogColor, smoothstep(near, far, dist))。
// 交互：WASD/方向键沿相机基向量漫游（悬停接管键盘）、拖拽转头（先 pitch
// 后 yaw）、滚轮调移动速度、白天/夜晚切换（太阳光强+环境光+雾色+自发光
// 一起沿 lerp 渐变）、「换个种子」按种子重建整个世界。
// 零外部资源：几何、地面格子纹理全部程序化生成；SSG 安全（GL 全在
// onMounted 内，onUnmounted 清理）。移动端降级：不依赖键盘也能拖拽漫游
// 观景，绘制量十几个 draw call。
import { onMounted, onUnmounted, ref } from 'vue'

// ---------- 内联迷你 vec3 / mat4（与 src/math/vec3.ts、mat4.ts 同款约定） ----------
type V3 = readonly [number, number, number]
type M4 = Float32Array

function vAdd(a: V3, b: V3): [number, number, number] {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}
function vCross(a: V3, b: V3): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}
function vNorm(v: V3): [number, number, number] {
  const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
  if (len === 0) return [0, 0, 0]
  return [v[0] / len, v[1] / len, v[2] / len]
}
const rad = (deg: number): number => (deg * Math.PI) / 180
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

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
function mScale(sx: number, sy: number, sz: number): M4 {
  const m = new Float32Array(16)
  m[0] = sx
  m[5] = sy
  m[10] = sz
  m[15] = 1
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
  const f = vNorm([center[0] - eye[0], center[1] - eye[1], center[2] - eye[2]])
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
  m[12] = -(s[0] * eye[0] + s[1] * eye[1] + s[2] * eye[2])
  m[13] = -(u[0] * eye[0] + u[1] * eye[1] + u[2] * eye[2])
  m[14] = f[0] * eye[0] + f[1] * eye[1] + f[2] * eye[2]
  m[15] = 1
  return m
}
/** 模型矩阵左上 3×3 的逆转置（与 src/math/mat4.ts normalFromMat4 同款：余子式 ÷ 行列式）。 */
function mNormalFrom(m: M4): M4 {
  const a11 = m[0]
  const a12 = m[4]
  const a13 = m[8]
  const a21 = m[1]
  const a22 = m[5]
  const a23 = m[9]
  const a31 = m[2]
  const a32 = m[6]
  const a33 = m[10]
  const det =
    a11 * (a22 * a33 - a23 * a32) - a12 * (a21 * a33 - a23 * a31) + a13 * (a21 * a32 - a22 * a31)
  const out = new Float32Array(16)
  out[0] = (a22 * a33 - a23 * a32) / det
  out[4] = -(a21 * a33 - a23 * a31) / det
  out[8] = (a21 * a32 - a22 * a31) / det
  out[1] = -(a12 * a33 - a13 * a32) / det
  out[5] = (a11 * a33 - a13 * a31) / det
  out[9] = -(a11 * a32 - a12 * a31) / det
  out[2] = (a12 * a23 - a13 * a22) / det
  out[6] = -(a11 * a23 - a13 * a21) / det
  out[10] = (a11 * a22 - a12 * a21) / det
  out[15] = 1
  return out
}

// ---------- 内联漫游相机（与 src/scene/camera.ts viewBasis 同款：先 pitch 后 yaw） ----------
function viewBasisDemo(yawDeg: number, pitchDeg: number): { forward: V3; right: V3; up: V3 } {
  const yaw = rad(yawDeg)
  const pitch = rad(clamp(pitchDeg, -89, 89))
  const forward: V3 = [-Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), -Math.cos(pitch) * Math.cos(yaw)]
  const right = vNorm(vCross(forward, [0, 1, 0]))
  const up = vCross(right, forward)
  return { forward, right, up }
}

// ---------- 内联种子随机数与材质（与 src/world/world.ts 同款约定） ----------
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Mat {
  baseColor: V3
  ambient: number
  diffuseK: number
  specularK: number
  shininess: number
  emissive: number
}
interface Item {
  local: M4
  material: Mat
  texMix: number // 只有地面用格子纹理调亮，其余 0
}
interface WorldDemo {
  items: Item[]
  sunPosition: V3
  entry: { eye: V3; yawDeg: number; pitchDeg: number }
  fog: { color: V3; near: number; far: number }
}

const GROUND_HALF = 20
const FOG_NEAR = 8
const FOG_FAR = 28
const DAY_FOG: V3 = [0.75, 0.82, 0.9]
const NIGHT_FOG: V3 = [0.04, 0.06, 0.12]

const GROUND_MATERIAL: Mat = { baseColor: [0.3, 0.55, 0.28], ambient: 0.35, diffuseK: 0.8, specularK: 0.05, shininess: 8, emissive: 0 }
const STONE_MATERIAL: Mat = { baseColor: [0.62, 0.6, 0.57], ambient: 0.3, diffuseK: 0.85, specularK: 0.1, shininess: 16, emissive: 0 }
const SUN_MATERIAL: Mat = { baseColor: [1.0, 0.85, 0.45], ambient: 0, diffuseK: 0, specularK: 0, shininess: 1, emissive: 1 }
const HOUSE_PALETTE: Mat[] = [
  { baseColor: [0.82, 0.42, 0.32], ambient: 0.3, diffuseK: 0.7, specularK: 0.25, shininess: 32, emissive: 0 },
  { baseColor: [0.36, 0.55, 0.78], ambient: 0.3, diffuseK: 0.7, specularK: 0.25, shininess: 32, emissive: 0 },
  { baseColor: [0.8, 0.72, 0.4], ambient: 0.3, diffuseK: 0.7, specularK: 0.2, shininess: 24, emissive: 0 },
  { baseColor: [0.55, 0.42, 0.66], ambient: 0.3, diffuseK: 0.7, specularK: 0.3, shininess: 48, emissive: 0 },
]

/** createWorld 的演示内联版：同一段布局代码、同一个种子数——同种子同世界。 */
function createWorldDemo(seed: number): WorldDemo {
  const rng = mulberry32(seed)
  const items: Item[] = []
  // 地面：cube 压扁成 40×40 地坪，顶面 y=0；唯一用格子纹理的物体。
  items.push({
    local: mMul(mTranslate(0, -0.5, 0), mScale(GROUND_HALF, 0.5, GROUND_HALF)),
    material: GROUND_MATERIAL,
    texMix: 1,
  })
  // 太阳：位置由种子定（高 10..16、水平距 15..23），自发光——它自己亮。
  const sunAz = rad(rng() * 360)
  const sunDist = 15 + rng() * 8
  const sunHeight = 10 + rng() * 6
  const sunPosition: V3 = [Math.sin(sunAz) * sunDist, sunHeight, Math.cos(sunAz) * sunDist]
  items.push({
    local: mMul(mTranslate(sunPosition[0], sunPosition[1], sunPosition[2]), mScale(1.4, 1.4, 1.4)),
    material: SUN_MATERIAL,
    texMix: 0,
  })
  // 柱廊：7..11 根石柱排成圆弧，共享同一份石头材质（改一处全体变）。
  const columnCount = 7 + Math.floor(rng() * 5)
  const arcadeAzDeg = rng() * 360
  const arcadeRadius = 6 + rng() * 4
  for (let i = 0; i < columnCount; i++) {
    const angle = rad(arcadeAzDeg + (i - (columnCount - 1) / 2) * 6)
    const radius = arcadeRadius + (rng() - 0.5) * 0.8
    const height = 2.5 + rng() * 2
    items.push({
      local: mMul(
        mTranslate(Math.sin(angle) * radius, height / 2, Math.cos(angle) * radius),
        mScale(0.55, height / 2, 0.55),
      ),
      material: STONE_MATERIAL,
      texMix: 0,
    })
  }
  // 房子：3..6 栋散在外圈，从四份现成材质里挑一份。
  const houseCount = 3 + Math.floor(rng() * 4)
  for (let i = 0; i < houseCount; i++) {
    const angle = rad(rng() * 360)
    const radius = 9 + rng() * 7
    const halfW = 1.5 + rng() * 1.5
    const halfD = 1.5 + rng() * 1.5
    const height = 2.4 + rng() * 3.6
    items.push({
      local: mMul(
        mTranslate(Math.sin(angle) * radius, height / 2, Math.cos(angle) * radius),
        mScale(halfW, height / 2, halfD),
      ),
      material: HOUSE_PALETTE[Math.floor(rng() * HOUSE_PALETTE.length)],
      texMix: 0,
    })
  }
  // 相机入口：外圈站位朝世界中心看（yaw 由眼位反推，pitch 平视）。
  const entryAz = rad(rng() * 360)
  const entryRadius = 13 + rng() * 3
  const eye: V3 = [Math.sin(entryAz) * entryRadius, 3 + rng() * 1.5, Math.cos(entryAz) * entryRadius]
  const yawDeg = (Math.atan2(eye[0], eye[2]) * 180) / Math.PI
  return {
    items,
    sunPosition,
    entry: { eye, yawDeg, pitchDeg: 0 },
    fog: { color: DAY_FOG, near: FOG_NEAR, far: FOG_FAR },
  }
}

// ---------- 内联 cube（与 src/geometry/cube.ts 同款：24 顶点 pos3+normal3+uv2 交错、36 索引） ----------
const FACES: { n: V3; c: V3[] }[] = [
  { n: [1, 0, 0], c: [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]] },
  { n: [-1, 0, 0], c: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]] },
  { n: [0, 1, 0], c: [[1, 1, -1], [-1, 1, -1], [-1, 1, 1], [1, 1, 1]] },
  { n: [0, -1, 0], c: [[1, -1, 1], [-1, -1, 1], [-1, -1, -1], [1, -1, -1]] },
  { n: [0, 0, 1], c: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
  { n: [0, 0, -1], c: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]] },
]
const FACE_UVS: [number, number][] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
]
function cubeGeometry(): { vertices: Float32Array; indices: Uint16Array } {
  const vertices = new Float32Array(24 * 8)
  const indices = new Uint16Array(36)
  FACES.forEach((face, f) => {
    face.c.forEach((corner, i) => {
      const o = (f * 4 + i) * 8
      vertices.set(corner, o)
      vertices.set(face.n, o + 3)
      vertices.set(FACE_UVS[i], o + 6)
    })
    const b = f * 4
    indices.set([b, b + 1, b + 2, b, b + 2, b + 3], f * 6)
  })
  return { vertices, indices }
}

/** 地面格子纹理：64×64、8×8 格的程序化数据（与 texture/procedural 同款思路）。 */
function makeChecker(size: number, cells: number): Uint8Array {
  const data = new Uint8Array(size * size * 4)
  const cell = size / cells
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const on = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0
      const v = on ? 235 : 70
      const o = (y * size + x) * 4
      data[o] = v
      data[o + 1] = v
      data[o + 2] = v
      data[o + 3] = 255
    }
  }
  return data
}

const VS = `
attribute vec3 a_position;
attribute vec3 a_normal;
attribute vec2 a_uv;
uniform mat4 u_vp;
uniform mat4 u_model;
uniform mat4 u_normalMat;
varying vec3 v_worldPos;
varying vec3 v_normal;
varying vec2 v_uv;
void main() {
  vec4 wp = u_model * vec4(a_position, 1.0);
  v_worldPos = wp.xyz;
  v_normal = (u_normalMat * vec4(a_normal, 0.0)).xyz;
  v_uv = a_uv;
  gl_Position = u_vp * wp;
}
`
const FS = `
precision mediump float;
varying vec3 v_worldPos;
varying vec3 v_normal;
varying vec2 v_uv;
uniform vec3 u_eye;
uniform vec3 u_sunPos;
uniform vec3 u_fogColor;
uniform float u_fogNear;
uniform float u_fogFar;
uniform vec3 u_baseColor;
uniform float u_ambient;
uniform float u_diffuseK;
uniform float u_specularK;
uniform float u_shininess;
uniform float u_emissive;
uniform float u_lightK;      // 白天 1 / 夜晚 0.12（太阳光强）
uniform float u_ambientK;    // 白天 1 / 夜晚 0.45（环境光整体缩放）
uniform float u_emissiveK;   // 白天 1 / 夜晚 0.35（自发光也随之暗下来）
uniform sampler2D u_tex;
uniform float u_texMix;      // 只有地面是 1
void main() {
  vec3 n = normalize(v_normal);
  vec3 l = normalize(u_sunPos - v_worldPos);
  vec3 v = normalize(u_eye - v_worldPos);
  vec3 r = reflect(-l, n);
  float dif = max(dot(n, l), 0.0) * u_diffuseK * u_lightK;
  float spe = pow(max(dot(r, v), 0.0), u_shininess) * u_specularK * u_lightK;
  float amb = u_ambient * u_ambientK;
  vec3 base = u_baseColor;
  vec3 tex = texture2D(u_tex, v_uv * 16.0).rgb;
  base = mix(base, base * (0.55 + 0.45 * tex.r), u_texMix);
  vec3 lit = base * (amb + dif) + vec3(spe) + base * u_emissive * u_emissiveK;
  float dist = distance(v_worldPos, u_eye);
  // 自发光免雾（factor 再乘 (1 - emissive)）：太阳是光源，隔着雾也该是个
  // 亮斑——否则挂在 28 格（雾的 far）外的太阳会被雾完全吃掉，看不见了。
  float factor = smoothstep(u_fogNear, u_fogFar, dist) * (1.0 - u_emissive);
  gl_FragColor = vec4(mix(lit, u_fogColor, factor), 1.0);
}
`

// ---------- 状态（模板读数与按钮） ----------
const W = 640
const H = 400
const seed = ref(7)
const isNight = ref(false)
const speed = ref(4)
const eyeText = ref('')
const yawText = ref('')
const pitchText = ref('')
const itemsText = ref('')
const hover = ref(false)
const glError = ref(false)
const cv = ref<HTMLCanvasElement | null>(null)

let world = createWorldDemo(seed.value)
let eye: [number, number, number] = [...world.entry.eye] as [number, number, number]
let yaw = world.entry.yawDeg
let pitch = world.entry.pitchDeg

function resetCamera(): void {
  eye = [...world.entry.eye] as [number, number, number]
  yaw = world.entry.yawDeg
  pitch = world.entry.pitchDeg
}
function regen(): void {
  seed.value = (seed.value + 1) % 100
  world = createWorldDemo(seed.value)
  resetCamera()
}
function toggleNight(): void {
  isNight.value = !isNight.value
}

// ---------- WebGL 装配与渲染循环 ----------
let raf = 0
let last = 0
let nightK = 0 // 0=白天 1=夜晚，每帧向目标 lerp 渐变
const keys = new Set<string>()
let cleanup: (() => void) | null = null

onMounted(() => {
  const gl = cv.value?.getContext('webgl', { antialias: true })
  if (!gl || !cv.value) {
    glError.value = true
    return
  }
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

  const geo = cubeGeometry()
  const vbo = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
  gl.bufferData(gl.ARRAY_BUFFER, geo.vertices, gl.STATIC_DRAW)
  const ibo = gl.createBuffer()
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo)
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geo.indices, gl.STATIC_DRAW)

  // 地面格子纹理：2 的幂尺寸，REPEAT + LINEAR（不传 mipmap，MIN_FILTER 用
  // LINEAR 保持纹理完整——第 9 章的账）。
  const tex = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 64, 64, 0, gl.RGBA, gl.UNSIGNED_BYTE, makeChecker(64, 8))
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)

  const aPos = gl.getAttribLocation(prog, 'a_position')
  const aNor = gl.getAttribLocation(prog, 'a_normal')
  const aUv = gl.getAttribLocation(prog, 'a_uv')
  gl.enableVertexAttribArray(aPos)
  gl.enableVertexAttribArray(aNor)
  gl.enableVertexAttribArray(aUv)
  const U = (name: string): WebGLUniformLocation | null => gl.getUniformLocation(prog, name)
  const uVp = U('u_vp')
  const uModel = U('u_model')
  const uNormalMat = U('u_normalMat')
  const uEye = U('u_eye')
  const uSun = U('u_sunPos')
  const uFogColor = U('u_fogColor')
  const uFogNear = U('u_fogNear')
  const uFogFar = U('u_fogFar')
  const uBase = U('u_baseColor')
  const uAmbient = U('u_ambient')
  const uDiffuse = U('u_diffuseK')
  const uSpecular = U('u_specularK')
  const uShininess = U('u_shininess')
  const uEmissive = U('u_emissive')
  const uLightK = U('u_lightK')
  const uAmbientK = U('u_ambientK')
  const uEmissiveK = U('u_emissiveK')
  const uTex = U('u_tex')
  const uTexMix = U('u_texMix')

  gl.enable(gl.DEPTH_TEST)
  gl.enable(gl.CULL_FACE)
  gl.uniform1i(uTex, 0)

  // 拖拽转头（先 pitch 后 yaw 的固定顺序住在 viewBasisDemo 里）。
  const canvas = cv.value
  let dragging = false
  let lx = 0
  let ly = 0
  const onDown = (e: PointerEvent): void => {
    dragging = true
    lx = e.clientX
    ly = e.clientY
    canvas.setPointerCapture(e.pointerId)
  }
  const onMove = (e: PointerEvent): void => {
    if (!dragging) return
    yaw -= (e.clientX - lx) * 0.25
    pitch = clamp(pitch - (e.clientY - ly) * 0.25, -89, 89)
    lx = e.clientX
    ly = e.clientY
  }
  const onUp = (): void => {
    dragging = false
  }
  const onWheel = (e: WheelEvent): void => {
    e.preventDefault()
    speed.value = clamp(speed.value * Math.exp(-e.deltaY * 0.001), 1, 12)
  }
  const onEnter = (): void => {
    hover.value = true
  }
  const onLeave = (): void => {
    hover.value = false
    keys.clear()
  }
  const onKeyDown = (e: KeyboardEvent): void => {
    if (!hover.value) return
    keys.add(e.code)
    if (e.code.startsWith('Arrow')) e.preventDefault()
  }
  const onKeyUp = (e: KeyboardEvent): void => {
    keys.delete(e.code)
  }
  canvas.addEventListener('pointerdown', onDown)
  canvas.addEventListener('pointermove', onMove)
  canvas.addEventListener('pointerup', onUp)
  canvas.addEventListener('wheel', onWheel, { passive: false })
  canvas.addEventListener('pointerenter', onEnter)
  canvas.addEventListener('pointerleave', onLeave)
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)

  const frame = (now: number): void => {
    const dt = Math.min((now - last) / 1000, 0.05)
    if (last > 0) {
      // 漫游移动：沿相机自己的前/右基向量，步长用增量时间 × 速度缩放。
      const basis = viewBasisDemo(yaw, pitch)
      const step = speed.value * dt
      let move: [number, number, number] = [0, 0, 0]
      if (keys.has('KeyW') || keys.has('ArrowUp')) move = vAdd(move, [basis.forward[0] * step, basis.forward[1] * step, basis.forward[2] * step])
      if (keys.has('KeyS') || keys.has('ArrowDown')) move = vAdd(move, [-basis.forward[0] * step, -basis.forward[1] * step, -basis.forward[2] * step])
      if (keys.has('KeyD') || keys.has('ArrowRight')) move = vAdd(move, [basis.right[0] * step, basis.right[1] * step, basis.right[2] * step])
      if (keys.has('KeyA') || keys.has('ArrowLeft')) move = vAdd(move, [-basis.right[0] * step, -basis.right[1] * step, -basis.right[2] * step])
      eye = vAdd(eye, move)
      // 白天/夜晚渐变：nightK 向目标指数式 lerp（每帧走剩余差距的一成多）。
      nightK += ((isNight.value ? 1 : 0) - nightK) * Math.min(1, dt * 2.4)
    }
    last = now

    const basis = viewBasisDemo(yaw, pitch)
    const view = mLookAt(eye, vAdd(eye, basis.forward), basis.up)
    const proj = mPerspective(rad(60), W / H, 0.1, 100)
    const vp = mMul(proj, view)

    // 清屏色＝当前雾色：地平线以外本来就是「全雾色」的地方。
    const fogColor: V3 = [
      lerp(DAY_FOG[0], NIGHT_FOG[0], nightK),
      lerp(DAY_FOG[1], NIGHT_FOG[1], nightK),
      lerp(DAY_FOG[2], NIGHT_FOG[2], nightK),
    ]
    gl.viewport(0, 0, W, H)
    gl.clearColor(fogColor[0], fogColor[1], fogColor[2], 1)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)

    gl.uniform3fv(uEye, eye)
    gl.uniform3fv(uSun, world.sunPosition)
    gl.uniform3fv(uFogColor, fogColor)
    gl.uniform1f(uFogNear, world.fog.near)
    gl.uniform1f(uFogFar, world.fog.far)
    gl.uniform1f(uLightK, lerp(1, 0.12, nightK))
    gl.uniform1f(uAmbientK, lerp(1, 0.45, nightK))
    gl.uniform1f(uEmissiveK, lerp(1, 0.35, nightK))
    gl.uniformMatrix4fv(uVp, false, vp)
    // 渲染清单的通用循环：循环不认识「柱子」也不认识「房子」，只认清单行。
    for (const item of world.items) {
      gl.uniformMatrix4fv(uModel, false, item.local)
      gl.uniformMatrix4fv(uNormalMat, false, mNormalFrom(item.local))
      const m = item.material
      gl.uniform3fv(uBase, m.baseColor)
      gl.uniform1f(uAmbient, m.ambient)
      gl.uniform1f(uDiffuse, m.diffuseK)
      gl.uniform1f(uSpecular, m.specularK)
      gl.uniform1f(uShininess, m.shininess)
      gl.uniform1f(uEmissive, m.emissive)
      gl.uniform1f(uTexMix, item.texMix)
      // 交错取料：pos3+normal3+uv2 = 32 字节步长，normal 偏移 12、uv 偏移 24。
      gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 32, 0)
      gl.vertexAttribPointer(aNor, 3, gl.FLOAT, false, 32, 12)
      gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 32, 24)
      gl.drawElements(gl.TRIANGLES, 36, gl.UNSIGNED_SHORT, 0)
    }

    eyeText.value = eye.map((x) => x.toFixed(1)).join(', ')
    yawText.value = yaw.toFixed(1)
    pitchText.value = pitch.toFixed(1)
    itemsText.value = String(world.items.length)
    raf = requestAnimationFrame(frame)
  }
  raf = requestAnimationFrame(frame)

  cleanup = () => {
    cancelAnimationFrame(raf)
    canvas.removeEventListener('pointerdown', onDown)
    canvas.removeEventListener('pointermove', onMove)
    canvas.removeEventListener('pointerup', onUp)
    canvas.removeEventListener('wheel', onWheel)
    canvas.removeEventListener('pointerenter', onEnter)
    canvas.removeEventListener('pointerleave', onLeave)
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
  }
})

onUnmounted(() => {
  cleanup?.()
  cleanup = null
  cv.value?.getContext('webgl')?.getExtension('WEBGL_lose_context')?.loseContext()
})
</script>

<template>
  <div class="demo-world">
    <p v-if="glError" class="err">这个浏览器/环境拿不到 WebGL 上下文，演示无法启动。</p>
    <template v-else>
      <div class="stage">
        <canvas
          ref="cv"
          :width="W"
          :height="H"
          class="cv"
          :class="{ hot: hover }"
        ></canvas>
        <div class="badge">{{ isNight ? '夜晚' : '白天' }}</div>
      </div>
      <div class="controls">
        <button class="btn" @click="toggleNight">{{ isNight ? '切到白天' : '切到夜晚' }}</button>
        <button class="btn" @click="regen">换个种子（{{ seed }}）</button>
        <button class="btn" @click="resetCamera">复位相机</button>
      </div>
      <ul class="stats">
        <li>seed {{ seed }} · 渲染清单 {{ itemsText }} 行（地面 + 太阳 + 柱廊 + 房子，逐行一个 draw call）</li>
        <li>eye = ({{ eyeText }}) · yaw {{ yawText }}° · pitch {{ pitchText }}°</li>
        <li>移动速度 {{ speed.toFixed(1) }} 格/秒（滚轮调） · 雾 near {{ 8 }} / far {{ 28 }}</li>
      </ul>
      <p class="hint">
        鼠标悬停画布（边框变亮）后按 WASD 或方向键漫游，按住拖拽转头，滚轮调移动速度。
        「切到白天/夜晚」看太阳光强、环境光、雾色一起渐变；「换个种子」用同一份布局代码重建一个不同的世界。
        远处的物体渐渐溶进雾色——28 格以外就是纯雾色，与清屏色接上。
      </p>
    </template>
  </div>
</template>

<style scoped>
.demo-world {
  margin: 16px 0;
}
.stage {
  position: relative;
}
.cv {
  width: 100%;
  max-width: 640px;
  height: auto;
  display: block;
  border-radius: 6px;
  border: 1px solid #30363d;
  cursor: grab;
  touch-action: none;
}
.cv.hot {
  border-color: #79c0ff;
}
.badge {
  position: absolute;
  top: 8px;
  right: 8px;
  padding: 2px 10px;
  border-radius: 10px;
  background: rgba(110, 118, 129, 0.35);
  color: #e6edf3;
  font-size: 12px;
  pointer-events: none;
}
.controls {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}
.btn {
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
.stats {
  margin: 8px 0 0;
  padding-left: 18px;
  color: #8b949e;
  font-size: 13px;
  line-height: 1.7;
  font-variant-numeric: tabular-nums;
}
.hint {
  margin: 10px 0 0;
  color: #8b949e;
  font-size: 12px;
  line-height: 1.7;
}
.err {
  color: #f85149;
  font-size: 13px;
}
</style>
