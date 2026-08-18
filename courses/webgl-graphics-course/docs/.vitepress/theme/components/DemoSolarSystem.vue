<script setup lang="ts">
// 用法示例（自包含演示）：太阳系——太阳自转、地球公转+自转、月亮绕地球。
// 演示不 import 实验场：MiniNode 与 src/scene/node.ts 的 SceneNode 同款
// （local 相对父级、world 从根链乘、updateWorld 递归结算），mini mat4 直接内联。
// 「手算版」开关复刻痛点：不走场景树，每帧把月亮在地球坐标系里迈的步子
// 直接加到世界坐标上——只做平移叠加、不做旋转链乘，两套坐标系打架，
// 月亮踩不在轨道圈上、周期性撞穿地球。
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

// ---------- 内联迷你 mat4（与 src/math/mat4.ts 同款约定，列主序） ----------
type M4 = Float32Array
type V3 = readonly [number, number, number]

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
function mIdentity(): M4 {
  const m = new Float32Array(16)
  m[0] = 1
  m[5] = 1
  m[10] = 1
  m[15] = 1
  return m
}
function mTranslate(tx: number, ty: number, tz: number): M4 {
  const m = mIdentity()
  m[12] = tx
  m[13] = ty
  m[14] = tz
  return m
}
function mRotY(rad: number): M4 {
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  const m = mIdentity()
  m[0] = c
  m[2] = -s
  m[8] = s
  m[10] = c
  return m
}
function mScale(sx: number, sy: number, sz: number): M4 {
  const m = mIdentity()
  m[0] = sx
  m[5] = sy
  m[10] = sz
  return m
}
function mLookAt(eye: V3, center: V3, up: V3): M4 {
  // 与 src/math/mat4.ts · lookAt 同款：f/s/u 三根正交基按行装旋转
  const sub = (a: V3, b: V3): V3 => [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  const cross = (a: V3, b: V3): V3 => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]
  const norm = (a: V3): V3 => {
    const l = Math.hypot(a[0], a[1], a[2])
    return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0]
  }
  const f = norm(sub(eye, center))
  const s = norm(cross(f, up))
  const u = cross(s, f)
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
  m[12] = -dot(s, eye)
  m[13] = -dot(u, eye)
  m[14] = dot(f, eye)
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
function mTransformPoint(m: M4, p: V3): V3 {
  const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15]
  return [
    (m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12]) / w,
    (m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13]) / w,
    (m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]) / w,
  ]
}

// ---------- 迷你场景树（与 src/scene/node.ts · SceneNode 同款） ----------
class MiniNode {
  local: M4
  children: MiniNode[] = []
  world: M4
  constructor(local: M4 = mIdentity()) {
    this.local = local
    this.world = mIdentity()
  }
  add(child: MiniNode): MiniNode {
    this.children.push(child)
    return child
  }
  updateWorld(parent?: M4): void {
    this.world = mMul(parent ?? mIdentity(), this.local)
    for (const child of this.children) child.updateWorld(this.world)
  }
}

// ---------- 几何：经纬球（position 3 + normal 3 交错，位置即法线）与轨道圈 ----------
const STRIDE = 6

function buildSphere(): { vertices: Float32Array; indices: Uint16Array } {
  const STACKS = 14
  const SLICES = 20
  const rows = STACKS + 1
  const cols = SLICES + 1
  const vertices = new Float32Array(rows * cols * STRIDE)
  const indices: number[] = []
  for (let i = 0; i < rows; i++) {
    const theta = (Math.PI * i) / STACKS
    for (let j = 0; j < cols; j++) {
      const phi = (2 * Math.PI * j) / SLICES
      const p: V3 = [
        Math.sin(theta) * Math.cos(phi),
        Math.cos(theta),
        Math.sin(theta) * Math.sin(phi),
      ]
      const o = (i * cols + j) * STRIDE
      vertices.set(p, o)
      vertices.set(p, o + 3) // 单位球：位置即法线；半径交给各级 local 的缩放
    }
  }
  for (let i = 0; i < STACKS; i++) {
    for (let j = 0; j < SLICES; j++) {
      const a = i * cols + j
      const b = a + 1
      const c = a + cols + 1
      const d = a + cols
      indices.push(a, c, d, a, b, c) // 从外面看逆时针
    }
  }
  return { vertices, indices: new Uint16Array(indices) }
}

