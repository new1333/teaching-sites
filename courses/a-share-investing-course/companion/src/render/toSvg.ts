import type { Candle } from '../types'

/**
 * K线渲染器：把蜡烛数组映射成 SVG 字符串（主图 + 成交量副图）。
 * 几何映射与 docs 站点的 KLineChart.vue 组件保持一致：
 * 一根K线 = 一个 rect（实体）+ 两条 line（上影线、下影线）；A股配色红涨绿跌。
 */

export type ToSvgOpts = {
  /** 画布宽（像素），默认 760 */
  width?: number
  /** 画布高（像素），默认 320 */
  height?: number
  /** 纵轴用对数坐标（等比例刻度），默认 false */
  logScale?: boolean
  /** 是否画成交量副图，默认 true */
  showVolume?: boolean
  /** 图题，默认空 */
  title?: string
}

const UP = '#d94848' // 阳线：A股红
const DOWN = '#2b8a3e' // 阴线：A股绿
const GRID = '#e9ecef'
const PAD = { left: 10, right: 46, top: 16, bottom: 20 }
const VOL_H = 56

export function toSvg(candles: readonly Candle[], opts: ToSvgOpts = {}): string {
  if (candles.length === 0) throw new Error('toSvg：candles 不能为空')
  for (let i = 0; i < candles.length; i++) {
    const { open, high, low, close } = candles[i]
    for (const v of [open, high, low, close]) {
      if (!Number.isFinite(v)) throw new Error(`toSvg：第 ${i + 1} 根的开高低收必须是有限数字，收到的是 ${v}`)
    }
    if (high < low || high < Math.max(open, close) || low > Math.min(open, close)) {
      throw new Error(`toSvg：第 ${i + 1} 根的最高/最低价必须包住开盘价与收盘价`)
    }
  }

  const W = opts.width ?? 760
  const H = opts.height ?? 320
  const logScale = opts.logScale ?? false
  const title = opts.title ?? ''

  const n = candles.length
  const hasVolume = (opts.showVolume ?? true) && candles.some((c) => c.volume > 0)
  const plotW = W - PAD.left - PAD.right
  const mainH = H - PAD.top - PAD.bottom - (hasVolume ? VOL_H : 0)
  const volTop = PAD.top + mainH + 10
  const band = plotW / n

  const lo = Math.min(...candles.map((c) => c.low))
  const hi = Math.max(...candles.map((c) => c.high))
  const span = Math.max(hi - lo, Math.abs(hi) * 1e-6, 1e-9)

  // 价格 → 主图 y 坐标：先归一化到 0~1（对数坐标按 log 距离归一化），再翻转进 y 轴向下的屏幕坐标系
  const y = (price: number): number => {
    const t =
      logScale && lo > 0
        ? (Math.log(Math.max(price, 1e-9)) - Math.log(lo)) / (Math.log(hi) - Math.log(lo) || 1)
        : (price - lo) / span
    return PAD.top + (1 - t) * mainH
  }
  const f = (x: number): string => x.toFixed(1)

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeXml(title || 'K线图')}">`,
  ]

  // 价格网格：纵轴 5 等分，右侧标价——最上一条就是最高价、最下一条就是最低价的落点
  for (let i = 0; i <= 5; i++) {
    const price = lo + (span * i) / 5
    parts.push(
      `<line class="grid" x1="${f(PAD.left)}" x2="${f(W - PAD.right)}" y1="${f(y(price))}" y2="${f(y(price))}" stroke="${GRID}" stroke-width="1"/>`,
      `<text x="${f(W - PAD.right + 4)}" y="${f(y(price) + 3)}" font-size="10" fill="#868e96">${price.toFixed(2)}</text>`,
    )
  }
  if (title) {
    parts.push(
      `<text x="${f(PAD.left + 2)}" y="${f(PAD.top - 4)}" font-size="11" fill="#495057">${escapeXml(title)}</text>`,
    )
  }

  // 每根K线：一个 rect（实体）+ 两条 line（上影线、下影线），x 按时间从左到右排
  for (let i = 0; i < n; i++) {
    const cd = candles[i]
    const x = PAD.left + i * band
    const cx = x + band / 2
    const color = cd.close >= cd.open ? UP : DOWN
    const yOpen = y(cd.open)
    const yClose = y(cd.close)
    const bodyTop = Math.min(yOpen, yClose)
    const bodyBottom = Math.max(yOpen, yClose)
    parts.push(
      `<line class="wick-upper" x1="${f(cx)}" x2="${f(cx)}" y1="${f(y(cd.high))}" y2="${f(bodyTop)}" stroke="${color}" stroke-width="1"/>`,
      `<line class="wick-lower" x1="${f(cx)}" x2="${f(cx)}" y1="${f(bodyBottom)}" y2="${f(y(cd.low))}" stroke="${color}" stroke-width="1"/>`,
      `<rect class="body" x="${f(x + band * 0.15)}" y="${f(bodyTop)}" width="${f(Math.max(band * 0.7, 1))}" height="${f(Math.max(bodyBottom - bodyTop, 1))}" fill="${color}"/>`,
    )
  }

  // 成交量副图：量纲与价格不同，按全场最大量独立归一化后画在主图下方
  if (hasVolume) {
    const maxVol = Math.max(...candles.map((cd) => cd.volume), 1)
    parts.push(
      `<line x1="${f(PAD.left)}" x2="${f(W - PAD.right)}" y1="${f(volTop)}" y2="${f(volTop)}" stroke="#ced4da" stroke-width="1"/>`,
    )
    for (let i = 0; i < n; i++) {
      const cd = candles[i]
      const x = PAD.left + i * band
      const h = (cd.volume / maxVol) * (VOL_H - 8)
      parts.push(
        `<rect class="vol" x="${f(x + band * 0.15)}" y="${f(volTop + (VOL_H - 6 - h))}" width="${f(Math.max(band * 0.7, 1))}" height="${f(h)}" fill="${cd.close >= cd.open ? UP : DOWN}" opacity="0.55"/>`,
      )
    }
  }

  // 日期刻度：最多 6 个，均匀取样
  const want = Math.min(6, n)
  for (let i = 0; i < want; i++) {
    const idx = Math.round((i * (n - 1)) / (want - 1 || 1))
    const x = PAD.left + (idx + 0.5) * band
    parts.push(
      `<text x="${f(x)}" y="${H - 6}" font-size="10" fill="#868e96" text-anchor="middle">${escapeXml(candles[idx].date)}</text>`,
    )
  }

  parts.push('</svg>')
  return parts.join('\n')
}

function escapeXml(s: string): string {
  return s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch] ?? ch)
}
