<script setup lang="ts">
// docs/.vitepress/theme/components/PortfolioMixChart.vue · 第 10 章 相关性实验台与漂移-再平衡教学图
// 只消费导出产物 portfolio-mix.json（companion/src/datasets/ch10-mix.ts 固定种子生成，pnpm export 再生成），
// 组件内不做任何相关系数、组合波动、占比或再平衡计算——按钮只切换档位下标，全部读数取自数据文件，
// 禁止平行手抄第二套数字。上层：相关性实验台（三条净值 + 五档组合波动柱状对照）；中层：伪分散对账条；
// 下层：60/40 三年漂移的仓位堆积图与逐年再平衡对照线。
import { computed, ref } from 'vue'
import ChartCanvas from './ChartCanvas.vue'
import mixData from '../../../assets/data/portfolio-mix.json'

interface Ch10Drawdown {
  peak_month: string
  trough_month: string
  drawdown_pct: number
}
interface Ch10Variant {
  level: number
  sample_correlation: number
  partner_volatility_annual_pct: number
  partner_values: number[]
  combo: {
    values: number[]
    volatility_annual_pct: number
    max_drawdown: Ch10Drawdown
    final_return_pct: number
  }
}
interface Ch10Json {
  labeling: string
  meta: { months24: string[]; months36: string[] }
  hook: {
    asset_a: { name: string; values: number[]; volatility_annual_pct: number; max_drawdown: Ch10Drawdown }
    asset_b: { name: string; values: number[]; volatility_annual_pct: number; max_drawdown: Ch10Drawdown }
    correlation: number
    combo: { values: number[]; volatility_annual_pct: number; max_drawdown: Ch10Drawdown }
  }
  correlation_lab: {
    base_asset: { name: string; values: number[]; volatility_annual_pct: number }
    variants: Ch10Variant[]
  }
  pseudo: {
    correlation: number
    stock_c: { name: string; volatility_annual_pct: number; max_drawdown: Ch10Drawdown }
    stock_d: { name: string; volatility_annual_pct: number; max_drawdown: Ch10Drawdown }
    combo: { volatility_annual_pct: number; max_drawdown: Ch10Drawdown }
  }
  drift: {
    start_stock_amount: number
    start_bond_amount: number
    stock_sleeve_values: number[]
    bond_sleeve_values: number[]
    total_values: number[]
    annual_rebalance_total_values: number[]
    annual_rebalance_difference: number
    stock_total_return_pct: number
    bond_total_return_pct: number
    end: { stock_amount: number; bond_amount: number; total: number; stock_weight_pct: number; bond_weight_pct: number }
    rebalance: {
      target_stock_weight: number
      trade_stock_amount: number
      trade_bond_amount: number
      after_stock_amount: number
      after_bond_amount: number
    }
  }
}

const data = mixData as unknown as Ch10Json

const JIA = '#1f5fa8'
const YI = '#c98a12'
const COMBO = '#2e7d52'
const GRAY = '#9aa1ab'
const STOCK = '#b02a1e'
const BOND = '#1f5fa8'

const fmtLevel = (level: number): string => (level > 0 ? `+${level}` : `${level}`)
const pct = (v: number): string => `${v.toFixed(2)}%`
const money = (v: number): string =>
  v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// 实验台默认停在最高档 +0.8：读者从「最同步」出发，往低处逐档切换，看组合波动一路下台阶
const activeIdx = ref(data.correlation_lab.variants.length - 1)
const active = computed(() => data.correlation_lab.variants[activeIdx.value] as Ch10Variant)

const levelLabels = data.correlation_lab.variants.map((v) => fmtLevel(v.level))

