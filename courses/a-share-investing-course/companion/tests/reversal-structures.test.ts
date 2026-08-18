import { describe, expect, it } from 'vitest'
import { detectStructures } from '../src/levels/structures'
import type { Candle } from '../src/types'

/**
 * 反转结构的行为断言：只喂 K 线序列，只看返回的结构列表——
 * 内部怎么扫枢轴、怎么排窗口一概不问。全章核心命题在这里受审：
 * 1. 头肩顶=「左肩、左谷、头、右谷、右肩」五枢轴骨架：头明显更高、两肩同水平、两谷同水平，
 *    颈线取两谷均值；结构成立判据是右肩之后第一次收盘跌破颈线（盘中影线不算）；
 *    量度目标=结构高度从颈线向下投影，即 2×颈线−头顶价；
 * 2. 双顶/双底=「峰、谷、峰」（镜像「谷、峰、谷」）三枢轴骨架：两峰（谷）同水平、
 *    中间谷（峰）要拉开深度，收盘越过中间枢轴价才算成立；
 * 3. 非结构序列不误报：上行台阶、单峰、单调序列一概空手而归——
 *    骨架成形但收盘未破线也不报（确认纪律与第 10、13 章同口径）；
 * 4. 同水平容差是显式参数（默认取平均振幅一半），放宽可让原被拒绝的序列成结构；
 * 5. 结构性非法输入抛中文错误。
 */

const bar = (i: number, open: number, high: number, low: number, close: number): Candle => ({
  date: `2026-07-${String(i + 1).padStart(2, '0')}`,
  open,
  high,
  low,
  close,
  volume: 10000,
})

/** 以 mid 为中心的对称 K 线：high=mid+0.5、low=mid−0.5，全章手工排布峰谷的积木（平均振幅恒为 1，默认容差 0.5） */
const midBars = (mids: number[]): Candle[] =>
  mids.map((m, i) => bar(i, m, m + 0.5, m - 0.5, m))

/** 覆盖序列中的一根（保留原日期） */
const withBar = (cs: readonly Candle[], i: number, c: Candle): Candle[] =>
  cs.map((k, n) => (n === i ? { ...c, date: k.date } : k))

// 教科书头肩顶：左肩高点 11.1（第 4 根）、左谷低点 9.3（第 7 根）、头 11.9（第 11 根）、
// 右谷低点 9.4（第 14 根）、右肩高点 11.2（第 17 根），末段下破颈线
const HS_MIDS = [
  9.4, 9.8, 10.2, 10.6, 10.3, 10.0, 9.8, 10.1, 10.5, 10.9, 11.4, 10.8, 10.3, 9.9, 10.2, 10.5,
  10.7, 10.3, 9.9, 9.5, 9.0, 8.6,
]
const headShoulders = midBars(HS_MIDS)

describe('头肩顶：三峰两谷加一次收盘破线', () => {
  it('教科书头肩顶被检出：五枢轴下标、颈线、破位日与量度目标与手算一致', () => {
    const out = detectStructures(headShoulders)
    expect(out).toHaveLength(1) // 头之下的两谷虽是同水平，收不上头价不算双底——只报头肩顶一件
    const s = out[0]!
    expect(s.id).toBe('head-and-shoulders')
    expect(s.direction).toBe('bear')
    expect(s.indices).toEqual([3, 6, 10, 13, 16])
    // 颈线 =（左谷 9.3 + 右谷 9.4）÷ 2 = 9.35
    expect(s.neckline).toBeCloseTo(9.35, 10)
    // 右肩之后第一次收盘 < 9.35 在第 21 根（close 9.0）
    expect(s.breakIndex).toBe(20)
    // 量度目标 = 2×9.35 − 11.9 = 6.8（结构高度 2.55 从颈线向下投影）
    expect(s.target).toBeCloseTo(6.8, 10)
  })

  it('右肩成形但收盘未破颈线：结构不算成立，不报', () => {
    const held = midBars([...HS_MIDS.slice(0, 17), 10.2, 10.4, 10.3, 10.5, 10.4]) // 尾段全部收在 9.35 之上
    expect(detectStructures(held)).toEqual([])
  })

  it('盘中影线刺破颈线、收盘收回：收盘口径下不算破位', () => {
    const pierced = midBars([...HS_MIDS.slice(0, 17), 10.3, 10.3, 10.2, 10.1, 10.0])
    const wickOnly = withBar(pierced, 18, bar(18, 10.3, 10.5, 9.0, 10.0)) // 第 19 根低点 9.0 刺穿 9.35，收盘 10.0 收回
    expect(wickOnly[18]!.low).toBeLessThan(9.35)
    expect(detectStructures(wickOnly)).toEqual([])
  })

  it('显式 tol=0.5 与默认容差（平均振幅一半）同输出', () => {
    expect(detectStructures(headShoulders, { tol: 0.5 })).toEqual(detectStructures(headShoulders))
  })
})

