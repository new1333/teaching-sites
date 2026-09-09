<!-- companion/app/components/PriceTrendChart.vue · 价格走势图（手写 SVG 折线 + 悬浮提示，无第三方图表库）
     重组件教学样本：走势生成、平滑曲线、刻度、均线、悬浮命中的全部逻辑都长在这棵组件子树里，
     刻意不拆共享——同步引入时它会整个进首屏，Lazy 前缀动态分割后按需加载。
     全部计算走 app/utils/price-trend 的确定性纯函数：服务端直出与客户端水合产出逐字节一致的 SVG。 -->
<script setup lang="ts">
import {
  type PricePoint,
  generatePriceHistory,
  generateMarketHistory,
  generateVolume,
  computeScales,
  niceTicks,
  buildSmoothPath,
  buildAreaPath,
  buildLinePath,
  movingAverage,
  findNearestPoint,
  summarizeRange,
  localExtremes,
  xTickIndices,
  dayToLabel,
  formatYuan,
  formatSignedPct,
} from '~/utils/price-trend'

const props = defineProps<{
  productId: number
  category: string
  basePriceYuan: number
}>()

// ---- 视口与绘图区：SVG 用固定 viewBox 坐标系，宽度随容器自适应缩放 ----
const VIEW_W = 720
const VIEW_H = 300
const VOL_H = 96
const PAD = { left: 14, right: 64, top: 18, bottom: 30 }
const VOL_PAD = { left: 14, right: 64, top: 6, bottom: 18 }
const MA_WINDOW = 20

// ---- 区间选择：默认近半年 ----
const RANGES = [
  { key: '1m', label: '1 个月', days: 30 },
  { key: '3m', label: '3 个月', days: 90 },
  { key: '6m', label: '6 个月', days: 180 },
  { key: '1y', label: '1 年', days: 365 },
] as const
type RangeKey = (typeof RANGES)[number]['key']
const rangeKey = ref<RangeKey>('6m')
const rangeDays = computed(() => RANGES.find((r) => r.key === rangeKey.value)!.days)

// ---- 序列开关：主价不可关，均线与市场参考线可开关 ----
const showMA = ref(true)
const showMarket = ref(true)

// ---- 数据：整年历史按区间取尾部切片 ----
const history = computed<PricePoint[]>(() =>
  generatePriceHistory(props.productId, props.basePriceYuan),
)
const marketHistory = computed<PricePoint[]>(() =>
  generateMarketHistory(props.category, props.basePriceYuan),
)
const volumes = computed(() => generateVolume(props.productId))
const points = computed<PricePoint[]>(() => history.value.slice(-rangeDays.value))
const marketPoints = computed<PricePoint[]>(() => marketHistory.value.slice(-rangeDays.value))
const visibleVolumes = computed(() => volumes.value.slice(-rangeDays.value))

const scales = computed(() =>
  computeScales(points.value, { width: VIEW_W, height: VIEW_H, padding: PAD }),
)
const marketScales = computed(() =>
  computeScales(marketPoints.value, { width: VIEW_W, height: VIEW_H, padding: PAD }),
)
// 成交量 Pane 自己的坐标：值域取 [0, max×1.1]，柱子从底边长起
const volMax = computed(() => Math.max(...visibleVolumes.value.map((v) => v.volume), 1) * 1.1)
const volScales = computed(() => {
  const plotLeft = VOL_PAD.left
  const plotRight = VIEW_W - VOL_PAD.right
  const plotTop = VOL_PAD.top
  const plotBottom = VOL_H - VOL_PAD.bottom
  const firstDay = points.value[0]!.day
  const daySpan = points.value[points.value.length - 1]!.day - firstDay || 1
  return {
    plotLeft,
    plotRight,
    plotTop,
    plotBottom,
    x: (day: number) => plotLeft + ((day - firstDay) / daySpan) * (plotRight - plotLeft),
    y: (vol: number) => plotTop + (1 - vol / volMax.value) * (plotBottom - plotTop),
  }
})
const volTicks = computed(() =>
  niceTicks(0, volMax.value, 3).map((vol) => ({
    vol,
    y: Math.round(volScales.value.y(vol) * 10) / 10,
  })),
)
const volBars = computed(() => {
  const barW = Math.max(
    1,
    Math.floor(((volScales.value.plotRight - volScales.value.plotLeft) / points.value.length) * 0.7),
  )
  return visibleVolumes.value.map((v) => {
    const x = Math.round(volScales.value.x(v.day) * 10) / 10 - barW / 2
    const yTop = Math.round(volScales.value.y(v.volume) * 10) / 10
    const yBase = Math.round(volScales.value.plotBottom * 10) / 10
    return { key: v.day, x, y: yTop, w: barW, h: Math.round((yBase - yTop) * 10) / 10 }
  })
})

