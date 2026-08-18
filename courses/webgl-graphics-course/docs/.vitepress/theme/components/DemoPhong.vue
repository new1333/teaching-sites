<script setup lang="ts">
// 用法示例（自包含演示）：立方体 + 经纬球做 Phong 光照。
// 演示不 import 实验场：mini mat4（含 normalFromMat4 的同款余子式算法）
// 与球几何直接内联。片元着色器与 companion/src/light/phong.ts 逐行同形，
// 强度滑杆的系数乘在 diff / spec 上。「法线吃错矩阵」开关把法线的变换
// 矩阵从法线矩阵换成模型矩阵——X 拉伸大于 1 时明暗当场开始撒谎，
// 复刻「六个面一模一样 / 拉伸后明暗错位」的痛点。
import { computed, onMounted, onUnmounted, ref } from 'vue'

// ---------- 内联迷你 mat4（与 src/math/mat4.ts 同款，列主序） ----------
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
function mNormalFromMat4(m: M4): M4 {
  // 与 src/math/mat4.ts · normalFromMat4 同款：逆转置 = 余子式矩阵 ÷ 行列式
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
    a11 * (a22 * a33 - a23 * a32) -
    a12 * (a21 * a33 - a23 * a31) +
    a13 * (a21 * a32 - a22 * a31)
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

// ---------- 立方体几何（与 src/geometry/cube.ts 同款面数据表，本演示只留 pos+normal） ----------
const STRIDE = 6 // 每顶点分量：position 3 + normal 3

// 一行一张面：法线 + 从外面看逆时针（左下→右下→右上→左上）的 4 个角点
const FACES: ReadonlyArray<{
  n: V3
  c: readonly V3[]
}> = [
  { n: [1, 0, 0], c: [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]] }, // +X
  { n: [-1, 0, 0], c: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]] }, // −X
  { n: [0, 1, 0], c: [[1, 1, -1], [-1, 1, -1], [-1, 1, 1], [1, 1, 1]] }, // +Y
  { n: [0, -1, 0], c: [[1, -1, 1], [-1, -1, 1], [-1, -1, -1], [1, -1, -1]] }, // −Y
  { n: [0, 0, 1], c: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] }, // +Z
  { n: [0, 0, -1], c: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]] }, // −Z
]

function buildCube(): {
  vertices: Float32Array
  indices: Uint16Array
  edges: Uint16Array
  arrows: Float32Array
} {
  const vertices = new Float32Array(6 * 4 * STRIDE)
  const indices = new Uint16Array(6 * 6)
  const edges = new Uint16Array(6 * 8)
  // 法线小箭头：每顶点一条杆（0=基点、1=箭头端），交错 [px,py,pz, nx,ny,nz, end]
  const arrows = new Float32Array(6 * 4 * 2 * 7)
  FACES.forEach((face, f) => {
    face.c.forEach((corner, i) => {
      const o = (f * 4 + i) * STRIDE
      vertices.set(corner, o)
      vertices.set(face.n, o + 3)
      const ao = (f * 4 + i) * 2 * 7
      arrows.set([...corner, ...face.n, 0], ao)
      arrows.set([...corner, ...face.n, 1], ao + 7)
    })
    const b = f * 4
    indices.set([b, b + 1, b + 2, b, b + 2, b + 3], f * 6)
    edges.set([b, b + 1, b + 1, b + 2, b + 2, b + 3, b + 3, b], f * 8)
  })
  return { vertices, indices, edges, arrows }
}

// ---------- 经纬球：每顶点「位置 = 法线」（球心在原点，半径方向即垂直方向） ----------
const STACKS = 12
const SLICES = 16

