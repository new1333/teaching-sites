import { describe, expect, it } from 'vitest'
import { volumeFeatures, turnoverRate } from '../src/volume/features'
import type { Candle } from '../src/types'

/**
 * 量能特征的行为断言：只喂 K 线序列与阈值参数，只看返回的标签列表、背离点列表与换手率数组，
 * 内部怎么扫窗、怎么比较一概不问。全章核心命题在这里受审：
 * 1. 放量/缩量是相对近段的：当根量对前 lookback 根平均量的倍数越过上下线才记账，
 *    常量序列零标签，阶梯升量不冒充天量；
 * 2. 天量/地量是极值：天量=窗口最大且仍是放量，地量=窗口最小且仍是缩量，同根只记最高档；
 * 3. 量价背离：价格创窗口新高/新低而量显著萎缩才记账，逐根独立判定，
 *    正常放量上涨不误报，量缩但不创新高不误报；
 * 4. 换手率=成交量÷流通股本，逐根对齐、分母翻倍读数减半；
 * 5. 结构性非法输入抛中文错误。
 */

const mk = (closes: number[], volumes: number[]): Candle[] =>
  closes.map((close, i) => {
    const open = i === 0 ? closes[0] : closes[i - 1]
    return {
      date: `2026-06-${String(i + 1).padStart(2, '0')}`,
      open,
      high: Math.max(open, close) + 0.02,
      low: Math.min(open, close) - 0.02,
      close,
      volume: volumes[i],
    }
  })

const flat = (n: number, price = 10): number[] => Array(n).fill(price)

describe('放量/缩量：相对近段的倍数', () => {
  it('前五根 1000 股、第六根 2000 股：2 倍于近五根均量，记 surge', () => {
    const r = volumeFeatures(mk(flat(6), [...Array(5).fill(1000), 2000]))
    expect(r.labels).toHaveLength(1)
    expect(r.labels[0]).toMatchObject({ index: 5, kind: 'surge' })
    expect(r.labels[0]!.ratio).toBeCloseTo(2, 10)
  })

  it('第六根 500 股：不足均量七成，记 shrink（此时凑不满极值窗，不冒充地量）', () => {
    const r = volumeFeatures(mk(flat(6), [...Array(5).fill(1000), 500]))
    expect(r.labels).toHaveLength(1)
    expect(r.labels[0]).toMatchObject({ index: 5, kind: 'shrink' })
    expect(r.labels[0]!.ratio).toBeCloseTo(0.5, 10)
  })

  it('常量序列：量不动，一根标签都没有', () => {
    const r = volumeFeatures(mk(flat(15), Array(15).fill(1000)))
    expect(r.labels).toEqual([])
    expect(r.divergences).toEqual([])
  })

  it('阶梯升量不打天量：每日 +50 股，根根是窗口最大却不足 1.5 倍，无 climax', () => {
    const vols = Array.from({ length: 30 }, (_, i) => 1000 + 50 * i)
    const r = volumeFeatures(mk(flat(30), vols))
    expect(r.labels.filter((l) => l.kind === 'climax')).toEqual([])
  })

  it('序列不足参照窗：返回空报告，不抛错也不猜', () => {
    const r = volumeFeatures(mk(flat(3), [1000, 1000, 4000]))
    expect(r).toEqual({ labels: [], divergences: [] })
  })
})

describe('天量/地量：极值且仍是倍数标签', () => {
  it('二十根 1000 股后一根 3000 股：窗口最大且 3 倍均量，记 climax 而非 surge', () => {
    const r = volumeFeatures(mk(flat(21), [...Array(20).fill(1000), 3000]))
    expect(r.labels).toHaveLength(1)
    expect(r.labels[0]).toMatchObject({ index: 20, kind: 'climax' })
  })

  it('二十根 1000 股后一根 200 股：窗口最小且不足七成，记 drought 而非 shrink', () => {
    const r = volumeFeatures(mk(flat(21), [...Array(20).fill(1000), 200]))
    expect(r.labels).toHaveLength(1)
    expect(r.labels[0]).toMatchObject({ index: 20, kind: 'drought' })
  })

  it('高量仅次于窗口内更高的旧量：只是 surge，天量要让位给旧峰', () => {
    // 第 21 根 12000 股是全场最大；第 27 根 8000 股是放量（2 倍于近五根均量 4000），
    // 但 20 根极值窗内有 12000 压着，判 surge 不判 climax
    const vols = [...Array(20).fill(4000), 12000, ...Array(5).fill(4000), 8000]
    const r = volumeFeatures(mk(flat(27), vols))
    const at26 = r.labels.find((l) => l.index === 26)
    expect(at26).toMatchObject({ kind: 'surge' })
    expect(r.labels.find((l) => l.index === 20)).toMatchObject({ kind: 'climax' })
  })
})

