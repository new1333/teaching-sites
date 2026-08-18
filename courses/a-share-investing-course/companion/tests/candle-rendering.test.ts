import { describe, expect, it } from 'vitest'
import { toSvg } from '../src/render/toSvg'
import type { Candle } from '../src/types'

/**
 * 渲染器的行为断言：只读 SVG 这个公共输出，不碰内部。
 * 锚点自取：网格最上/最下两条横线就是最高价/最低价的落点，
 * 期望坐标全部从输出本身推导，不依赖任何写死的边距常量。
 */

const c = (
  open: number,
  high: number,
  low: number,
  close: number,
  date = '2026-03-02',
  volume = 1000,
): Candle => ({ date, open, high, low, close, volume })

/** 抓取所有带指定 class 的元素标签（如 <rect class="body" …/>） */
const tagsOf = (svg: string, cls: string): string[] =>
  svg.match(new RegExp(`<\\w+ class="${cls}"[^>]*>`, 'g')) ?? []

/** 从一个标签里读数值属性 */
const num = (tag: string, attr: string): number => {
  const m = new RegExp(` ${attr}="(-?[\\d.]+)"`).exec(tag)
  if (!m) throw new Error(`标签里没有属性 ${attr}：${tag}`)
  return Number(m[1])
}

/** 网格横线的 y 坐标（价格从低到高等分）：返回 [最上, 最下] */
const gridAnchors = (svg: string): [number, number] => {
  const ys = tagsOf(svg, 'grid').map((t) => num(t, 'y1'))
  return [Math.min(...ys), Math.max(...ys)]
}

/** 线性映射下的期望 y：价格 p 在区间 [lo, hi] 里应落的像素位置 */
const expectY = (p: number, lo: number, hi: number, [top, bottom]: [number, number]): number =>
  bottom + ((p - lo) / (hi - lo)) * (top - bottom)

const VOL_ON = { height: 300 } // 与默认宽一致；只改高度便于口算

describe('toSvg：一根K线 = 一个 rect（实体）+ 两条 line（影线）', () => {
  const svg = toSvg([c(10, 11, 9, 10.5), c(10.4, 10.6, 9.8, 10.0), c(10.1, 10.3, 9.7, 10.2)], VOL_ON)

  it('三根K线产出三条实体矩形与六条影线', () => {
    expect(tagsOf(svg, 'body')).toHaveLength(3)
    expect(tagsOf(svg, 'wick-upper')).toHaveLength(3)
    expect(tagsOf(svg, 'wick-lower')).toHaveLength(3)
  })

  it('阳线红、阴线绿（A股配色），实体与影线同色', () => {
    const bodies = tagsOf(svg, 'body')
    const upper = tagsOf(svg, 'wick-upper')
    expect(bodies[0].match(/fill="([^"]+)"/)![1]).toBe('#d94848')
    expect(bodies[1].match(/fill="([^"]+)"/)![1]).toBe('#2b8a3e')
    expect(upper[0].match(/stroke="([^"]+)"/)![1]).toBe('#d94848')
  })

  it('时间从左到右：K线的 x 坐标随下标递增', () => {
    const xs = tagsOf(svg, 'wick-upper').map((t) => num(t, 'x1'))
    expect(xs[0]).toBeLessThan(xs[1])
    expect(xs[1]).toBeLessThan(xs[2])
  })
})

describe('价格坐标映射：像素坐标随纵轴价格区间缩放', () => {
  it('单根K线的四个价各就各位：高=顶、低=底、开收按比例插值（手算一致）', () => {
    const svg = toSvg([c(10, 11, 9, 10.5)], { ...VOL_ON, showVolume: false })
    const anchors = gridAnchors(svg)
    const [upper, lower] = [tagsOf(svg, 'wick-upper')[0], tagsOf(svg, 'wick-lower')[0]]
    const body = tagsOf(svg, 'body')[0]
    expect(num(upper, 'y1')).toBeCloseTo(anchors[0], 1) // 最高价贴最上网格线
    expect(num(lower, 'y2')).toBeCloseTo(anchors[1], 1) // 最低价贴最下网格线
    expect(num(upper, 'y2')).toBeCloseTo(expectY(10.5, 9, 11, anchors), 1) // 实体顶=收盘 10.5
    expect(num(lower, 'y1')).toBeCloseTo(expectY(10, 9, 11, anchors), 1) // 实体底=开盘 10
    expect(num(body, 'y')).toBeCloseTo(expectY(10.5, 9, 11, anchors), 1)
    expect(num(body, 'height')).toBeCloseTo(
      expectY(10, 9, 11, anchors) - expectY(10.5, 9, 11, anchors),
      1,
    )
  })

  it('同一根K线，放进宽 10 倍的价格区间，实体与影线的像素长度精确缩小 10 倍', () => {
    const narrow = toSvg([c(10, 11, 9, 10.5)], { ...VOL_ON, showVolume: false })
    const wide = toSvg([c(10, 11, 9, 10.5), c(10, 21, 1, 10)], { ...VOL_ON, showVolume: false })
    const bodyN = num(tagsOf(narrow, 'body')[0], 'height')
    const bodyW = num(tagsOf(wide, 'body')[0], 'height')
    const wickN = num(tagsOf(narrow, 'wick-lower')[0], 'y2') - num(tagsOf(narrow, 'wick-lower')[0], 'y1')
    const wickW = num(tagsOf(wide, 'wick-lower')[0], 'y2') - num(tagsOf(wide, 'wick-lower')[0], 'y1')
    expect(bodyN / bodyW).toBeCloseTo(10, 1)
    expect(wickN / wickW).toBeCloseTo(10, 1)
  })
})

