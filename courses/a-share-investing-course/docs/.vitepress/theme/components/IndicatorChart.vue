<script setup lang="ts">
// IndicatorChart：echarts 版 K 线主图 + 指标副图（+ 可选量副图）交互组件。
// 与 KLineChart（SVG 定格图）的分工：教学正文里的静态示意用 KLineChart；
// 需要 tooltip 读数、缩放平移、主副图十字光标联动时用本组件。
//
// SSR 硬约束：VitePress build 会先在 Node 端执行本模块，因此顶层禁止
// import echarts（含 echarts/core）；echarts 只能在 onMounted 里经
// echartsClient 动态加载（见 echartsClient.ts 注释）。
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { EChartsType } from 'echarts/core'
import { initChart, type ChartOption } from './echartsClient'

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
interface ThresholdT {
  value: number
  label?: string
  band?: boolean
}
interface SubT {
  bars?: { name: string; values: (number | null)[] }[]
  lines?: { name: string; values: (number | null)[]; color?: string }[]
  thresholds?: ThresholdT[]
  markers?: MarkerT[]
}

const props = withDefaults(
  defineProps<{
    candles: CandleT[]
    overlays?: OverlayT[]
    markers?: MarkerT[]
    sub?: SubT
    subLabel?: string
    showVolume?: boolean
    height?: number
    title?: string
  }>(),
  { subLabel: '', showVolume: true, height: 420, title: '' },
)

// 配色与 KLineChart 完全一致：A 股红涨绿跌
const UP = '#d94848'
const DOWN = '#2b8a3e'
const GRAY = '#495057'
const PALETTE = ['#e8833a', '#7048e8', '#0c8599', '#d6336c']

// 布局常量（px）：legend 高、grid 间距、底部 dataZoom 滑块、日期标签
const TITLE_H = 22
const LEGEND_H = 22
const GAP = 8
const SLIDER_H = 18
const SLIDER_B = 6
const XLAB = 16

const elRef = ref<HTMLElement | null>(null)
const ready = ref(false)
let chart: EChartsType | null = null
let ro: ResizeObserver | null = null
let disposed = false

const n = computed(() => props.candles.length)
const hasVol = computed(() => props.showVolume && props.candles.some((c) => (c.volume ?? 0) > 0))
const hasSub = computed(() => {
  const s = props.sub
  if (!s) return false
  return (s.bars?.length ?? 0) + (s.lines?.length ?? 0) + (s.thresholds?.length ?? 0) > 0
})
const bodyH = computed(() => props.height - (props.title ? TITLE_H : 0) - 2)

// 价格纵向跨度：给主图标记（金叉/死叉三角）让出蜡烛外侧的偏移量
const span = computed(() => {
  if (n.value === 0) return 1
  return Math.max(...props.candles.map((c) => c.high)) - Math.min(...props.candles.map((c) => c.low))
})

function fmtVol(v: number): string {
  return v >= 1e8 ? `${(v / 1e8).toFixed(2)}亿` : v >= 1e4 ? `${(v / 1e4).toFixed(2)}万` : String(Math.round(v))
}
function fmtNum(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? '—' : v.toFixed(2)
}

