<script setup lang="ts">
// docs/.vitepress/theme/components/DrawdownChart.vue · 第 9 章 回撤与回本涨幅教学图
// 只消费导出产物 drawdown-paths.json（companion/src/datasets/ch09-risk.ts 固定种子生成，pnpm export 再生成），
// 组件内不做任何回撤、回本或波动率计算——路径、峰谷、标注值全部来自数据文件，禁止平行手抄第二套数字。
// 上层：三条净值路径（标注各自的最大回撤峰值点与谷值点）；下层：亏损→回本涨幅对照曲线（锚定 30/50/70），
// 并画一条「涨回同样多」的加法直觉线，让不对称看得见。
import { computed } from 'vue'
import ChartCanvas from './ChartCanvas.vue'
import drawdownData from '../../../assets/data/drawdown-paths.json'

interface Ch09Drawdown {
  peak_month: string
  trough_month: string
  peak_value: number
  trough_value: number
  drawdown_pct: number
  recovery_gain_pct: number
}
interface Ch09Path {
  id: string
  name: string
  values: number[]
  volatility_annual_pct: number
  max_drawdown: Ch09Drawdown
}
interface Ch09Json {
  labeling: string
  meta: { months: string[]; start_value: number }
  paths: Ch09Path[]
  recovery_curve: {
    loss_step_pct: number
    highlights: number[]
    curve: Array<{ loss_pct: number; recovery_pct: number }>
  }
}

const data = drawdownData as unknown as Ch09Json

// 三条路径一色：甲蓝、乙深红、丙琥珀；峰值三角朝上、谷值三角朝下，与所属路径同色
const PATH_COLORS = ['#1f5fa8', '#b02a1e', '#c98a12']
const CURVE = '#b02a1e'
const INTUITION = '#8a8f99'

const pct = (v: number): string => `${v.toFixed(2)}%`

const option = computed(() => {
  const months = data.meta.months
  const peakPoints = data.paths.map((p, i) => ({
    value: [p.max_drawdown.peak_month, p.max_drawdown.peak_value],
    itemStyle: { color: PATH_COLORS[i] },
  }))
  const troughPoints = data.paths.map((p, i) => ({
    value: [p.max_drawdown.trough_month, p.max_drawdown.trough_value],
    itemStyle: { color: PATH_COLORS[i] },
  }))
  const ddByMonth = new Map<string, { name: string; kind: 'peak' | 'trough'; dd: Ch09Drawdown }>()
  for (const p of data.paths) {
    ddByMonth.set(p.max_drawdown.peak_month, { name: p.name, kind: 'peak', dd: p.max_drawdown })
    ddByMonth.set(p.max_drawdown.trough_month, { name: p.name, kind: 'trough', dd: p.max_drawdown })
  }
  const highlights = data.recovery_curve.curve.filter((c) => data.recovery_curve.highlights.includes(c.loss_pct))
  return {
    animation: false,
    legend: { top: 0 },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross', label: { backgroundColor: '#6a7985' } },
      formatter: (params: unknown) => {
        const arr = params as Array<{ axisIndex: number; dataIndex: number; seriesName: string; value: number | number[]; marker: string }>
        const first = arr[0]
        if (!first) return ''
        if (first.axisIndex === 0) {
          const month = String(first.value instanceof Array ? first.value[0] : months[first.dataIndex])
          const lines = [`<strong>${month}</strong>`]
          data.paths.forEach((p, i) => {
            const v = p.values[months.indexOf(month)]
            lines.push(
              `<span style="color:${PATH_COLORS[i]}">■</span> ${p.name} 净值 ${(v as number).toFixed(4)}`,
            )
          })
          const mark = ddByMonth.get(month)
          if (mark) {
            const label = mark.kind === 'peak' ? '最大回撤起点（峰值）' : '最大回撤终点（谷值）'
            lines.push(
              `${mark.name} · ${label}：最大回撤 ${pct(mark.dd.drawdown_pct)}，回本涨幅 ${pct(mark.dd.recovery_gain_pct)}`,
            )
          }
          return lines.join('<br/>')
        }
        const x = Number(first.value instanceof Array ? first.value[0] : first.value)
        const hit = data.recovery_curve.curve.find((c) => c.loss_pct === x)
        if (!hit) return ''
        const intuition = (hit.recovery_pct - hit.loss_pct).toFixed(2)
        return [
          `<strong>亏 ${hit.loss_pct}%</strong>`,
          `回本需涨 <strong>${pct(hit.recovery_pct)}</strong>`,
          `比「涨回同样多」多出 ${intuition} 个百分点`,
        ].join('<br/>')
      },
    },
    axisPointer: { link: [{ xAxisIndex: 'all' }] },
    grid: [
      { left: 64, right: 24, top: 36, height: '48%' },
      { left: 64, right: 24, top: '70%', height: '22%' },
    ],
    xAxis: [
      { type: 'category', gridIndex: 0, data: months, boundaryGap: false, axisLabel: { interval: 3 } },
      {
        type: 'value',
        gridIndex: 1,
        min: 0,
        max: 70,
        name: '亏损幅度 %',
        nameLocation: 'middle',
        nameGap: 24,
      },
    ],
    yAxis: [
      { gridIndex: 0, scale: true, name: '净值（起点 1）' },
      { gridIndex: 1, min: 0, max: 250, name: '回本涨幅 %' },
    ],
    series: [
      ...data.paths.map((p, i) => ({
        name: p.name,
        type: 'line',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: p.values,
        symbol: 'none',
        lineStyle: { width: 1.8, color: PATH_COLORS[i] },
        z: 2 + i,
      })),
      {
        name: '峰值（回撤起点）',
        type: 'scatter',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: peakPoints,
        symbol: 'triangle',
        symbolSize: 11,
        z: 6,
      },
      {
        name: '谷值（回撤终点）',
        type: 'scatter',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: troughPoints,
        symbol: 'triangle',
        symbolRotate: 180,
        symbolSize: 11,
        z: 6,
      },
      {
        name: '回本涨幅',
        type: 'line',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: data.recovery_curve.curve.map((c) => [c.loss_pct, c.recovery_pct]),
        symbol: 'circle',
        symbolSize: 5,
        lineStyle: { width: 2, color: CURVE },
        itemStyle: { color: CURVE },
        z: 3,
      },
      {
        name: '加法直觉线（涨回同样多）',
        type: 'line',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: [
          [0, 0],
          [70, 70],
        ],
        symbol: 'none',
        lineStyle: { width: 1.4, type: 'dashed', color: INTUITION },
        z: 2,
      },
      {
        name: '锚点 30 / 50 / 70',
        type: 'scatter',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: highlights.map((c) => [c.loss_pct, c.recovery_pct]),
        symbolSize: 10,
        itemStyle: { color: CURVE },
        label: { show: true, position: 'top', formatter: (p: { value: number[] }) => `+${p.value[1]}%`, color: CURVE, fontSize: 11 },
        z: 5,
      },
    ],
  }
})

