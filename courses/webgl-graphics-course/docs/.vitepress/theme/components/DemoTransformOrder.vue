<script setup lang="ts">
// 用法示例（自包含演示）：矩阵顺序实验室 + 绕中心转的修复。
// 面板一：小飞机的 T（平移）/ R（旋转）/ S（缩放）三组滑杆，四种组合顺序
// 预设（T·R·S 等）——同一组参数、不同顺序，飞机被坑到不同的位置；下方
// 实时显示组合出的 4×4 矩阵，列主序标注：数组 m[0..3] = 数学矩阵第 1 列，
// 平移量住在 m[12..14]（第 4 列）。
// 面板二：裸旋转 vs 修复——裸旋转时飞机绕世界原点（画面左下角）转飞，
// 修复用 T·R·T⁻¹（先搬到原点、旋转、再搬回去）让它原地自转。
// 2D 画面 = 世界的 x/y 平面，旋转都是绕 Z 轴（rotZ）。
// 演示自包含：内联与 companion/src/math/mat4.ts 同款的列主序算法，
// 不 import 实验场。
import { computed, onMounted, onUnmounted, ref } from 'vue'

// ---------- 内联迷你 mat4（与 src/math/mat4.ts 同款，列主序） ----------
type M4 = Float32Array

function mIdentity(): M4 {
  const m = new Float32Array(16)
  m[0] = 1
  m[5] = 1
  m[10] = 1
  m[15] = 1
  return m
}

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
  const m = mIdentity()
  m[12] = tx
  m[13] = ty
  m[14] = tz
  return m
}

function mRotZ(rad: number): M4 {
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  const m = mIdentity()
  m[0] = c
  m[1] = s
  m[4] = -s
  m[5] = c
  return m
}

function mScale(sx: number, sy: number, sz: number): M4 {
  const m = mIdentity()
  m[0] = sx
  m[5] = sy
  m[10] = sz
  return m
}

/** 点过机器（z=0、w=1 进，出口除以 w——本章矩阵 w 恒 1，除 1 原样）。 */
function xform(m: M4, x: number, y: number): [number, number] {
  const w = m[3] * x + m[7] * y + m[15]
  return [(m[0] * x + m[4] * y + m[12]) / w, (m[1] * x + m[5] * y + m[13]) / w]
}

// ---------- 世界与形状 ----------
const W = 480
const H = 340
const S = 72 // 1 世界单位 = 72 px
const OX = 34 // 原点在画布上的 x（世界 0）
const OY = H - 34 // 原点在画布上的 y（世界 0，y 朝上）
/** 小飞机自己家的中心（世界坐标）——不在原点，正是痛点的火药。 */
const C = { x: 2.6, y: 1.6 }
/** 机身顶点（相对中心的偏移）：机头 + 左翼 + 尾凹 + 右翼。 */
const SHAPE: ReadonlyArray<readonly [number, number]> = [
  [0.62, 0],
  [-0.4, 0.4],
  [-0.18, 0],
  [-0.4, -0.4],
]

function toPx(x: number, y: number): [number, number] {
  return [OX + x * S, OY - y * S]
}

// ---------- 面板一：顺序实验室 ----------
const tx = ref(1.2)
const ty = ref(1.0)
const rotA = ref(50)
const sx = ref(1.4)
const sy = ref(0.7)
const ORDERS = ['T·R·S', 'T·S·R', 'R·T·S', 'R·S·T'] as const
const order = ref<string>('T·R·S')

const matA = computed<M4>(() => {
  const mats: Record<string, M4> = {
    T: mTranslate(tx.value, ty.value, 0),
    R: mRotZ((rotA.value * Math.PI) / 180),
    S: mScale(sx.value, sy.value, 1),
  }
  const toks = order.value.split('·')
  return toks.slice(1).reduce<M4>((acc, t) => mMul(acc, mats[t]), mats[toks[0]])
})

const centerA = computed(() => xform(matA.value, C.x, C.y))

// ---------- 面板二：绕中心转 ----------
const rotB = ref(90)
const fixed = ref(false)
const auto = ref(false)

const matB = computed<M4>(() => {
  const R = mRotZ((rotB.value * Math.PI) / 180)
  if (!fixed.value) return R
  // T·R·T⁻¹：先把中心搬到原点、旋转、再搬回去——绕自己的中心转
  return mMul(mTranslate(C.x, C.y, 0), mMul(R, mTranslate(-C.x, -C.y, 0)))
})

const centerB = computed(() => xform(matB.value, C.x, C.y))
const modeText = computed(() =>
  fixed.value ? '修复：T·R·T⁻¹ 原地自转' : '裸旋转：R 绕原点转飞',
)

