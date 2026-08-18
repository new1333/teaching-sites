<script setup lang="ts">
// BacktestChart：回测净值交互图（echarts）。
// 与 LineChart（SVG 定格图）的分工：正文静态示意用 LineChart；需要 tooltip
// 读数、交易点标注、净值/回撤双区联动缩放时用本组件。
//
// SSR 硬约束：顶层禁止 import echarts（含 echarts/core），仅在 onMounted 后
// 经 echartsClient 动态加载（见 echartsClient.ts 注释）。
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { EChartsType } from 'echarts/core'
import { initChart, type ChartOption } from './echartsClient'

interface TradeT {
  index: number
  kind: 'buy' | 'sell'
  note?: string
}

const props = withDefaults(
  defineProps<{
    dates: string[]
    equity: number[]
    benchmark?: number[]
    trades?: TradeT[]
    /** 回撤序列：负数比率（-0.23 即 -23%），与 dates 等长，缺项置 null */
    drawdown?: number[]
    height?: number
    title?: string
  }>(),
  { height: 420, title: '' },
)

// 配色沿用站内调色板：策略=橙、基准=青（虚线）；交易点与回撤遵循红涨绿跌
const UP = '#d94848' // 买入箭头：红
const DOWN = '#2b8a3e' // 卖出箭头与回撤水下曲线：绿
const STRATEGY = '#e8833a'
const BENCH = '#0c8599'
const GRAY = '#495057'

// 布局常量（px），与 IndicatorChart 同一套刻度语义
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

const n = computed(() => Math.min(props.dates.length, props.equity.length))
// 回撤区只在传入至少一个有限负值时启用（双 grid + dataZoom 模式随之开启）
const hasDD = computed(
  () => (props.drawdown ?? []).some((v) => v != null && Number.isFinite(v)),
)
const bodyH = computed(() => props.height - (props.title ? TITLE_H : 0) - 2)

// 净值纵向跨度：给交易点箭头让出折线两侧的偏移量
const span = computed(() => {
  if (n.value === 0) return 1
  const vals = [...props.equity, ...(props.benchmark ?? [])].filter((v) => v != null && Number.isFinite(v))
  return vals.length ? Math.max(...vals) - Math.min(...vals) : 1
})

