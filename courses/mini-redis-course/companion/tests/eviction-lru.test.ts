// 第 7 章测试：内存淘汰——键数上限（maxmemory 的教学近似）与随机抽样近似 LRU（抽 5 踢 idle 最大）。
// noeviction 拒写与 allkeys-lru 腾位各自独立钉死；时钟与随机源全部可注入，「哪个键被踢」不赌真随机。
import { describe, expect, it } from 'vitest'
import { Evictor } from '../src/eviction.ts'
import { MiniRedis } from '../src/db.ts'
import { RespDecoder } from '../src/resp.ts'
import { connect } from '../src/client.ts'
import { createMiniRedisServer } from '../src/server.ts'

// 手拨的假钟（第 6 章同款）：advance 把时间往前推，测试不 sleep 的全部秘密
function fakeClock(start = 0) {
  let t = start
  return { now: () => t, advance: (ms: number) => (t += ms) }
}

// 线性同余伪随机：固定种子 → 固定序列。抽样本是随机的，测试里「抽中了谁」必须确定
function lcg(seed = 42) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x1_0000_0000
  }
}

// 把数组应答解析回字符串列表（第 2 章的解码器反过来用在测试里）
function parseBulkArray(reply: string): string[] {
  return new RespDecoder().feed(reply)[0] ?? []
}

// 把 INFO 的应答解析成 { 指标: 值 }
function infoOf(reply: string): Record<string, string> {
  const body = reply.slice(reply.indexOf('\r\n') + 2, reply.lastIndexOf('\r\n'))
  const out: Record<string, string> = {}
  for (const line of body.split('\r\n')) {
    const idx = line.indexOf(':')
    if (idx > 0) out[line.slice(0, idx)] = line.slice(idx + 1)
  }
  return out
}

// 真实 OOM 应答原文（公开协议事实）：错误码是 OOM 不是 ERR
const OOM = "-OOM command not allowed when used memory > 'maxmemory'\r\n"

describe('Evictor：抽 5 个，踢最久未用的', () => {
  it('恒 0 随机下抽样退化为「取池面前 5 个」：踢的是样本里 idle 最大的', () => {
    const clock = fakeClock(1000)
    const evicted: string[] = []
    const e = new Evictor({ now: clock.now, random: () => 0 })
    e.setLimit(5)
    e.setPolicy('allkeys-lru')
    // 池面 a..f：touch 时刻依次 +10ms——a 最久没用，f 刚刚用过
    for (const k of ['a', 'b', 'c', 'd', 'e', 'f']) {
      clock.advance(10)
      e.touch(k)
    }
    const pool = ['a', 'b', 'c', 'd', 'e', 'f']
    const freed = e.onWrite(() => [...pool], (k) => evicted.push(k))
    expect(freed).toBe(2) // 6 键上限 5：腾到 4 才放新键进来
    expect(evicted).toEqual(['a', 'b']) // 两轮各踢 idle 最大：先 a，再 b——刚用过的 f 永不中签
    expect(e.evicted).toBe(2)
  })

  it('近似语义：刚 touch 过的键永不中签，被踢的全是老键（不依赖具体随机序列）', () => {
    const clock = fakeClock(1_000_000)
    const e = new Evictor({ now: clock.now, random: lcg(2024) })
    e.setLimit(4)
    e.setPolicy('allkeys-lru')
    for (const k of ['old1', 'old2', 'old3', 'old4']) e.touch(k)
    clock.advance(500_000) // 老键闲置半秒
    e.touch('fresh') // 新键刚刚用过：idle 为 0
    const evicted: string[] = []
    const freed = e.onWrite(() => ['old1', 'old2', 'old3', 'old4', 'fresh'], (k) => evicted.push(k))
    expect(freed).toBe(2) // 5 键上限 4：踢 2 个
    // fresh 只要进样本，样本里必有比它更老的——它永远不是 idle 最大的那个
    expect(evicted).not.toContain('fresh')
    expect(evicted.length).toBe(2)
  })

  it('noeviction：满了回 -1，一根汗毛不动——真 Redis 同款默认策略', () => {
    const evicted: string[] = []
    const e = new Evictor({ now: () => 0, random: lcg(7) })
    e.setLimit(3) // 不 setPolicy：默认就是 noeviction
    expect(e.onWrite(() => ['a', 'b', 'c'], (k) => evicted.push(k))).toBe(-1)
    expect(evicted).toEqual([])
    expect(e.evicted).toBe(0)
  })

  it('没设上限（0）与没满：照常放行，回 0', () => {
    const e = new Evictor({ now: () => 0, random: lcg(1) })
    expect(e.onWrite(() => ['a', 'b'], () => {})).toBe(0) // limit=0：内存关不存在
    e.setLimit(10)
    expect(e.onWrite(() => ['a', 'b'], () => {})).toBe(0) // 没满：不用腾
  })
})