const summary = computed(() =>
  data.paths
    .map(
      (p) =>
        `${p.name}：最大回撤 <strong>${pct(p.max_drawdown.drawdown_pct)}</strong>（${p.max_drawdown.peak_month} 峰 → ${p.max_drawdown.trough_month} 谷），回本需涨 <strong>${pct(p.max_drawdown.recovery_gain_pct)}</strong>，年化波动率 ${pct(p.volatility_annual_pct)}`,
    )
    .join('；'),
)

const ariaText = computed(
  () =>
    `回撤教学图，${data.meta.months.length - 1} 个月：上层为浅回撤、深腰斩、慢磨阴跌三条净值路径及各自峰值谷值标记，下层为亏损幅度与回本涨幅的对照曲线并标注 30、50、70 三点，悬停可读数值`,
)
</script>

<template>
  <figure class="drawdown-demo">
    <ChartCanvas :option="option" height="520px" :aria-label="ariaText" />
    <div class="drawdown-summary">
      <p v-html="summary"></p>
    </div>
    <figcaption>
      {{ data.labeling }}。上层三角标记各路径的最大回撤：峰（朝上）到谷（朝下）；下层虚线是「涨回同样多」的加法直觉，
      实线是真实所需的回本涨幅——两条线的距离就是盈亏不对称。悬停可读每个月、每一档的数值。
    </figcaption>
  </figure>
</template>

<style scoped>
.drawdown-demo {
  margin: 1rem 0;
}
.drawdown-summary {
  margin: 0.5rem 0 0;
  padding: 0.6rem 0.9rem;
  border: 1px solid var(--vp-c-divider, #e2e6ea);
  border-radius: 8px;
  background: var(--vp-c-bg-soft, #f7f8fa);
}
.drawdown-summary p {
  margin: 0;
  font-size: 13.5px;
  line-height: 1.7;
  color: var(--vp-c-text-1, #3d4148);
}
figcaption {
  margin-top: 0.4rem;
  font-size: 12.5px;
  color: var(--vp-c-text-3, #777);
  text-align: center;
}
</style>