function buildRing(segments: number): { vertices: Float32Array; count: number } {
  // XZ 平面上的单位圆（LINE_LOOP）：轨道圈本体，半径由各级 local 的缩放给
  const vertices = new Float32Array(segments * 3)
  for (let i = 0; i < segments; i++) {
    const a = (2 * Math.PI * i) / segments
    vertices.set([Math.cos(a), 0, Math.sin(a)], i * 3)
  }
  return { vertices, count: segments }
}

const W = 480
const H = 360

// ---------- 控件状态 ----------
const sunSpinSpeed = ref(0.4) // 太阳自转速度（弧度/秒）
const orbitSpeed = ref(0.5) // 地球公转速度
const earthSpinSpeed = ref(1.2) // 地球自转速度
const moonSpeed = ref(1.5) // 月亮公转速度
const handMode = ref(false) // 手算版：不走场景树，复刻痛点
const running = ref(true)
const moonDist = ref(1.5) // 月亮—地球实时距离（账面读数）

const verdict = computed<string>(() => {
  if (handMode.value) {
    const d = moonDist.value
    return d < 0.45
      ? '手算版翻车现场：月亮正在撞穿地球——只做平移叠加、不做旋转链乘，两套坐标系的账越加越歪'
      : '手算版翻车现场：月亮已经飘出轨道圈（半径应恒为 1.5，此刻读数见下）——地球坐标系在转，加出去的步子方向没跟着转'
  }
  return '场景树结算：月亮的 local 只写「绕地球」，地球的 local 只写「绕太阳」，世界坐标由链乘自动结算——月亮永远踩在自己的轨道圈上，轨道圈跟着地球走'
})

const cv = ref<HTMLCanvasElement | null>(null)
const glError = ref(false)
let gl: WebGLRenderingContext | null = null
let raf = 0
let last = 0
let sunA = 0
let orbitA = 0
let spinA = 0
let moonA = 0
const trail: number[] = [] // 手算版月亮的世界轨迹尾巴（切模式清空，避免断线假象）

watch(handMode, () => {
  trail.length = 0
})

