<script setup lang="ts">
// ChipDistChart：筹码分布水平直方图（价格档 y 轴 × 筹码量 x 轴）。
// 用途：教学「获利盘/套牢盘」读图——低于现价的筹码获利（红），高于现价套牢（绿）。
// 与 SVG 定格图分工同 IndicatorChart：需要 hover 读占比、现价/成本线对照时用本组件。
//
// SSR 硬约束：顶层禁止 import echarts，仅 onMounted 后经 echartsClient 动态加载。
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { EChartsType } from 'echarts/core'
import { initChart, type ChartOption } from './echartsClient'

interface BinT {
  price: number
  volume: number
  profitable?: boolean
}

const props = withDefaults(
  defineProps<{
    bins: BinT[]
    currentPrice?: number
    avgCost?: number
    height?: number
    title?: string
  }>(),
  { height: 360, title: '' },
)

// 配色延续 KLineChart：获利盘红、套牢盘绿（A 股语义），未标注档位用站内中性灰蓝
const UP = '#d94848'
const DOWN = '#2b8a3e'
const NEUTRAL = '#868e96'
const PRICE_LINE = '#e8590c' // 现价：橙红虚线，与获利盘红区分
const COST_LINE = '#1971c2' // 平均成本：蓝虚线

const TITLE_H = 22
const X_NAME_H = 16 // 底部「筹码量」轴名占位

const elRef = ref<HTMLElement | null>(null)
const ready = ref(false)
let chart: EChartsType | null = null
let ro: ResizeObserver | null = null
let disposed = false

const n = computed(() => props.bins.length)
// 升序拷贝：y 轴自下而上从小到大，符合「低价在下」的看盘习惯（不改动传入 props）
const sorted = computed(() => [...props.bins].sort((a, b) => a.price - b.price))
// 相邻价格档的最小间距作为一档步长：y 轴 min/max/interval 都按它对齐，
// 使每根横条的格线恰好落在价格档上，markLine 也能用精确价格定位
const step = computed(() => {
  if (n.value < 2) return 1
  let d = Infinity
  for (let i = 1; i < sorted.value.length; i++) d = Math.min(d, sorted.value[i].price - sorted.value[i - 1].price)
  return d > 0 ? d : 1
})
const totalVol = computed(() => sorted.value.reduce((s, b) => s + b.volume, 0))
const bodyH = computed(() => props.height - (props.title ? TITLE_H : 0) - 2)

function fmtVol(v: number): string {
  return v >= 1e8 ? `${(v / 1e8).toFixed(2)}亿` : v >= 1e4 ? `${(v / 1e4).toFixed(2)}万` : String(Math.round(v))
}

