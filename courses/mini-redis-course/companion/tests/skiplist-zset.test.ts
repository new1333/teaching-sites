// 第 5 章测试：跳表 SkipList——多层索引、随机层数（可控随机源）、按分数取段；
// 服务器新增 ZADD/ZRANGE/ZCARD；一万随机分数的 ZRANGE 与 Array.sort 基准逐一对上。
import { describe, expect, it } from 'vitest'
import { SkipList } from '../src/skiplist.ts'
import { RespDecoder } from '../src/resp.ts'
import { MiniRedis } from '../src/db.ts'
import { connect } from '../src/client.ts'
import { createMiniRedisServer } from '../src/server.ts'

// 种子随机：线性同余——固定种子跑出固定序列，让「随机」的行为可复现地被测
function seededRandom(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x100000000
  }
}

// 排序基准：与真 Redis 同款排序键——先比分数，同分比成员名（字典序）
function baseline(pairs: Array<[string, number]>): Array<[string, number]> {
  return [...pairs].sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1))
}

// 把 ZRANGE 的数组应答解析回字符串列表——第 2 章的解码器反过来用在测试里
function parseBulkArray(reply: string): string[] {
  return new RespDecoder().feed(reply)[0] ?? []
}

describe('SkipList 基础：插入即有序，与插入顺序无关', () => {
  it('倒序灌入，rangeByScore 全域与排序基准逐一对上；length 如实', () => {
    const z = new SkipList()
    const pairs: Array<[string, number]> = []
    for (let i = 19; i >= 0; i--) pairs.push([`p${i}`, i * 3]) // 从大到小倒着灌
    for (const [m, s] of pairs) expect(z.insert(m, s)).toBe(true) // 全员新增
    expect(z.length).toBe(20)
    expect(z.rangeByScore(-Infinity, Infinity)).toEqual(baseline(pairs))
  })

  it('跳跃顺序灌入同分成员：同分按成员名字典序排队', () => {
    const z = new SkipList()
    const pairs: Array<[string, number]> = [
      ['c', 50],
      ['a', 50],
      ['e', 20],
      ['b', 50],
      ['d', 20],
    ]
    for (const [m, s] of pairs) z.insert(m, s)
    expect(z.rangeByScore(0, 100)).toEqual(baseline(pairs))
    // 直接钉同分段的队形：d(20) 排在 e(20) 前；a b c 三个 50 分按名字排队
    expect(z.rangeByScore(50, 50).map(([m]) => m)).toEqual(['a', 'b', 'c'])
    expect(z.rangeByScore(20, 20).map(([m]) => m)).toEqual(['d', 'e'])
  })

  it('已有成员再 insert 是改分：位置随新分搬家，length 不变，返回 false', () => {
    const z = new SkipList()
    for (const [m, s] of [
      ['a', 10],
      ['b', 20],
      ['c', 30],
    ] as Array<[string, number]>) {
      z.insert(m, s)
    }
    expect(z.insert('c', 5)).toBe(false) // 老成员改分，不算新增
    expect(z.length).toBe(3) // 还是三个成员
    expect(z.rangeByScore(0, 100).map(([m]) => m)).toEqual(['c', 'a', 'b']) // c 从队尾搬到队头
    expect(z.insert('c', 30)).toBe(false) // 改回原分：位置复原
    expect(z.rangeByScore(0, 100).map(([m]) => m)).toEqual(['a', 'b', 'c'])
  })

  it('rangeByScore 的边界与翻页：区间端点包含在内，offset 先跳过、limit 封顶', () => {
    const z = new SkipList()
    for (let i = 0; i < 10; i++) z.insert(`p${i}`, i) // 分数 0..9
    expect(z.rangeByScore(3, 8)).toEqual([
      ['p3', 3],
      ['p4', 4],
      ['p5', 5],
      ['p6', 6],
      ['p7', 7],
      ['p8', 8],
    ]) // 3 与 8 两个端点都在段内
    expect(z.rangeByScore(0, 100, 2, 1)).toEqual([
      ['p1', 1],
      ['p2', 2],
    ]) // 跳过第 1 名、连取 2 名
    expect(z.rangeByScore(100, 200)).toEqual([]) // 没有人的分数落在段内
  })
})