// grid 顺序遵循行情软件惯例：主图 → 成交量 → 指标副图；副图不与主图交换 x 轴，
// 各 grid 各持一条 category x 轴（数据相同、仅最底部显示刻度），靠 axisPointer
// link 实现十字光标联动、靠 dataZoom 的 xAxisIndex 数组实现同步缩放。
function buildOption(): ChartOption {
  const dates = props.candles.map((c) => c.date)
  const order: ('main' | 'vol' | 'sub')[] = ['main']
  if (hasVol.value) order.push('vol')
  if (hasSub.value) order.push('sub')
  const wMap: Record<string, number> =
    order.length === 3
      ? { main: 0.54, vol: 0.22, sub: 0.24 }
      : order.length === 2
        ? { main: 0.7, [order[1]]: 0.3 }
        : { main: 1 }
  const area = bodyH.value - LEGEND_H - SLIDER_H - SLIDER_B - XLAB - 4 - GAP * (order.length - 1)
  let top = LEGEND_H + 4
  const grids = order.map((k) => {
    const g = { top, height: Math.max(36, Math.round(area * wMap[k])) }
    top += g.height + GAP
    return g
  })
  const lastX = order.length - 1
  const idxOf = (k: 'main' | 'vol' | 'sub') => order.indexOf(k)

  const xAxis = order.map((_, i) => ({
    type: 'category',
    gridIndex: i,
    data: dates,
    axisTick: { show: false },
    axisLine: { lineStyle: { color: '#ced4da' } },
    axisLabel: { show: i === lastX, fontSize: 10, color: '#868e96', margin: 6 },
    splitLine: { show: false },
    // 只在最底部 x 轴显示游标标签，避免多 grid 重复
    axisPointer: { label: { show: i === lastX } },
  }))

  const yAxis = order.map((k) => {
    if (k === 'main')
      return {
        type: 'value',
        gridIndex: idxOf('main'),
        position: 'right',
        scale: true,
        splitNumber: 4,
        axisLabel: { fontSize: 10, color: '#868e96', formatter: (v: number) => v.toFixed(2) },
        splitLine: { lineStyle: { color: '#e9ecef' } },
        axisPointer: { label: { precision: 2 } },
      }
    if (k === 'vol')
      return {
        type: 'value',
        gridIndex: idxOf('vol'),
        position: 'right',
        axisLabel: { fontSize: 10, color: '#868e96', formatter: fmtVol },
        splitLine: { show: false },
        axisPointer: { label: { formatter: (p: { value: number }) => fmtVol(Number(p.value)) } },
      }
    return {
      type: 'value',
      gridIndex: idxOf('sub'),
      position: 'right',
      scale: true,
      splitNumber: 3,
      axisLabel: { fontSize: 10, color: '#868e96' },
      splitLine: { lineStyle: { color: '#f1f3f5' } },
      name: props.subLabel,
      nameTextStyle: { fontSize: 10, color: GRAY },
      axisPointer: { label: { precision: 2 } },
    }
  })

  // K 线数据顺序为 echarts 约定的 [open, close, low, high]
  const series: Record<string, unknown>[] = [
    {
      type: 'candlestick',
      name: 'K线',
      xAxisIndex: idxOf('main'),
      yAxisIndex: idxOf('main'),
      barMaxWidth: 13,
      data: props.candles.map((c) => [c.open, c.close, c.low, c.high]),
      itemStyle: { color: UP, borderColor: UP, color0: DOWN, borderColor0: DOWN },
    },
  ]

  for (const [oi, o] of (props.overlays ?? []).entries()) {
    const color = o.color ?? PALETTE[oi % PALETTE.length]
    series.push({
      type: 'line',
      name: o.name,
      xAxisIndex: idxOf('main'),
      yAxisIndex: idxOf('main'),
      data: o.values,
      symbol: 'none',
      lineStyle: { color, width: 1.4 },
      itemStyle: { color },
      emphasis: { focus: 'series' },
    })
  }

  // 主图信号标记：bull 在低点下方红三角、bear 在高点上方绿三角、info 圆点，
  // 用 scatter 承载（每个点可带独立 symbol/label，比 markPoint 更可控）
  if (props.markers?.length) {
    const off = Math.max(span.value * 0.06, span.value * 1e-6, 1e-9)
    series.push({
      type: 'scatter',
      xAxisIndex: idxOf('main'),
      yAxisIndex: idxOf('main'),
      z: 5,
      data: props.markers
        .filter((m) => m.index >= 0 && m.index < n.value)
        .map((m) => {
          const c = props.candles[m.index]
          const kind = m.kind ?? 'info'
          const color = kind === 'bull' ? UP : kind === 'bear' ? DOWN : GRAY
          const bull = kind === 'bull'
          return {
            value: [m.index, bull ? c.low - off : c.high + off],
            symbol: kind === 'info' ? 'circle' : 'triangle',
            symbolRotate: kind === 'bear' ? 180 : 0,
            symbolSize: kind === 'info' ? 7 : 9,
            itemStyle: { color },
            label: { show: true, position: bull ? 'bottom' : 'top', formatter: m.label, fontSize: 9, color },
          }
        }),
    })
  }

  if (hasVol.value) {
    // 量副图沿用 KLineChart 的语义：按当日涨跌着色、半透明
    series.push({
      type: 'bar',
      name: '成交量',
      xAxisIndex: idxOf('vol'),
      yAxisIndex: idxOf('vol'),
      barMaxWidth: 20,
      data: props.candles.map((c) => ({
        value: c.volume ?? 0,
        itemStyle: { color: c.close >= c.open ? UP : DOWN, opacity: 0.55 },
      })),
    })
  }

  const sub = hasSub.value ? props.sub : undefined
  if (sub) {
    const xi = idxOf('sub')
    const yi = idxOf('sub')
    for (const [bi, b] of (sub.bars ?? []).entries()) {
      // 柱系列按正负自动红/绿（MACD 柱：多头红、空头绿）
      series.push({
        type: 'bar',
        name: b.name,
        xAxisIndex: xi,
        yAxisIndex: yi,
        barMaxWidth: 10,
        data: b.values.map((v) =>
          v == null || !Number.isFinite(v)
            ? null
            : { value: v, itemStyle: { color: v >= 0 ? UP : DOWN, opacity: 0.85 } },
        ),
        markLine: bi === 0 ? subMarkLine(sub) : undefined,
        markArea: bi === 0 ? subMarkArea(sub) : undefined,
      })
    }
    for (const [li, l] of (sub.lines ?? []).entries()) {
      const color = l.color ?? PALETTE[((props.overlays?.length ?? 0) + li) % PALETTE.length]
      series.push({
        type: 'line',
        name: l.name,
        xAxisIndex: xi,
        yAxisIndex: yi,
        data: l.values,
        symbol: 'none',
        lineStyle: { color, width: 1.3 },
        itemStyle: { color },
        emphasis: { focus: 'series' },
        // 没有柱系列时由第一条折线承载阈值参考线
        markLine: (sub.bars?.length ?? 0) === 0 && li === 0 ? subMarkLine(sub) : undefined,
        markArea: (sub.bars?.length ?? 0) === 0 && li === 0 ? subMarkArea(sub) : undefined,
      })
    }
    // 副图只有阈值（无柱无线）时补一条全空折线作为 markLine 宿主
    if (!sub.bars?.length && !sub.lines?.length) {
      series.push({
        type: 'line',
        xAxisIndex: xi,
        yAxisIndex: yi,
        data: dates.map(() => null),
        symbol: 'none',
        markLine: subMarkLine(sub),
        markArea: subMarkArea(sub),
      })
    }
    if (sub.markers?.length) {
      const hostVals = sub.bars?.[0]?.values ?? sub.lines?.[0]?.values
      series.push({
        type: 'scatter',
        xAxisIndex: xi,
        yAxisIndex: yi,
        z: 5,
        data: sub.markers
          .filter((m) => m.index >= 0 && m.index < n.value)
          .map((m) => {
            const kind = m.kind ?? 'info'
            const color = kind === 'bull' ? UP : kind === 'bear' ? DOWN : GRAY
            const y = hostVals?.[m.index]
            return {
              value: [m.index, y == null || !Number.isFinite(y) ? 0 : y],
              symbol: kind === 'info' ? 'circle' : 'triangle',
              symbolRotate: kind === 'bear' ? 180 : 0,
              symbolSize: kind === 'info' ? 6 : 8,
              itemStyle: { color },
              label: { show: true, position: 'top', formatter: m.label, fontSize: 9, color },
            }
          }),
      })
    }
  }

  const legendData = [
    ...(props.overlays ?? []).map((o) => o.name),
    ...(hasVol.value ? ['成交量'] : []),
    ...(sub?.bars ?? []).map((b) => b.name),
    ...(sub?.lines ?? []).map((l) => l.name),
  ]

  return {
    axisPointer: { link: [{ xAxisIndex: 'all' }], label: { backgroundColor: GRAY } },
    legend: { data: legendData, top: 0, left: 8, itemWidth: 14, itemHeight: 8, textStyle: { fontSize: 10, color: GRAY } },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross', crossStyle: { color: '#adb5bd' } },
      confine: true,
      textStyle: { fontSize: 11 },
      formatter: tooltipFormatter,
    },
    grid: grids.map((g) => ({ left: 10, right: 56, top: g.top, height: g.height })),
    xAxis,
    yAxis,
    dataZoom: [
      { type: 'inside', xAxisIndex: order.map((_, i) => i) },
      {
        type: 'slider',
        xAxisIndex: order.map((_, i) => i),
        bottom: SLIDER_B,
        height: SLIDER_H,
        borderColor: '#ced4da',
        fillerColor: 'rgba(206,212,218,0.3)',
        handleStyle: { color: '#adb5bd' },
        textStyle: { fontSize: 9, color: '#868e96' },
        dataBackground: { lineStyle: { color: '#dee2e6' }, areaStyle: { color: 'rgba(222,226,230,0.4)' } },
      },
    ],
    series,
  }
}

