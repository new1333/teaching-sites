<script setup lang="ts">
// 用法示例（自包含演示）：程序化棋盘格纹理立方体 + 过滤/包裹/翻转开关。
// 纹理数据与 companion/src/texture/procedural.ts 同款算法内联（演示不
// import 实验场），但演示按「图片文件的行序」生成——数组第 0 行是图案
// 顶行，好让 UNPACK_FLIP_Y_WEBGL 开关有戏可唱：关掉它，顶行落进 v=0
// 的底边，整张贴图上下颠倒——痛点复刻。左下角格染红做方向标记
//（companion 的 checkerboard 约定该格为黑、纯黑白；演示为了让你看清
// 方向把这一格染红，其余格用深浅两档代替纯黑白，避免黑格沉进背景）。
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

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
function mLookAtZ(ez: number): M4 {
  // 相机固定在 (0,0,ez) 看原点、头朝 +Y：V 恰等于 translate(0,0,−ez)
  const m = new Float32Array(16)
  m[0] = 1
  m[5] = 1
  m[10] = 1
  m[15] = 1
  m[14] = -ez
  return m
}

// ---------- 立方体几何（与 src/geometry/cube.ts 同款：面数据表 → 交错缓冲） ----------
const STRIDE = 8 // 每顶点分量：position 3 + normal 3 + uv 2

// 一行一张面：法线 + 从外面看逆时针（左下→右下→右上→左上）的 4 个角点
const FACES: ReadonlyArray<{
  n: readonly [number, number, number]
  c: readonly (readonly [number, number, number])[]
}> = [
  { n: [1, 0, 0], c: [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]] }, // +X
  { n: [-1, 0, 0], c: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]] }, // −X
  { n: [0, 1, 0], c: [[1, 1, -1], [-1, 1, -1], [-1, 1, 1], [1, 1, 1]] }, // +Y
  { n: [0, -1, 0], c: [[1, -1, 1], [-1, -1, 1], [-1, -1, -1], [1, -1, -1]] }, // −Y
  { n: [0, 0, 1], c: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] }, // +Z
  { n: [0, 0, -1], c: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]] }, // −Z
]
const FACE_UVS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
]

function buildCube(): { vertices: Float32Array; indices: Uint16Array } {
  const vertices = new Float32Array(6 * 4 * STRIDE)
  const indices = new Uint16Array(6 * 6)
  FACES.forEach((face, f) => {
    face.c.forEach((corner, i) => {
      const o = (f * 4 + i) * STRIDE
      vertices.set(corner, o)
      vertices.set(face.n, o + 3)
      vertices.set(FACE_UVS[i], o + 6)
    })
    const b = f * 4
    indices.set([b, b + 1, b + 2, b, b + 2, b + 3], f * 6)
  })
  return { vertices, indices }
}

// ---------- 程序化纹理（与 procedural.ts 同款按格算色；行序按图片文件习惯） ----------
const TEX = 128 // 纹理边长：2 的幂——WebGL 1 里 REPEAT 只发给 2 的幂尺寸

// 图案坐标 y 从底边数起（与 UV 同向），数组行号 row 从顶行数起（图片习惯）：
// row=0 ↔ y=size−1。颜色按 (cx+cy) 奇偶分两档，左下角格染红做方向标记。
function genChecker(cells: number): Uint8Array {
  const size = TEX
  const edge = size / cells
  const data = new Uint8Array(size * size * 4)
  for (let row = 0; row < size; row++) {
    const y = size - 1 - row
    for (let x = 0; x < size; x++) {
      const cx = Math.floor(x / edge)
      const cy = Math.floor(y / edge)
      let rgb: readonly [number, number, number]
      if (cx === 0 && cy === 0) rgb = [229, 57, 53] // 左下角格：方向标记
      else if ((cx + cy) % 2 === 0) rgb = [30, 36, 44] // 深格
      else rgb = [233, 238, 242] // 浅格
      const o = (row * size + x) * 4
      data[o] = rgb[0]
      data[o + 1] = rgb[1]
      data[o + 2] = rgb[2]
      data[o + 3] = 255
    }
  }
  return data
}

const W = 440
const H = 330

