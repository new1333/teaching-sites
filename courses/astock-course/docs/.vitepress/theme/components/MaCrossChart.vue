<script setup lang="ts">
// docs/.vitepress/theme/components/MaCrossChart.vue · 第 5 章 均线交叉回测教学图
// 只消费导出产物 ma-cross.json（companion/src/market.ts 固定种子生成，pnpm export 再生成），
// 组件内不做任何行情或回测计算——价格、均线、交叉、净值全部来自数据文件，禁止平行手抄第二套数字。
// 上层：收盘价 + MA5 + MA20 + 金叉/死叉标记；下层：「交叉策略 vs 持有不动」两条净值曲线。
import { computed } from 'vue'
import ChartCanvas from './ChartCanvas.vue'
import maCrossData from '../../../assets/data/ma-cross.json'

interface Candle {
  day: string
  open: number
  close: number
  high: number
  low: number
  volume: number
}
interface CrossInfo {
  index: number
  day: string
  type: 'golden' | 'death'
  ma5: number
  ma20: number
  exec_day: string | null
  exec_price: number | null
  acted: boolean
  lag_days: number | null
  lag_pct: number | null
}
interface MaCrossJson {
  labeling: string
  meta: { total: number; short_ma: number; long_ma: number; initial_capital: number }
  candles: Candle[]
  ma5: Array<number | null>
  ma20: Array<number | null>
  crosses: CrossInfo[]
  backtest: {
    strategy_final: number
    hold_final: number
    gap_pct: number
    total_fees: number
    trade_count: number
    round_trips: number
    whipsaw_round_trips: number
    strategy_equity: number[]
    hold_equity: number[]
  }
}

const data = maCrossData as unknown as MaCrossJson

const GOLDEN = '#c0392b' // 金叉·红（A股惯例：红涨）
const DEATH = '#1e8e5a' // 死叉·绿（A股惯例：绿跌）
const PRICE = '#3d4148'
const STRATEGY = '#b02a1e' // 策略净值·深红
const HOLD = '#1f5fa8' // 持有净值·蓝

const labels = computed(() => data.candles.map((c) => c.day))
const crossesByDay = computed(() => new Map(data.crosses.map((c) => [c.day, c])))