describe('量价背离：价格创新而量萎缩', () => {
  it('顶背离：收盘创近五根新高、量缩到 0.6 倍，记 top', () => {
    const closes = [10, 10.1, 10.2, 10.3, 10.4, 10.5]
    const r = volumeFeatures(mk(closes, [...Array(5).fill(1000), 600]))
    expect(r.divergences).toHaveLength(1)
    expect(r.divergences[0]).toMatchObject({ index: 5, kind: 'top' })
    expect(r.divergences[0]!.ratio).toBeCloseTo(0.6, 10)
    expect(r.divergences[0]!.priceMargin).toBeGreaterThan(0)
  })

  it('正常放量上涨不误报：同样新高但量放到 1.8 倍，零背离', () => {
    const closes = [10, 10.1, 10.2, 10.3, 10.4, 10.5]
    const r = volumeFeatures(mk(closes, [...Array(5).fill(1000), 1800]))
    expect(r.divergences).toEqual([])
  })

  it('量缩但不创新高不误报：只记 shrink，无背离', () => {
    const closes = [10, 10.5, 9.8, 10.3, 9.9, 10.1] // 收在近五根的高低点之间
    const r = volumeFeatures(mk(closes, [...Array(5).fill(1000), 500]))
    expect(r.labels.map((l) => l.kind)).toEqual(['shrink'])
    expect(r.divergences).toEqual([])
  })

  it('底背离：收盘创近五根新低、量缩到 0.6 倍，记 bottom', () => {
    const closes = [10, 9.9, 9.8, 9.7, 9.6, 9.5]
    const r = volumeFeatures(mk(closes, [...Array(5).fill(1000), 600]))
    expect(r.divergences).toHaveLength(1)
    expect(r.divergences[0]).toMatchObject({ index: 5, kind: 'bottom' })
  })

  it('逐根独立判定：连续三根新高且量递减，三个背离点逐根记账', () => {
    const closes = [10, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7]
    const vols = [...Array(5).fill(1000), 500, 450, 400]
    const r = volumeFeatures(mk(closes, vols))
    expect(r.divergences.map((d) => d.index)).toEqual([5, 6, 7])
    expect(r.divergences.every((d) => d.kind === 'top')).toBe(true)
  })

  it('整段量价同步上行：零背离', () => {
    const closes = [10, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6]
    const vols = [1000, 1100, 1200, 1300, 1400, 1500, 1600]
    const r = volumeFeatures(mk(closes, vols))
    expect(r.divergences).toEqual([])
  })
})

describe('换手率：成交量÷流通股本', () => {
  it('成交 800 万股、流通 4 亿股：换手率 0.02（2%）', () => {
    const r = turnoverRate(mk([10], [8_000_000]), 400_000_000)
    expect(r).toHaveLength(1)
    expect(r[0]).toBeCloseTo(0.02, 10)
  })

  it('逐根对齐：数组与 K 线等长，各根按各自的量算', () => {
    const r = turnoverRate(mk(flat(3), [4_000_000, 8_000_000, 2_000_000]), 400_000_000)
    expect(r.map((v) => Math.round(v * 1000) / 1000)).toEqual([0.01, 0.02, 0.005])
  })

  it('分母翻倍读数减半：同一根量，流通 8 亿股时换手率 1%', () => {
    const r = turnoverRate(mk([10], [8_000_000]), 800_000_000)
    expect(r[0]).toBeCloseTo(0.01, 10)
  })
})

describe('结构性非法输入：抛中文错误', () => {
  const ok = mk(flat(8), Array(8).fill(1000))
  it.each([
    ['volumeFeatures 空数组', () => volumeFeatures([])],
    ['volumeFeatures 参照窗为 0', () => volumeFeatures(ok, { lookback: 0 })],
    ['volumeFeatures 参照窗非整数', () => volumeFeatures(ok, { lookback: 2.5 })],
    ['volumeFeatures 极值窗为 0', () => volumeFeatures(ok, { extremeWindow: 0 })],
    ['volumeFeatures 放量线不高于缩量线', () => volumeFeatures(ok, { surgeRatio: 0.7 })],
    ['volumeFeatures 缩量线为负', () => volumeFeatures(ok, { shrinkRatio: -0.1 })],
    ['volumeFeatures 成交量 NaN', () => volumeFeatures(mk(flat(2), [1000, NaN]))],
    ['volumeFeatures 成交量为负', () => volumeFeatures(mk(flat(2), [1000, -5]))],
    ['volumeFeatures 收盘价 NaN', () => volumeFeatures(mk([10, NaN], [1000, 1000]))],
    ['turnoverRate 空数组', () => turnoverRate([], 400_000_000)],
    ['turnoverRate 流通股本为 0', () => turnoverRate(ok, 0)],
    ['turnoverRate 流通股本为负', () => turnoverRate(ok, -100)],
    ['turnoverRate 成交量 NaN', () => turnoverRate(mk(flat(2), [1000, NaN]), 400_000_000)],
  ])('%s', (_name, fn) => {
    expect(fn).toThrow()
  })
})