function fmtNav(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? '—' : v.toFixed(2)
}
function fmtDD(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(1)}%`
}

// 双 grid 模式与 IndicatorChart 相同：各 grid 各持一条 category x 轴（数据相同、
// 仅最底部显示刻度），axisPointer link 联动十字光标，dataZoom 数组同步缩放。
function buildOption(): ChartOption {
  const dates = props.dates.slice(0, n.value)
  const equity = dates.map((_, i) => props.equity[i] ?? null)
  const benchmark = props.benchmark ? dates.map((_, i) => props.benchmark![i] ?? null) : undefined
  const dd = hasDD.value ? dates.map((_, i) => props.drawdown![i] ?? null) : undefined

  const order: ('nav' | 'dd')[] = hasDD.value ? ['nav', 'dd'] : ['nav']
  const wMap: Record<string, number> = hasDD.value ? { nav: 0.7, dd: 0.3 } : { nav: 1 }
  const area =
    bodyH.value - LEGEND_H - XLAB - 4 - (hasDD.value ? SLIDER_H + SLIDER_B : 0) - GAP * (order.length - 1)
  let top = LEGEND_H + 4
  const grids = order.map((k) => {
    const g = { top, height: Math.max(36, Math.round(area * wMap[k])) }
    top += g.height + GAP
    return g
  })
  const lastX = order.length - 1

  const xAxis = order.map((_, i) => ({
    type: 'category',
    gridIndex: i,
    data: dates,
    axisTick: { show: false },
    axisLine: { lineStyle: { color: '#ced4da' } },
    axisLabel: { show: i === lastX, fontSize: 10, color: '#868e96', margin: 6 },
    splitLine: { show: false },
    axisPointer: { label: { show: i === lastX } },
  }))

  const yAxis: Record<string, unknown>[] = [
    {
      type: 'value',
      gridIndex: 0,
      position: 'right',
      scale: true,
      splitNumber: 4,
      axisLabel: { fontSize: 10, color: '#868e96', formatter: (v: number) => v.toFixed(2) },
      splitLine: { lineStyle: { color: '#e9ecef' } },
      axisPointer: { label: { precision: 2 } },
    },
  ]
  if (hasDD.value) {
    const ddMin = Math.min(...(dd as (number | null)[]).filter((v): v is number => v != null && Number.isFinite(v)))
    yAxis.push({
      type: 'value',
      gridIndex: 1,
      position: 'right',
      max: 0,
      min: Math.floor(ddMin * 1.15 * 100) / 100,
      splitNumber: 2,
      axisLabel: { fontSize: 10, color: '#868e96', formatter: (v: number) => `${(v * 100).toFixed(0)}%` },
      splitLine: { lineStyle: { color: '#f1f3f5' } },
      axisPointer: { label: { formatter: (p: { value: number }) => fmtDD(Number(p.value)) } },
    })
  }

  const series: Record<string, unknown>[] = [
    {
      type: 'line',
      name: '策略净值',
      xAxisIndex: 0,
      yAxisIndex: 0,
      data: equity,
      symbol: 'none',
      lineStyle: { color: STRATEGY, width: 1.6 },
      itemStyle: { color: STRATEGY },
      emphasis: { focus: 'series' },
      z: 3,
    },
  ]
  if (benchmark) {
    series.push({
      type: 'line',
      name: '基准(买入持有)',
      xAxisIndex: 0,
      yAxisIndex: 0,
      data: benchmark,
      symbol: 'none',
      lineStyle: { color: BENCH, width: 1.2, type: 'dashed' },
      itemStyle: { color: BENCH },
      emphasis: { focus: 'series' },
    })
  }
  if (dd) {
    // 水下曲线：负值绿色半透明面积，max=0 保证水面线贴住 0 轴
    series.push({
      type: 'line',
      name: '回撤',
      xAxisIndex: 1,
      yAxisIndex: 1,
      data: dd,
      symbol: 'none',
      lineStyle: { color: DOWN, width: 1 },
      itemStyle: { color: DOWN },
      areaStyle: { color: DOWN, opacity: 0.35 },
      emphasis: { focus: 'series' },
    })
  }
  if (props.trades?.length) {
    // 交易点：buy 折线下方红上箭头、sell 折线上方绿下箭头；说明文字走 tooltip
    const off = Math.max(span.value * 0.05, span.value * 1e-6, 1e-9)
    series.push({
      type: 'scatter',
      xAxisIndex: 0,
      yAxisIndex: 0,
      z: 5,
      data: props.trades
        .filter((t) => t.index >= 0 && t.index < n.value)
        .map((t) => {
          const buy = t.kind === 'buy'
          const v = equity[t.index]
          return {
            value: [t.index, v == null || !Number.isFinite(v) ? null : buy ? v - off : v + off],
            symbol: 'triangle',
            symbolRotate: buy ? 0 : 180,
            symbolSize: 9,
            itemStyle: { color: buy ? UP : DOWN },
          }
        }),
    })
  }

  const legendData = ['策略净值', ...(benchmark ? ['基准(买入持有)'] : []), ...(dd ? ['回撤'] : [])]

  return {
    ...(hasDD.value ? { axisPointer: { link: [{ xAxisIndex: 'all' }], label: { backgroundColor: GRAY } } } : {}),
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
    ...(hasDD.value
      ? {
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
        }
      : {}),
    series,
  }
}

// tooltip 闭包直读 props：同一下标给出净值/基准/回撤与当日交易的完整读数
function tooltipFormatter(params: unknown): string {
  const arr = (Array.isArray(params) ? params : [params]) as { dataIndex: number }[]
  const i = arr[0]?.dataIndex ?? 0
  if (!props.dates[i]) return ''
  const rows = [`<b>${props.dates[i]}</b>`, `策略净值 ${fmtNav(props.equity[i])}`]
  if (props.benchmark) rows.push(`基准 ${fmtNav(props.benchmark[i])}`)
  if (hasDD.value) rows.push(`<span style="color:${DOWN}">回撤 ${fmtDD(props.drawdown?.[i])}</span>`)
  for (const t of props.trades ?? [])
    if (t.index === i)
      rows.push(
        `<span style="color:${t.kind === 'buy' ? UP : DOWN}">${t.kind === 'buy' ? '买入' : '卖出'}${t.note ? `　${t.note}` : ''}</span>`,
      )
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

// 数据引用变化时整图重设（notMerge 防止旧 series 残留）；resize 交给 ResizeObserver
watch([() => props.dates, () => props.equity, () => props.benchmark, () => props.trades, () => props.drawdown], () => {
  chart?.setOption(buildOption(), { notMerge: true })
})
</script>

<template>
  <div v-if="n === 0" class="bt-empty">（无数据）</div>
  <!-- 外层固定总高：SSR 首屏与挂载后高度一致，避免 echarts 初始化时布局跳动 -->
  <div v-else class="bt-chart" :style="{ height: height + 'px' }" role="img" :aria-label="title || '回测净值图'">
    <div v-if="title" class="bt-title">{{ title }}</div>
    <div ref="elRef" class="bt-body">
      <div v-if="!ready" class="bt-loading">图表加载中…</div>
    </div>
  </div>
</template>

<style scoped>
.bt-chart {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  width: 100%;
  background: #fdfdfd;
  border: 1px solid #e9ecef;
  border-radius: 6px;
}
.bt-title {
  height: 22px;
  line-height: 22px;
  padding: 0 8px;
  font-size: 11px;
  color: #495057;
}
.bt-body {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
}
.bt-loading {
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
.bt-empty {
  color: #868e96;
  padding: 12px;
}
</style>