// ---------- 矩阵面板（列主序标注） ----------
interface Cell {
  v: number
  i: number
  c: number
}

function cells(m: M4): Cell[][] {
  const rows: Cell[][] = []
  for (let r = 0; r < 4; r++) {
    rows.push(
      [0, 1, 2, 3].map((c) => ({ v: m[c * 4 + r], i: c * 4 + r, c })),
    )
  }
  return rows
}

const cellsA = computed(() => cells(matA.value))
const cellsB = computed(() => cells(matB.value))

function group(m: M4, c: number): string {
  return [0, 1, 2, 3].map((r) => m[c * 4 + r].toFixed(2)).join(' ')
}

// ---------- 画布 ----------
const cvA = ref<HTMLCanvasElement | null>(null)
const cvB = ref<HTMLCanvasElement | null>(null)
let ctxA: CanvasRenderingContext2D | null = null
let ctxB: CanvasRenderingContext2D | null = null
let raf = 0
let last = 0

function drawGrid(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = '#0d1117'
  ctx.fillRect(0, 0, W, H)
  // 每单位一格的网格
  ctx.strokeStyle = '#161b22'
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let gx = 0; gx <= (W - OX) / S; gx++) {
    ctx.moveTo(OX + gx * S, 0)
    ctx.lineTo(OX + gx * S, H)
  }
  for (let gy = 0; gy <= (H - (H - OY)) / S + 1; gy++) {
    ctx.moveTo(0, OY - gy * S)
    ctx.lineTo(W, OY - gy * S)
  }
  ctx.stroke()
  // 坐标轴
  ctx.strokeStyle = '#30363d'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(0, OY)
  ctx.lineTo(W, OY)
  ctx.moveTo(OX, 0)
  ctx.lineTo(OX, H)
  ctx.stroke()
  ctx.fillStyle = '#8b949e'
  ctx.font = '12px system-ui, sans-serif'
  ctx.fillText('x', W - 14, OY - 6)
  ctx.fillText('y', OX + 6, 14)
  ctx.fillText('原点 (0,0)', 6, H - 8)
}

function drawShape(
  ctx: CanvasRenderingContext2D,
  m: M4,
  mode: 'ghost' | 'solid',
): void {
  ctx.beginPath()
  let first = true
  for (const [dx, dy] of SHAPE) {
    const [x, y] = xform(m, C.x + dx, C.y + dy)
    const [px, py] = toPx(x, y)
    if (first) {
      ctx.moveTo(px, py)
      first = false
    } else ctx.lineTo(px, py)
  }
  ctx.closePath()
  if (mode === 'ghost') {
    ctx.setLineDash([5, 4])
    ctx.strokeStyle = '#8b949e'
    ctx.lineWidth = 1.5
    ctx.stroke()
    ctx.setLineDash([])
    return
  }
  ctx.fillStyle = 'rgba(88, 166, 255, 0.22)'
  ctx.fill()
  ctx.strokeStyle = '#58a6ff'
  ctx.lineWidth = 2
  ctx.stroke()
  // 机头小点（认出朝向用）
  const [nx, ny] = xform(m, C.x + SHAPE[0][0], C.y + SHAPE[0][1])
  const [npx, npy] = toPx(nx, ny)
  ctx.fillStyle = '#58a6ff'
  ctx.beginPath()
  ctx.arc(npx, npy, 3, 0, Math.PI * 2)
  ctx.fill()
}

function drawCenter(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  label: string,
): void {
  const [px, py] = toPx(x, y)
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(px, py, 3.5, 0, Math.PI * 2)
  ctx.fill()
  ctx.font = '12px system-ui, sans-serif'
  ctx.fillText(label, px + 7, py - 7)
}

function drawA(): void {
  const ctx = ctxA
  if (!ctx) return
  drawGrid(ctx)
  drawShape(ctx, mIdentity(), 'ghost')
  drawShape(ctx, matA.value, 'solid')
  drawCenter(ctx, C.x, C.y, '#8b949e', '中心 C')
  drawCenter(
    ctx,
    centerA.value[0],
    centerA.value[1],
    '#f0883e',
    `中心落点 (${centerA.value[0].toFixed(2)}, ${centerA.value[1].toFixed(2)})`,
  )
}