const yTicks = computed(() =>
  niceTicks(scales.value.minCents, scales.value.maxCents, 5).map((cents) => ({
    cents,
    y: Math.round(scales.value.y(cents) * 10) / 10,
  })),
)
const xTicks = computed(() =>
  xTickIndices(points.value.length, 5).map((index) => ({
    index,
    label: dayToLabel(points.value[index]!.day),
    x: Math.round(scales.value.x(points.value[index]!.day) * 10) / 10,
  })),
)

const linePath = computed(() => buildSmoothPath(points.value, scales.value))
const areaPath = computed(() => buildAreaPath(points.value, scales.value))
const marketPath = computed(() => buildSmoothPath(marketPoints.value, marketScales.value))
// 均线：移动平均的 null 前缀丢弃后，用均价点拼一条虚线
const maPath = computed(() => {
  const ma = movingAverage(points.value, MA_WINDOW)
  const maPoints: PricePoint[] = []
  for (let i = 0; i < points.value.length; i++) {
    const v = ma[i]
    if (v !== null) maPoints.push({ day: points.value[i]!.day, priceCents: v })
  }
  return buildLinePath(maPoints, scales.value)
})

// 区间极值标注：贴着最高/最低点画小旗，靠右时文字左移避免出界
const extremes = computed(() => localExtremes(points.value))
function extremeAnchor(p: PricePoint) {
  const x = scales.value.x(p.day)
  return {
    cx: Math.round(x * 10) / 10,
    cy: Math.round(scales.value.y(p.priceCents) * 10) / 10,
    textAnchor: x > VIEW_W * 0.72 ? 'end' : 'start',
    dx: x > VIEW_W * 0.72 ? -10 : 10,
  }
}
const highAnchor = computed(() => extremeAnchor(extremes.value.high))
const lowAnchor = computed(() => extremeAnchor(extremes.value.low))

const stats = computed(() => summarizeRange(points.value))

// ---- 悬浮交互：指针 / 键盘（←/→）共用同一个「最邻近点」命中 ----
const hoverIndex = ref<number | null>(null)
const hoverPoint = computed(() =>
  hoverIndex.value === null ? null : (points.value[hoverIndex.value] ?? null),
)
const hoverMarket = computed(() =>
  hoverIndex.value === null ? null : (marketPoints.value[hoverIndex.value] ?? null),
)
const hoverVolume = computed(() =>
  hoverIndex.value === null ? null : (visibleVolumes.value[hoverIndex.value] ?? null),
)
const hoverChangePct = computed(() => {
  const i = hoverIndex.value
  if (i === null || i === 0) return null
  const prev = points.value[i - 1]!
  const cur = points.value[i]!
  return Math.round((cur.priceCents / prev.priceCents - 1) * 10000) / 100
})
// 提示框贴着数据点走；点位过右时翻到左侧，避免越出绘图区
const tooltipStyle = computed(() => {
  const p = hoverPoint.value
  if (!p) return {}
  const x = scales.value.x(p.day)
  const y = scales.value.y(p.priceCents)
  const flip = x > VIEW_W * 0.6
  return {
    left: `${(x / VIEW_W) * 100}%`,
    top: `${(y / VIEW_H) * 100}%`,
    transform: flip ? 'translate(calc(-100% - 12px), -50%)' : 'translate(12px, -50%)',
  }
})
// 成交量 Pane 上的悬浮竖条：与价格 Pane 共享同一个命中下标
const hoverVolBarX = computed(() => {
  const v = hoverVolume.value
  if (!v) return null
  return Math.round(volScales.value.x(v.day) * 10) / 10
})