describe('CONFIG：上限与策略的开关', () => {
  it('SET/GET maxmemory 与 maxmemory-policy：设了能查回；默认 0（不限）与 noeviction', () => {
    const db = new MiniRedis({ now: () => 0, cycleMs: Infinity })
    expect(parseBulkArray(db.execute(['CONFIG', 'GET', 'maxmemory']))).toEqual(['maxmemory', '0'])
    expect(parseBulkArray(db.execute(['CONFIG', 'GET', 'maxmemory-policy']))).toEqual(['maxmemory-policy', 'noeviction'])
    expect(db.execute(['CONFIG', 'SET', 'maxmemory', '100'])).toBe('+OK\r\n')
    expect(db.execute(['CONFIG', 'SET', 'maxmemory-policy', 'allkeys-lru'])).toBe('+OK\r\n')
    expect(parseBulkArray(db.execute(['CONFIG', 'GET', 'maxmemory']))).toEqual(['maxmemory', '100'])
    expect(parseBulkArray(db.execute(['CONFIG', 'GET', 'maxmemory-policy']))).toEqual(['maxmemory-policy', 'allkeys-lru'])
  })

  it('坏值与不认识的名字都回 -ERR；不设上限时写多少键都进得来', () => {
    const db = new MiniRedis({ now: () => 0, cycleMs: Infinity })
    expect(db.execute(['CONFIG', 'SET', 'maxmemory', 'abc'])).toBe('-ERR value is not an integer or out of range\r\n')
    expect(db.execute(['CONFIG', 'SET', 'maxmemory', '-1'])).toBe('-ERR value is not an integer or out of range\r\n')
    expect(db.execute(['CONFIG', 'SET', 'maxmemory-policy', 'volatile-lru'])).toBe("-ERR policy must be 'noeviction' or 'allkeys-lru'\r\n")
    expect(db.execute(['CONFIG', 'GET', 'save'])).toBe("-ERR unknown option or number of arguments for CONFIG GET - 'save'\r\n")
    for (let i = 0; i < 200; i++) db.execute(['SET', `k${i}`, 'v']) // 没设上限：200 键照单全收
    expect(infoOf(db.execute(['INFO']))).toMatchObject({ keys: '200', evicted: '0' })
  })
})

describe('noeviction：宁可报错，不扔活键', () => {
  it('满后 SET 新键回 -OOM；GET 照常、覆盖旧键照常——只读命令不受内存关拦', () => {
    const clock = fakeClock(0)
    const db = new MiniRedis({ now: clock.now, cycleMs: Infinity })
    db.execute(['CONFIG', 'SET', 'maxmemory', '2'])
    db.execute(['SET', 'a', '1'])
    db.execute(['SET', 'b', '2'])
    expect(db.execute(['SET', 'c', '3'])).toBe(OOM)
    expect(db.execute(['GET', 'a'])).toBe('$1\r\n1\r\n') // 读照常：官方口径，noeviction 只拦写
    expect(db.execute(['TTL', 'a'])).toBe(':-1\r\n')
    expect(db.execute(['SET', 'a', '11'])).toBe('+OK\r\n') // 覆盖旧键不占新座位
    expect(infoOf(db.execute(['INFO']))).toMatchObject({ keys: '2', evicted: '0' })
  })

  it('ZADD 新键同样被拦；老排行榜加成员不占新座位、照常进', () => {
    const clock = fakeClock(0)
    const db = new MiniRedis({ now: clock.now, cycleMs: Infinity })
    db.execute(['CONFIG', 'SET', 'maxmemory', '1'])
    expect(db.execute(['ZADD', 'lb', '10', 'a'])).toBe(':1\r\n')
    expect(db.execute(['ZADD', 'lb2', '10', 'a'])).toBe(OOM)
    expect(db.execute(['ZADD', 'lb', '20', 'b'])).toBe(':1\r\n')
  })
})

