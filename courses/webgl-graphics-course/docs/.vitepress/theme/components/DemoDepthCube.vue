<script setup lang="ts">
// 用法示例（自包含演示）：实心立方体 + 深度测试/背面剔除/线框三开关。
// 几何与 companion/src/geometry/cube.ts 同款算法内联（演示不 import 实验
// 场）：24 顶点按 [px,py,pz, nx,ny,nz, u,v] 交错，每顶点 8 分量；36 个索
// 引一次 drawElements 引用。每面底色由面法线推出（六个朝向六种色）。
// 关掉深度测试立刻复刻幽灵方块：一张面画不画得过别人，只看它在索引清单
// 里排得晚不晚——谁后画谁覆盖。
import { computed, onMounted, onUnmounted, ref } from 'vue'

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

function buildCube(): { vertices: Float32Array; indices: Uint16Array; edges: Uint16Array } {
  const vertices = new Float32Array(6 * 4 * STRIDE)
  const indices = new Uint16Array(6 * 6)
  const edges = new Uint16Array(6 * 8) // 线框：每面 4 条边 × 2 端点
  FACES.forEach((face, f) => {
    face.c.forEach((corner, i) => {
      const o = (f * 4 + i) * STRIDE
      vertices.set(corner, o)
      vertices.set(face.n, o + 3)
      vertices.set(FACE_UVS[i], o + 6)
    })
    const b = f * 4
    indices.set([b, b + 1, b + 2, b, b + 2, b + 3], f * 6)
    edges.set([b, b + 1, b + 1, b + 2, b + 2, b + 3, b + 3, b], f * 8)
  })
  return { vertices, indices, edges }
}

const W = 440
const H = 330

// ---------- 开关状态 ----------
const depthOn = ref(true) // 深度测试：关掉 = 幽灵方块
const cullOn = ref(false) // 背面剔除：凸物体省一半片元
const wire = ref(false) // 线框模式：只画棱
const spin = ref(true) // 自转

/** 画面判词随开关组合实时换：每一种组合都是正文里的一笔账。 */
const verdict = computed<string>(() => {
  if (wire.value) {
    return cullOn.value
      ? '线框 + 剔除：棱一条不少——背面剔除只裁三角形，线段（LINES）不吃这套'
      : '线框模式：24 个顶点落在 8 个角点上——每个角点被三张面各记一次，法线不同就不能共用'
  }
  if (!depthOn.value && !cullOn.value) {
    return '幽灵方块：深度测试关着，遮挡只看索引清单里的先后——谁后画谁覆盖，转着转着背面的墙穿透到前面'
  }
  if (!depthOn.value && cullOn.value) {
    return '有趣的一笔：深度测试仍关着，但凸物体只靠背面剔除就画得对——背面的片元根本没生成，前面无人争座位'
  }
  if (depthOn.value && !cullOn.value) {
    return '深度测试开：新片元更近才许覆盖——「近者遮远者」由每像素的账本执行'
  }
  return '深度 + 剔除全开：画面与只开深度时一样，但背面对相机的面整个跳过——省下约一半片元的预算'
})

const cv = ref<HTMLCanvasElement | null>(null)
const glError = ref(false)
let gl: WebGLRenderingContext | null = null
let raf = 0
let last = 0
let angle = 0.6