describe('随机层数：硬币可注入，形状与结果解耦', () => {
  it('随机源恒回 0：逢抛必晋升，全员顶到 32 级封顶——层数不无限长', () => {
    const z = new SkipList({ random: () => 0 })
    for (let i = 0; i < 50; i++) z.insert(`p${i}`, i)
    for (let i = 0; i < 50; i++) expect(z.levelOf(`p${i}`)).toBe(32)
    expect(z.length).toBe(50)
  })

  it('随机源恒回 0.99：一次不晋升，全员 1 级——退化成纯链表，语义一点不丢', () => {
    const z = new SkipList({ random: () => 0.99 })
    const pairs: Array<[string, number]> = []
    const r = seededRandom(7)
    for (let i = 0; i < 100; i++) {
      const s = Math.floor(r() * 1000)
      pairs.push([`p${i}`, s])
      z.insert(`p${i}`, s)
    }
    for (const [m] of pairs) expect(z.levelOf(m)).toBe(1) // 全员只住底层
    expect(z.rangeByScore(-Infinity, Infinity)).toEqual(baseline(pairs)) // 形状退化，结果照对
  })

  it('种子随机灌 2000 个：约四分之三停在第 1 级，往上逐级是上一级的四分之一', () => {
    const z = new SkipList({ random: seededRandom(42) })
    for (let i = 0; i < 2000; i++) z.insert(`p${i}`, (i * 7) % 1000)
    const at = (lv: number) => {
      let n = 0
      for (let i = 0; i < 2000; i++) if (z.levelOf(`p${i}`) === lv) n++
      return n
    }
    // 每级占比是几何分布：1 级 75%、2 级 18.75%、3 级 4.7%（固定种子结果确定，容差带防脆）
    expect(at(1)).toBeGreaterThan(1400)
    expect(at(1)).toBeLessThan(1600)
    expect(at(2)).toBeGreaterThan(300)
    expect(at(2)).toBeLessThan(450)
    expect(at(3)).toBeGreaterThan(60)
    expect(at(3)).toBeLessThan(130)
  })

  it('同一批数据、两份不同的硬币：层数形状不同，rangeByScore 结果逐项相等', () => {
    const pairs: Array<[string, number]> = []
    const r = seededRandom(99)
    for (let i = 0; i < 300; i++) pairs.push([`p${i}`, Math.floor(r() * 500)])
    const z1 = new SkipList({ random: seededRandom(1) })
    const z2 = new SkipList({ random: seededRandom(2) })
    for (const [m, s] of pairs) {
      z1.insert(m, s)
      z2.insert(m, s)
    }
    expect(z1.rangeByScore(-Infinity, Infinity)).toEqual(z2.rangeByScore(-Infinity, Infinity))
    expect(z1.length).toBe(z2.length)
  })
})