function drawB(): void {
  const ctx = ctxB
  if (!ctx) return
  drawGrid(ctx)
  const rC = Math.hypot(C.x, C.y)
  if (!fixed.value) {
    // 裸旋转：中心绕原点转的大圆轨道 + 从原点指向中心的半径臂
    ctx.setLineDash([4, 4])
    ctx.strokeStyle = 'rgba(248, 81, 73, 0.55)'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.arc(OX, OY, rC * S, 0, Math.PI * 2)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.strokeStyle = 'rgba(248, 81, 73, 0.7)'
    ctx.beginPath()
    ctx.moveTo(OX, OY)
    ctx.lineTo(...toPx(centerB.value[0], centerB.value[1]))
    ctx.stroke()
  } else {
    // 修复：机头绕中心转的小圆
    ctx.setLineDash([4, 4])
    ctx.strokeStyle = 'rgba(63, 185, 80, 0.6)'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.arc(...toPx(C.x, C.y), 0.62 * S, 0, Math.PI * 2)
    ctx.stroke()
    ctx.setLineDash([])
  }
  drawShape(ctx, mIdentity(), 'ghost')
  drawShape(ctx, matB.value, 'solid')
  drawCenter(ctx, C.x, C.y, '#8b949e', '中心 C')
}

function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.05)
  if (last > 0 && auto.value) {
    rotB.value = (rotB.value + dt * 45) % 360
  }
  last = now
  drawA()
  drawB()
  raf = requestAnimationFrame(frame)
}

onMounted(() => {
  ctxA = cvA.value?.getContext('2d') ?? null
  ctxB = cvB.value?.getContext('2d') ?? null
  raf = requestAnimationFrame(frame)
})
onUnmounted(() => cancelAnimationFrame(raf))
</script>