function onPointerMove(ev: PointerEvent) {
  const rect = (ev.currentTarget as SVGSVGElement).getBoundingClientRect()
  if (!rect || rect.width === 0) return
  // 容器宽度 → viewBox 坐标换算：悬浮命中在数据坐标系里做，不依赖布局尺寸
  const svgX = ((ev.clientX - rect.left) / rect.width) * VIEW_W
  hoverIndex.value = findNearestPoint(points.value, svgX, scales.value)
}
function onPointerLeave() {
  hoverIndex.value = null
}
function nudgeHover(dir: -1 | 1) {
  const base = hoverIndex.value ?? Math.floor(points.value.length / 2)
  const next = Math.min(points.value.length - 1, Math.max(0, base + dir))
  hoverIndex.value = next
}
function selectRange(key: RangeKey) {
  rangeKey.value = key
  hoverIndex.value = null
}
</script>

<template>
  <section class="price-trend-chart" :data-product="props.productId">
    <header class="chart-head">
      <h2 class="chart-title">
        价格走势
        <span class="chart-sub">近 {{ rangeDays }} 天 · {{ points.length }} 个交易日</span>
      </h2>
      <div class="chart-ranges" role="group" aria-label="选择时间区间">
        <button
          v-for="r in RANGES"
          :key="r.key"
          type="button"
          :class="{ active: rangeKey === r.key }"
          :aria-pressed="rangeKey === r.key"
          @click="selectRange(r.key)"
        >
          {{ r.label }}
        </button>
      </div>
    </header>

    <div class="chart-plot">
      <svg
        class="chart-svg"
        :viewBox="`0 0 ${VIEW_W} ${VIEW_H}`"
        role="img"
        aria-label="价格走势图"
        tabindex="0"
        @pointermove="onPointerMove"
        @pointerleave="onPointerLeave"
        @keydown.left.prevent="nudgeHover(-1)"
        @keydown.right.prevent="nudgeHover(1)"
      >
        <defs>
          <linearGradient :id="`area-${props.productId}`" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#1f7a5f" stop-opacity="0.26" />
            <stop offset="100%" stop-color="#1f7a5f" stop-opacity="0.02" />
          </linearGradient>
        </defs>

        <!-- 水平网格 + 价格刻度（右侧） -->
        <g v-for="t in yTicks" :key="t.cents">
          <line
            :x1="scales.plotLeft"
            :x2="scales.plotRight"
            :y1="t.y"
            :y2="t.y"
            class="grid-line"
          />
          <text :x="scales.plotRight + 8" :y="t.y + 4" class="tick-label">
            {{ formatYuan(t.cents) }}
          </text>
        </g>

        <!-- 垂直参考线 + 日期刻度（底部） -->
        <g v-for="t in xTicks" :key="t.index">
          <line
            :x1="t.x"
            :x2="t.x"
            :y1="scales.plotTop"
            :y2="scales.plotBottom"
            class="grid-line faint"
          />
          <text :x="t.x" :y="scales.plotBottom + 18" class="tick-label" text-anchor="middle">
            {{ t.label }}
          </text>
        </g>

        <!-- 市场参考线（可关）+ 渐变面积 + 20 日均线（可关）+ 主曲线 -->
        <path v-if="showMarket" :d="marketPath" class="market-line" />
        <path :d="areaPath" :fill="`url(#area-${props.productId})`" />
        <path v-if="showMA" :d="maPath" class="ma-line" />
        <path :d="linePath" class="main-line" />

        <!-- 区间极值小旗 -->
        <g class="extreme">
          <circle :cx="highAnchor.cx" :cy="highAnchor.cy" r="3.5" />
          <text :x="highAnchor.cx + highAnchor.dx" :y="highAnchor.cy - 6" :text-anchor="highAnchor.textAnchor">
            高 {{ formatYuan(extremes.high.priceCents) }}
          </text>
        </g>
        <g class="extreme low">
          <circle :cx="lowAnchor.cx" :cy="lowAnchor.cy" r="3.5" />
          <text :x="lowAnchor.cx + lowAnchor.dx" :y="lowAnchor.cy + 14" :text-anchor="lowAnchor.textAnchor">
            低 {{ formatYuan(extremes.low.priceCents) }}
          </text>
        </g>

        <!-- 悬浮：十字线 + 命中点（水合前不渲染——hoverIndex 只在客户端才可能非空） -->
        <g v-if="hoverPoint" class="hover-group">
          <line
            :x1="scales.x(hoverPoint.day)"
            :x2="scales.x(hoverPoint.day)"
            :y1="scales.plotTop"
            :y2="scales.plotBottom"
            class="crosshair"
          />
          <circle
            :cx="scales.x(hoverPoint.day)"
            :cy="scales.y(hoverPoint.priceCents)"
            r="9"
            class="hover-ring"
          />
          <circle
            :cx="scales.x(hoverPoint.day)"
            :cy="scales.y(hoverPoint.priceCents)"
            r="4"
            class="hover-dot"
          />
        </g>
      </svg>

      <!-- 成交量 Pane：与价格 Pane 共享悬浮命中 -->
      <svg
        class="chart-svg vol-svg"
        :viewBox="`0 0 ${VIEW_W} ${VOL_H}`"
        role="img"
        aria-label="每日销量"
        @pointermove="onPointerMove"
        @pointerleave="onPointerLeave"
      >
        <g v-for="t in volTicks" :key="t.vol">
          <line
            :x1="volScales.plotLeft"
            :x2="volScales.plotRight"
            :y1="t.y"
            :y2="t.y"
            class="grid-line faint"
          />
          <text :x="volScales.plotRight + 8" :y="t.y + 4" class="tick-label">
            {{ t.vol }}
          </text>
        </g>
        <rect
          v-for="b in volBars"
          :key="b.key"
          :x="b.x"
          :y="b.y"
          :width="b.w"
          :height="b.h"
          class="vol-bar"
          :class="{ hit: hoverVolBarX !== null && Math.abs(b.x + b.w / 2 - hoverVolBarX) < 2 }"
        />
        <line
          v-if="hoverVolBarX !== null"
          :x1="hoverVolBarX"
          :x2="hoverVolBarX"
          :y1="volScales.plotTop"
          :y2="volScales.plotBottom"
          class="crosshair"
        />
      </svg>

      <div v-if="hoverPoint" class="chart-tooltip" :style="tooltipStyle">
        <p class="tt-date">{{ dayToLabel(hoverPoint.day) }}</p>
        <p class="tt-price">{{ formatYuan(hoverPoint.priceCents) }}</p>
        <p v-if="hoverChangePct !== null" :class="['tt-change', hoverChangePct >= 0 ? 'up' : 'down']">
          较前日 {{ formatSignedPct(hoverChangePct) }}
        </p>
        <p v-if="hoverMarket" class="tt-market">
          市场参考 {{ formatYuan(hoverMarket.priceCents) }}
        </p>
        <p v-if="hoverVolume" class="tt-volume">当日卖出 {{ hoverVolume.volume }} 件</p>
      </div>
    </div>

    <div class="chart-legend">
      <button type="button" class="legend-item static" aria-disabled="true">
        <span class="swatch main" />本商品
      </button>
      <button type="button" class="legend-item" :class="{ off: !showMA }" @click="showMA = !showMA">
        <span class="swatch ma" />20 日均线
      </button>
      <button
        type="button"
        class="legend-item"
        :class="{ off: !showMarket }"
        @click="showMarket = !showMarket"
      >
        <span class="swatch market" />市场参考
      </button>
    </div>

    <dl class="chart-stats">
      <div><dt>区间最高</dt><dd>{{ formatYuan(stats.highCents) }}</dd></div>
      <div><dt>区间最低</dt><dd>{{ formatYuan(stats.lowCents) }}</dd></div>
      <div>
        <dt>区间涨跌</dt>
        <dd :class="stats.changePct >= 0 ? 'up' : 'down'">{{ formatSignedPct(stats.changePct) }}</dd>
      </div>
      <div><dt>年化波动</dt><dd>{{ stats.annualVolatilityPct.toFixed(1) }}%</dd></div>
    </dl>

    <p class="chart-note">
      走势由商品编号经固定公式生成（教学演示数据）· 悬浮或 ←/→ 键查看逐日价格
    </p>
  </section>
