<script setup lang="ts">
// docs/.vitepress/theme/components/DcaChart.vue · 第 13 章 合成宽基指数 240 个月定投回测教学图
// 只消费导出产物 dca-vs-lump.json（companion/src/datasets/ch13-dca.ts 固定种子生成，pnpm export 再生成），
// 组件内不做任何收益率、平均成本、回撤或终值计算——全部读数取自数据文件，禁止平行手抄第二套数字。
// 三层：上：净值线（蓝）与平均成本线（橙虚线，读「成本线在哪」）；中：定投市值与一次性买入市值双线；
// 下：两档费率 20 年终值柱状读数区（0.2% 对 1.5%）。
import { computed } from 'vue'
import ChartCanvas from './ChartCanvas.vue'
import dcaData from '../../../assets/data/dca-vs-lump.json'

interface Ch13Json {
  labeling: string
  meta: { months: number; monthly_amount: number; invested_total: number; seed_note: string; fee_note: string; lump_note: string }
  months_labels: string[]
  nav: {
    prices: number[]
    final_nav: number
    total_return_pct: number
    annualized_pct: number
    max_drawdown: { peak_month: string; trough_month: string; peak_nav: number; trough_nav: number; drawdown_pct: number; recovery_gain_pct: number }
  }
  dca: {
    total_amount: number
    total_fees: number
    total_paid: number
    total_shares: number
    avg_cost: number
    avg_cost_ex_fee: number
    end_nav: number
    end_value: number
    pl_pct: number
    net_pl_pct: number
    avg_cost_series: number[]
    mark_series: number[]
    cum_paid_series: number[]
    deepest_underwater: { month: number; mark: number; cum_amount: number; underwater_pct: number }
  }
  lump: { start_amount: number; buy_nav: number; end_value: number; total_return_pct: number; values: number[] }
  fee_tiers: {
    principal: number
    gross_rate_pct: number
    low_fee_pct: number
    high_fee_pct: number
    years: number
    low_end: number
    high_end: number
    gap: number
    gap_pct_of_principal: number
  }
}

const data = dcaData as unknown as Ch13Json

const NAV = '#1f5fa8'
const COST = '#c98a12'
const DCA = '#2e7d52'
const LUMP = '#1f5fa8'
const LOW = '#2e7d52'
const HIGH = '#b02a1e'

