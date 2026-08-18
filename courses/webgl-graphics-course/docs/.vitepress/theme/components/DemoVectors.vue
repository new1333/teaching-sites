<script setup lang="ts">
// 用法示例（自包含演示）：向量可视化 + 飞船归一化对比。
// 面板一：两根可调角度/长度的向量 a、b（z 恒 0 的 3D 向量画成 2D 平面图），
// 实时读出点积、夹角、单位向量的 cos 值、a 在 b 上的投影影子；
// 叉积是 3D 运算，这里 2D 化展示：只看 z 分量正负——正 = 朝屏幕外
// （朝你），负 = 朝屏幕里，配 a 转向 b 的旋向弧箭头。
// 面板二：飞船飞向目标——归一化开关切换「等速」（normalize 后每帧走
// 固定一步）与「忽快忽慢」（方向直接当速度，速度里混着距离：越远越快、
// 贴近目标爬行），底部速度条带把两种速度剖面画在同一时间轴上；
// 到达后停留片刻重置循环。
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

const W = 480
const H = 360
const S = 100 // 1 单位 = 100 px（面板一）

// ---------- 面板一：两根向量的读数 ----------
const angA = ref(35)
const angB = ref(335)
const lenA = ref(100) // 百分数：100 = 1.0 个单位
const lenB = ref(150)

const aVec = computed<[number, number, number]>(() => {
  const r = (angA.value * Math.PI) / 180
  const l = lenA.value / 100
  return [l * Math.cos(r), l * Math.sin(r), 0]
})
const bVec = computed<[number, number, number]>(() => {
  const r = (angB.value * Math.PI) / 180
  const l = lenB.value / 100
  return [l * Math.cos(r), l * Math.sin(r), 0]
})
const dotVal = computed(() => aVec.value[0] * bVec.value[0] + aVec.value[1] * bVec.value[1])
const crossZ = computed(() => aVec.value[0] * bVec.value[1] - aVec.value[1] * bVec.value[0])
const lenAv = computed(() => Math.hypot(aVec.value[0], aVec.value[1]))
const lenBv = computed(() => Math.hypot(bVec.value[0], bVec.value[1]))
const cosVal = computed(() => {
  const d = dotVal.value / (lenAv.value * lenBv.value)
  return Math.max(-1, Math.min(1, d))
})
const degVal = computed(() => (Math.acos(cosVal.value) * 180) / Math.PI)
const crossText = computed(() =>
  crossZ.value >= 0 ? '朝屏幕外（朝你）' : '朝屏幕里（背你）',
)

// ---------- 面板二：飞船归一化对比 ----------
const START = { x: 0.6, y: 1.4 }
const TARGET = { x: 4.2, y: 1.4 }
const SPEED = 1.5 // 归一化后的固定速度（单位/秒）
const RAW_K = 1.5 // 未归一化时速度 = 距离 × RAW_K（速度里混着距离）
const normalized = ref(false)

const shipSpeed = ref(0)
const shipDist = ref(0)
const modeText = computed(() => (normalized.value ? '等速飞行' : '忽快忽慢'))

const vecEl = ref<HTMLCanvasElement | null>(null)
const shipEl = ref<HTMLCanvasElement | null>(null)
let vecCtx: CanvasRenderingContext2D | null = null
let shipCtx: CanvasRenderingContext2D | null = null
let raf = 0
let last = 0
let pos = { ...START }
let arriveAt = 0 // 到达时刻（0 = 未到达）
const trail: { x: number; y: number; t: number }[] = []
const speedHist: { t: number; v: number }[] = []
let lastDot = 0

function resetRun(): void {
  pos = { ...START }
  arriveAt = 0
  trail.length = 0
  speedHist.length = 0
  lastDot = 0
}

watch(normalized, resetRun)

function arrow(
  ctx: CanvasRenderingContext2D,
  x0: number, y0: number, x1: number, y1: number,
  color: string, label: string,
): void {
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(x0, y0)
  ctx.lineTo(x1, y1)
  ctx.stroke()
  const a = Math.atan2(y1 - y0, x1 - x0)
  const h = 10
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x1 - h * Math.cos(a - 0.45), y1 - h * Math.sin(a - 0.45))
  ctx.lineTo(x1 - h * Math.cos(a + 0.45), y1 - h * Math.sin(a + 0.45))
  ctx.closePath()
  ctx.fill()
  ctx.font = 'bold 13px system-ui, sans-serif'
  ctx.fillText(label, x1 + 8 * Math.cos(a) - 4, y1 + 8 * Math.sin(a) + 4)
}