function buildOption(): ChartOption {
  const bins = sorted.value
  const p0 = bins[0].price
  const pLast = bins[bins.length - 1].price
  // 上下各放宽一档：横条不顶边，刻度线正好逐档落位
  const yMin = p0 - step.value
  const yMax = pLast + step.value
  // 柱宽用像素估算（值轴上 bar 无 category 带宽可依赖）：绘图高 ≈ 总高 - 上下留白，
  // y 轴共跨 n+1 档；误差只影响条形胖瘦，不影响位置正确性
  const plotH = bodyH.value - 20 - 26
  const barW = Math.max(2, Math.min(18, Math.floor((plotH / (n.value + 1)) * 0.8)))

  const markLines: Record<string, unknown>[] = []
  if (props.currentPrice != null && Number.isFinite(props.currentPrice))
    markLines.push({ yAxis: props.currentPrice, lineStyle: { color: PRICE_LINE }, label: { formatter: `现价 ${props.currentPrice.toFixed(2)}` } })
  if (props.avgCost != null && Number.isFinite(props.avgCost))
    markLines.push({ yAxis: props.avgCost, lineStyle: { color: COST_LINE }, label: { formatter: `平均成本 ${props.avgCost.toFixed(2)}` } })

  return {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross', crossStyle: { color: '#adb5bd' } },
      confine: true,
      textStyle: { fontSize: 11 },
      formatter: tooltipFormatter,
    },
    grid: { left: 10, right: 64, top: 14, bottom: 34 },
    xAxis: {
      type: 'value',
      name: '筹码量',
      nameLocation: 'middle',
      nameGap: 22,
      nameTextStyle: { fontSize: 10, color: '#868e96' },
      axisLabel: { fontSize: 10, color: '#868e96', formatter: (v: number) => fmtVol(v) },
      splitLine: { lineStyle: { color: '#f1f3f5' } },
    },
    yAxis: {
      type: 'value',
      position: 'right',
      min: yMin,
      max: yMax,
      interval: step.value,
      axisLabel: { fontSize: 10, color: '#868e96', formatter: (v: number) => v.toFixed(2) },
      splitLine: { lineStyle: { color: '#e9ecef' } },
      axisPointer: { label: { precision: 2 } },
    },
    series: [
      {
        type: 'bar',
        barWidth: barW,
        data: bins.map((b) => ({
          value: [b.volume, b.price],
          itemStyle: {
            color: b.profitable === true ? UP : b.profitable === false ? DOWN : NEUTRAL,
            opacity: b.profitable == null ? 0.65 : 0.85,
          },
        })),
        markLine: markLines.length
          ? {
              silent: true,
              symbol: 'none',
              animation: false,
              lineStyle: { type: 'dashed', width: 1 },
              label: { show: true, position: 'end', fontSize: 9 },
              data: markLines,
            }
          : undefined,
      },
    ],
  }
}

function tooltipFormatter(params: unknown): string {
  const arr = (Array.isArray(params) ? params : [params]) as { dataIndex: number }[]
  const b = sorted.value[arr[0]?.dataIndex ?? 0]
  if (!b || totalVol.value <= 0) return ''
  const pct = ((b.volume / totalVol.value) * 100).toFixed(1)
  const state =
    b.profitable === true
      ? `<span style="color:${UP}">获利盘</span>`
      : b.profitable === false
        ? `<span style="color:${DOWN}">套牢盘</span>`
        : '未标注'
  return [`<b>价格档 ${b.price.toFixed(2)}</b>`, `筹码量 ${fmtVol(b.volume)}`, `占比 ${pct}%`, `状态 ${state}`].join('<br/>')
}

onMounted(async () => {
  const el = elRef.value
  if (!el || n.value === 0) return
  chart = await initChart(el)
  if (disposed) {
    chart.dispose()
    chart = null
    return
  }
  chart.setOption(buildOption())
  ready.value = true
  ro = new ResizeObserver(() => chart?.resize())
  ro.observe(el)
})

onBeforeUnmount(() => {
  disposed = true
  ro?.disconnect()
  chart?.dispose()
  chart = null
})

watch([() => props.bins, () => props.currentPrice, () => props.avgCost], () => {
  chart?.setOption(buildOption(), { notMerge: true })
})
</script>

<template>
  <div v-if="n === 0" class="cd-empty">（无数据）</div>
  <div v-else class="cd-chart" :style="{ height: height + 'px' }" role="img" :aria-label="title || '筹码分布图'">
    <div v-if="title" class="cd-title">{{ title }}</div>
    <div ref="elRef" class="cd-body">
      <div v-if="!ready" class="cd-loading">图表加载中…</div>
    </div>
  </div>
</template>

<style scoped>
.cd-chart {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  width: 100%;
  background: #fdfdfd;
  border: 1px solid #e9ecef;
  border-radius: 6px;
}
.cd-title {
  height: 22px;
  line-height: 22px;
  padding: 0 8px;
  font-size: 11px;
  color: #495057;
}
.cd-body {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
}
.cd-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: #868e96;
  background: #fdfdfd;
  pointer-events: none;
}
.cd-empty {
  color: #868e96;
  padding: 12px;
}
</style>