function buildSphere(radius: number): {
  vertices: Float32Array
  indices: Uint16Array
  arrows: Float32Array
} {
  const rows = STACKS + 1
  const cols = SLICES + 1
  const vertices = new Float32Array(rows * cols * STRIDE)
  const arrows: number[] = []
  for (let i = 0; i < rows; i++) {
    const theta = (Math.PI * i) / STACKS // 0（+Y 极点）→ π（−Y 极点）
    for (let j = 0; j < cols; j++) {
      const phi = (2 * Math.PI * j) / SLICES
      const p: V3 = [
        radius * Math.sin(theta) * Math.cos(phi),
        radius * Math.cos(theta),
        radius * Math.sin(theta) * Math.sin(phi),
      ]
      const o = (i * cols + j) * STRIDE
      vertices.set(p, o)
      vertices.set(p, o + 3) // 法线 = 位置归一化；radius 缩放交给模型矩阵
      // 箭头抽稀：每 3 纬度 × 每 4 经度取一根，避开两极挤成一团
      if (i % 3 === 0 && j % 4 === 0 && i > 0 && i < rows - 1) {
        const n: V3 = [
          Math.sin(theta) * Math.cos(phi),
          Math.cos(theta),
          Math.sin(theta) * Math.sin(phi),
        ]
        arrows.push(...p, ...n, 0, ...p, ...n, 1)
      }
    }
  }
  const indices: number[] = []
  for (let i = 0; i < STACKS; i++) {
    for (let j = 0; j < SLICES; j++) {
      const a = i * cols + j
      const b = a + 1
      const c = a + cols + 1
      const d = a + cols
      // 从外面看逆时针（背面剔除照常判正反）
      indices.push(a, c, d, a, b, c)
    }
  }
  return { vertices, indices: new Uint16Array(indices), arrows: new Float32Array(arrows) }
}

const W = 480
const H = 340

// ---------- 控件状态 ----------
const lightAz = ref(35) // 光源方位角（度）
const lightEl = ref(22) // 光源仰角（度）
const lightR = ref(3.6) // 光源半径
const ambientOn = ref(true)
const ambientK = ref(0.12)
const diffuseOn = ref(true)
const diffuseK = ref(1)
const specularOn = ref(true)
const specularK = ref(0.9)
const shininess = ref(32)
const stretchX = ref(1.6) // X 拉伸：非均匀缩放，痛点开关的燃料
const showNormals = ref(false)
const wrongMatrix = ref(false) // 法线吃错矩阵：法线改吃模型矩阵
const spin = ref(true)

const verdict = computed<string>(() => {
  if (wrongMatrix.value) {
    return stretchX.value > 1.05
      ? '法线吃错了矩阵：它直接乘模型矩阵，被拉伸的方向把法线往 X 扳——明暗跟着撒谎，椭球腰部亮区偏移、暗面渗光。关掉开关（改吃法线矩阵）立刻回正'
      : '此刻 X 拉伸是 1：模型矩阵与法线矩阵殊途同归，看不出差别——把 X 拉伸拉到 2 再看'
  }
  if (!diffuseOn.value && specularOn.value) {
    return '只剩高光：像玻璃弹珠的怪感——姿势打分（漫反射）缺席，只有反光斑在滑'
  }
  if (diffuseOn.value && !specularOn.value) {
    return '哑光石膏：只有环境光兜底加 N·L 打分，没有反光斑——漫反射管「正对光多亮」'
  }
  if (!diffuseOn.value && !specularOn.value && ambientOn.value) {
    return '只剩环境光：一视同仁的底亮度，整颗物体糊成剪影——阴天兜底，兜不了立体感'
  }
  if (!ambientOn.value && !diffuseOn.value && !specularOn.value) {
    return '三件套全关：没有光就没有亮度，画面只剩背景'
  }
  return 'Phong 三件套合流：环境光垫底、漫反射按 N·L 打分、高光按对齐度取幂——挪动光源，明暗分界线跟着走'
})