// 面板一：坐标轴 + 两向量 + 夹角弧 + 投影影子 + 叉积旋向指示
function drawVecPanel(): void {
  const ctx = vecCtx
  if (!ctx) return
  const cx = W / 2
  const cy = H / 2
  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = '#0d1117'
  ctx.fillRect(0, 0, W, H)
  // 坐标轴（x 朝右、y 朝上——数学习惯，画布 y 翻转）
  ctx.strokeStyle = '#30363d'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, cy)
  ctx.lineTo(W, cy)
  ctx.moveTo(cx, 0)
  ctx.lineTo(cx, H)
  ctx.stroke()
  ctx.fillStyle = '#8b949e'
  ctx.font = '12px system-ui, sans-serif'
  ctx.fillText('x', W - 14, cy - 6)
  ctx.fillText('y', cx + 6, 14)
  const ax = cx + aVec.value[0] * S
  const ay = cy - aVec.value[1] * S
  const bx = cx + bVec.value[0] * S
  const by = cy - bVec.value[1] * S
  // b 方向的延长虚线（投影要落在它上面）
  const bl = Math.hypot(bx - cx, by - cy) || 1
  const ux = (bx - cx) / bl
  const uy = (by - cy) / bl
  ctx.setLineDash([4, 4])
  ctx.strokeStyle = '#3d444d'
  ctx.beginPath()
  ctx.moveTo(cx - ux * 230, cy - uy * 230)
  ctx.lineTo(cx + ux * 230, cy + uy * 230)
  ctx.stroke()
  ctx.setLineDash([])
  // a 在 b 上的投影：影子端点 p = 原点 + b̂ × (a·b̂)，影子长 = a·b / |b|
  const dAb = dotVal.value / (lenBv.value || 1)
  const px = cx + ux * dAb * S
  const py = cy + uy * dAb * S
  // 影子段（原点 → p，画在 b 线上，加粗淡蓝）
  ctx.strokeStyle = 'rgba(88, 166, 255, 0.55)'
  ctx.lineWidth = 7
  ctx.beginPath()
  ctx.moveTo(cx, cy)
  ctx.lineTo(px, py)
  ctx.stroke()
  // 从 a 箭头尖到影子端点的垂直虚线
  ctx.setLineDash([3, 4])
  ctx.strokeStyle = 'rgba(88, 166, 255, 0.7)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(ax, ay)
  ctx.lineTo(px, py)
  ctx.stroke()
  ctx.setLineDash([])
  // 两根向量
  arrow(ctx, cx, cy, bx, by, '#f0883e', 'b')
  arrow(ctx, cx, cy, ax, ay, '#58a6ff', 'a')
  // 夹角弧 + 叉积旋向（a 转向 b 的短弧；画布 y 翻转后逆时针 = anticlockwise）
  const ar = (angA.value * Math.PI) / 180
  const br = (angB.value * Math.PI) / 180
  let delta = br - ar
  while (delta > Math.PI) delta -= Math.PI * 2
  while (delta < -Math.PI) delta += Math.PI * 2
  const r = 40
  ctx.strokeStyle = crossZ.value >= 0 ? '#3fb950' : '#f85149'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(cx, cy, r, -ar, -(ar + delta), delta > 0)
  ctx.stroke()
  // 弧末端的小箭头（沿切线方向：数学切向 sgn×(−sin, cos)，画布 y 翻转）
  const te = ar + delta
  const sgn = delta >= 0 ? 1 : -1
  const tx = -sgn * Math.sin(te)
  const ty = -sgn * Math.cos(te)
  const hx = cx + r * Math.cos(te)
  const hy = cy - r * Math.sin(te)
  const ha = Math.atan2(ty, tx)
  ctx.fillStyle = crossZ.value >= 0 ? '#3fb950' : '#f85149'
  ctx.beginPath()
  ctx.moveTo(hx, hy)
  ctx.lineTo(hx - 8 * Math.cos(ha - 0.5), hy - 8 * Math.sin(ha - 0.5))
  ctx.lineTo(hx - 8 * Math.cos(ha + 0.5), hy - 8 * Math.sin(ha + 0.5))
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = '#8b949e'
  ctx.fillText('θ', cx + (r + 8) * Math.cos(ar + delta / 2), cy - (r + 8) * Math.sin(ar + delta / 2))
  ctx.fillText('a 在 b 上的影子', px + 8, py + (uy > 0 ? 16 : -8))
}

