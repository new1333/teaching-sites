// companion/app/utils/price-trend.ts · 价格走势图的纯逻辑
// 序列生成、坐标换算、刻度、路径构建、均线、悬浮命中、区间汇总——全部是确定性的纯函数：
// 不读系统时钟、不碰全局随机源、不发请求，同一输入永远得到同一输出。
// 服务端渲染与客户端水合因此产出逐字节一致的 SVG（水合对账的前提），测试也能用固定输入断言。

export interface PricePoint {
  /** 距 2025-01-01 的天数偏移（0 起） */
  day: number
  /** 收盘价，单位分（整数，避免浮点漂移进入路径与汇总） */
  priceCents: number
}

export const HISTORY_DAYS = 365

/** 走势时间轴的固定起点：所有日期标签都由「起点 + 天数偏移」推导 */
export const EPOCH_UTC_MS = Date.UTC(2025, 0, 1)

const DAY_MS = 86_400_000

const round1 = (n: number) => Math.round(n * 10) / 10
const round2 = (n: number) => Math.round(n * 100) / 100

/** mulberry32 确定性伪随机：同一种子产出同一条 0~1 序列 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * 生成一件商品近 `days` 天的每日收盘价：种子由商品编号派生，基准价来自商品数据。
 * 三股力道叠加：±1.8% 日内噪声、3% 向基准价的均值回复、7 天周期的星期效应；
 * 全程夹在基准价的 [0.55, 1.7] 倍之间。同一件商品永远得到同一条走势。
 */
export function generatePriceHistory(
  productId: number,
  basePriceYuan: number,
  days = HISTORY_DAYS,
): PricePoint[] {
  const baseCents = Math.round(basePriceYuan * 100)
  const rand = mulberry32((productId * 2654435761 + 0x9e3779b9) >>> 0)
  return walkSeries(rand, baseCents, 0.018, 0.03, true, days)
}