// ---------- 开关状态 ----------
const spin = ref(true) // 自转
const cellsK = ref(3) // 格子密度：cells = 2^k，默认 8×8
const cells = computed(() => 2 ** cellsK.value)
const linear = ref(false) // 过滤：false = NEAREST 马赛克，true = LINEAR 调匀
const repeat = ref(true) // 包裹：true = REPEAT 平铺，false = CLAMP_TO_EDGE 摁边缘
const uvScaleOn = ref(false) // UV 放大到 [0,3]：越界交给包裹方式裁决
const closeUp = ref(false) // 特写：相机贴近，纹素被放大
const flipY = ref(true) // UNPACK_FLIP_Y_WEBGL：不勾 = 图片行序直传，上下颠倒

/** 画面判词随开关组合实时换：每一种组合都是正文里的一笔账。 */
const verdict = computed<string>(() => {
  if (!flipY.value) {
    return '上下颠倒复刻：数据按图片文件的行序（顶行在前）直传，UNPACK_FLIP_Y_WEBGL 关着——顶行落进 v=0 的底边，红色标记格跑到左上角，整张贴图倒立'
  }
  if (uvScaleOn.value && repeat.value) {
    return 'UV 放大到 [0,3] + REPEAT：越界的部分取小数部分回来——一张贴图平铺成 3×3，格子数肉眼可数'
  }
  if (uvScaleOn.value && !repeat.value) {
    return 'UV 放大到 [0,3] + CLAMP_TO_EDGE：越界的 UV 摁在 [0,1] 边缘——最外那排纹素被拉成宽条纹，平铺变拉伸'
  }
  if (closeUp.value && !linear.value) {
    return '特写 + NEAREST：谁近听谁的，每个屏幕像素整块取一个纹素——放大后全是马赛克块，斜边锯齿分明'
  }
  if (closeUp.value && linear.value) {
    return '特写 + LINEAR：UV 落在纹素之间时按距离加权调匀——格子边缘变成过渡灰，马赛克块化开'
  }
  return '立方体每面铺满一张 [0,1] 的程序化棋盘格：UV 在顶点表里写好，varying 插值到片元，texture2D 采样上色'
})

const cv = ref<HTMLCanvasElement | null>(null)
const glError = ref(false)
let gl: WebGLRenderingContext | null = null
let tex: WebGLTexture | null = null
let raf = 0
let last = 0
let angle = 0.5

onMounted(() => {
  const ctx = cv.value?.getContext('webgl', { antialias: true, depth: true })
  if (!ctx) {
    glError.value = true
    return
  }
  gl = ctx

  const VS = `
attribute vec3 a_position;
attribute vec2 a_uv;
uniform mat4 u_mvp;
uniform float u_uvScale;
varying vec2 v_uv;
void main() {
  gl_Position = u_mvp * vec4(a_position, 1.0);
  v_uv = a_uv * u_uvScale; // 越界的 UV 交给包裹方式裁决
}
`
  const FS = `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_sampler;
void main() {
  gl_FragColor = texture2D(u_sampler, v_uv);
}
`
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
  const aUv = gl.getAttribLocation(prog, 'a_uv')
  gl.enableVertexAttribArray(aPos)
  gl.enableVertexAttribArray(aUv)
  const mvpLoc = gl.getUniformLocation(prog, 'u_mvp')
  const scaleLoc = gl.getUniformLocation(prog, 'u_uvScale')
  const samplerLoc = gl.getUniformLocation(prog, 'u_sampler')

  const { vertices, indices } = buildCube()
  const vbo = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW)
  const ibo = gl.createBuffer()
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo)
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW)

  // 交错布局的取数口令：步长 8 分量 = 32 字节；position 偏移 0、uv 偏移 24 字节
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
  gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, STRIDE * 4, 0)
  gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, STRIDE * 4, 24)

  // 纹理接线：对象挂上 0 号纹理单元，采样器 uniform 里填的就是单元号
  tex = gl.createTexture()
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.uniform1i(samplerLoc, 0)
  reconfigure()

  const proj = mPerspective((55 * Math.PI) / 180, W / H, 0.5, 20)

  const frame = (now: number): void => {
    const dt = Math.min((now - last) / 1000, 0.05)
    if (last > 0 && spin.value) angle += dt * 0.5
    last = now
    gl!.viewport(0, 0, W, H)
    gl!.clearColor(0.05, 0.07, 0.09, 1)
    gl!.clearDepth(1)
    gl!.clear(gl!.COLOR_BUFFER_BIT | gl!.DEPTH_BUFFER_BIT)
    gl!.enable(gl!.DEPTH_TEST)
    gl!.enable(gl!.CULL_FACE) // 背面剔除照旧开着：焦点在纹理，别让幽灵方块抢戏
    // 特写换的是眼距（视图矩阵），纹理一个字不用重传
    const view = mLookAtZ(closeUp.value ? 2.6 : 4.5)
    const m = mMul(mRotY(angle), mRotX(angle * 0.55))
    const mvp = mMul(proj, mMul(view, m))
    gl!.uniformMatrix4fv(mvpLoc, false, mvp)
    gl!.uniform1f(scaleLoc, uvScaleOn.value ? 3 : 1)
    gl!.drawElements(gl!.TRIANGLES, indices.length, gl!.UNSIGNED_SHORT, 0)
    raf = requestAnimationFrame(frame)
  }
  raf = requestAnimationFrame(frame)
})