// 面板二：飞船 + 轨迹点 + 速度条带
function drawShipPanel(): void {
  const ctx = shipCtx
  if (!ctx) return
  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = '#0d1117'
  ctx.fillRect(0, 0, W, H)
  // 世界区（上半）与速度条带（下半）
  ctx.strokeStyle = '#30363d'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, 282)
  ctx.lineTo(W, 282)
  ctx.stroke()
  ctx.fillStyle = '#8b949e'
  ctx.font = '12px system-ui, sans-serif'
  ctx.fillText('速度（单位/秒，最近 6 秒）', 10, 276)
  // 等速参考线（SPEED）
  const stripY = (v: number) => 354 - (v / 6) * 68
  ctx.setLineDash([4, 4])
  ctx.strokeStyle = '#3d444d'
  ctx.beginPath()
  ctx.moveTo(0, stripY(SPEED))
  ctx.lineTo(W, stripY(SPEED))
  ctx.stroke()
  ctx.setLineDash([])
  ctx.fillStyle = '#8b949e'
  ctx.fillText(`${SPEED}`, W - 20, stripY(SPEED) - 4)
  // 起点 / 目标（世界 y 以 1.4 为中线，画布 y 翻转）
  const tx = TARGET.x * S
  const ty = 140 - (TARGET.y - 1.4) * S
  ctx.strokeStyle = '#f0883e'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(tx, ty, 10, 0, Math.PI * 2)
  ctx.stroke()
  ctx.fillStyle = '#f0883e'
  ctx.fillText('目标', tx - 12, ty + 26)
  ctx.fillStyle = '#8b949e'
  ctx.fillText('起点', START.x * S - 12, 140 + 26)
  // 轨迹点（间隔 90ms 一个点：点距 = 速度）
  for (const p of trail) {
    const age = (last - p.t) / 1000
    ctx.fillStyle = `rgba(88, 166, 255, ${Math.max(0.08, 0.55 - age * 0.06)})`
    ctx.beginPath()
    ctx.arc(p.x * S, 140 - (p.y - 1.4) * S, 2.5, 0, Math.PI * 2)
    ctx.fill()
  }
  // 飞船（朝向运动方向的三角形）
  const dirX = TARGET.x - pos.x
  const dirY = TARGET.y - pos.y
  const ang = Math.atan2(dirY, dirX)
  const px = pos.x * S
  const py = 140 - (pos.y - 1.4) * S
  ctx.save()
  ctx.translate(px, py)
  ctx.rotate(-ang) // 画布 y 向下，取负角
  ctx.fillStyle = arriveAt > 0 ? '#3fb950' : '#58a6ff'
  ctx.beginPath()
  ctx.moveTo(11, 0)
  ctx.lineTo(-8, 7)
  ctx.lineTo(-8, -7)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
  // 速度条带折线
  if (speedHist.length > 1) {
    ctx.strokeStyle = normalized.value ? '#3fb950' : '#f85149'
    ctx.lineWidth = 2
    ctx.beginPath()
    let first = true
    for (const p of speedHist) {
      const x = W - ((last - p.t) / 6000) * W
      const y = stripY(p.v)
      if (first) {
        ctx.moveTo(x, y)
        first = false
      } else ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
}

function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.05)
  if (last > 0) {
    // 更新飞船：方向 = 目标 − 位置；开 = 归一化后走固定一步，关 = 直接当速度
    const dx = TARGET.x - pos.x
    const dy = TARGET.y - pos.y
    const dist = Math.hypot(dx, dy)
    shipDist.value = dist
    if (arriveAt > 0) {
      shipSpeed.value = 0
      if (now - arriveAt > 700) resetRun()
    } else if (dist < 0.08) {
      arriveAt = now
      shipSpeed.value = 0
    } else {
      let vx: number
      let vy: number
      if (normalized.value) {
        vx = (dx / dist) * SPEED
        vy = (dy / dist) * SPEED
      } else {
        vx = dx * RAW_K
        vy = dy * RAW_K
      }
      pos = { x: pos.x + vx * dt, y: pos.y + vy * dt }
      shipSpeed.value = Math.hypot(vx, vy)
    }
    if (arriveAt === 0 && last - lastDot > 90) {
      trail.push({ x: pos.x, y: pos.y, t: now })
      if (trail.length > 90) trail.shift()
      lastDot = last
    }
    speedHist.push({ t: now, v: shipSpeed.value })
    while (speedHist.length && now - speedHist[0].t > 6000) speedHist.shift()
  }
  last = now
  drawVecPanel()
  drawShipPanel()
  raf = requestAnimationFrame(frame)
}