const cv = ref<HTMLCanvasElement | null>(null)
const glError = ref(false)
let gl: WebGLRenderingContext | null = null
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

  // 主程序：Phong 三件套（与 src/light/phong.ts 逐行同形，强度系数是滑杆的倍率）
  const VS = `
attribute vec3 a_position;
attribute vec3 a_normal;
uniform mat4 u_model;
uniform mat4 u_viewProj;
uniform mat4 u_normalMat;
varying vec3 v_normal;
varying vec3 v_worldPos;
void main() {
  vec4 world = u_model * vec4(a_position, 1.0);
  gl_Position = u_viewProj * world;
  v_worldPos = world.xyz;
  v_normal = (u_normalMat * vec4(a_normal, 0.0)).xyz; // 方向补 w=0：平移不吃进法线
}
`
  const FS = `
precision mediump float;
varying vec3 v_normal;
varying vec3 v_worldPos;
uniform vec3 u_lightPos;
uniform vec3 u_cameraPos;
uniform vec3 u_baseColor;
uniform float u_ambient;
uniform float u_diffuseK;
uniform float u_specularK;
uniform float u_shininess;
void main() {
  vec3 N = normalize(v_normal); // 插值会缩短向量——先归一化补回
  vec3 L = normalize(u_lightPos - v_worldPos);
  vec3 V = normalize(u_cameraPos - v_worldPos);
  float diff = max(dot(N, L), 0.0) * u_diffuseK;
  vec3 R = reflect(-L, N);
  float spec = pow(max(dot(R, V), 0.0), u_shininess) * u_specularK;
  vec3 color = u_baseColor * (u_ambient + diff) + spec * vec3(1.0);
  gl_FragColor = vec4(color, 1.0); // 超 [0,1] 的亮度写入时被摁回量程
}
`
  // 法线箭头程序：基点 + 变换后的法线方向 × 长度，a_end 选 0（基点）/1（箭头端）
  const VS_ARROW = `
attribute vec3 a_position;
attribute vec3 a_normal;
attribute float a_end;
uniform mat4 u_model;
uniform mat4 u_normalMat;
uniform mat4 u_viewProj;
uniform float u_len;
void main() {
  vec3 base = (u_model * vec4(a_position, 1.0)).xyz;
  vec3 n = normalize((u_normalMat * vec4(a_normal, 0.0)).xyz);
  gl_Position = u_viewProj * vec4(base + n * u_len * a_end, 1.0);
}
`
  // 平色线程序：立方体棱的线框
  const VS_LINE = `
attribute vec3 a_position;
uniform mat4 u_mvp;
void main() {
  gl_Position = u_mvp * vec4(a_position, 1.0);
}
`
  const FS_FLAT = `
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
  const arrowProg = link(VS_ARROW, FS_FLAT)
  const lineProg = link(VS_LINE, FS_FLAT)
  if (!mainProg || !arrowProg || !lineProg) {
    glError.value = true
    return
  }

  const loc = (p: WebGLProgram, n: string): WebGLUniformLocation | null =>
    gl!.getUniformLocation(p, n)
  const attrib = (p: WebGLProgram, n: string): number => gl!.getAttribLocation(p, n)

  const cube = buildCube()
  const sphere = buildSphere(1.05)
  const mkVbo = (data: Float32Array): WebGLBuffer => {
    const b = gl!.createBuffer()
    gl!.bindBuffer(gl!.ARRAY_BUFFER, b)
    gl!.bufferData(gl!.ARRAY_BUFFER, data, gl!.STATIC_DRAW)
    return b
  }
  const mkIbo = (data: Uint16Array): WebGLBuffer => {
    const b = gl!.createBuffer()
    gl!.bindBuffer(gl!.ELEMENT_ARRAY_BUFFER, b)
    gl!.bufferData(gl!.ELEMENT_ARRAY_BUFFER, data, gl!.STATIC_DRAW)
    return b
  }
  const cubeVbo = mkVbo(cube.vertices)
  const cubeIbo = mkIbo(cube.indices)
  const cubeEdgeIbo = mkIbo(cube.edges)
  const cubeArrowVbo = mkVbo(cube.arrows)
  const sphereVbo = mkVbo(sphere.vertices)
  const sphereIbo = mkIbo(sphere.indices)
  const sphereArrowVbo = mkVbo(sphere.arrows)

  // 主程序取数口令：交错布局步长 6 分量，position 偏移 0、normal 偏移 12 字节
  const bindMain = (vbo: WebGLBuffer, aPos: number, aNrm: number): void => {
    gl!.bindBuffer(gl!.ARRAY_BUFFER, vbo)
    gl!.vertexAttribPointer(aPos, 3, gl!.FLOAT, false, STRIDE * 4, 0)
    gl!.vertexAttribPointer(aNrm, 3, gl!.FLOAT, false, STRIDE * 4, 12)
  }
  // 箭头交错布局 [pos3, nrm3, end1]，步长 7 分量
  const bindArrow = (vbo: WebGLBuffer, aPos: number, aNrm: number, aEnd: number): void => {
    gl!.bindBuffer(gl!.ARRAY_BUFFER, vbo)
    gl!.vertexAttribPointer(aPos, 3, gl!.FLOAT, false, 7 * 4, 0)
    gl!.vertexAttribPointer(aNrm, 3, gl!.FLOAT, false, 7 * 4, 12)
    gl!.vertexAttribPointer(aEnd, 1, gl!.FLOAT, false, 7 * 4, 24)
  }

  const camera: V3 = [0, 0.9, 8.6]
  const view = mTranslate(-camera[0], -camera[1], -camera[2]) // 相机固定在 z 轴上看原点：V = T(−eye)
  const proj = mPerspective((45 * Math.PI) / 180, W / H, 0.5, 40)
  const viewProj = mMul(proj, view)

  const mp = {
    aPos: attrib(mainProg, 'a_position'),
    aNrm: attrib(mainProg, 'a_normal'),
    model: loc(mainProg, 'u_model'),
    viewProj: loc(mainProg, 'u_viewProj'),
    normalMat: loc(mainProg, 'u_normalMat'),
    lightPos: loc(mainProg, 'u_lightPos'),
    cameraPos: loc(mainProg, 'u_cameraPos'),
    baseColor: loc(mainProg, 'u_baseColor'),
    ambient: loc(mainProg, 'u_ambient'),
    diffuseK: loc(mainProg, 'u_diffuseK'),
    specularK: loc(mainProg, 'u_specularK'),
    shininess: loc(mainProg, 'u_shininess'),
  }
  const ap = {
    aPos: attrib(arrowProg, 'a_position'),
    aNrm: attrib(arrowProg, 'a_normal'),
    aEnd: attrib(arrowProg, 'a_end'),
    model: loc(arrowProg, 'u_model'),
    normalMat: loc(arrowProg, 'u_normalMat'),
    viewProj: loc(arrowProg, 'u_viewProj'),
    len: loc(arrowProg, 'u_len'),
    color: loc(arrowProg, 'u_color'),
  }
  const lp = {
    aPos: attrib(lineProg, 'a_position'),
    mvp: loc(lineProg, 'u_mvp'),
    color: loc(lineProg, 'u_color'),
  }

  const frame = (now: number): void => {
    const dt = Math.min((now - last) / 1000, 0.05)
    if (last > 0 && spin.value) angle += dt * 0.5
    last = now
    const sx = stretchX.value
    // 光源球坐标 → 世界位置（经度 az、纬度 el、半径 r）
    const az = (lightAz.value * Math.PI) / 180
    const el = (lightEl.value * Math.PI) / 180
    const r = lightR.value
    const light: V3 = [
      r * Math.cos(el) * Math.sin(az),
      r * Math.sin(el),
      r * Math.cos(el) * Math.cos(az),
    ]

    gl!.viewport(0, 0, W, H)
    gl!.enable(gl!.DEPTH_TEST)
    gl!.depthFunc(gl!.LESS)
    gl!.enable(gl!.CULL_FACE)
    gl!.frontFace(gl!.CCW)
    gl!.clearColor(0.05, 0.07, 0.09, 1)
    gl!.clearDepth(1)
    gl!.clear(gl!.COLOR_BUFFER_BIT | gl!.DEPTH_BUFFER_BIT)

    // 两件物体的模型矩阵：平移摆位 · 慢转 · 非均匀缩放（X 拉伸是痛点燃料）
    const rot = mRotY(angle)
    const cubeModel = mMul(mTranslate(-1.75, 0, 0), mMul(rot, mScale(0.85 * sx, 0.85, 0.85)))
    const sphereModel = mMul(mTranslate(1.75, 0, 0), mMul(rot, mScale(1.05 * sx, 1.05, 1.05)))

    // 主 pass：两件物体逐件画
    gl!.useProgram(mainProg)
    gl!.enableVertexAttribArray(mp.aPos)
    gl!.enableVertexAttribArray(mp.aNrm)
    gl!.uniformMatrix4fv(mp.viewProj, false, viewProj)
    gl!.uniform3f(mp.lightPos, light[0], light[1], light[2])
    gl!.uniform3f(mp.cameraPos, camera[0], camera[1], camera[2])
    gl!.uniform1f(mp.ambient, ambientOn.value ? ambientK.value : 0)
    gl!.uniform1f(mp.diffuseK, diffuseOn.value ? diffuseK.value : 0)
    gl!.uniform1f(mp.specularK, specularOn.value ? specularK.value : 0)
    gl!.uniform1f(mp.shininess, shininess.value)
    const drawMain = (
      model: M4,
      vbo: WebGLBuffer,
      ibo: WebGLBuffer,
      count: number,
      color: V3,
    ): void => {
      gl!.uniformMatrix4fv(mp.model, false, model)
      // 法线矩阵二选一：逆转置（对） vs 模型矩阵（痛点开关）
      gl!.uniformMatrix4fv(
        mp.normalMat,
        false,
        wrongMatrix.value ? model : mNormalFromMat4(model),
      )
      gl!.uniform3f(mp.baseColor, color[0], color[1], color[2])
      bindMain(vbo, mp.aPos, mp.aNrm)
      gl!.bindBuffer(gl!.ELEMENT_ARRAY_BUFFER, ibo)
      gl!.drawElements(gl!.TRIANGLES, count, gl!.UNSIGNED_SHORT, 0)
    }
    drawMain(cubeModel, cubeVbo, cubeIbo, cube.indices.length, [0.85, 0.36, 0.32])
    drawMain(sphereModel, sphereVbo, sphereIbo, sphere.indices.length, [0.42, 0.62, 0.86])

    // 光源标记：亮黄小方块（不受光照，平色画）——只用 position 一个属性
    gl!.useProgram(lineProg)
    gl!.disableVertexAttribArray(mp.aNrm)
    gl!.enableVertexAttribArray(lp.aPos)
    const markerModel = mMul(
      mTranslate(light[0], light[1], light[2]),
      mScale(0.1, 0.1, 0.1),
    )
    gl!.uniformMatrix4fv(lp.mvp, false, mMul(viewProj, markerModel))
    gl!.uniform3f(lp.color, 1, 0.9, 0.3)
    gl!.bindBuffer(gl!.ARRAY_BUFFER, cubeVbo)
    gl!.vertexAttribPointer(lp.aPos, 3, gl!.FLOAT, false, STRIDE * 4, 0)
    gl!.bindBuffer(gl!.ELEMENT_ARRAY_BUFFER, cubeIbo)
    gl!.drawElements(gl!.TRIANGLES, cube.indices.length, gl!.UNSIGNED_SHORT, 0)

    // 叠加 pass：法线可视化 = 立方体棱线框 + 法线小箭头
    if (showNormals.value) {
      gl!.useProgram(lineProg)
      gl!.uniform3f(lp.color, 0.75, 0.85, 0.95)
      gl!.uniformMatrix4fv(lp.mvp, false, mMul(viewProj, cubeModel))
      gl!.bindBuffer(gl!.ELEMENT_ARRAY_BUFFER, cubeEdgeIbo)
      gl!.drawElements(gl!.LINES, cube.edges.length, gl!.UNSIGNED_SHORT, 0)

      gl!.useProgram(arrowProg)
      gl!.enableVertexAttribArray(ap.aPos)
      gl!.enableVertexAttribArray(ap.aNrm)
      gl!.enableVertexAttribArray(ap.aEnd)
      gl!.uniformMatrix4fv(ap.viewProj, false, viewProj)
      gl!.uniform1f(ap.len, 0.35)
      gl!.uniform3f(ap.color, 0.55, 0.95, 0.75)
      const drawArrows = (model: M4, vbo: WebGLBuffer, count: number): void => {
        gl!.uniformMatrix4fv(ap.model, false, model)
        gl!.uniformMatrix4fv(
          ap.normalMat,
          false,
          wrongMatrix.value ? model : mNormalFromMat4(model),
        )
        bindArrow(vbo, ap.aPos, ap.aNrm, ap.aEnd)
        gl!.drawArrays(gl!.LINES, 0, count)
      }
      drawArrows(cubeModel, cubeArrowVbo, cube.arrows.length / 7)
      drawArrows(sphereModel, sphereArrowVbo, sphere.arrows.length / 7)
      gl!.disableVertexAttribArray(ap.aPos)
      gl!.disableVertexAttribArray(ap.aNrm)
      gl!.disableVertexAttribArray(ap.aEnd)
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
  <div class="demo-phong">
    <div class="controls">
      <span class="group">光源：方位 {{ lightAz }}°
        <input v-model.number="lightAz" type="range" min="-180" max="180" step="1">
      </span>
      <span class="group">仰角 {{ lightEl }}°
        <input v-model.number="lightEl" type="range" min="-80" max="80" step="1">
      </span>
      <span class="group">半径 {{ lightR.toFixed(1) }}
        <input v-model.number="lightR" type="range" min="2.5" max="6" step="0.1">
      </span>
    </div>
    <div class="controls">
      <label class="toggle"><input v-model="ambientOn" type="checkbox"> 环境光</label>
      <span class="group">{{ ambientK.toFixed(2) }}
        <input v-model.number="ambientK" type="range" min="0" max="0.6" step="0.01">
      </span>
      <label class="toggle"><input v-model="diffuseOn" type="checkbox"> 漫反射</label>
      <span class="group">{{ diffuseK.toFixed(2) }}
        <input v-model.number="diffuseK" type="range" min="0" max="1" step="0.01">
      </span>
      <label class="toggle"><input v-model="specularOn" type="checkbox"> 高光</label>
      <span class="group">{{ specularK.toFixed(2) }}
        <input v-model.number="specularK" type="range" min="0" max="1" step="0.01">
      </span>
      <span class="group">shininess {{ shininess }}
        <input v-model.number="shininess" type="range" min="2" max="256" step="1">
      </span>
    </div>
    <div class="controls">
      <span class="group">X 拉伸 {{ stretchX.toFixed(1) }}
        <input v-model.number="stretchX" type="range" min="1" max="2.5" step="0.1">
      </span>
      <label class="toggle warn"><input v-model="wrongMatrix" type="checkbox"> 法线吃错矩阵</label>
      <label class="toggle"><input v-model="showNormals" type="checkbox"> 法线可视化</label>
      <label class="toggle"><input v-model="spin" type="checkbox"> 自转</label>
    </div>
    <p v-if="glError" class="err">这个浏览器/环境拿不到 WebGL 上下文，演示无法启动。</p>
    <template v-else>
      <canvas ref="cv" :width="W" :height="H"></canvas>
      <ul class="stats">
        <li>法线从交错顶点表的第 12 字节偏移取用（pos3+nrm3，步长 24 字节）；片元着色器里先 normalize 再打分——插值会把向量缩短。</li>
        <li>球面每顶点「位置即法线」（球心在原点）；法线矩阵 = 模型矩阵 3×3 的逆转置，X 拉伸时它与模型矩阵分道扬镳。</li>
        <li>高光 = pow(max(R·V, 0), shininess)：shininess 2 是巴掌大的光斑，256 是针尖。</li>
      </ul>
      <p class="hint">{{ verdict }}</p>
    </template>
  </div>
</template>

<style scoped>
.demo-phong {
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