const yuan = (v: number): string => v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const option = computed(() => {
  const cs = data.candles
  const marks = (type: 'golden' | 'death') =>
    data.crosses
      .filter((c) => c.type === type)
      .map((c) => ({
        value: [c.day, c.ma20],
        day: c.day,
      }))
  return {
    animation: false,
    legend: {
      top: 0,
      data: ['收盘价', `MA${data.meta.short_ma}`, `MA${data.meta.long_ma}`, '金叉', '死叉', '策略净值', '持有净值'],
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross', label: { backgroundColor: '#6a7985' } },
      formatter: (params: unknown) => {
        const arr = params as Array<{ dataIndex: number }>
        const i = arr[0]?.dataIndex ?? 0
        const c = cs[i]
        if (!c) return ''
        const ma5 = data.ma5[i]
        const ma20 = data.ma20[i]
        const cross = crossesByDay.value.get(c.day)
        const lines = [
          `<strong>${c.day}</strong>`,
          `收盘 ${(c.close as number).toFixed(2)}`,
          `MA${data.meta.short_ma} ${ma5 === null ? '—' : (ma5 as number).toFixed(2)}　MA${data.meta.long_ma} ${ma20 === null ? '—' : (ma20 as number).toFixed(2)}`,
        ]
        if (cross) {
          const name = cross.type === 'golden' ? '金叉（MA5 上穿 MA20）' : '死叉（MA5 下穿 MA20）'
          if (cross.acted && cross.exec_day && cross.exec_price !== null) {
            lines.push(
              `<span style="color:${cross.type === 'golden' ? GOLDEN : DEATH}">${name}</span>：次日 ${cross.exec_day} 开盘 ${cross.exec_price.toFixed(2)} 元执行`,
            )
          } else {
            lines.push(`${name}：当日已${cross.type === 'golden' ? '持仓' : '空仓'}，信号未执行`)
          }
        }
        lines.push(
          `策略净值 ${yuan(data.backtest.strategy_equity[i] as number)} 元`,
          `持有净值 ${yuan(data.backtest.hold_equity[i] as number)} 元`,
        )
        return lines.join('<br/>')
      },
    },
    axisPointer: { link: [{ xAxisIndex: 'all' }] },
    grid: [
      { left: 64, right: 20, top: 32, height: '52%' },
      { left: 64, right: 20, top: '74%', height: '18%' },
    ],
    xAxis: [
      {
        type: 'category',
        gridIndex: 0,
        data: labels.value,
        boundaryGap: false,
        axisLabel: { interval: 29 },
      },
      {
        type: 'category',
        gridIndex: 1,
        data: labels.value,
        boundaryGap: false,
        axisLabel: { interval: 29 },
      },
    ],
    yAxis: [
      { gridIndex: 0, scale: true },
      { gridIndex: 1, scale: true },
    ],
    series: [
      {
        name: '收盘价',
        type: 'line',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: cs.map((c) => c.close),
        symbol: 'none',
        lineStyle: { width: 1.2, color: PRICE },
        z: 2,
      },
      {
        name: `MA${data.meta.short_ma}`,
        type: 'line',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: data.ma5,
        connectNulls: false,
        symbol: 'none',
        lineStyle: { width: 1.2, color: '#c98a12' },
        z: 3,
      },
      {
        name: `MA${data.meta.long_ma}`,
        type: 'line',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: data.ma20,
        connectNulls: false,
        symbol: 'none',
        lineStyle: { width: 1.2, color: '#1f5fa8' },
        z: 3,
      },
      {
        name: '金叉',
        type: 'scatter',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: marks('golden'),
        symbol: 'triangle',
        symbolSize: 11,
        itemStyle: { color: GOLDEN },
        symbolOffset: [0, '90%'],
        z: 5,
      },
      {
        name: '死叉',
        type: 'scatter',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: marks('death'),
        symbol: 'triangle',
        symbolSize: 11,
        symbolRotate: 180,
        itemStyle: { color: DEATH },
        symbolOffset: [0, '-90%'],
        z: 5,
      },
      {
        name: '策略净值',
        type: 'line',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: data.backtest.strategy_equity,
        symbol: 'none',
        lineStyle: { width: 1.6, color: STRATEGY },
      },
      {
        name: '持有净值',
        type: 'line',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: data.backtest.hold_equity,
        symbol: 'none',
        lineStyle: { width: 1.6, color: HOLD },
      },
    ],
  }
})

const ariaText = computed(
  () =>
    `合成行情均线交叉教学图，${data.meta.total} 个交易日：上层为收盘价、MA${data.meta.short_ma}、MA${data.meta.long_ma} 与金叉死叉标记，下层为交叉策略与持有不动两条净值曲线，悬停可读每日数值`,
)
</script>

<template>
  <figure class="ma-cross-demo">
    <ChartCanvas :option="option" height="500px" :aria-label="ariaText" />
    <div class="ma-cross-summary">
      <p>
        期末对账：交叉策略（含手续费）<strong>{{ yuan(data.backtest.strategy_final) }}</strong> 元，持有不动
        <strong>{{ yuan(data.backtest.hold_final) }}</strong> 元——勤快一年，少赚
        {{ yuan(data.backtest.hold_final - data.backtest.strategy_final) }} 元（差距 {{ data.backtest.gap_pct }} 个百分点）。
        全程成交 {{ data.backtest.trade_count }} 笔（{{ data.backtest.round_trips }} 个完整回合，其中
        {{ data.backtest.whipsaw_round_trips }} 趟卖低买高），费用合计 {{ yuan(data.backtest.total_fees) }} 元。
      </p>
    </div>
    <figcaption>{{ data.labeling }}。悬停可读每日收盘、均线与两条净值；三角标记处为金叉（红、朝上）与死叉（绿、朝下）。</figcaption>
  </figure>
</template>

<style scoped>
.ma-cross-demo {
  margin: 1rem 0;
}
.ma-cross-summary {
  margin: 0.5rem 0 0;
  padding: 0.6rem 0.9rem;
  border: 1px solid var(--vp-c-divider, #e2e6ea);
  border-radius: 8px;
  background: var(--vp-c-bg-soft, #f7f8fa);
}
.ma-cross-summary p {
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