<template>
  <div class="demo-transform-order">
    <div class="panel">
      <p class="panel-title">顺序实验室：同一组参数，换顺序就换结果</p>
      <canvas ref="cvA" :width="W" :height="H"></canvas>
      <div class="controls">
        <label>平移 x <input v-model.number="tx" type="range" min="-1" max="3" step="0.1"> <span class="val">{{ tx.toFixed(1) }}</span></label>
        <label>平移 y <input v-model.number="ty" type="range" min="-0.5" max="2.5" step="0.1"> <span class="val">{{ ty.toFixed(1) }}</span></label>
        <label>旋转 <input v-model.number="rotA" type="range" min="-180" max="180" step="5"> <span class="val">{{ rotA }}°</span></label>
        <label>缩放 x <input v-model.number="sx" type="range" min="0.3" max="2.5" step="0.05"> <span class="val">{{ sx.toFixed(2) }}</span></label>
        <label>缩放 y <input v-model.number="sy" type="range" min="0.3" max="2.5" step="0.05"> <span class="val">{{ sy.toFixed(2) }}</span></label>
      </div>
      <div class="controls order-row">
        <span class="order-label">组合顺序</span>
        <button
          v-for="o in ORDERS"
          :key="o"
          :class="{ active: order === o }"
          type="button"
          @click="order = o"
        >
          {{ o }}
        </button>
        <span class="order-note">乘积从右往左作用：坐标先过最右边那台</span>
      </div>
      <div class="matwrap">
        <p class="mat-title">M = {{ order }}（实时数值）</p>
        <table class="mat">
          <thead>
            <tr>
              <th></th>
              <th v-for="c in 4" :key="c" :class="{ tcol: c === 4 }">
                第 {{ c }} 列 = m[{{ (c - 1) * 4 }}–{{ (c - 1) * 4 + 3 }}]
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, r) in cellsA" :key="r">
              <th>第 {{ r + 1 }} 行</th>
              <td v-for="cell in row" :key="cell.i" :class="{ tcol: cell.c === 3 }">
                <span class="v">{{ cell.v.toFixed(2) }}</span>
                <span class="idx">m{{ cell.i }}</span>
              </td>
            </tr>
          </tbody>
        </table>
        <p class="raw">
          列主序数组（每 4 个数是一列）：
          <code v-for="c in 4" :key="c" :class="{ tg: c === 4 }">[{{ group(matA, c - 1) }}]</code>
        </p>
      </div>
      <ul class="stats">
        <li>灰色虚线 = 原始飞机；蓝色 = 顺序组合后的落点。飞机中心从 (2.6, 1.6) 被送到 <b>({{ centerA[0].toFixed(2) }}, {{ centerA[1].toFixed(2) }})</b>。</li>
        <li>只点顺序按钮、滑杆一根不动：橙点立刻搬家——<b>{{ order }}</b> 与其它预设不可交换。</li>
        <li>平移量永远住在第 4 列（m[12]、m[13]、m[14]，橙色格子）；顺序一换，平移列里的数就不同。</li>
      </ul>
    </div>
    <div class="panel">
      <p class="panel-title">绕中心转：裸旋转 vs 修复</p>
      <canvas ref="cvB" :width="W" :height="H"></canvas>
      <div class="controls">
        <label>旋转角 <input v-model.number="rotB" type="range" min="0" max="360" step="5"> <span class="val">{{ rotB }}°</span></label>
        <label class="toggle">
          <input v-model="auto" type="checkbox">
          自动转
        </label>
        <button
          type="button"
          class="fix-btn"
          :class="{ on: fixed }"
          @click="fixed = !fixed"
        >
          {{ fixed ? '修复中：T·R·T⁻¹（点击回到裸旋转）' : '裸旋转中：R（点击修复——T·R·T⁻¹）' }}
        </button>
      </div>
      <div class="matwrap">
        <p class="mat-title">{{ fixed ? 'M = T·R·T⁻¹' : 'M = R' }}（实时数值）</p>
        <table class="mat">
          <thead>
            <tr>
              <th></th>
              <th v-for="c in 4" :key="c" :class="{ tcol: c === 4 }">
                第 {{ c }} 列 = m[{{ (c - 1) * 4 }}–{{ (c - 1) * 4 + 3 }}]
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, r) in cellsB" :key="r">
              <th>第 {{ r + 1 }} 行</th>
              <td v-for="cell in row" :key="cell.i" :class="{ tcol: cell.c === 3 }">
                <span class="v">{{ cell.v.toFixed(2) }}</span>
                <span class="idx">m{{ cell.i }}</span>
              </td>
            </tr>
          </tbody>
        </table>
        <p class="raw">
          列主序数组（每 4 个数是一列）：
          <code v-for="c in 4" :key="c" :class="{ tg: c === 4 }">[{{ group(matB, c - 1) }}]</code>
        </p>
      </div>
      <ul class="stats">
        <li>当前：<b>{{ modeText }}</b>。裸旋转时飞机中心沿红圈绕左下角原点跑（半径 {{ Math.hypot(C.x, C.y).toFixed(2) }}），一转就飞出画面。</li>
        <li>修复 = 三台机器串联：先 T⁻¹ 把中心搬回原点、R 原地旋转、再 T 搬回去——<b>中心落点回到 ({{ centerB[0].toFixed(2) }}, {{ centerB[1].toFixed(2) }})</b>，机头沿绿圈自转。</li>
        <li>勾「自动转」看两种模式的动画对比：一个绕圈转飞，一个原地打转。</li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.demo-transform-order {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  margin: 16px 0;
}
.panel {
  flex: 1 1 460px;
  border: 1px solid #30363d;
  border-radius: 8px;
  padding: 12px;
  background: #010409;
}
.panel-title {
  margin: 0 0 8px;
  font-weight: 600;
  color: #e6edf3;
}
canvas {
  width: 100%;
  height: auto;
  border-radius: 6px;
  display: block;
}
.controls {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 18px;
  margin-top: 10px;
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
  min-width: 38px;
  color: #79c0ff;
  font-variant-numeric: tabular-nums;
}
.order-row button {
  background: #161b22;
  color: #e6edf3;
  border: 1px solid #30363d;
  border-radius: 6px;
  padding: 3px 10px;
  font-size: 13px;
  cursor: pointer;
  font-variant-numeric: tabular-nums;
}
.order-row button.active {
  border-color: #f0883e;
  color: #f0883e;
}
.order-label {
  color: #8b949e;
}
.order-note {
  color: #8b949e;
  font-size: 12px;
}
.fix-btn {
  background: #161b22;
  color: #f85149;
  border: 1px solid #f8514966;
  border-radius: 6px;
  padding: 4px 12px;
  font-size: 13px;
  cursor: pointer;
}
.fix-btn.on {
  color: #3fb950;
  border-color: #3fb95066;
}
.matwrap {
  margin-top: 12px;
}
.mat-title {
  margin: 0 0 6px;
  color: #e6edf3;
  font-size: 13px;
  font-weight: 600;
}
table.mat {
  border-collapse: collapse;
  font-variant-numeric: tabular-nums;
}
table.mat th,
table.mat td {
  border: 1px solid #30363d;
  padding: 3px 8px;
  font-size: 12px;
  text-align: center;
  color: #8b949e;
  font-weight: 400;
}
table.mat td .v {
  display: block;
  color: #e6edf3;
  min-width: 44px;
}
table.mat td .idx {
  display: block;
  font-size: 10px;
  color: #6e7681;
}
table.mat .tcol {
  background: rgba(240, 136, 62, 0.12);
}
table.mat td.tcol .v {
  color: #f0883e;
}
.raw {
  margin: 8px 0 0;
  color: #8b949e;
  font-size: 12px;
  word-break: break-all;
}
.raw code {
  color: #79c0ff;
  background: #0d1117;
  padding: 1px 4px;
  border-radius: 4px;
  margin-right: 4px;
  font-variant-numeric: tabular-nums;
}
.raw code.tg {
  color: #f0883e;
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
</style>