describe('对数坐标：等比例刻度改变长相', () => {
  // 几何均值 sqrt(10*20) ≈ 14.1421：在对数轴上它正好落在区间正中
  const mid = Math.sqrt(10 * 20)
  const doji = [c(mid, 20, 10, mid)]

  it('对数轴上几何均值落在正中，线性轴上同一价格明显偏下', () => {
    const log = toSvg(doji, { ...VOL_ON, showVolume: false, logScale: true })
    const lin = toSvg(doji, { ...VOL_ON, showVolume: false, logScale: false })
    const [logTop, logBottom] = gridAnchors(log)
    const [linTop, linBottom] = gridAnchors(lin)
    const logBodyY = num(tagsOf(log, 'body')[0], 'y')
    const linBodyY = num(tagsOf(lin, 'body')[0], 'y')
    expect(logBodyY).toBeCloseTo((logTop + logBottom) / 2, 1)
    expect(linBodyY).toBeCloseTo(expectY(mid, 10, 20, [linTop, linBottom]), 1)
    expect(linBodyY - logBodyY).toBeGreaterThan(5) // 线性把 14.14 压得比对数低半格以上
  })

  it('对数轴上 10→20 与 20→40 的像素距离相等（每「翻一倍」等长）', () => {
    const svg = toSvg([c(10, 40, 10, 20)], { ...VOL_ON, showVolume: false, logScale: true })
    const anchors = gridAnchors(svg) // lo=10、hi=40
    const [top, bottom] = anchors
    const yAt = (p: number) => bottom + ((Math.log(p) - Math.log(10)) / (Math.log(40) - Math.log(10))) * (top - bottom)
    const d1 = yAt(10) - yAt(20)
    const d2 = yAt(20) - yAt(40)
    expect(d1).toBeCloseTo(d2, 1)
  })
})

describe('成交量副图：量纲独立归一化', () => {
  const vols = [100, 500, 300]
  const svg = toSvg(vols.map((v, i) => c(10, 10.5, 9.5, i % 2 === 0 ? 10.3 : 9.7, `2026-03-0${i + 2}`, v)), VOL_ON)

  it('每天一根量柱，高度与成交量成正比，最大的量顶到副图满高', () => {
    const bars = tagsOf(svg, 'vol')
    expect(bars).toHaveLength(3)
    const heights = bars.map((t) => num(t, 'height'))
    expect(heights[0] / heights[2]).toBeCloseTo(100 / 300, 1)
    expect(heights[1]).toBeGreaterThan(heights[0])
    expect(heights[1]).toBeGreaterThan(heights[2])
  })

  it('量柱颜色跟随当天阳阴：阳红阴绿', () => {
    const bars = tagsOf(svg, 'vol')
    expect(bars[0].match(/fill="([^"]+)"/)![1]).toBe('#d94848')
    expect(bars[1].match(/fill="([^"]+)"/)![1]).toBe('#2b8a3e')
  })

  it('全部成交量为零时不画副图；showVolume: false 也不画', () => {
    const flat = toSvg([c(10, 10.5, 9.5, 10.2, '2026-03-02', 0)], VOL_ON)
    expect(tagsOf(flat, 'vol')).toHaveLength(0)
    const off = toSvg([c(10, 10.5, 9.5, 10.2)], { ...VOL_ON, showVolume: false })
    expect(tagsOf(off, 'vol')).toHaveLength(0)
  })
})

describe('渲染器的守门与确定性', () => {
  it('同一输入两次渲染逐字节一致', () => {
    const candles = [c(10, 11, 9, 10.5), c(10.2, 10.8, 9.6, 10.0, '2026-03-03')]
    expect(toSvg(candles, VOL_ON)).toBe(toSvg(candles, VOL_ON))
  })

  it('空数组、非法价格直接报错', () => {
    expect(() => toSvg([], VOL_ON)).toThrow()
    expect(() => toSvg([c(Number.NaN, 11, 9, 10.5)], VOL_ON)).toThrow()
    expect(() => toSvg([c(10, 9, 9, 10.5)], VOL_ON)).toThrow()
  })

  it('输出是合法 SVG 字符串：有开头标签与 viewBox', () => {
    const svg = toSvg([c(10, 11, 9, 10.5)], VOL_ON)
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg.endsWith('</svg>')).toBe(true)
    expect(svg).toContain('viewBox="0 0 760 300"')
  })
})
