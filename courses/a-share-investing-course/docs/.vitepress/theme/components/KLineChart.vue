<script setup lang="ts">
// KLineChart：课程统一的 K 线可视化组件（SVG、零依赖）。
// 几何映射与 companion 的 src/render/toSvg.ts 一致：一根K线 = 一个 rect（实体）+ 两条 line（影线）。
// 配色遵循 A 股习惯：红涨绿跌。
import { computed } from 'vue'

interface CandleT {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume?: number
}
interface OverlayT {
  name: string
  values: (number | null)[]
  color?: string
}
interface MarkerT {
  index: number
  label: string
  kind?: 'bull' | 'bear' | 'info'
}

const props = withDefaults(
  defineProps<{
    candles: CandleT[]
    overlays?: OverlayT[]
    markers?: MarkerT[]
    logScale?: boolean
    height?: number
    showVolume?: boolean
    title?: string
  }>(),
  { logScale: false, height: 320, showVolume: true, title: '' },
)

const UP = '#d94848' // 阳线：A股红
const DOWN = '#2b8a3e' // 阴线：A股绿
const PALETTE = ['#e8833a', '#7048e8', '#0c8599', '#d6336c']

const W = 760
const PAD = { left: 10, right: 46, top: 16, bottom: 20 }
const VOL_H = 56

const n = computed(() => props.candles.length)
const hasVolume = computed(
  () => props.showVolume && props.candles.some((c) => (c.volume ?? 0) > 0),
)
const plotW = computed(() => W - PAD.left - PAD.right)
const mainH = computed(() => props.height - PAD.top - PAD.bottom - (hasVolume.value ? VOL_H : 0))
const volTop = computed(() => PAD.top + mainH.value + 10)
const band = computed(() => (n.value > 0 ? plotW.value / n.value : plotW.value))

const overlayFinite = computed(() =>
  (props.overlays ?? []).flatMap((o) => o.values.filter((v): v is number => v != null && Number.isFinite(v))),
)

const lo = computed(() => {
  const lows = props.candles.map((c) => c.low)
  const all = [...lows, ...overlayFinite.value]
  return all.length ? Math.min(...all) : 0
})
const hi = computed(() => {
  const highs = props.candles.map((c) => c.high)
  const all = [...highs, ...overlayFinite.value]
  return all.length ? Math.max(...all) : 1
})
const span = computed(() => Math.max(hi.value - lo.value, Math.abs(hi.value) * 1e-6, 1e-9))

// 价格 → 主图 y 坐标（logScale 时按对数映射，压缩大级别行情的视觉失真）
function y(price: number): number {
  const t =
    props.logScale && lo.value > 0
      ? (Math.log(Math.max(price, 1e-9)) - Math.log(lo.value)) /
        (Math.log(hi.value) - Math.log(lo.value) || 1)
      : (price - lo.value) / span.value
  return PAD.top + (1 - t) * mainH.value
}

const gridTicks = computed(() => {
  const ticks: { yv: number; label: string }[] = []
  const steps = 5
  for (let i = 0; i <= steps; i++) {
    const price = lo.value + (span.value * i) / steps
    ticks.push({ yv: y(price), label: price.toFixed(2) })
  }
  return ticks
})

const dateTicks = computed(() => {
  const out: { x: number; label: string }[] = []
  if (n.value === 0) return out
  const want = Math.min(6, n.value)
  for (let i = 0; i < want; i++) {
    const idx = Math.round((i * (n.value - 1)) / (want - 1 || 1))
    out.push({ x: PAD.left + (idx + 0.5) * band.value, label: props.candles[idx].date })
  }
  return out
})

const bars = computed(() =>
  props.candles.map((c, i) => {
    const x = PAD.left + i * band.value
    const cx = x + band.value / 2
    const up = c.close >= c.open
    const color = up ? UP : DOWN
    const yOpen = y(c.open)
    const yClose = y(c.close)
    const bodyTop = Math.min(yOpen, yClose)
    const bodyH = Math.max(Math.abs(yClose - yOpen), 1)
    return {
      key: i,
      cx,
      color,
      up,
      bodyX: x + band.value * 0.15,
      bodyW: Math.max(band.value * 0.7, 1),
      bodyY: bodyTop,
      bodyH,
      wickTop: y(c.high),
      wickBottom: y(c.low),
      label: c.date,
    }
  }),
)

const maxVol = computed(() => Math.max(...props.candles.map((c) => c.volume ?? 0), 1))
const volBars = computed(() =>
  props.candles.map((c, i) => {
    const v = c.volume ?? 0
    const h = (v / maxVol.value) * (VOL_H - 8)
    return { key: i, x: PAD.left + i * band.value + band.value * 0.15, w: Math.max(band.value * 0.7, 1), h, color: c.close >= c.open ? UP : DOWN }
  }),
)

