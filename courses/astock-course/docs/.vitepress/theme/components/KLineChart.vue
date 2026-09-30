<script setup lang="ts">
// docs/.vitepress/theme/components/KLineChart.vue · 第 4 章 K线教学图（先猜后揭晓）
// 只消费导出产物 kline-demo.json（companion/src/market.ts 固定种子生成，pnpm export 再生成），
// 组件内不做任何行情计算——四价与量全部来自数据文件，禁止平行手抄第二套数字。
// 交互：默认只显示前 40 根，按钮「揭晓后 20 根」展开全部（组件内 ref 状态）。
import { computed, ref } from 'vue'
import ChartCanvas from './ChartCanvas.vue'
import klineData from '../../../assets/data/kline-demo.json'

interface Candle {
  day: string
  open: number
  close: number
  high: number
  low: number
  volume: number
}

interface KlineData {
  labeling: string
  meta: { total: number; visible: number; hidden: number; hidden_days: string }
  candles: Candle[]
}

const data = klineData as unknown as KlineData

const UP = '#c0392b' // 阳·红（A股惯例：红涨）
const DOWN = '#1e8e5a' // 阴·绿（A股惯例：绿跌）
const FLAT = '#8a8f99' // 平盘（开=收）：与正文「阳线=收>开」判定对齐，不算阳线

const revealed = ref(false)
const shown = computed(() => (revealed.value ? data.candles : data.candles.slice(0, data.meta.visible)))

const wan = (v: number): string => `${(v / 10000).toFixed(1)} 万手`

const option = computed(() => {
  const cs = shown.value
  const labels = cs.map((c) => c.day)
  // echarts candlestick 数据顺序：[开, 收, 低, 高]；平盘日用中性灰单列，保证图上红色蜡烛数=阳线数
  const ohlc = cs.map((c) =>
    c.close === c.open
      ? {
          value: [c.open, c.close, c.low, c.high],
          itemStyle: { color: FLAT, color0: FLAT, borderColor: FLAT, borderColor0: FLAT },
        }
      : [c.open, c.close, c.low, c.high],
  )
  const vols = cs.map((c) => ({
    value: c.volume,
    itemStyle: { color: c.close > c.open ? UP : c.close < c.open ? DOWN : FLAT, opacity: 0.85 },
  }))
  return {
    animation: false,
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross', label: { backgroundColor: '#6a7985' } },
      formatter: (params: unknown) => {
        const arr = params as Array<{ dataIndex: number }>
        const c = cs[arr[0]?.dataIndex ?? 0]
        if (!c) return ''
        const i = data.candles.indexOf(c)
        const prev = i > 0 ? data.candles[i - 1] : undefined
        const chg = prev ? (((c.close - prev.close) / prev.close) * 100).toFixed(2) : '--'
        const color = c.close > c.open ? UP : c.close < c.open ? DOWN : FLAT
        const tag = i >= data.meta.visible ? '（揭晓段）' : ''
        return [
          `<strong>${c.day}${tag}</strong>`,
          `开盘 ${c.open.toFixed(2)}　收盘 <span style="color:${color}">${c.close.toFixed(2)}</span>（较昨收 ${chg}%）`,
          `最高 ${c.high.toFixed(2)}　最低 ${c.low.toFixed(2)}`,
          `成交量 ${wan(c.volume)}`,
        ].join('<br/>')
      },
    },
    axisPointer: { link: [{ xAxisIndex: 'all' }] },
    grid: [
      { left: 56, right: 20, top: 20, height: '56%' },
      { left: 56, right: 20, top: '72%', height: '18%' },
    ],
    xAxis: [
      { type: 'category', gridIndex: 0, data: labels, boundaryGap: true },
      {
        type: 'category',
        gridIndex: 1,
        data: labels,
        axisLabel: { show: false },
        axisTick: { show: false },
      },
    ],
    yAxis: [
      { gridIndex: 0, scale: true },
      {
        gridIndex: 1,
        axisLabel: { formatter: (v: number) => (v >= 10000 ? `${Math.round(v / 10000)}万` : `${v}`) },
      },
    ],
    series: [
      {
        name: 'K线',
        type: 'candlestick',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: ohlc,
        itemStyle: { color: UP, color0: DOWN, borderColor: UP, borderColor0: DOWN },
        ...(revealed.value
          ? {}
          : {
              markLine: {
                silent: true,
                symbol: 'none',
                lineStyle: { type: 'dashed', color: '#8a8f99' },
                label: {
                  formatter: 'D40 后还藏着 20 根',
                  position: 'insideEndTop',
                  color: '#8a8f99',
                },
                data: [{ xAxis: 'D40' }],
              },
            }),
      },
      {
        name: '成交量',
        type: 'bar',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: vols,
        barWidth: '60%',
      },
    ],
  }
})

const ariaText = computed(() =>
  revealed.value
    ? `合成K线教学图，共 ${data.meta.total} 根已全部展开：K线主图与成交量副图，悬停可读每日四价与成交量`
    : `合成K线教学图，当前展示前 ${data.meta.visible} 根（D1–D40），另有 ${data.meta.hidden} 根可点按钮揭晓`,
)
</script>

<template>
  <figure class="kline-demo">
    <ChartCanvas :option="option" height="480px" :aria-label="ariaText" />
    <div class="kline-controls">
      <button v-if="!revealed" type="button" class="kline-reveal" @click="revealed = true">
        揭晓后 20 根（D41–D60）
      </button>
      <p v-else class="kline-note">
        已展开全部 {{ data.meta.total }} 根——后 {{ data.meta.hidden }} 根（{{ data.meta.hidden_days }}）是同一段剧情的收尾，拿它对照你落纸的预测。
      </p>
    </div>
    <figcaption>{{ data.labeling }}。</figcaption>
  </figure>
</template>

<style scoped>
.kline-demo {
  margin: 1rem 0;
}
.kline-controls {
  display: flex;
  justify-content: center;
  margin: 0.75rem 0 0.25rem;
}
.kline-reveal {
  cursor: pointer;
  border: 1px solid transparent;
  border-radius: 8px;
  padding: 6px 18px;
  font-size: 14px;
  font-weight: 500;
  color: #fff;
  background: var(--vp-c-brand-1, #b02a1e);
}
.kline-reveal:hover {
  opacity: 0.9;
}
.kline-note {
  margin: 0;
  font-size: 13px;
  color: var(--vp-c-text-2, #555);
}
figcaption {
  margin-top: 0.4rem;
  font-size: 12.5px;
  color: var(--vp-c-text-3, #777);
  text-align: center;
}
</style>
