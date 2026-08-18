import { describe, expect, it } from 'vitest'
import { pivots } from '../src/levels/pivots'
import { levels } from '../src/levels/levels'
import { fibLevels, FIB_RATIOS } from '../src/levels/fib'
import type { Candle } from '../src/types'

/**
 * 支撑阻力的行为断言：只喂 K 线序列（或两个价位），只看返回的枢轴列表、位列表与刻度列表，
 * 内部怎么扫窗、怎么并簇一概不问。全章核心命题在这里受审：
 * 1. 枢轴=左右各 k 根的严格局部极值，与第 10 章教学标注同款判据；首尾各 k 根不判
 *    （最后一根的新高要等右侧凑满 k 根才能确认）；同类相邻只留更极端的，逼出峰谷交替；
 * 2. 位=枢轴价位的聚类：同簇平均价为位价、簇内枢轴数为触碰次数；容差收紧可拆簇；
 *    位的角色（支撑/阻力）与最新收盘价比出，破位后角色互换；
 * 3. 斐波那契刻度=行程段上按固定比例回撤：涨幅段与跌幅段对称，已知涨跌幅上与手算一致；
 * 4. 结构性非法输入抛中文错误。
 */

const bar = (i: number, open: number, high: number, low: number, close: number): Candle => ({
  date: `2026-07-${String(i + 1).padStart(2, '0')}`,
  open,
  high,
  low,
  close,
  volume: 10000,
})

/** 以 mid 为中心的对称 K 线：high=mid+0.5、low=mid−0.5，便于手工排布峰谷 */
const midBars = (mids: number[]): Candle[] =>
  mids.map((m, i) => bar(i, m, m + 0.5, m - 0.5, m))

describe('枢轴：左右各 k 根的严格局部极值', () => {
  it('k=3 的山形序列：峰在第 4 根、谷在第 8 根，价位取高点与低点', () => {
    const cs = midBars([10.0, 10.5, 11.0, 11.5, 11.0, 10.5, 10.0, 9.5, 10.0, 10.5, 10.7, 10.4, 10.1])
    expect(pivots(cs, 3)).toEqual([
      { index: 3, side: 'high', price: 12.0 },
      { index: 7, side: 'low', price: 9.0 },
    ])
  })

  it('最后一根的全程新高不是枢轴：右侧凑不满 k 根，谁也不能提前确认', () => {
    const base = [10.0, 10.5, 11.0, 11.5, 11.0, 10.5, 10.0, 9.5, 10.0, 10.5, 10.7, 10.4]
    const spiked = midBars([...base, 12.5]) // 末根冲出全程最高，却无右侧窗口
    expect(pivots(spiked, 3)).toEqual([
      { index: 3, side: 'high', price: 12.0 },
      { index: 7, side: 'low', price: 9.0 },
    ])
  })

  it('k=1 的锯齿：峰谷逐根交替，位置与价位手算一致', () => {
    const cs = midBars([10, 11, 10, 9, 10, 11, 10])
    expect(pivots(cs, 1)).toEqual([
      { index: 1, side: 'high', price: 11.5 },
      { index: 3, side: 'low', price: 8.5 },
      { index: 5, side: 'high', price: 11.5 },
    ])
  })

  it('同类相邻只留更极端的：两个峰夹一条平低点（相等低点判不出谷），只剩更高的峰', () => {
    const cs = [
      bar(0, 10.0, 10.5, 9.8, 10.0),
      bar(1, 10.0, 11.5, 9.9, 11.0), // 峰候选一：11.5
      bar(2, 11.0, 10.8, 9.9, 10.5), // 低点 9.9 与前一根相等：严格判据下不是谷
      bar(3, 10.5, 11.8, 10.2, 11.5), // 峰候选二：11.8
      bar(4, 11.5, 11.2, 10.8, 11.0),
      bar(5, 11.0, 10.9, 10.5, 10.7),
    ]
    expect(pivots(cs, 1)).toEqual([{ index: 3, side: 'high', price: 11.8 }])
  })

  it('平顶的两次相等高点：严格不等号下谁也不是峰', () => {
    const cs = midBars([10, 11, 11, 10])
    expect(pivots(cs, 1)).toEqual([])
  })

  it('序列长度不足 2k+1：返回空列表，不抛错也不猜', () => {
    expect(pivots(midBars([10, 11, 10]), 3)).toEqual([])
  })

  it('默认窗口 k=3：与显式传 3 的结果一致（第 10 章教学标注的同款口径）', () => {
    const cs = midBars([10.0, 10.5, 11.0, 11.5, 11.0, 10.5, 10.0, 9.5, 10.0, 10.5, 10.7, 10.4, 10.1])
    expect(pivots(cs)).toEqual(pivots(cs, 3))
  })
})