describe('命令层：ZADD / ZRANGE / ZCARD', () => {
  it('ZADD 回新增数（老成员改分不计）；ZRANGE 按名次切片、认负下标；ZCARD 数成员', () => {
    const db = new MiniRedis()
    expect(db.execute(['ZADD', 'lb', '10', 'a'])).toBe(':1\r\n')
    expect(db.execute(['ZADD', 'lb', '20', 'b', '30', 'c'])).toBe(':2\r\n')
    expect(db.execute(['ZADD', 'lb', '5', 'a'])).toBe(':0\r\n') // a 改分 10→5，不算新增
    expect(db.execute(['ZCARD', 'lb'])).toBe(':3\r\n')
    expect(db.execute(['ZRANGE', 'lb', '0', '-1'])).toBe('*3\r\n$1\r\na\r\n$1\r\nb\r\n$1\r\nc\r\n') // 改分后 a 领跑
    expect(db.execute(['ZRANGE', 'lb', '0', '0'])).toBe('*1\r\n$1\r\na\r\n') // 第 1 名
    expect(db.execute(['ZRANGE', 'lb', '-1', '-1'])).toBe('*1\r\n$1\r\nc\r\n') // 最后一名
    expect(db.execute(['ZRANGE', 'lb', '5', '10'])).toBe('*0\r\n') // 起点名次超出队伍：空
  })

  it('ZRANGE WITHSCORES：成员与它的分数交替排列', () => {
    const db = new MiniRedis()
    db.execute(['ZADD', 'lb', '10', 'a', '20', 'b'])
    expect(db.execute(['ZRANGE', 'lb', '0', '-1', 'WITHSCORES'])).toBe(
      '*4\r\n$1\r\na\r\n$2\r\n10\r\n$1\r\nb\r\n$2\r\n20\r\n',
    )
  })

  it('不存在的 key：ZCARD 回 0、ZRANGE 回空数组；参数不合法回 -ERR', () => {
    const db = new MiniRedis()
    expect(db.execute(['ZCARD', 'missing'])).toBe(':0\r\n')
    expect(db.execute(['ZRANGE', 'missing', '0', '-1'])).toBe('*0\r\n')
    expect(db.execute(['ZADD', 'lb', '10'])).toBe('-ERR wrong number of arguments for ZADD\r\n') // score 与 member 必须成对
    expect(db.execute(['ZADD', 'lb', 'abc', 'a'])).toBe('-ERR value is not a valid float\r\n')
  })

  it('类型走错门：对字符串键 ZADD、对有序集合 GET，都回 WRONGTYPE 错误', () => {
    const db = new MiniRedis()
    db.execute(['SET', 'name', 'alice'])
    expect(db.execute(['ZADD', 'name', '10', 'a'])).toBe(
      '-WRONGTYPE Operation against a key holding the wrong kind of value\r\n',
    )
    db.execute(['ZADD', 'lb', '10', 'a'])
    expect(db.execute(['GET', 'lb'])).toBe(
      '-WRONGTYPE Operation against a key holding the wrong kind of value\r\n',
    )
  })
})

describe('一万随机分数压舱：ZRANGE 与 Array.sort 基准一致', () => {
  it('种子随机灌 1 万个（大量同分），全量、前 100 名、WITHSCORES 全部与基准对上', () => {
    const db = new MiniRedis()
    const r = seededRandom(2024)
    const pairs: Array<[string, number]> = []
    const zaddArgs = ['ZADD', 'lb']
    // 分数一位小数、值域 0~100：一万个成员挤一千档——同分比成员名，正是基准的排序键
    for (let i = 0; i < 10_000; i++) {
      const score = Math.round(r() * 1000) / 10
      pairs.push([`player:${i}`, score])
      zaddArgs.push(String(score), `player:${i}`)
    }
    expect(db.execute(zaddArgs)).toBe(':10000\r\n') // 一条命令一口气全收
    expect(db.execute(['ZCARD', 'lb'])).toBe(':10000\r\n')
    const sorted = baseline(pairs)
    // 全量名次与基准逐一对上
    expect(parseBulkArray(db.execute(['ZRANGE', 'lb', '0', '-1']))).toEqual(sorted.map(([m]) => m))
    // 前 100 名（排行榜的正脸）与基准前 100 逐一对上，含分数
    expect(parseBulkArray(db.execute(['ZRANGE', 'lb', '0', '99', 'WITHSCORES']))).toEqual(
      sorted.slice(0, 100).flatMap(([m, s]) => [m, String(s)]),
    )
    // 末尾翻页（负下标）也对上
    expect(parseBulkArray(db.execute(['ZRANGE', 'lb', '-100', '-1']))).toEqual(
      sorted.slice(-100).map(([m]) => m),
    )
  })
})

describe('TCP 侧照常：排行榜走网络', () => {
  it('管道灌 30 名成员，ZRANGE 取前 3 名应答逐字节核对', async () => {
    const server = await createMiniRedisServer(new MiniRedis(), 0)
    const c = await connect(server.port)
    try {
      const batch: string[][] = []
      for (let i = 0; i < 30; i++) batch.push(['ZADD', 'lb', String((i * 37) % 100), `p${i}`])
      const added = await c.pipe(...batch)
      expect(added.every((x) => x === ':1\r\n')).toBe(true)
      expect(await c.cmd('ZCARD', 'lb')).toBe(':30\r\n')
      // (i*37)%100 最小的三个分数：p0=0、p19=3、p11=7——前三名手工核对
      expect(await c.cmd('ZRANGE', 'lb', '0', '2')).toBe('*3\r\n$2\r\np0\r\n$3\r\np19\r\n$3\r\np11\r\n')
    } finally {
      await c.close()
      await server.close()
    }
  })
})