const money = (v: number): string => v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const pct = (v: number): string => `${v.toFixed(2)}%`
const signPct = (v: number): string => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`

const option = computed(() => ({
  animation: false,
  legend: { top: 0 },
  tooltip: {
    trigger: 'axis',
    axisPointer: { type: 'cross', label: { backgroundColor: '#6a7985' } },
    formatter: (params: unknown) => {
      const arr = params as Array<{ axisIndex: number; seriesName: string; value: number }>
      const first = arr[0]
      if (!first) return ''
      const i = Number(first.dataIndex)
      if (first.axisIndex === 2) {
        const t = data.fee_tiers
        return [
          '<strong>两档费率终值读数区</strong>',
          `费率 ${t.low_fee_pct}%：${money(t.low_end)} 元`,
          `费率 ${t.high_fee_pct}%：${money(t.high_end)} 元`,
          `终值差 ${money(t.gap)} 元（本金的 ${pct(t.gap_pct_of_principal)}）`,
        ].join('<br/>')
      }
      const lines = [`<strong>${data.months_labels[i]}</strong>`]
      for (const p of arr) {
        const unit = p.axisIndex === 0 ? '' : ' 元'
        lines.push(`${p.seriesName}：<strong>${Number(p.value).toLocaleString('zh-CN')}${unit}</strong>`)
      }
      return lines.join('<br/>')
    },
  },
  axisPointer: { link: [{ xAxisIndex: [0, 1] }] },
  grid: [
    { left: 64, right: 24, top: 36, height: '26%' },
    { left: 64, right: 24, top: '44%', height: '26%' },
    { left: 64, right: 24, top: '78%', height: '16%' },
  ],
  xAxis: [
    { type: 'category', gridIndex: 0, data: data.months_labels, boundaryGap: false, axisLabel: { interval: 23 } },
    { type: 'category', gridIndex: 1, data: data.months_labels, boundaryGap: false, axisLabel: { interval: 23 } },
    { type: 'category', gridIndex: 2, data: [`费率 ${data.fee_tiers.low_fee_pct}%`, `费率 ${data.fee_tiers.high_fee_pct}%`] },
  ],
  yAxis: [
    { gridIndex: 0, scale: true, name: '净值 / 平均成本（元）' },
    { gridIndex: 1, scale: true, name: '市值（元）', axisLabel: { formatter: (v: number) => `${Math.round(v / 10000)}万` } },
    { gridIndex: 2, min: 0, name: '20 年终值（元）', axisLabel: { formatter: (v: number) => `${Math.round(v / 10000)}万` } },
  ],
  series: [
    {
      name: '指数基金净值',
      type: 'line',
      xAxisIndex: 0,
      yAxisIndex: 0,
      data: data.nav.prices,
      symbol: 'none',
      lineStyle: { width: 1.8, color: NAV },
      z: 3,
    },
    {
      name: '定投平均成本',
      type: 'line',
      xAxisIndex: 0,
      yAxisIndex: 0,
      data: data.dca.avg_cost_series,
      symbol: 'none',
      lineStyle: { width: 1.8, type: 'dashed', color: COST },
      z: 4,
    },
    {
      name: '定投市值（每月 1000 元）',
      type: 'line',
      xAxisIndex: 1,
      yAxisIndex: 1,
      data: data.dca.mark_series,
      symbol: 'none',
      lineStyle: { width: 2, color: DCA },
      z: 3,
    },
    {
      name: '累计投入',
      type: 'line',
      xAxisIndex: 1,
      yAxisIndex: 1,
      data: data.dca.cum_paid_series,
      symbol: 'none',
      lineStyle: { width: 1.4, type: 'dotted', color: '#9aa1ab' },
      z: 2,
    },
    {
      name: '一次性买入市值',
      type: 'line',
      xAxisIndex: 1,
      yAxisIndex: 1,
      data: data.lump.values,
      symbol: 'none',
      lineStyle: { width: 1.6, type: 'dashed', color: LUMP },
      z: 2,
    },
    {
      name: '两档费率终值',
      type: 'bar',
      xAxisIndex: 2,
      yAxisIndex: 2,
      data: [
        { value: data.fee_tiers.low_end, itemStyle: { color: LOW } },
        { value: data.fee_tiers.high_end, itemStyle: { color: HIGH } },
      ],
      barWidth: '42%',
      label: {
        show: true,
        position: 'top',
        fontSize: 11,
        formatter: (p: { dataIndex: number }) =>
          money(p.dataIndex === 0 ? data.fee_tiers.low_end : data.fee_tiers.high_end),
      },
      z: 3,
    },
  ],
}))

const aria = computed(
  () =>
    '定投回测教学图：上图为合成宽基指数基金 240 个月净值线与定投平均成本虚线；中图为定投市值、累计投入点线与一次性买入市值虚线的对照；下图为 0.2% 与 1.5% 两档费率 20 年终值柱状读数区，悬停可读数值',
)
</script>

<template>
  <figure class="dca-chart">
    <ChartCanvas :option="option" height="720px" :aria-label="aria" />
    <div class="readout">
      <p>
        上层读平均成本线：240 期定投的平均成本从
        <strong>{{ data.dca.avg_cost_series[0] }}</strong> 元一路挪到
        <strong>{{ data.dca.avg_cost }}</strong> 元（不计交易佣金为 {{ data.dca.avg_cost_ex_fee }} 元），
        期末净值 <strong>{{ data.nav.final_nav }}</strong> 元——成本线收在净值下方。
      </p>
      <p>
        中层读过程：同样投 240,000 元，定投期末市值 {{ money(data.dca.end_value) }} 元（{{ signPct(data.dca.pl_pct) }}，
        落袋 {{ signPct(data.dca.net_pl_pct) }}）；一次性买入期末 {{ money(data.lump.end_value) }} 元（{{ signPct(data.lump.total_return_pct) }}）。
        这轮先深坑后修复的行情里一次性反超——但看过程：定投市值最深处仅
        {{ money(data.dca.deepest_underwater.mark) }} 元、比同期已投入的
        {{ money(data.dca.deepest_underwater.cum_amount) }} 元浮亏
        <strong>{{ pct(Math.abs(data.dca.deepest_underwater.underwater_pct)) }}</strong>（M{{ data.dca.deepest_underwater.month }}），
        累计投入点线以上的缺口就是「亏着但没下车」的那段。
      </p>
      <p>
        下层读终值：同样 100,000 元本金、同样毛收益 {{ data.fee_tiers.gross_rate_pct }}%、同样持有
        {{ data.fee_tiers.years }} 年，费率 {{ data.fee_tiers.low_fee_pct }}% 期末
        {{ money(data.fee_tiers.low_end) }} 元，费率 {{ data.fee_tiers.high_fee_pct }}% 期末
        {{ money(data.fee_tiers.high_end) }} 元——终值差
        <strong>{{ money(data.fee_tiers.gap) }}</strong> 元，相当于本金的
        {{ pct(data.fee_tiers.gap_pct_of_principal) }}。
      </p>
    </div>
    <figcaption>
      {{ data.labeling }}。{{ data.meta.seed_note }}。上层净值线的形状是沪深300式大盘宽基的合成示意，不是真实指数；
      下层两根柱只差费率，毛收益与年限完全相同。所有读数取自课程预导出数据文件。
    </figcaption>
  </figure>
</template>

<style scoped>
.dca-chart {
  margin: 1rem 0;
}
.readout {
  margin: 0.5rem 0 0.9rem;
  padding: 0.6rem 0.9rem;
  border: 1px solid var(--vp-c-divider, #e2e6ea);
  border-radius: 8px;
  background: var(--vp-c-bg-soft, #f7f8fa);
}
.readout p {
  margin: 0.15rem 0;
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
