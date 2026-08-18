import { describe, expect, it } from 'vitest'
import { rsi } from '../src/indicators/rsi'
import { kdj } from '../src/indicators/kdj'
import type { Candle } from '../src/types'

/**
 * RSI 与 KDJ 的行为断言：只喂 K 线序列与窗口参数，只看返回的读数序列，
 * 内部怎么递推、怎么滑窗一概不问。全章核心命题在这里受审：
 * 1. 小样本与手算逐格一致——
 *    RSI：把每日涨跌差拆成涨/跌两列，先取 n 个的平均，此后 Wilder 递推
 *    （旧平均 ×(n−1) + 当日新值) ÷ n，RSI = 100 × 平均涨幅 ÷（平均涨幅 + 平均跌幅）；
 *    KDJ：RSV = 收盘价在近 n 日高低区间里的位置百分比，K = 2/3·昨K + 1/3·RSV
 *    （初值 50）、D 对 K 再来一次、J = 3K − 2D；
 * 2. 单调上涨序列两指标超买钝化（高位粘滞）被检出——日涨幅 0.5% 与 3% 的强弱
 *    差了 6 倍，读数却全程一样、且逐格不再变化：指标对强弱失明；
 * 3. 边界：全涨/全跌/走平三态读数钉死，不炸、不猜；
 * 4. 同源差异：同一根急跌 K 线上，K 的位移大于 RSI 的位移、J 的位移又大于 K；
 * 5. 结构性非法输入抛中文错误。
 */

const bar = (i: number, open: number, high: number, low: number, close: number): Candle => ({
  date: `2026-08-${String(i + 1).padStart(2, '0')}`,
  open,
  high,
  low,
  close,
  volume: 10000,
})

/** 以 mid 为中心的对称 K 线：high=mid+0.5、low=mid−0.5——RSI 只看收盘，高低随便给 */
const midBars = (mids: number[]): Candle[] => mids.map((m, i) => bar(i, m, m + 0.5, m - 0.5, m))

/** 把 n 日窗口的高低钉死在 9~10 元、只动收盘价：收盘 10 → RSV=100、收盘 9 → RSV=0 */
const fixedBand = (closes: number[]): Candle[] => closes.map((c, i) => bar(i, c, 10, 9, c))

/** 单调上涨 40 根：日涨幅按 0.5%/2%/1%/3% 轮换（强弱差 6 倍），每天收在全天最高（光头阳线） */
const rallyBars = (dir: 1 | -1, count: number): Candle[] => {
  const gains = [0.005, 0.02, 0.01, 0.03]
  const out: Candle[] = []
  let close = 10
  for (let i = 0; i < count; i++) {
    const open = close
    close = Math.round(open * (1 + dir * gains[i % 4]) * 1e6) / 1e6
    const high = Math.max(open, close)
    const low = Math.min(open, close)
    out.push(bar(i, open, high, low, close))
  }
  return out
}

describe('rsi：小样本与手算一致', () => {
  // closes=[10,10,10,13,14,14,12,12]，n=3：头 3 根攒不出 3 个涨跌差；
  //   i3: 平均涨 (0+0+3)/3=1、平均跌 0 → RSI=100；
  //   i4: 平均涨 (1×2+1)/3=1、平均跌 0 → 100；
  //   i5: 平均涨 (1×2+0)/3=2/3、平均跌 0 → 100；
  //   i6: 平均跌 (0×2+2)/3=2/3 → RSI = 100×(4/9)/(4/9+2/3) = 40；
  //   i7: 平均涨 8/27、平均跌 4/9 → 100×8/20 = 40
  it('小样本逐格复算：第 4~6 根钉 100（跌的一列消失），第 7~8 根恰好 40', () => {
    const r = rsi(midBars([10, 10, 10, 13, 14, 14, 12, 12]), 3)
    expect(r).toHaveLength(8)
    expect(r.slice(0, 3)).toEqual([null, null, null]) // 不足 n 个涨跌差，不猜
    expect(r[3]).toBeCloseTo(100, 10)
    expect(r[4]).toBeCloseTo(100, 10)
    expect(r[5]).toBeCloseTo(100, 10)
    expect(r[6]).toBeCloseTo(40, 6)
    expect(r[7]).toBeCloseTo(40, 6)
  })

  it('默认参数 14：自第 15 根成形；常数行情分子分母同零，读数记 50（不偏不倚）', () => {
    const r = rsi(midBars(Array<number>(40).fill(10)))
    expect(r.slice(0, 14)).toEqual(Array<number | null>(14).fill(null))
    for (let i = 14; i < 40; i++) expect(r[i]).toBeCloseTo(50, 10)
  })

  it('序列不足 n+1 根：整条 null，不猜', () => {
    expect(rsi(midBars([10, 10, 10]), 3)).toEqual([null, null, null])
  })
})