// 副图阈值：水平虚线（RSI 70/30、KDJ 80/20 等）；band=true 的阈值对之间
// 叠半透明色带标出超买/超卖区
function subMarkLine(sub: SubT): Record<string, unknown> {
  return {
    silent: true,
    symbol: 'none',
    animation: false,
    lineStyle: { type: 'dashed', color: '#868e96', width: 1 },
    label: { show: true, position: 'insideEndTop', fontSize: 9, color: '#868e96' },
    data: (sub.thresholds ?? []).map((t) => ({ yAxis: t.value, label: { formatter: t.label ?? String(t.value) } })),
  }
}
function subMarkArea(sub: SubT): Record<string, unknown> | undefined {
  const band = (sub.thresholds ?? []).filter((t) => t.band)
  if (band.length < 2) return undefined
  const vs = band.map((t) => t.value)
  return {
    silent: true,
    itemStyle: { color: 'rgba(130,140,150,0.1)' },
    data: [[{ xAxis: 0, yAxis: Math.min(...vs) }, { xAxis: n.value - 1, yAxis: Math.max(...vs) }]],
  }
}

// tooltip 用闭包直接读 props：跨 grid 联动时不管悬停在哪个 grid，都给出
// 同一下标的完整读数（OHLC/均线/成交量/副图指标/当日信号）
function tooltipFormatter(params: unknown): string {
  const arr = (Array.isArray(params) ? params : [params]) as { dataIndex: number }[]
  const i = arr[0]?.dataIndex ?? 0
  const c = props.candles[i]
  if (!c) return ''
  const prev = i > 0 ? props.candles[i - 1].close : c.open
  const pct = prev ? ((c.close - prev) / prev) * 100 : 0
  const rows: string[] = [`<b>${c.date}</b>`, `开 ${fmtNum(c.open)}　收 ${fmtNum(c.close)}`, `高 ${fmtNum(c.high)}　低 ${fmtNum(c.low)}`]
  rows.push(`<span style="color:${pct >= 0 ? UP : DOWN}">涨跌幅 ${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%</span>`)
  for (const o of props.overlays ?? []) rows.push(`${o.name} ${fmtNum(o.values[i])}`)
  if (hasVol.value) rows.push(`成交量 ${fmtVol(c.volume ?? 0)}`)
  const sub = props.sub
  if (sub) {
    for (const b of sub.bars ?? []) rows.push(`${b.name} ${fmtNum(b.values[i])}`)
    for (const l of sub.lines ?? []) rows.push(`${l.name} ${fmtNum(l.values[i])}`)
  }
  for (const m of props.markers ?? [])
    if (m.index === i) rows.push(`<span style="color:${m.kind === 'bear' ? DOWN : UP}">信号 ${m.label}</span>`)
  for (const m of sub?.markers ?? [])
    if (m.index === i) rows.push(`<span style="color:${m.kind === 'bear' ? DOWN : UP}">副图信号 ${m.label}</span>`)
  return rows.join('<br/>')
}