const labOption = computed(() => {
  const months = data.meta.months24
  const bars = data.correlation_lab.variants.map((v, i) => ({
    value: v.combo.volatility_annual_pct,
    itemStyle: { color: i === activeIdx.value ? COMBO : '#ccd3db' },
  }))
  return {
    animation: false,
    legend: { top: 0 },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross', label: { backgroundColor: '#6a7985' } },
      formatter: (params: unknown) => {
        const arr = params as Array<{ axisIndex: number; dataIndex: number; seriesName: string; value: number | number[] }>
        const first = arr[0]
        if (!first) return ''
        if (first.axisIndex === 0) {
          const month = String(first.value instanceof Array ? first.value[0] : months[first.dataIndex])
          const lines = [`<strong>${month}</strong>`]
          const jia = data.correlation_lab.base_asset.values[months.indexOf(month)]
          const yi = active.value.partner_values[months.indexOf(month)]
          const combo = active.value.combo.values[months.indexOf(month)]
          lines.push(`<span style="color:${JIA}">■</span> 甲 净值 ${(jia as number).toFixed(4)}`)
          lines.push(`<span style="color:${YI}">■</span> 乙（ρ=${fmtLevel(active.value.level)}）净值 ${(yi as number).toFixed(4)}`)
          lines.push(`<span style="color:${COMBO}">■</span> 组合（各半）净值 ${(combo as number).toFixed(4)}`)
          return lines.join('<br/>')
        }
        const i = Number(first.dataIndex)
        const v = data.correlation_lab.variants[i]
        if (!v) return ''
        const mark = i === activeIdx.value ? '（当前档位）' : ''
        return [
          `<strong>ρ = ${fmtLevel(v.level)}</strong>${mark}`,
          `组合年化波动率 <strong>${pct(v.combo.volatility_annual_pct)}</strong>`,
          `组合最大回撤 ${pct(v.combo.max_drawdown.drawdown_pct)}`,
        ].join('<br/>')
      },
    },
    axisPointer: { link: [{ xAxisIndex: 'all' }] },
    grid: [
      { left: 64, right: 24, top: 36, height: '46%' },
      { left: 64, right: 24, top: '72%', height: '20%' },
    ],
    xAxis: [
      { type: 'category', gridIndex: 0, data: months, boundaryGap: false, axisLabel: { interval: 3 } },
      { type: 'category', gridIndex: 1, data: levelLabels, name: '相关水平 ρ', nameLocation: 'middle', nameGap: 24 },
    ],
    yAxis: [
      { gridIndex: 0, scale: true, name: '净值（起点 1）' },
      { gridIndex: 1, min: 0, max: 24, name: '组合年化波动率 %' },
    ],
    series: [
      {
        name: '甲（固定）',
        type: 'line',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: data.correlation_lab.base_asset.values,
        symbol: 'none',
        lineStyle: { width: 1.6, color: JIA },
        z: 3,
      },
      {
        name: '乙（当前档位）',
        type: 'line',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: active.value.partner_values,
        symbol: 'none',
        lineStyle: { width: 1.4, color: YI },
        z: 2,
      },
      {
        name: '组合（各半）',
        type: 'line',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: active.value.combo.values,
        symbol: 'none',
        lineStyle: { width: 2.6, color: COMBO },
        z: 4,
      },
      {
        name: '组合年化波动率',
        type: 'bar',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: bars,
        barWidth: '46%',
        markLine: {
          symbol: 'none',
          silent: true,
          data: [
            {
              yAxis: data.correlation_lab.base_asset.volatility_annual_pct,
              lineStyle: { color: JIA, type: 'dashed', width: 1.2 },
              label: { formatter: `甲单独持有 ${pct(data.correlation_lab.base_asset.volatility_annual_pct)}`, color: JIA, fontSize: 11 },
            },
          ],
        },
        z: 3,
      },
    ],
  }
})