/** 重配纹理：行序翻转 + 数据上传 + 过滤/包裹参数。开关一动就整体重申一遍。 */
function reconfigure(): void {
  if (!gl || !tex) return
  gl.bindTexture(gl.TEXTURE_2D, tex)
  // 图片行序的数据要正立，就得在上传这一步倒一次行序；关掉即上下颠倒
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flipY.value ? 1 : 0)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, TEX, TEX, 0, gl.RGBA, gl.UNSIGNED_BYTE, genChecker(cells.value))
  // MIN/MAG 同档：默认的 NEAREST_MIPMAP_LINEAR 要多级渐远纹理才完整，
  // 本章不做 mipmap，把它绕开
  const filter = linear.value ? gl.LINEAR : gl.NEAREST
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter)
  const wrap = repeat.value ? gl.REPEAT : gl.CLAMP_TO_EDGE
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap)
}
watch([cellsK, flipY, linear, repeat], reconfigure)

onUnmounted(() => {
  cancelAnimationFrame(raf)
  gl?.getExtension('WEBGL_lose_context')?.loseContext()
  gl = null
})
</script>

<template>
  <div class="demo-texturecube">
    <div class="controls">
      <label class="slider">
        格子密度 {{ cells }}×{{ cells }}
        <input v-model.number="cellsK" type="range" min="1" max="5" step="1" />
      </label>
      <label class="toggle"><input v-model="linear" type="checkbox"> LINEAR 过滤</label>
      <label class="toggle"><input v-model="repeat" type="checkbox"> REPEAT 包裹</label>
      <label class="toggle"><input v-model="uvScaleOn" type="checkbox"> UV 放大到 [0,3]</label>
      <label class="toggle"><input v-model="closeUp" type="checkbox"> 特写</label>
      <label class="toggle"><input v-model="flipY" type="checkbox"> 行序翻转 UNPACK_FLIP_Y</label>
      <label class="toggle"><input v-model="spin" type="checkbox"> 自转</label>
    </div>
    <p v-if="glError" class="err">这个浏览器/环境拿不到 WebGL 上下文，演示无法启动。</p>
    <template v-else>
      <canvas ref="cv" :width="W" :height="H"></canvas>
      <ul class="stats">
        <li>纹理 128×128、RGBA 逐像素 4 字节，共 65536 字节——代码生成（Uint8Array），零图片文件；左下角格染红是方向标记。</li>
        <li>接线五步：createTexture → bindTexture → pixelStorei + texImage2D → texParameteri（过滤/包裹）→ activeTexture(TEXTURE0) + uniform1i 把采样器指到 0 号单元。</li>
        <li>MIN_FILTER 与 MAG_FILTER 设成同一档：默认的 NEAREST_MIPMAP_LINEAR 要多级渐远纹理才完整，本章不做 mipmap，把它绕开。</li>
      </ul>
      <p class="hint">{{ verdict }}</p>
    </template>
  </div>
</template>

<style scoped>
.demo-texturecube {
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
.controls .slider input {
  width: 110px;
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