describe('allkeys-lru：写满后老键被逐、新键能进', () => {
  it('里程碑剧本：100 键上限灌满，先访问 k000 再灌新键——没被碰过的更旧键先消失', () => {
    const clock = fakeClock(0)
    const db = new MiniRedis({ now: clock.now, cycleMs: Infinity, random: lcg(7) })
    db.execute(['CONFIG', 'SET', 'maxmemory', '100'])
    db.execute(['CONFIG', 'SET', 'maxmemory-policy', 'allkeys-lru'])
    for (let i = 0; i < 100; i++) db.execute(['SET', `k${String(i).padStart(3, '0')}`, 'v'])
    clock.advance(60_000) // 一分钟过去：100 个键全都闲置
    expect(db.execute(['GET', 'k000'])).toBe('$1\r\nv\r\n') // 全场唯一一次访问：k000 的 idle 清零
    expect(db.execute(['SET', 'newcomer', 'v'])).toBe('+OK\r\n') // 新键进门：踢一个老的腾座位
    expect(infoOf(db.execute(['INFO']))).toMatchObject({ keys: '100', evicted: '1' }) // 键数不涨，总数守恒
    expect(db.execute(['GET', 'k000'])).toBe('$1\r\nv\r\n') // 刚用过的键活了
    expect(db.execute(['GET', 'newcomer'])).toBe('$1\r\nv\r\n') // 新键也进来了
    let gone = 0
    for (let i = 1; i < 100; i++) if (db.execute(['GET', `k${String(i).padStart(3, '0')}`]) === '$-1\r\n') gone++
    expect(gone).toBe(1) // 被踢的是 k001..k099 里的一个：k000 的 idle 是 0，永不中签
  })

  it('GET 就是保命符：满内存下反复访问的键活到最后（近似 LRU 的「最近」由访问刷新）', () => {
    const clock = fakeClock(0)
    const db = new MiniRedis({ now: clock.now, cycleMs: Infinity, random: lcg(99) })
    db.execute(['CONFIG', 'SET', 'maxmemory', '3'])
    db.execute(['CONFIG', 'SET', 'maxmemory-policy', 'allkeys-lru'])
    db.execute(['SET', 'hot', 'v']) // 第一个进场，本是全场最老
    db.execute(['SET', 'm1', 'v'])
    db.execute(['SET', 'm2', 'v'])
    for (let round = 0; round < 20; round++) {
      clock.advance(1000)
      expect(db.execute(['GET', 'hot'])).toBe('$1\r\nv\r\n') // 每轮都摸它一下
      db.execute(['SET', `x${round}`, 'v']) // 每轮都灌一个新键：hot 必须靠「被用着」活下来
    }
    expect(db.execute(['GET', 'hot'])).toBe('$1\r\nv\r\n') // 20 轮洗牌后仍在场
    expect(infoOf(db.execute(['INFO']))).toMatchObject({ keys: '3', evicted: '20' }) // 踢了 20 个，键数纹丝不动
  })

  it('淘汰与过期走同一套删键路径：被踢的带 TTL 键，寿命登记跟着撤——expires 不留孤儿', () => {
    const clock = fakeClock(0)
    const db = new MiniRedis({ now: clock.now, cycleMs: Infinity, random: () => 0 })
    db.execute(['CONFIG', 'SET', 'maxmemory', '2'])
    db.execute(['CONFIG', 'SET', 'maxmemory-policy', 'allkeys-lru'])
    db.execute(['SET', 'shortlived', 'v', 'EX', '100']) // 带寿命的键
    clock.advance(1000)
    db.execute(['SET', 'keeper', 'v']) // 晚一秒进场：更「新」
    expect(db.execute(['SET', 'newcomer', 'v'])).toBe('+OK\r\n') // 满 2：踢 idle 最大的 shortlived
    expect(db.execute(['GET', 'shortlived'])).toBe('$-1\r\n')
    expect(db.execute(['GET', 'keeper'])).toBe('$1\r\nv\r\n')
    // 淘汰的账不记进过期：它还没到寿命，是内存判了它；寿命簿也不留孤儿登记
    expect(infoOf(db.execute(['INFO']))).toMatchObject({ keys: '2', expires: '0', evicted: '1', expired: '0' })
  })
})

describe('TCP 侧照常：OOM 走网络', () => {
  it('CONFIG 设上限，SET 新键收到 -OOM；换 allkeys-lru 后新键进门、evicted +1', async () => {
    const clock = fakeClock(0)
    const server = await createMiniRedisServer(new MiniRedis({ now: clock.now, cycleMs: Infinity }), 0)
    const c = await connect(server.port)
    try {
      expect(await c.cmd('CONFIG', 'SET', 'maxmemory', '2')).toBe('+OK\r\n')
      expect(await c.cmd('SET', 'a', '1')).toBe('+OK\r\n')
      expect(await c.cmd('SET', 'b', '2')).toBe('+OK\r\n')
      // 满了：默认策略拒写。错误应答走网络，最小客户端按第 2 章的约定把它抛成异常、原文随行
      await expect(c.cmd('SET', 'c', '3')).rejects.toThrow("OOM command not allowed when used memory > 'maxmemory'")
      expect(await c.cmd('CONFIG', 'SET', 'maxmemory-policy', 'allkeys-lru')).toBe('+OK\r\n')
      expect(await c.cmd('SET', 'c', '3')).toBe('+OK\r\n') // 换了策略：新键进得来了
      expect(await c.cmd('INFO')).toContain('evicted:1')
      expect(await c.cmd('GET', 'c')).toBe('$1\r\n3\r\n')
    } finally {
      await c.close()
      await server.close()
    }
  })
})