const labReadout = computed(() => {
  const v = active.value
  return [
    `相关水平 ρ = <strong>${fmtLevel(v.level)}</strong>（样本实测 ${fmtLevel(v.sample_correlation)}）`,
    `乙的年化波动率 <strong>${pct(v.partner_volatility_annual_pct)}</strong>——和甲的 ${pct(data.correlation_lab.base_asset.volatility_annual_pct)} 几乎相同，乙的独自颠簸没变过`,
    `组合年化波动率 <strong>${pct(v.combo.volatility_annual_pct)}</strong>，组合最大回撤 <strong>${pct(v.combo.max_drawdown.drawdown_pct)}</strong>（${v.combo.max_drawdown.peak_month} 峰 → ${v.combo.max_drawdown.trough_month} 谷）`,
    `组合期末 <strong>${v.combo.final_return_pct >= 0 ? '+' : ''}${pct(v.combo.final_return_pct)}</strong>`,
  ]
})

const driftOption = computed(() => ({
  animation: false,
  legend: { top: 0 },
  tooltip: {
    trigger: 'axis',
    axisPointer: { type: 'cross', label: { backgroundColor: '#6a7985' } },
    formatter: (params: unknown) => {
      const arr = params as Array<{ dataIndex: number; seriesName: string; value: number }>
      const i = arr[0]?.dataIndex ?? 0
      const lines = [`<strong>${data.meta.months36[i]}</strong>`]
      for (const p of arr) {
        lines.push(`${p.seriesName}：<strong>${money(p.value)}</strong> 元`)
      }
      return lines.join('<br/>')
    },
  },
  grid: { left: 84, right: 24, top: 36, bottom: 40 },
  xAxis: { type: 'category', data: data.meta.months36, boundaryGap: false, axisLabel: { interval: 5 } },
  yAxis: { scale: true, name: '金额（元）', axisLabel: { formatter: (v: number) => v.toLocaleString('zh-CN') } },
  series: [
    {
      name: '股票仓位（放着不动）',
      type: 'line',
      data: data.drift.stock_sleeve_values,
      symbol: 'none',
      stack: 'drift',
      areaStyle: { opacity: 0.18 },
      lineStyle: { width: 1.8, color: STOCK },
      itemStyle: { color: STOCK },
      z: 2,
    },
    {
      name: '低波动仓位（放着不动）',
      type: 'line',
      data: data.drift.bond_sleeve_values,
      symbol: 'none',
      stack: 'drift',
      areaStyle: { opacity: 0.18 },
      lineStyle: { width: 1.8, color: BOND },
      itemStyle: { color: BOND },
      z: 2,
    },
    {
      name: '总资产（放着不动）',
      type: 'line',
      data: data.drift.total_values,
      symbol: 'none',
      lineStyle: { width: 2, type: 'dashed', color: STOCK },
      z: 3,
    },
    {
      name: '总资产（每年拨回 60/40）',
      type: 'line',
      data: data.drift.annual_rebalance_total_values,
      symbol: 'none',
      lineStyle: { width: 2, type: 'dotted', color: COMBO },
      z: 3,
    },
  ],
}))

const ariaLab = computed(
  () =>
    `相关性实验台：上层为甲、乙与各半组合在相关水平 ${fmtLevel(active.value.level)} 下的 24 个月净值，下层为五个相关水平的组合年化波动率柱状对照，附甲单独持有的波动率参考线，点击按钮切换档位`,
)
const ariaDrift = computed(
  () =>
    '漂移与再平衡对照图：36 个月中股票仓位与低波动仓位的金额堆积图，叠加放着不动的总资产虚线与每年拨回 60/40 的总资产点线，悬停可读金额',
)
</script>