const overlayPaths = computed(() =>
  (props.overlays ?? []).map((o, oi) => {
    const pts = o.values
      .map((v, i) => (v == null || !Number.isFinite(v) ? null : `${(PAD.left + (i + 0.5) * band.value).toFixed(1)},${y(v).toFixed(1)}`))
      .filter((p): p is string => p != null)
    return { name: o.name, color: o.color ?? PALETTE[oi % PALETTE.length], d: pts.join(' ') }
  }),
)

const markerShapes = computed(() =>
  (props.markers ?? [])
    .filter((m) => m.index >= 0 && m.index < n.value)
    .map((m) => {
      const c = props.candles[m.index]
      const cx = PAD.left + (m.index + 0.5) * band.value
      const kind = m.kind ?? 'info'
      const color = kind === 'bull' ? UP : kind === 'bear' ? DOWN : '#495057'
      // bull：低点下方红色上三角；bear：高点上方绿色下三角；info：高点上方圆点
      const shape =
        kind === 'bull'
          ? `M ${cx - 5} ${y(c.low) + 14} L ${cx + 5} ${y(c.low) + 14} L ${cx} ${y(c.low) + 6} Z`
          : kind === 'bear'
            ? `M ${cx - 5} ${y(c.high) - 14} L ${cx + 5} ${y(c.high) - 14} L ${cx} ${y(c.high) - 6} Z`
            : `M ${cx} ${y(c.high) - 8} m -3 0 a 3 3 0 1 0 6 0 a 3 3 0 1 0 -6 0`
      const textY = kind === 'bull' ? y(c.low) + 25 : y(c.high) - 18
      return { key: `${m.index}-${m.label}`, color, shape, cx, textY, label: m.label }
    }),
)
</script>

<template>
  <div v-if="n === 0" class="kline-empty">（无数据）</div>
  <svg v-else :viewBox="`0 0 ${W} ${height}`" class="kline-chart" role="img" :aria-label="title || 'K线图'">
    <!-- 网格与价格刻度 -->
    <g v-for="t in gridTicks" :key="t.label + t.yv">
      <line :x1="PAD.left" :x2="W - PAD.right" :y1="t.yv" :y2="t.yv" stroke="#e9ecef" stroke-width="1" />
      <text :x="W - PAD.right + 4" :y="t.yv + 3" font-size="10" fill="#868e96">{{ t.label }}</text>
    </g>
    <!-- 标题与图例 -->
    <text v-if="title" :x="PAD.left + 2" :y="PAD.top - 4" font-size="11" fill="#495057">{{ title }}</text>
    <text
      v-for="(o, i) in overlayPaths"
      :key="'legend-' + o.name"
      :x="W - PAD.right - 8 - i * 60"
      :y="PAD.top - 4"
      font-size="10"
      :fill="o.color"
      text-anchor="end"
    >
      {{ o.name }}
    </text>
    <!-- 叠加线（均线/布林带等，数据出自 companion 计算） -->
    <polyline v-for="o in overlayPaths" :key="'ov-' + o.name" :points="o.d" fill="none" :stroke="o.color" stroke-width="1.4" />
    <!-- K线：影线两条 + 实体一个 -->
    <g v-for="b in bars" :key="'bar' + b.key">
      <line :x1="b.cx" :x2="b.cx" :y1="b.wickTop" :y2="b.wickBottom" :stroke="b.color" stroke-width="1" />
      <rect :x="b.bodyX" :y="b.bodyY" :width="b.bodyW" :height="b.bodyH" :fill="b.color" />
    </g>
    <!-- 形态/信号标记 -->
    <g v-for="m in markerShapes" :key="m.key">
      <path :d="m.shape" :fill="m.color" />
      <text :x="m.cx" :y="m.textY" font-size="10" :fill="m.color" text-anchor="middle">{{ m.label }}</text>
    </g>
    <!-- 成交量副图 -->
    <g v-if="hasVolume">
      <line :x1="PAD.left" :x2="W - PAD.right" :y1="volTop" :y2="volTop" stroke="#ced4da" stroke-width="1" />
      <rect
        v-for="v in volBars"
        :key="'vol' + v.key"
        :x="v.x"
        :y="volTop + (VOL_H - 6 - v.h)"
        :width="v.w"
        :height="v.h"
        :fill="v.color"
        opacity="0.55"
      />
    </g>
    <!-- 日期刻度 -->
    <g v-for="d in dateTicks" :key="'date' + d.label + d.x">
      <text :x="d.x" :y="height - 6" font-size="10" fill="#868e96" text-anchor="middle">{{ d.label }}</text>
    </g>
  </svg>
</template>

<style scoped>
.kline-chart {
  width: 100%;
  height: auto;
  background: #fdfdfd;
  border: 1px solid #e9ecef;
  border-radius: 6px;
}
.kline-empty {
  color: #868e96;
  padding: 12px;
}
</style>