</template>

<style scoped>
.price-trend-chart {
  margin-top: 22px;
  padding: 16px;
  border: 1px solid #e5ded2;
  border-radius: 10px;
  background: #fff;
}

.chart-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}

.chart-title {
  margin: 0;
  font-size: 18px;
}

.chart-sub {
  margin-left: 8px;
  color: #9a9285;
  font-size: 13px;
  font-weight: 400;
}

.chart-ranges {
  display: flex;
  gap: 6px;
}

.chart-ranges button {
  padding: 4px 10px;
  border: 1px solid #d8d0c2;
  border-radius: 999px;
  background: #faf7f2;
  color: #5a544b;
  font-size: 13px;
  cursor: pointer;
}

.chart-ranges button.active {
  border-color: #1f7a5f;
  background: #eaf2ee;
  color: #1f6a54;
  font-weight: 600;
}

.chart-plot {
  position: relative;
  margin-top: 10px;
}

.chart-svg {
  display: block;
  width: 100%;
  height: auto;
  outline: none;
  touch-action: pan-y;
}

.grid-line {
  stroke: #eee7da;
  stroke-width: 1;
}

.grid-line.faint {
  stroke-opacity: 0.5;
}

.tick-label {
  fill: #9a9285;
  font-size: 11px;
}

.main-line {
  fill: none;
  stroke: #1f7a5f;
  stroke-width: 2.2;
  stroke-linejoin: round;
  stroke-linecap: round;
}