describe('kdj：小样本与手算一致（RSV→K→D→J 每层可复算）', () => {
  // 窗口钉死 9~10 元、n=3，收盘 [9,9,9,9,10,10,10,10]：
  //   RSV 自第 3 根可算：收盘 9 → 0，收盘 10 → 100（RSV = [0,0,100,100,100,100]）；
  //   K/D 初值 50，K = 2/3·昨K + 1/3·RSV，D 对 K 同款再平滑；J = 3K − 2D。
  //   第 8 根 K=61700/729、D=146700/2187、J=261900/2187≈119.75（越上 100）
  it('小样本逐格复算：RSV/K/D/J 与分数手算一致', () => {
    const r = kdj(fixedBand([9, 9, 9, 9, 10, 10, 10, 10]), 3)
    expect(r.rsv).toEqual([null, null, 0, 0, 100, 100, 100, 100])
    expect(r.k.slice(0, 2)).toEqual([null, null])
    expect(r.k[2]).toBeCloseTo(100 / 3, 6)
    expect(r.k[3]).toBeCloseTo(200 / 9, 6)
    expect(r.k[4]).toBeCloseTo(1300 / 27, 6)
    expect(r.k[5]).toBeCloseTo(5300 / 81, 6)
    expect(r.k[6]).toBeCloseTo(18700 / 243, 6)
    expect(r.k[7]).toBeCloseTo(61700 / 729, 6)
    expect(r.d[2]).toBeCloseTo(400 / 9, 6)
    expect(r.d[3]).toBeCloseTo(1000 / 27, 6)
    expect(r.d[4]).toBeCloseTo(3300 / 81, 6)
    expect(r.d[5]).toBeCloseTo(11900 / 243, 6)
    expect(r.d[6]).toBeCloseTo(42500 / 729, 6)
    expect(r.d[7]).toBeCloseTo(146700 / 2187, 6)
    expect(r.j[7]).toBeCloseTo(261900 / 2187, 6)
  })

  it('J = 3K − 2D 是放大镜：收盘贴窗顶的连续根把 J 顶过 100，镜像贴窗底把 J 打破 0', () => {
    const up = kdj(fixedBand([9, 9, 9, 9, 10, 10, 10, 10]), 3)
    expect(up.j[7]).toBeGreaterThan(100) // 收盘贴窗顶：K 追 100、D 慢半拍，J = K + 2×(K−D) 冲出上界
    const down = kdj(fixedBand([10, 10, 10, 10, 9, 9, 9, 9]), 3)
    expect(down.j[7]).toBeLessThan(0) // 镜像：收盘贴窗底，J 冲出下界
    // 镜像样本逐格对偶：K' = 100−K、D' = 100−D、J' = 100−J
    for (const i of [2, 3, 4, 5, 6, 7] as const) {
      expect(down.k[i]).toBeCloseTo(100 - up.k[i]!, 6)
      expect(down.d[i]).toBeCloseTo(100 - up.d[i]!, 6)
      expect(down.j[i]).toBeCloseTo(100 - up.j[i]!, 6)
    }
  })

  it('走平且窗口高低重合（一字横盘）：RSV 分母为零，读数记 50；K/D/J 全程 50', () => {
    const flat = Array<number>(10).fill(10).map((m, i) => bar(i, m, m, m, m))
    const r = kdj(flat, 3)
    expect(r.rsv.slice(2)).toEqual(Array<number>(8).fill(50))
    for (let i = 2; i < 10; i++) {
      expect(r.k[i]).toBe(50)
      expect(r.d[i]).toBe(50)
      expect(r.j[i]).toBe(50)
    }
  })

  it('序列不足 n 根：整条 null，不猜', () => {
    const r = kdj(fixedBand([9, 9]), 3)
    expect(r.rsv).toEqual([null, null])
    expect(r.k).toEqual([null, null])
  })
})

