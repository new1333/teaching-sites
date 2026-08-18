<script setup lang="ts">
// LineChart：纯折线/面积图（资金曲线、筹码分布轮廓、破产概率曲线等），数据出自 companion 计算。
import { computed } from 'vue'

interface SeriesT {
  name: string
  values: (number | null)[]
  color?: string
  area?: boolean
}

const props = withDefaults(
  defineProps<{
    series: SeriesT[]
    labels?: string[]
    height?: number
    title?: string
    percentY?: boolean
  }>(),
  { height: 260, title: '', percentY: false },
)

const PALETTE = ['#1c7ed6', '#e8590c', '#2f9e44', '#9c36b5']
const W = 760
const PAD = { left: 10, right: 52, top: 16, bottom: 20 }

const n = computed(() => Math.max(...props.series.map((s) => s.values.length), 1))
const plotW = W - PAD.left - PAD.right
const plotH = props.height - PAD.top - PAD.bottom

const flat = computed(() =>
  props.series.flatMap((s) => s.values.filter((v): v is number => v != null && Number.isFinite(v))),
)
const lo = computed(() => (flat.value.length ? Math.min(...flat.value) : 0))
const hi = computed(() => {
  const max = flat.value.length ? Math.max(...flat.value) : 1
  return max === lo.value ? lo.value + 1 : max
})
const span = computed(() => hi.value - lo.value)

function yOf(v: number): number {
  return PAD.top + (1 - (v - lo.value) / span.value) * plotH
}
function xOf(i: number): number {
  return PAD.left + (n.value > 1 ? (i / (n.value - 1)) * plotW : plotW / 2)
}
function fmt(v: number): string {
  return props.percentY ? `${(v * 100).toFixed(1)}%` : Math.abs(v) >= 1000 ? v.toFixed(0) : v.toFixed(2)
}

const seriesView = computed(() =>
  props.series.map((s, si) => {
    const pts = s.values
      .map((v, i) => (v == null || !Number.isFinite(v) ? null : `${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`))
      .filter((p): p is string => p != null)
    const color = s.color ?? PALETTE[si % PALETTE.length]
    const areaD = s.area && pts.length ? `M ${PAD.left},${(PAD.top + plotH).toFixed(1)} L ${pts.join(' L ')} L ${(PAD.left + plotW).toFixed(1)},${(PAD.top + plotH).toFixed(1)} Z` : ''
    return { name: s.name, color, d: pts.join(' '), areaD }
  }),
)

const ticks = computed(() => {
  const out: { yv: number; label: string }[] = []
  for (let i = 0; i <= 4; i++) {
    const v = lo.value + (span.value * i) / 4
    out.push({ yv: yOf(v), label: fmt(v) })
  }
  return out
})

const xTicks = computed(() => {
  if (!props.labels?.length) return []
  const want = Math.min(6, props.labels.length)
  const out: { x: number; label: string }[] = []
  for (let i = 0; i < want; i++) {
    const idx = Math.round((i * (props.labels.length - 1)) / (want - 1 || 1))
    out.push({ x: xOf(idx), label: props.labels[idx] })
  }
  return out
})

// 零轴（资金曲线跨 0 时画出基准线）
const zeroY = computed(() => (lo.value < 0 && hi.value > 0 ? yOf(0) : null))
</script>

<template>
  <svg :viewBox="`0 0 ${W} ${height}`" class="line-chart" role="img" :aria-label="title || '折线图'">
    <g v-for="t in ticks" :key="t.label + t.yv">
      <line :x1="PAD.left" :x2="W - PAD.right" :y1="t.yv" :y2="t.yv" stroke="#e9ecef" stroke-width="1" />
      <text :x="W - PAD.right + 4" :y="t.yv + 3" font-size="10" fill="#868e96">{{ t.label }}</text>
    </g>
    <line v-if="zeroY != null" :x1="PAD.left" :x2="W - PAD.right" :y1="zeroY" :y2="zeroY" stroke="#adb5bd" stroke-dasharray="4 3" stroke-width="1" />
    <text v-if="title" :x="PAD.left + 2" :y="PAD.top - 4" font-size="11" fill="#495057">{{ title }}</text>
    <path v-for="s in seriesView" :key="'area-' + s.name" v-show="s.areaD" :d="s.areaD" :fill="s.color" opacity="0.12" />
    <polyline v-for="s in seriesView" :key="'line-' + s.name" :points="s.d" fill="none" :stroke="s.color" stroke-width="1.6" />
    <text
      v-for="(s, i) in seriesView"
      :key="'legend-' + s.name"
      :x="PAD.left + 4 + i * 72"
      :y="PAD.top - 4"
      font-size="10"
      :fill="s.color"
    >
      {{ s.name }}
    </text>
    <g v-for="t in xTicks" :key="'x' + t.label + t.x">
      <text :x="t.x" :y="height - 6" font-size="10" fill="#868e96" text-anchor="middle">{{ t.label }}</text>
    </g>
  </svg>
</template>

<style scoped>
.line-chart {
  width: 100%;
  height: auto;
  background: #fdfdfd;
  border: 1px solid #e9ecef;
  border-radius: 6px;
}
</style>