onMounted(() => {
  const ctx = cv.value?.getContext('webgl', { antialias: true, depth: true })
  if (!ctx) {
    glError.value = true
    return
  }
  gl = ctx

  // 主程序：Phong 光照（光源=太阳，在原点）；u_stripe 给太阳/地球开经度条纹，
  // 让「自转」肉眼可见；太阳自发光（三件套全关、只留基础色）
  const VS = `
attribute vec3 a_position;
attribute vec3 a_normal;
uniform mat4 u_model;
uniform mat4 u_viewProj;
varying vec3 v_normal;
varying vec3 v_worldPos;
varying vec3 v_localPos;
void main() {
  vec4 world = u_model * vec4(a_position, 1.0);
  gl_Position = u_viewProj * world;
  v_worldPos = world.xyz;
  v_localPos = a_position;
  // 本章模型全是旋转+均匀缩放：法线吃模型矩阵、片元里归一化即可
  // （第 10 章的坑只在非均匀缩放露头）
  v_normal = (u_model * vec4(a_normal, 0.0)).xyz;
}
`
  const FS = `
precision mediump float;
varying vec3 v_normal;
varying vec3 v_worldPos;
varying vec3 v_localPos;
uniform vec3 u_baseColor;
uniform float u_ambient;
uniform float u_diffuseK;
uniform float u_specularK;
uniform float u_stripe;
void main() {
  vec3 N = normalize(v_normal);
  vec3 L = normalize(-v_worldPos);      // 光源在原点（太阳自己）
  vec3 V = normalize(-v_worldPos);      // 相机在远处，近似与光同向
  float diff = max(dot(N, L), 0.0) * u_diffuseK;
  float spec = pow(max(dot(reflect(-L, N), V), 0.0), 24.0) * u_specularK;
  float band = 0.85 + 0.15 * sin(atan(v_localPos.z, v_localPos.x) * 8.0);
  vec3 base = mix(u_baseColor, u_baseColor * band, u_stripe);
  gl_FragColor = vec4(base * (u_ambient + diff) + spec * vec3(1.0), 1.0);
}
`
  // 线程序：轨道圈与轨迹尾巴
  const VS_LINE = `
attribute vec3 a_position;
uniform mat4 u_mvp;
void main() {
  gl_Position = u_mvp * vec4(a_position, 1.0);
}
`
  const FS_LINE = `
precision mediump float;
uniform vec3 u_color;
void main() {
  gl_FragColor = vec4(u_color, 1.0);
}
`
  const compile = (type: number, src: string): WebGLShader | null => {
    const sh = gl!.createShader(type)
    if (!sh) return null
    gl!.shaderSource(sh, src)
    gl!.compileShader(sh)
    return sh
  }
  const link = (vsSrc: string, fsSrc: string): WebGLProgram | null => {
    const vs = compile(gl!.VERTEX_SHADER, vsSrc)
    const fs = compile(gl!.FRAGMENT_SHADER, fsSrc)
    const prog = gl!.createProgram()
    if (!vs || !fs || !prog) return null
    gl!.attachShader(prog, vs)
    gl!.attachShader(prog, fs)
    gl!.linkProgram(prog)
    return prog
  }
  const mainProg = link(VS, FS)
  const lineProg = link(VS_LINE, FS_LINE)
  if (!mainProg || !lineProg) {
    glError.value = true
    return
  }
  const loc = (p: WebGLProgram, n: string) => gl!.getUniformLocation(p, n)
  const attrib = (p: WebGLProgram, n: string) => gl!.getAttribLocation(p, n)
  const mp = {
    aPos: attrib(mainProg, 'a_position'),
    aNrm: attrib(mainProg, 'a_normal'),
    model: loc(mainProg, 'u_model'),
    viewProj: loc(mainProg, 'u_viewProj'),
    baseColor: loc(mainProg, 'u_baseColor'),
    ambient: loc(mainProg, 'u_ambient'),
    diffuseK: loc(mainProg, 'u_diffuseK'),
    specularK: loc(mainProg, 'u_specularK'),
    stripe: loc(mainProg, 'u_stripe'),
  }
  const lp = { aPos: attrib(lineProg, 'a_position'), mvp: loc(lineProg, 'u_mvp'), color: loc(lineProg, 'u_color') }

  const sphere = buildSphere()
  const ring = buildRing(96)
  const mkVbo = (data: Float32Array): WebGLBuffer => {
    const b = gl!.createBuffer()
    gl!.bindBuffer(gl!.ARRAY_BUFFER, b)
    gl!.bufferData(gl!.ARRAY_BUFFER, data, gl!.STATIC_DRAW)
    return b
  }
  const sphereVbo = mkVbo(sphere.vertices)
  const sphereIbo = (() => {
    const b = gl!.createBuffer()
    gl!.bindBuffer(gl!.ELEMENT_ARRAY_BUFFER, b)
    gl!.bufferData(gl!.ELEMENT_ARRAY_BUFFER, sphere.indices, gl!.STATIC_DRAW)
    return b
  })()
  const ringVbo = mkVbo(ring.vertices)
  const trailVbo = gl!.createBuffer()

  // 场景树（与测试 buildSolarSystem 同一份结构）：
  //   sun（根）
  //   ├─ earthRing：地球轨道圈（半径 4，世界固定）
  //   ├─ sunMesh：太阳网格——自转写在这里（叶子），不拖着行星跑
  //   └─ earthOrbit：公转 R(orbit)·T(4)
  //      ├─ earthMesh：地球网格——自转（叶子），不拖着月亮跑
  //      ├─ moonOrbit：R(moon)·T(1.5) → moonMesh
  //      └─ moonRing：月亮轨道圈（半径 1.5）——挂在地球队下，跟着地球走
  const sun = new MiniNode()
  const earthRing = sun.add(new MiniNode(mScale(4, 1, 4)))
  const sunMesh = sun.add(new MiniNode())
  const earthOrbit = sun.add(new MiniNode())
  const earthMesh = earthOrbit.add(new MiniNode())
  const moonOrbit = earthOrbit.add(new MiniNode())
  const moonMesh = moonOrbit.add(new MiniNode())
  const moonRing = earthOrbit.add(new MiniNode(mScale(1.5, 1, 1.5)))

  // 手算版的状态：上一帧的月亮偏移（地球坐标系）与地球位置
  let prevOff: V3 = [1.5, 0, 0]
  let prevEarth: V3 = [4, 0, 0]
  let moonHand: V3 = [5.5, 0, 0]

  const view = mLookAt([0, 6.5, 9], [0, 0, 0], [0, 1, 0])
  const proj = mPerspective((45 * Math.PI) / 180, W / H, 0.5, 60)
  const viewProj = mMul(proj, view)
  const moonOffset = (m: number): V3 => [1.5 * Math.cos(m), 0, -1.5 * Math.sin(m)]

  const frame = (now: number): void => {
    const dt = Math.min((now - last) / 1000, 0.05)
    if (last > 0 && running.value) {
      sunA += dt * sunSpinSpeed.value
      orbitA += dt * orbitSpeed.value
      spinA += dt * earthSpinSpeed.value
      moonA += dt * moonSpeed.value
    }
    last = now

    // 每帧只重建各节点的 local，然后一次结算全树
    sunMesh.local = mMul(mRotY(sunA), mScale(1.2, 1.2, 1.2))
    earthOrbit.local = mMul(mRotY(orbitA), mTranslate(4, 0, 0))
    earthMesh.local = mMul(mRotY(spinA), mScale(0.55, 0.55, 0.55))
    moonOrbit.local = mMul(mRotY(moonA), mTranslate(1.5, 0, 0))
    moonMesh.local = mScale(0.25, 0.25, 0.25)
    sun.updateWorld()
    const earthPos = mTransformPoint(earthOrbit.world, [0, 0, 0])

    // 月亮的画位与读数
    let moonWorld: V3
    if (handMode.value) {
      // 手算版：把这帧在地球坐标系里迈的步子直接加到世界坐标上——
      // 只做平移叠加、不做旋转链乘；地球的位移另算一笔加进来
      const off = moonOffset(moonA)
      const step: V3 = [off[0] - prevOff[0], off[1] - prevOff[1], off[2] - prevOff[2]]
      const drift: V3 = [earthPos[0] - prevEarth[0], earthPos[1] - prevEarth[1], earthPos[2] - prevEarth[2]]
      moonHand = [
        moonHand[0] + step[0] + drift[0],
        moonHand[1] + step[1] + drift[1],
        moonHand[2] + step[2] + drift[2],
      ]
      prevOff = off
      prevEarth = earthPos
      moonWorld = moonHand
    } else {
      // 场景树版：月亮世界坐标就是链乘结算出来的 world
      moonWorld = mTransformPoint(moonOrbit.world, [0, 0, 0])
      prevOff = moonOffset(moonA)
      prevEarth = earthPos
      moonHand = [moonWorld[0], moonWorld[1], moonWorld[2]] // 重新对账，切手算版从正确位起漂
    }
    moonDist.value = Math.hypot(
      moonWorld[0] - earthPos[0],
      moonWorld[1] - earthPos[1],
      moonWorld[2] - earthPos[2],
    )
    trail.push(moonWorld[0], moonWorld[1], moonWorld[2])
    if (trail.length > 2400) trail.splice(0, 3) // 尾巴封顶 800 点

    gl!.viewport(0, 0, W, H)
    gl!.enable(gl!.DEPTH_TEST)
    gl!.depthFunc(gl!.LESS)
    gl!.enable(gl!.CULL_FACE)
    gl!.frontFace(gl!.CCW)
    gl!.clearColor(0.05, 0.07, 0.09, 1)
    gl!.clearDepth(1)
    gl!.clear(gl!.COLOR_BUFFER_BIT | gl!.DEPTH_BUFFER_BIT)

    // 轨道圈：遍历绘制里「不发光、只画线」的那类节点
    gl!.useProgram(lineProg)
    gl!.enableVertexAttribArray(lp.aPos)
    const drawRing = (model: M4, color: V3): void => {
      gl!.uniformMatrix4fv(lp.mvp, false, mMul(viewProj, model))
      gl!.uniform3f(lp.color, color[0], color[1], color[2])
      gl!.bindBuffer(gl!.ARRAY_BUFFER, ringVbo)
      gl!.vertexAttribPointer(lp.aPos, 3, gl!.FLOAT, false, 0, 0)
      gl!.drawArrays(gl!.LINE_LOOP, 0, ring.count)
    }
    drawRing(earthRing.world, [0.35, 0.42, 0.5])
    drawRing(moonRing.world, [0.45, 0.4, 0.3])
    if (handMode.value && trail.length >= 6) {
      // 手算版的轨迹尾巴：飘没飘，看这条线
      gl!.uniformMatrix4fv(lp.mvp, false, viewProj)
      gl!.uniform3f(lp.color, 0.95, 0.45, 0.4)
      gl!.bindBuffer(gl!.ARRAY_BUFFER, trailVbo)
      gl!.bufferData(gl!.ARRAY_BUFFER, new Float32Array(trail), gl!.DYNAMIC_DRAW)
      gl!.vertexAttribPointer(lp.aPos, 3, gl!.FLOAT, false, 0, 0)
      gl!.drawArrays(gl!.LINE_STRIP, 0, trail.length / 3)
    }

    // 球体：遍历绘制，每个节点用它当时的 world 当模型矩阵
    gl!.useProgram(mainProg)
    gl!.enableVertexAttribArray(mp.aPos)
    gl!.enableVertexAttribArray(mp.aNrm)
    gl!.uniformMatrix4fv(mp.viewProj, false, viewProj)
    const drawBody = (
      model: M4,
      color: V3,
      lit: boolean,
      stripe: boolean,
    ): void => {
      gl!.uniformMatrix4fv(mp.model, false, model)
      gl!.uniform3f(mp.baseColor, color[0], color[1], color[2])
      gl!.uniform1f(mp.ambient, lit ? 0.08 : 1)
      gl!.uniform1f(mp.diffuseK, lit ? 1 : 0)
      gl!.uniform1f(mp.specularK, lit ? 0.25 : 0)
      gl!.uniform1f(mp.stripe, stripe ? 1 : 0)
      gl!.bindBuffer(gl!.ARRAY_BUFFER, sphereVbo)
      gl!.vertexAttribPointer(mp.aPos, 3, gl!.FLOAT, false, STRIDE * 4, 0)
      gl!.vertexAttribPointer(mp.aNrm, 3, gl!.FLOAT, false, STRIDE * 4, 12)
      gl!.bindBuffer(gl!.ELEMENT_ARRAY_BUFFER, sphereIbo)
      gl!.drawElements(gl!.TRIANGLES, sphere.indices.length, gl!.UNSIGNED_SHORT, 0)
    }
    drawBody(sunMesh.world, [1, 0.78, 0.25], false, true) // 太阳自发光
    drawBody(earthMesh.world, [0.35, 0.6, 0.85], true, true)
    // 月亮：场景树版用链乘出的 world；手算版用手算的世界坐标硬摆
    const moonModel = handMode.value
      ? mMul(mTranslate(moonWorld[0], moonWorld[1], moonWorld[2]), mScale(0.25, 0.25, 0.25))
      : moonMesh.world
    drawBody(moonModel, [0.75, 0.75, 0.7], true, false)

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
  <div class="demo-solar">
    <div class="controls">
      <span class="group">太阳自转 {{ sunSpinSpeed.toFixed(1) }}
        <input v-model.number="sunSpinSpeed" type="range" min="0" max="2" step="0.1">
      </span>
      <span class="group">地球公转 {{ orbitSpeed.toFixed(1) }}
        <input v-model.number="orbitSpeed" type="range" min="0" max="2" step="0.1">
      </span>
      <span class="group">地球自转 {{ earthSpinSpeed.toFixed(1) }}
        <input v-model.number="earthSpinSpeed" type="range" min="0" max="4" step="0.1">
      </span>
      <span class="group">月亮公转 {{ moonSpeed.toFixed(1) }}
        <input v-model.number="moonSpeed" type="range" min="0" max="4" step="0.1">
      </span>
    </div>
    <div class="controls">
      <label class="toggle warn"><input v-model="handMode" type="checkbox"> 手算版（不走场景树）</label>
      <label class="toggle"><input v-model="running" type="checkbox"> 运行</label>
    </div>
    <p v-if="glError" class="err">这个浏览器/环境拿不到 WebGL 上下文，演示无法启动。</p>
    <template v-else>
      <canvas ref="cv" :width="W" :height="H"></canvas>
      <ul class="stats">
        <li>月亮—地球实时距离：{{ moonDist.toFixed(3) }}（轨道半径 1.5——场景树版恒为 1.500，手算版来回乱飘、周期性冲向地球）。</li>
        <li>灰圈是地球轨道（世界固定）；暗金圈是月亮轨道，挂在地球队列下、跟着地球走——层级语义的直观证据。</li>
        <li>太阳自转写在网格叶子节点上，不拖行星；地球自转写在地球网格上，不拖月亮——挂错层级的账另有风景。</li>
      </ul>
      <p class="hint">{{ verdict }}</p>
    </template>
  </div>
</template>

<style scoped>
.demo-solar {
  margin: 16px 0;
}
.controls {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 18px;
  color: #e6edf3;
  font-size: 13px;
  align-items: center;
  margin-bottom: 4px;
}
.controls label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.controls .group {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #8b949e;
}
.controls .toggle.warn {
  color: #f0b459;
}
.controls input[type='range'] {
  width: 110px;
}
canvas {
  width: 100%;
  max-width: 480px;
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
.hint {
  margin: 10px 0 0;
  color: #79c0ff;
  font-size: 13px;
  line-height: 1.7;
}
.err {
  color: #f85149;
  font-size: 13px;
}
</style>