describe('钝化：单调上涨里两指标高位粘滞，被检出', () => {
  const rally = rallyBars(1, 40) // 40 根连阳，日涨幅 0.5%~3%（强弱差 6 倍），天天创新高
  const r = rsi(rally, 14)
  const kd = kdj(rally, 9)

  it('RSI 自成形起全程钉 100：末段 20 根读数一模一样——涨 0.5% 与涨 3% 的日子分不出', () => {
    for (let i = 14; i < 40; i++) {
      expect(rally[i].close).toBeGreaterThan(rally[i - 1].close) // 样本自检：确实天天新高
      expect(r[i]).toBeCloseTo(100, 10) // 平均跌幅一列全程为零，比值钉死
    }
    expect(new Set(r.slice(20).filter((v): v is number => v != null)).size).toBe(1)
  })

  it('KDJ 高位粘滞：末段 K 全部 ≥ 99.8 且逐格位移 < 0.05——平滑让 K 追不上也回不动', () => {
    for (let i = 24; i < 40; i++) {
      expect(kd.k[i]).toBeGreaterThanOrEqual(99.8) // 收盘天天贴窗顶，RSV=100，K 渐近 100
      expect(kd.j[i]).toBeGreaterThanOrEqual(99.5)
    }
    for (let i = 25; i < 40; i++) {
      expect(Math.abs(kd.k[i]! - kd.k[i - 1]!)).toBeLessThan(0.05) // 变化收敛到零：粘滞
    }
  })

  it('镜像：单调下跌 40 根，RSI 钉 0、K 贴地——钝化对两个方向一视同仁', () => {
    const fall = rallyBars(-1, 40)
    const rf = rsi(fall, 14)
    const kf = kdj(fall, 9)
    for (let i = 14; i < 40; i++) expect(rf[i]).toBeCloseTo(0, 10)
    for (let i = 24; i < 40; i++) {
      expect(kf.k[i]).toBeLessThanOrEqual(0.2)
      expect(kf.j[i]).toBeLessThanOrEqual(0)
    }
  })
})

describe('同源差异：同一根急跌，K 比 RSI 敏感、J 比 K 更敏感', () => {
  // 30 根 +1/−1 交替横盘（两指标都在中位附近），第 31 根单日 −3 元急跌
  const closes: number[] = [10]
  for (let i = 1; i <= 29; i++) closes.push(closes[i - 1] + (i % 2 === 1 ? 1 : -1))
  closes.push(closes[29] - 3)
  const cs = closes.map((c, i) => {
    const open = i === 0 ? c : closes[i - 1]
    return bar(i, open, Math.max(open, c) + 0.2, Math.min(open, c) - 0.2, c)
  })
  const r = rsi(cs, 14)
  const kd = kdj(cs, 9)

  it('急跌前两指标都在中位：RSI 逼近 50、K 在 40~60', () => {
    expect(r[29]).toBeGreaterThan(45)
    expect(r[29]).toBeLessThan(55)
    expect(kd.k[29]).toBeGreaterThan(40)
    expect(kd.k[29]).toBeLessThan(60)
  })

  it('急跌当根：|ΔJ| > |ΔK| > |ΔRSI|——同一根 K 线，三把尺的位移逐级放大', () => {
    const dRsi = Math.abs(r[30]! - r[29]!)
    const dK = Math.abs(kd.k[30]! - kd.k[29]!)
    const dJ = Math.abs(kd.j[30]! - kd.j[29]!)
    expect(dK).toBeGreaterThan(dRsi)
    expect(dJ).toBeGreaterThan(dK)
  })
})

describe('结构性非法输入：抛中文错误', () => {
  const ok = fixedBand([9, 9, 9, 9, 10, 10, 10, 10])
  it.each([
    ['rsi 空数组', () => rsi([], 3)],
    ['rsi 窗口为 0', () => rsi(ok, 0)],
    ['rsi 窗口非整数', () => rsi(ok, 2.5)],
    ['rsi 收盘价 NaN', () => rsi([bar(0, 10, 10.5, 9.5, NaN)], 3)],
    ['kdj 空数组', () => kdj([], 3)],
    ['kdj 窗口为 0', () => kdj(ok, 0)],
    ['kdj 最高价 NaN', () => kdj([bar(0, 10, NaN, 9.5, 10)], 3)],
    ['kdj 高低于低', () => kdj([bar(0, 10, 9.5, 10.5, 10)], 3)],
    ['kdj 收盘价越出高低带', () => kdj([bar(0, 10, 10.5, 9.5, 11)], 3)],
  ])('%s', (_name, fn) => {
    expect(fn).toThrow()
  })
})