onMounted(() => {
  vecCtx = vecEl.value?.getContext('2d') ?? null
  shipCtx = shipEl.value?.getContext('2d') ?? null
  raf = requestAnimationFrame(frame)
})
onUnmounted(() => cancelAnimationFrame(raf))
</script>

<template>
  <div class="demo-vectors">
    <div class="panel">
      <p class="panel-title">两根向量：点积 / 夹角 / 叉积方向</p>
      <canvas ref="vecEl" :width="W" :height="H"></canvas>
      <div class="controls">
        <label>a 角度 <input v-model.number="angA" type="range" min="0" max="359" step="1"> <span class="val">{{ angA }}°</span></label>
        <label>a 长度 <input v-model.number="lenA" type="range" min="20" max="200" step="5"> <span class="val">{{ (lenA / 100).toFixed(1) }}</span></label>
        <label>b 角度 <input v-model.number="angB" type="range" min="0" max="359" step="1"> <span class="val">{{ angB }}°</span></label>
        <label>b 长度 <input v-model.number="lenB" type="range" min="20" max="200" step="5"> <span class="val">{{ (lenB / 100).toFixed(1) }}</span></label>
      </div>
      <ul class="stats">
        <li>a·b = <b>{{ dotVal.toFixed(2) }}</b>（同向正、垂直 0、反向负）</li>
        <li>夹角 θ = <b>{{ degVal.toFixed(1) }}°</b>，â·b̂ = cos θ = <b>{{ cosVal.toFixed(2) }}</b>（先归一化再点积，分数只看夹角）</li>
        <li>a×b 的 z 分量 = <b>{{ crossZ.toFixed(2) }}</b>，方向<b>{{ crossText }}</b>（弧箭头 = a 转向 b 的旋向）</li>
        <li>|a| = {{ lenAv.toFixed(2) }}，|b| = {{ lenBv.toFixed(2) }}，影子长 = a·b / |b| = {{ (dotVal / (lenBv || 1)).toFixed(2) }}</li>
      </ul>
    </div>
    <div class="panel">
      <p class="panel-title">飞船：归一化开关对比</p>
      <canvas ref="shipEl" :width="W" :height="H"></canvas>
      <div class="controls">
        <label class="toggle">
          <input v-model="normalized" type="checkbox">
          归一化：{{ normalized ? '开——每帧走固定一步，等速' : '关——方向直接当速度，忽快忽慢' }}
        </label>
      </div>
      <ul class="stats">
        <li>模式：<b>{{ modeText }}</b>，实时速度 <b>{{ shipSpeed.toFixed(2) }}</b> 单位/秒，距目标 {{ shipDist.toFixed(2) }}</li>
        <li>关：速度 = 距离 × {{ RAW_K }}——离目标越远飞得越快，贴近后爬行（蓝点间距就是速度）</li>
        <li>开：速度恒为 {{ SPEED }}——先把方向归一化成单位向量，再乘固定步长</li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.demo-vectors {
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
}
.controls label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.controls .val {
  min-width: 34px;
  color: #79c0ff;
  font-variant-numeric: tabular-nums;
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