// 双顶：峰 11.5（第 4 根）、中间谷低点 9.1（第 7 根）、第二峰 11.5（第 11 根），末段下破
const DOUBLE_TOP_MIDS = [
  9.8, 10.2, 10.6, 11.0, 10.5, 10.0, 9.6, 10.0, 10.4, 10.8, 11.0, 10.6, 10.1, 9.6, 8.9, 8.6,
]
// 双底：谷 8.9（第 4 根）、中间峰高点 11.3（第 7 根）、第二谷 8.9（第 11 根），末段上破
const DOUBLE_BOTTOM_MIDS = [
  10.6, 10.2, 9.8, 9.4, 9.9, 10.4, 10.8, 10.4, 10.0, 9.6, 9.4, 9.9, 10.4, 10.9, 11.4, 11.8,
]
// 第二峰明显更低（LH）：峰 11.5 与峰 10.9 差 0.6，默认容差 0.5 下不算同水平
const LOWER_HIGH_MIDS = [
  9.8, 10.2, 10.6, 11.0, 10.5, 10.0, 9.6, 9.9, 10.1, 10.4, 10.3, 9.9, 9.6, 9.2, 8.9, 8.6,
]

describe('双顶与双底：两次冲击同一价位的证明', () => {
  it('双顶：两峰同水平加收盘跌破中间谷，颈线与量度目标与手算一致', () => {
    const out = detectStructures(midBars(DOUBLE_TOP_MIDS))
    expect(out).toHaveLength(1)
    const s = out[0]!
    expect(s.id).toBe('double-top')
    expect(s.direction).toBe('bear')
    expect(s.indices).toEqual([3, 6, 10])
    expect(s.neckline).toBeCloseTo(9.1, 10) // 颈线 = 中间谷低点
    expect(s.breakIndex).toBe(14) // 第 15 根收盘 8.9 首次跌破 9.1
    expect(s.target).toBeCloseTo(6.7, 10) // 2×9.1 −（11.5+11.5）÷2 = 6.7
  })

  it('双底：镜像成立，方向看涨、量度目标从颈线向上投影', () => {
    const out = detectStructures(midBars(DOUBLE_BOTTOM_MIDS))
    expect(out).toHaveLength(1)
    const s = out[0]!
    expect(s.id).toBe('double-bottom')
    expect(s.direction).toBe('bull')
    expect(s.indices).toEqual([3, 6, 10])
    expect(s.neckline).toBeCloseTo(11.3, 10)
    expect(s.breakIndex).toBe(14) // 第 15 根收盘 11.4 首次涨破 11.3
    expect(s.target).toBeCloseTo(13.7, 10) // 2×11.3 − 8.9 = 13.7
  })

  it('第二峰明显更低（LH）：默认容差下不是双顶；容差放宽到 0.8 后同一序列判为双顶', () => {
    const cs = midBars(LOWER_HIGH_MIDS)
    expect(detectStructures(cs)).toEqual([])
    const out = detectStructures(cs, { tol: 0.8 })
    expect(out).toHaveLength(1)
    expect(out[0]!.id).toBe('double-top')
    expect(out[0]!.neckline).toBeCloseTo(9.1, 10)
    expect(out[0]!.target).toBeCloseTo(7.0, 10) // 2×9.1 −（11.5+10.9）÷2 = 7.0
  })
})

describe('非结构序列不误报', () => {
  it('上行台阶（峰谷交替、步步抬高）：无任何结构', () => {
    const up = midBars([
      10.0, 10.25, 10.55, 10.8, 10.55, 10.3, 10.15, 10.4, 10.65, 10.9, 11.15, 11.4, 11.15, 10.9,
      10.75, 11.0, 11.25, 11.5, 11.75, 12.0, 11.75, 11.5, 11.35, 11.6, 11.85, 12.1, 12.35, 12.6,
      12.35, 12.1, 11.95, 12.2,
    ])
    expect(detectStructures(up)).toEqual([])
  })

  it('单峰山形与单调序列：无结构', () => {
    expect(detectStructures(midBars([10, 10.5, 11, 11.5, 11, 10.5, 10]))).toEqual([])
    expect(detectStructures(midBars([10, 10.3, 10.6, 10.9, 11.2, 11.5, 11.8, 12.1]))).toEqual([])
  })
})

describe('结构性非法输入：抛中文错误', () => {
  const ok = headShoulders
  it.each([
    ['空数组', () => detectStructures([])],
    ['容差为 0', () => detectStructures(ok, { tol: 0 })],
    ['容差为负', () => detectStructures(ok, { tol: -0.1 })],
    ['容差 NaN', () => detectStructures(ok, { tol: NaN })],
    ['收盘价 NaN', () => detectStructures([bar(0, 10, 10.5, 9.5, NaN)])],
    ['高点 NaN', () => detectStructures([bar(0, 10, NaN, 9.5, 10)])],
  ])('%s', (_name, fn) => {
    expect(fn).toThrow()
  })
})