.ma-line {
  fill: none;
  stroke: #a2704a;
  stroke-width: 1.4;
  stroke-dasharray: 5 4;
  stroke-opacity: 0.8;
}

.market-line {
  fill: none;
  stroke: #8a7ca8;
  stroke-width: 1.4;
  stroke-opacity: 0.75;
}

.extreme circle {
  fill: #b0483a;
}

.extreme text {
  fill: #b0483a;
  font-size: 11px;
}

.extreme.low circle,
.extreme.low text {
  fill: #2f6da2;
}

.vol-svg {
  margin-top: 2px;
}

.vol-bar {
  fill: #4c7c9b;
  fill-opacity: 0.45;
}

.vol-bar.hit {
  fill: #1f7a5f;
  fill-opacity: 0.85;
}

.tt-market,
.tt-volume {
  margin: 2px 0 0;
  color: #7a7264;
  font-size: 12px;
}

.chart-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}

.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  border: 1px solid #d8d0c2;
  border-radius: 999px;
  background: #fff;
  color: #5a544b;
  font-size: 12px;
  cursor: pointer;
}

.legend-item.static {
  cursor: default;
}

.legend-item.off {
  opacity: 0.45;
}

.swatch {
  display: inline-block;
  width: 14px;
  height: 3px;
  border-radius: 2px;
}

.swatch.main {
  background: #1f7a5f;
}

.swatch.ma {
  background: repeating-linear-gradient(90deg, #a2704a 0 4px, transparent 4px 7px);
}

.swatch.market {
  background: #8a7ca8;
}

.hover-group .crosshair {
  stroke: #5a544b;
  stroke-width: 1;
  stroke-dasharray: 3 3;
}

.hover-ring {
  fill: none;
  stroke: #1f7a5f;
  stroke-width: 1.5;
  stroke-opacity: 0.45;
}

.hover-dot {
  fill: #1f7a5f;
}

.chart-tooltip {
  position: absolute;
  padding: 6px 10px;
  border: 1px solid #d8d0c2;
  border-radius: 8px;
  background: #fffdf9;
  box-shadow: 0 2px 8px rgba(45, 42, 38, 0.12);
  pointer-events: none;
  white-space: nowrap;
}

.tt-date {
  margin: 0;
  color: #9a9285;
  font-size: 11px;
}

.tt-price {
  margin: 2px 0 0;
  font-size: 15px;
  font-weight: 700;
}

.tt-change {
  margin: 2px 0 0;
  font-size: 12px;
}

.chart-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
  gap: 10px;
  margin: 14px 0 0;
}

.chart-stats div {
  padding: 8px 10px;
  border-radius: 8px;
  background: #faf7f2;
}

.chart-stats dt {
  color: #9a9285;
  font-size: 12px;
}

.chart-stats dd {
  margin: 2px 0 0;
  font-size: 15px;
  font-weight: 600;
}

.chart-note {
  margin: 12px 0 0;
  color: #9a9285;
  font-size: 12px;
}

.up {
  color: #b0483a;
}

.down {
  color: #2f6da2;
}
</style>