onMounted(async () => {
  const el = elRef.value
  if (!el || n.value === 0) return
  chart = await initChart(el)
  if (disposed) {
    // 动态 import 完成前组件已被卸载：立即释放，避免泄漏
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

// 数据引用变化时整图重设（notMerge 防止旧 series 残留）；resize 由
// ResizeObserver 处理，echarts 的 resize 会保留当前 option
watch(
  [() => props.candles, () => props.overlays, () => props.markers, () => props.sub, () => props.showVolume, () => props.subLabel],
  () => {
    chart?.setOption(buildOption(), { notMerge: true })
  },
)
</script>

<template>
  <div v-if="n === 0" class="ic-empty">（无数据）</div>
  <!-- 外层固定总高：SSR 首屏与挂载后高度一致，避免 echarts 初始化时布局跳动 -->
  <div v-else class="ic-chart" :style="{ height: height + 'px' }" role="img" :aria-label="title || 'K线指标交互图'">
    <div v-if="title" class="ic-title">{{ title }}</div>
    <div ref="elRef" class="ic-body">
      <div v-if="!ready" class="ic-loading">图表加载中…</div>
    </div>
  </div>
</template>

<style scoped>
.ic-chart {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  width: 100%;
  background: #fdfdfd;
  border: 1px solid #e9ecef;
  border-radius: 6px;
}
.ic-title {
  height: 22px;
  line-height: 22px;
  padding: 0 8px;
  font-size: 11px;
  color: #495057;
}
.ic-body {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
}
.ic-loading {
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
.ic-empty {
  color: #868e96;
  padding: 12px;
}
</style>
