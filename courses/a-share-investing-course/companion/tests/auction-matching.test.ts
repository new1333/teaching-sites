import { describe, expect, it } from 'vitest'
import { callAuction, type AuctionOrder } from '../src/matching/auction'

/**
 * 集合竞价撮合的行为断言：喂申报表，只看各候选价的可成交量与投出的开盘价。
 * 核心命题在这里受审：
 * 1. 第 2 章申报表逐行复算——愿买/愿卖/可成交量与正文表格一字不差；
 * 2. 开盘价 = 可成交量最大的候选价（正文结论 10.65 元），不是第一笔成交；
 * 3. 可成交量 = 两侧取小：单边垄断的候选价上量被压住；
 * 4. 并列最大时如实抛错，不替交易所猜细则；结构性非法输入抛中文错误。
 */

/** 第 2 章正文的申报表原文（数字为教学示意） */
const BOOK02_BUYS: AuctionOrder[] = [
  { price: 10.7, shares: 3000 },
  { price: 10.65, shares: 4000 },
  { price: 10.6, shares: 2000 },
  { price: 10.58, shares: 1000 },
  { price: 10.5, shares: 2000 },
]
const BOOK02_SELLS: AuctionOrder[] = [
  { price: 10.5, shares: 1500 },
  { price: 10.6, shares: 2500 },
  { price: 10.65, shares: 4500 },
  { price: 10.7, shares: 4000 },
]

describe('callAuction：第 2 章申报表逐候选价算可成交量', () => {
  it('五个候选价按报价从高到低排列，愿买/愿卖/可成交量与正文表格逐行一致', () => {
    const r = callAuction(BOOK02_BUYS, BOOK02_SELLS)
    expect(r.levels.map((l) => l.price)).toEqual([10.7, 10.65, 10.6, 10.58, 10.5])
    expect(r.levels.map((l) => l.buyShares)).toEqual([3000, 7000, 9000, 10000, 12000])
    expect(r.levels.map((l) => l.sellShares)).toEqual([12500, 8500, 4000, 1500, 1500])
    expect(r.levels.map((l) => l.volume)).toEqual([3000, 7000, 4000, 1500, 1500])
  })

  it('开盘价 = 可成交量最大的 10.65 元（7,000 股）——正文结论，不是第一笔成交', () => {
    const r = callAuction(BOOK02_BUYS, BOOK02_SELLS)
    expect(r.openingPrice).toBe(10.65)
    expect(r.openingVolume).toBe(7000)
  })

  it('可成交量 = 两侧取小：候选价 10 上买方只肯接 1,000、候选价 9 上卖方只肯给 2,000', () => {
    const r = callAuction(
      [
        { price: 10, shares: 1000 },
        { price: 9, shares: 4000 },
      ],
      [
        { price: 10, shares: 3000 },
        { price: 9, shares: 2000 },
      ],
    )
    expect(r.levels.map((l) => [l.price, l.buyShares, l.sellShares, l.volume])).toEqual([
      [10, 1000, 5000, 1000],
      [9, 5000, 2000, 2000],
    ])
    expect(r.openingPrice).toBe(9)
    expect(r.openingVolume).toBe(2000)
  })

  it('同价申报合并累计：两张 10.60 元买单在候选价 10.60 上合计 3,500 股', () => {
    const r = callAuction(
      [
        { price: 10.6, shares: 2000 },
        { price: 10.6, shares: 1500 },
        { price: 10.5, shares: 1000 },
      ],
      [{ price: 10.5, shares: 9000 }],
    )
    expect(r.levels.map((l) => [l.price, l.buyShares, l.volume])).toEqual([
      [10.6, 3500, 3500],
      [10.5, 4500, 4500],
    ])
    expect(r.openingPrice).toBe(10.5)
    expect(r.openingVolume).toBe(4500)
  })

  it('可成交量并列最大时如实抛错——并列细则不在撮合算式的实现范围', () => {
    // 两个候选价都只能成 100 股：11 元（买 100）与 10 元（卖 100）
    expect(() =>
      callAuction(
        [
          { price: 11, shares: 100 },
          { price: 10, shares: 100 },
        ],
        [
          { price: 11, shares: 100 },
          { price: 10, shares: 100 },
        ],
      ),
    ).toThrow()
  })

  it.each([
    ['买单为空', () => callAuction([], BOOK02_SELLS)],
    ['卖单为空', () => callAuction(BOOK02_BUYS, [])],
    ['报价为零', () => callAuction([{ price: 0, shares: 100 }], BOOK02_SELLS)],
    ['股数为零', () => callAuction([{ price: 10, shares: 0 }], BOOK02_SELLS)],
    ['股数非整数', () => callAuction([{ price: 10, shares: 100.5 }], BOOK02_SELLS)],
  ])('%s', (_name, fn) => {
    expect(fn).toThrow()
  })
})