onMounted(() => {
  const ctx = cv.value?.getContext('webgl', { antialias: true, depth: true })
  if (!ctx) {
    glError.value = true
    return
  }
  gl = ctx

  const VS = `
attribute vec3 a_position;
attribute vec3 a_normal;
uniform mat4 u_mvp;
varying vec3 v_normal;
void main() {
  gl_Position = u_mvp * vec4(a_position, 1.0);
  v_normal = a_normal; // 底色认「哪张面」：局部法线贴着面走
}
`
  const FS = `
precision mediump float;
varying vec3 v_normal;
uniform float u_wire;
void main() {
  vec3 face = 0.5 + 0.5 * v_normal; // 六个朝向 → 六种底色
  vec3 line = vec3(0.85, 0.9, 0.95);
  gl_FragColor = vec4(mix(face, line, u_wire), 1.0);
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
  const aNrm = gl.getAttribLocation(prog, 'a_normal')
  gl.enableVertexAttribArray(aPos)
  gl.enableVertexAttribArray(aNrm)
  const mvpLoc = gl.getUniformLocation(prog, 'u_mvp')
  const wireLoc = gl.getUniformLocation(prog, 'u_wire')

  const { vertices, indices, edges } = buildCube()
  const vbo = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW)
  const ibo = gl.createBuffer()
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo)
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW)
  const ebo = gl.createBuffer()
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ebo)
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, edges, gl.STATIC_DRAW)

  // 交错布局的取数口令：步长 8 分量 = 32 字节；position 偏移 0、normal 偏移 12 字节
  const bindAttribs = (): void => {
    gl!.bindBuffer(gl!.ARRAY_BUFFER, vbo)
    gl!.vertexAttribPointer(aPos, 3, gl!.FLOAT, false, STRIDE * 4, 0)
    gl!.vertexAttribPointer(aNrm, 3, gl!.FLOAT, false, STRIDE * 4, 12)
  }

  const view = mLookAtZ(4.5)
  const proj = mPerspective((55 * Math.PI) / 180, W / H, 0.5, 20)

  const frame = (now: number): void => {
    const dt = Math.min((now - last) / 1000, 0.05)
    if (last > 0 && spin.value) angle += dt * 0.6
    last = now
    // 深度与剔除是每次绘制前重申的开关，不是一次性配置
    if (depthOn.value) {
      gl!.enable(gl!.DEPTH_TEST)
      gl!.depthFunc(gl!.LESS)
    } else {
      gl!.disable(gl!.DEPTH_TEST)
    }
    if (cullOn.value) {
      gl!.enable(gl!.CULL_FACE)
      gl!.cullFace(gl!.BACK)
      gl!.frontFace(gl!.CCW)
    } else {
      gl!.disable(gl!.CULL_FACE)
    }
    gl!.viewport(0, 0, W, H)
    gl!.clearColor(0.05, 0.07, 0.09, 1)
    gl!.clearDepth(1) // 账本先铺满「无穷远」
    gl!.clear(gl!.COLOR_BUFFER_BIT | (depthOn.value ? gl!.DEPTH_BUFFER_BIT : 0))
    // 模型矩阵：两轴慢速翻滚（矩阵乘法从右往左作用，坐标先过 Rx 再过 Ry）
    const m = mMul(mRotY(angle), mRotX(angle * 0.55))
    const mvp = mMul(proj, mMul(view, m))
    gl!.uniformMatrix4fv(mvpLoc, false, mvp)
    bindAttribs()
    if (wire.value) {
      gl!.uniform1f(wireLoc, 1)
      gl!.bindBuffer(gl!.ELEMENT_ARRAY_BUFFER, ebo)
      gl!.drawElements(gl!.LINES, edges.length, gl!.UNSIGNED_SHORT, 0)
    } else {
      gl!.uniform1f(wireLoc, 0)
      gl!.bindBuffer(gl!.ELEMENT_ARRAY_BUFFER, ibo)
      gl!.drawElements(gl!.TRIANGLES, indices.length, gl!.UNSIGNED_SHORT, 0)
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
  <div class="demo-depthcube">
    <div class="controls">
      <label class="toggle"><input v-model="depthOn" type="checkbox"> 深度测试</label>
      <label class="toggle"><input v-model="cullOn" type="checkbox"> 背面剔除</label>
      <label class="toggle"><input v-model="wire" type="checkbox"> 线框模式</label>
      <label class="toggle"><input v-model="spin" type="checkbox"> 自转</label>
    </div>
    <p v-if="glError" class="err">这个浏览器/环境拿不到 WebGL 上下文，演示无法启动。</p>
    <template v-else>
      <canvas ref="cv" :width="W" :height="H"></canvas>
      <ul class="stats">
        <li>24 顶点（6 面 × 4）× 8 分量交错一张表；36 个索引一次 drawElements 引用完。</li>
        <li>深度测试开 = 每像素一本「谁最近」的账：清屏把账本铺满 1（无穷远），比较用 LESS——新片元更近才许覆盖。</li>
        <li>剔除只认缠绕方向：从外面看逆时针 = 正面；背对相机的面整张跳过，片元一个不生成。</li>
      </ul>
      <p class="hint">{{ verdict }}</p>
    </template>
  </div>
</template>

<style scoped>
.demo-depthcube {
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