<template>
  <figure class="portfolio-mix">
    <div class="lab-buttons" role="group" aria-label="切换相关水平">
      <button
        v-for="(v, i) in data.correlation_lab.variants"
        :key="v.level"
        type="button"
        :class="{ active: i === activeIdx }"
        @click="activeIdx = i"
      >
        ρ = {{ fmtLevel(v.level) }}
      </button>
    </div>
    <ChartCanvas :option="labOption" height="540px" :aria-label="ariaLab" />
    <div class="readout">
      <p v-for="(line, i) in labReadout" :key="i" v-html="line"></p>
    </div>
    <div class="readout pseudo-strip">
      <p>
        伪分散对账：<strong>{{ data.pseudo.stock_c.name }}</strong> 年化波动率 {{ pct(data.pseudo.stock_c.volatility_annual_pct) }}、
        最大回撤 {{ pct(data.pseudo.stock_c.max_drawdown.drawdown_pct) }}；
        <strong>{{ data.pseudo.stock_d.name }}</strong> 年化波动率 {{ pct(data.pseudo.stock_d.volatility_annual_pct) }}、
        最大回撤 {{ pct(data.pseudo.stock_d.max_drawdown.drawdown_pct) }}；两者相关
        {{ data.pseudo.correlation.toFixed(2) }}。
        丙丁各买一半：波动 {{ pct(data.pseudo.combo.volatility_annual_pct) }}（几乎没降）、
        最大回撤 {{ pct(data.pseudo.combo.max_drawdown.drawdown_pct) }}（坑几乎照旧）。
      </p>
    </div>
    <ChartCanvas :option="driftOption" height="440px" :aria-label="ariaDrift" />
    <div class="readout">
      <p>
        期初：股票 {{ money(data.drift.start_stock_amount) }} 元 + 低波动 {{ money(data.drift.start_bond_amount) }} 元（60/40）。
        三年后：股票 {{ money(data.drift.end.stock_amount) }} 元（{{ data.drift.stock_total_return_pct.toFixed(2) }}%）、
        低波动 {{ money(data.drift.end.bond_amount) }} 元（{{ data.drift.bond_total_return_pct.toFixed(2) }}%），
        合计 {{ money(data.drift.end.total) }} 元——没人做任何决定，股票占比自己走到了
        <strong>{{ data.drift.end.stock_weight_pct.toFixed(2) }}%</strong>。
      </p>
      <p>
        再平衡（拨回 60/40）：卖出股票 <strong>{{ money(Math.abs(data.drift.rebalance.trade_stock_amount)) }}</strong> 元、
        买入低波动 {{ money(data.drift.rebalance.trade_bond_amount) }} 元，
        两仓变为 {{ money(data.drift.rebalance.after_stock_amount) }} / {{ money(data.drift.rebalance.after_bond_amount) }} 元。
      </p>
      <p>
        对照：若每年都拨回 60/40，期末 {{ money(data.drift.annual_rebalance_total_values[36]) }} 元，比放着不动少
        {{ money(data.drift.annual_rebalance_difference) }} 元——这轮单边上行的行情里，再平衡买到的不是更高收益，是比例与风险的原位。
      </p>
    </div>
    <figcaption>
      {{ data.labeling }}。实验台：切换相关水平后，乙与组合的净值即时重绘，柱状图为五个档位的组合年化波动率（虚线为甲单独持有）；
      下图为 60/40 组合三年间的仓位漂移与逐年再平衡对照。所有读数取自课程预导出数据文件。
    </figcaption>
  </figure>
</template>

<style scoped>
.portfolio-mix {
  margin: 1rem 0;
}
.lab-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  justify-content: center;
  margin-bottom: 0.6rem;
}
.lab-buttons button {
  padding: 0.3rem 0.9rem;
  border: 1px solid var(--vp-c-divider, #e2e6ea);
  border-radius: 999px;
  background: var(--vp-c-bg, #fff);
  color: var(--vp-c-text-1, #3d4148);
  font-size: 13.5px;
  cursor: pointer;
}
.lab-buttons button.active {
  border-color: var(--vp-c-brand-1, #2e7d52);
  background: var(--vp-c-brand-soft, #e6f2ec);
  color: var(--vp-c-brand-1, #2e7d52);
  font-weight: 600;
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
.pseudo-strip {
  background: var(--vp-c-bg, #fff);
  border-style: dashed;
}
figcaption {
  margin-top: 0.4rem;
  font-size: 12.5px;
  color: var(--vp-c-text-3, #777);
  text-align: center;
}
</style>