describe('位：枢轴价位的聚类', () => {
  // 双顶夹双底的震荡段：顶 11.2/11.22 元、底 9.1/9.14 元，末根收在中部 10.5 元
  const range = midBars([
    10.0, 10.1, 10.3, 10.9, 10.4, 9.8, 9.4, 9.9, 10.5, 10.92, 10.4, 9.9, 9.44, 9.9, 10.2, 10.4, 10.5,
  ])

  it('双顶触碰同一价位：聚成一个位，位价取簇内均值、触碰次数为 2', () => {
    const ls = levels(range)
    expect(ls).toHaveLength(2)
    expect(ls[0]).toMatchObject({ touches: 2, kind: 'resistance', indices: [3, 9] })
    expect(ls[0]!.price).toBeCloseTo(11.41, 10)
    expect(ls[1]).toMatchObject({ touches: 2, kind: 'support', indices: [6, 12] })
    expect(ls[1]!.price).toBeCloseTo(8.92, 10)
  })

  it('位按价格从高到低排列', () => {
    const ls = levels(range)
    expect(ls[0]!.price).toBeGreaterThan(ls[1]!.price)
  })

  it('容差收紧可拆簇：同一序列 tol=0.01 时双顶拆成两个一位触碰的位', () => {
    const ls = levels(range, { tol: 0.01 })
    expect(ls).toHaveLength(4)
    expect(ls.every((l) => l.touches === 1)).toBe(true)
  })

  it('破位后角色互换：收盘涨过原阻力，同一个簇从阻力变支撑，位价与触碰次数不变', () => {
    const broken = [...range.map((c) => ({ ...c })), bar(17, 10.5, 11.6, 10.4, 11.5), bar(18, 11.5, 11.9, 11.3, 11.8)]
    const before = levels(range)[0]!
    const after = levels(broken).find((l) => l.indices[0] === 3)!
    expect(after.kind).toBe('support')
    expect(after.price).toBeCloseTo(before.price, 10)
    expect(after.touches).toBe(before.touches)
  })

  it('三个枢轴聚进同一位：触碰次数记 3', () => {
    const cs = midBars([
      9.5, 10.0, 10.5, 11.0, 10.4, 10.0, 10.6, 11.02, 10.3, 10.0, 10.6, 10.98, 10.3, 9.9, 10.2, 10.5, 10.6,
    ])
    const ls = levels(cs)
    expect(ls).toHaveLength(2)
    expect(ls[0]).toMatchObject({ touches: 3, kind: 'resistance', indices: [3, 7, 11] })
    expect(ls[0]!.price).toBeCloseTo(11.5, 10)
  })

  it('序列凑不出枢轴：返回空列表，不抛错', () => {
    expect(levels(midBars([10, 11, 10]))).toEqual([])
  })
})

describe('斐波那契回调刻度：行程段上的固定比例', () => {
  it('涨幅段 10→20 元：四档刻度与手算一致', () => {
    const fs = fibLevels(10, 20)
    expect(fs.map((f) => f.ratio)).toEqual([0.236, 0.382, 0.5, 0.618])
    expect(fs.map((f) => f.price)).toEqual([17.64, 16.18, 15.0, 13.82].map((p) => expect.closeTo(p, 10)))
  })

  it('跌幅段 20→10 元：同一算式对称成立，0.382 档反弹位是 13.82 元', () => {
    const fs = fibLevels(20, 10)
    expect(fs[1]!.price).toBeCloseTo(13.82, 10)
    expect(fs.every((f) => f.price > 10 && f.price < 20)).toBe(true)
  })

  it('A 股量级：12.5→15.0 元的半分位是 13.75 元', () => {
    expect(fibLevels(12.5, 15.0).find((f) => f.ratio === 0.5)!.price).toBeCloseTo(13.75, 10)
  })

  it('比例常量公开导出：四档固定，升序排列', () => {
    expect([...FIB_RATIOS]).toEqual([0.236, 0.382, 0.5, 0.618])
  })
})

describe('结构性非法输入：抛中文错误', () => {
  const ok = midBars([10, 11, 11.5, 11, 10.5, 10, 10.5, 11])
  it.each([
    ['pivots 空数组', () => pivots([])],
    ['pivots 窗口为 0', () => pivots(ok, 0)],
    ['pivots 窗口非整数', () => pivots(ok, 1.5)],
    ['pivots 窗口为负', () => pivots(ok, -2)],
    ['pivots 高点 NaN', () => pivots([bar(0, 10, NaN, 9.5, 10)])],
    ['levels 空数组', () => levels([])],
    ['levels 容差为 0', () => levels(ok, { tol: 0 })],
    ['levels 容差为负', () => levels(ok, { tol: -0.1 })],
    ['levels 收盘价 NaN', () => levels([bar(0, 10, 10.5, 9.5, NaN)])],
    ['fibLevels 两价位相等', () => fibLevels(10, 10)],
    ['fibLevels from 为 NaN', () => fibLevels(NaN, 20)],
    ['fibLevels to 非有限数', () => fibLevels(10, Infinity)],
  ])('%s', (_name, fn) => {
    expect(fn).toThrow()
  })
})