/** FNV-1a 字符串散列：把类别名变成稳定的数值种子 */
function hashString(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/**
 * 市场参考价：同类商品的「大盘」走势——种子由类别名派生，波动更平缓
 * （噪声 0.8%、回复 4%、无星期效应），用来与单品走势对照。
 */
export function generateMarketHistory(
  category: string,
  basePriceYuan: number,
  days = HISTORY_DAYS,
): PricePoint[] {
  const baseCents = Math.round(basePriceYuan * 100)
  const rand = mulberry32(hashString(`market:${category}`))
  return walkSeries(rand, baseCents, 0.008, 0.04, false, days)
}

/** 随机行走的共用实现：噪声 + 均值回复 + 可选星期效应，夹在 [0.55, 1.7] 倍基准价之间 */
function walkSeries(
  rand: () => number,
  baseCents: number,
  noiseAmp: number,
  reversionRate: number,
  weekly: boolean,
  days: number,
): PricePoint[] {
  const lo = Math.round(baseCents * 0.55)
  const hi = Math.round(baseCents * 1.7)
  const points: PricePoint[] = []
  let price = Math.round(baseCents * (0.9 + rand() * 0.2))
  for (let day = 0; day < days; day++) {
    const noise = (rand() - 0.5) * 2 * noiseAmp * baseCents
    const reversion = (baseCents - price) * reversionRate
    const weeklyEffect = weekly ? Math.sin((day / 7) * Math.PI * 2) * 0.006 * baseCents : 0
    price = Math.min(hi, Math.max(lo, Math.round(price + noise + reversion + weeklyEffect)))
    points.push({ day, priceCents: price })
  }
  return points
}

export interface VolumePoint {
  day: number
  /** 当日销量（件），40~260 之间：跌价日走量、周末放量 */
  volume: number
}

/** 每日销量：种子与价格走势同源（同一件商品同一张底牌），跌价日和周末卖得更多 */
export function generateVolume(
  productId: number,
  days = HISTORY_DAYS,
): VolumePoint[] {
  const rand = mulberry32((productId * 0x85ebca6b + 0x165667b1) >>> 0)
  const out: VolumePoint[] = []
  for (let day = 0; day < days; day++) {
    const weekday = day % 7
    const weekend = weekday === 5 || weekday === 6 ? 1.35 : 1
    const base = 40 + rand() * 180
    const dipBoost = 1 + rand() * 0.25
    out.push({ day, volume: Math.round(Math.min(260, base * weekend * dipBoost)) })
  }
  return out
}

// ---- 坐标换算：数据值 ↔ SVG 坐标 ----

export interface ChartScales {
  minCents: number
  maxCents: number
  plotLeft: number
  plotRight: number
  plotTop: number
  plotBottom: number
  /** 天数偏移 → SVG x 坐标 */
  x: (day: number) => number
  /** 分 → SVG y 坐标（价格越高越靠上） */
  y: (cents: number) => number
}

export interface ScaleBox {
  width: number
  height: number
  padding: { left: number; right: number; top: number; bottom: number }
}

/** 由可见点集推导坐标换算：上下各留 10% 呼吸空间，避免曲线贴边 */
export function computeScales(points: PricePoint[], box: ScaleBox): ChartScales {
  if (points.length === 0) throw new Error('computeScales 需要至少一个点')
  const prices = points.map((p) => p.priceCents)
  const dataMin = Math.min(...prices)
  const dataMax = Math.max(...prices)
  const span = dataMax - dataMin || Math.max(1, Math.round(dataMax * 0.05))
  const minCents = dataMin - span * 0.1
  const maxCents = dataMax + span * 0.1
  const { width, height, padding } = box
  const plotLeft = padding.left
  const plotRight = width - padding.right
  const plotTop = padding.top
  const plotBottom = height - padding.bottom
  const firstDay = points[0]!.day
  const daySpan = points[points.length - 1]!.day - firstDay || 1
  const centsSpan = maxCents - minCents || 1
  return {
    minCents,
    maxCents,
    plotLeft,
    plotRight,
    plotTop,
    plotBottom,
    x: (day) => plotLeft + ((day - firstDay) / daySpan) * (plotRight - plotLeft),
    y: (cents) => plotTop + ((maxCents - cents) / centsSpan) * (plotBottom - plotTop),
  }
}

/** 取「好看的」刻度值：步长规整到 1/2/2.5/5 × 10^n，返回落在 [min, max] 内的刻度序列 */
export function niceTicks(min: number, max: number, count = 5): number[] {
  const span = max - min || 1
  const step0 = span / Math.max(1, count - 1)
  const mag = 10 ** Math.floor(Math.log10(step0))
  const norm = step0 / mag
  let step: number
  if (norm <= 1) step = 1
  else if (norm <= 2) step = 2
  else if (norm <= 2.5) step = 2.5
  else if (norm <= 5) step = 5
  else step = 10
  const niceStep = step * mag
  const start = Math.ceil(min / niceStep) * niceStep
  const end = Math.floor(max / niceStep) * niceStep
  const ticks: number[] = []
  for (let v = start; v <= end + niceStep / 2; v += niceStep) ticks.push(round2(v))
  return ticks
}

// ---- 路径构建：点集 → SVG path 的 d 字符串 ----

/** 折线路径：M 起点后一路 L；坐标保留 1 位小数（SVG 显示精度足够，字节更省） */
export function buildLinePath(points: PricePoint[], scales: ChartScales): string {
  if (points.length === 0) return ''
  const cmds = points.map(
    (p) => `${round1(scales.x(p.day))} ${round1(scales.y(p.priceCents))}`,
  )
  return `M ${cmds.join(' L ')}`
}

/** 平滑曲线路径：Catmull-Rom 样条转三次贝塞尔——过每个数据点、相邻段一阶连续 */
export function buildSmoothPath(points: PricePoint[], scales: ChartScales): string {
  if (points.length < 3) return buildLinePath(points, scales)
  const pt = points.map((p) => ({
    x: round1(scales.x(p.day)),
    y: round1(scales.y(p.priceCents)),
  }))
  let d = `M ${pt[0]!.x} ${pt[0]!.y}`
  for (let i = 0; i < pt.length - 1; i++) {
    const p0 = pt[i - 1] ?? pt[i]!
    const p1 = pt[i]!
    const p2 = pt[i + 1]!
    const p3 = pt[i + 2] ?? p2
    const c1x = round1(p1.x + (p2.x - p0.x) / 6)
    const c1y = round1(p1.y + (p2.y - p0.y) / 6)
    const c2x = round1(p2.x - (p3.x - p1.x) / 6)
    const c2y = round1(p2.y - (p3.y - p1.y) / 6)
    d += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${p2.x} ${p2.y}`
  }
  return d
}

/** 面积路径：平滑曲线 + 沿绘图底边闭合（Z），供渐变填充 */
export function buildAreaPath(points: PricePoint[], scales: ChartScales): string {
  if (points.length === 0) return ''
  const first = points[0]!
  const last = points[points.length - 1]!
  const base = round1(scales.plotBottom)
  const closeX1 = round1(scales.x(last.day))
  const closeX0 = round1(scales.x(first.day))
  return `${buildSmoothPath(points, scales)} L ${closeX1} ${base} L ${closeX0} ${base} Z`
}

/** 简单移动平均：与输入逐位对齐，前 window-1 位为 null（样本不足，不画） */
export function movingAverage(points: PricePoint[], window: number): (number | null)[] {
  if (window < 1) throw new Error('window 必须 ≥ 1')
  const out: (number | null)[] = []
  let sum = 0
  for (let i = 0; i < points.length; i++) {
    sum += points[i]!.priceCents
    if (i >= window) sum -= points[i - window]!.priceCents
    out.push(i >= window - 1 ? Math.round(sum / window) : null)
  }
  return out
}

/**
 * 悬浮命中：给定指针的 SVG x 坐标，返回距离最近的数据点下标。
 * 等距平局时取左侧（严格小于才替换）；越界输入自然夹到首尾点。
 */
export function findNearestPoint(
  points: PricePoint[],
  x: number,
  scales: ChartScales,
): number {
  let best = 0
  let bestDist = Number.POSITIVE_INFINITY
  for (let i = 0; i < points.length; i++) {
    const dist = Math.abs(scales.x(points[i]!.day) - x)
    if (dist < bestDist) {
      bestDist = dist
      best = i
    }
  }
  return best
}

/** x 轴刻度下标：在 0..total-1 上均匀取 count 个（首尾必取） */
export function xTickIndices(total: number, count = 5): number[] {
  if (total <= 0) return []
  const n = Math.min(count, total)
  const out: number[] = []
  for (let i = 0; i < n; i++)
    out.push(total === 1 || n === 1 ? 0 : Math.round((i * (total - 1)) / (n - 1)))
  return [...new Set(out)]
}

// ---- 区间汇总 ----

/** 区间极值：最高与最低点（并列时取先出现者），供图上标注 */
export function localExtremes(points: PricePoint[]): {
  high: PricePoint
  low: PricePoint
} {
  if (points.length === 0) throw new Error('localExtremes 需要至少一个点')
  let high = points[0]!
  let low = points[0]!
  for (const p of points) {
    if (p.priceCents > high.priceCents) high = p
    if (p.priceCents < low.priceCents) low = p
  }
  return { high, low }
}

export interface RangeSummary {
  highCents: number
  lowCents: number
  firstCents: number
  lastCents: number
  /** 区间涨跌幅（百分比） */
  changePct: number
  /** 日收益率标准差年化后的百分比 */
  annualVolatilityPct: number
}

export function summarizeRange(points: PricePoint[]): RangeSummary {
  if (points.length === 0) throw new Error('summarizeRange 需要至少一个点')
  const prices = points.map((p) => p.priceCents)
  const rets: number[] = []
  for (let i = 1; i < prices.length; i++) rets.push(prices[i]! / prices[i - 1]! - 1)
  const mean = rets.reduce((s, r) => s + r, 0) / (rets.length || 1)
  const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length || 1)
  return {
    highCents: Math.max(...prices),
    lowCents: Math.min(...prices),
    firstCents: prices[0]!,
    lastCents: prices[prices.length - 1]!,
    changePct: round2((prices[prices.length - 1]! / prices[0]! - 1) * 100),
    annualVolatilityPct: round1(Math.sqrt(variance * 365) * 100),
  }
}

// ---- 展示格式化（手写分组，不依赖 ICU，保证两端逐字节一致） ----

/** 天数偏移 → 'YYYY-MM-DD'（固定起点 + 整数天，无时区参与） */
export function dayToLabel(day: number): string {
  const d = new Date(EPOCH_UTC_MS + day * DAY_MS)
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${d.getUTCFullYear()}-${m}-${dd}`
}

/** 分 → '¥1,234.56'（千分位手写正则分组） */
export function formatYuan(cents: number): string {
  const [int, frac] = (cents / 100).toFixed(2).split('.')
  return `¥${int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${frac}`
}

/** 百分比 → 带符号 '+1.23%' / '-0.50%' / '0.00%' */
export function formatSignedPct(pct: number): string {
  return `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`
}
