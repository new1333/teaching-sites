// 第 6 章测试：过期字典与 EXPIRE/TTL/SET EX——惰性删除（访问即删）与定期抽样删除（activeCycle）
// 两条路径各自独立钉死；时钟全部可注入（手拨假钟），没有一条测试等真钟。
import { describe, expect, it } from 'vitest'
import { Expirer } from '../src/expire.ts'
import { MiniRedis } from '../src/db.ts'
import { RespDecoder } from '../src/resp.ts'
import { connect } from '../src/client.ts'
import { createMiniRedisServer } from '../src/server.ts'

// 手拨的假钟：advance 把时间往前推，服务器以为过了这么久——测试不 sleep 的全部秘密
function fakeClock(start = 0) {
  let t = start
  return { now: () => t, advance: (ms: number) => (t += ms) }
}

// 递进的钟：每读一次时间就走 1ms——用来钉「定期删除掐时间上限」
function steppingClock(start: number) {
  let t = start
  return { now: () => t++, advance: (ms: number) => (t += ms) }
}

// 把数组应答解析回字符串列表（第 2 章的解码器反过来用在测试里）
function parseBulkArray(reply: string): string[] {
  return new RespDecoder().feed(reply)[0] ?? []
}

// 把 INFO 的应答解析成 { 指标: 值 }：应答是单个批量串，剥掉 $长度 头和尾部 \r\n，剩下就是指标行
function infoOf(reply: string): Record<string, string> {
  const body = reply.slice(reply.indexOf('\r\n') + 2, reply.lastIndexOf('\r\n'))
  const out: Record<string, string> = {}
  for (const line of body.split('\r\n')) {
    const idx = line.indexOf(':')
    if (idx > 0) out[line.slice(0, idx)] = line.slice(idx + 1)
  }
  return out
}

describe('Expirer：另一张表，键 → 到期时间戳', () => {
  it('setExpire/getTtl：登记后剩余毫秒随手拨的钟递减；没登记回 null', () => {
    const clock = fakeClock(1000)
    const dropped: string[] = []
    const e = new Expirer({ now: clock.now, dropKey: (k) => dropped.push(k) })
    expect(e.getTtl('code')).toBeNull() // 没登记的键没有寿命
    e.setExpire('code', 4000) // 绝对时刻：第 4000ms 到期
    expect(e.getTtl('code')).toBe(3000) // 此刻是 1000，剩 3000
    clock.advance(2500)
    expect(e.getTtl('code')).toBe(500)
    expect(e.lazyCheck('code')).toBe(false) // 还没到点，谁也不删
  })

  it('lazyCheck 到点回 true：撤登记、叫 dropKey 删主表键、expired 计数 +1', () => {
    const clock = fakeClock(0)
    const dropped: string[] = []
    const e = new Expirer({ now: clock.now, dropKey: (k) => dropped.push(k) })
    e.setExpire('code', 1000)
    clock.advance(1000) // 恰好到点
    expect(e.lazyCheck('code')).toBe(true)
    expect(dropped).toEqual(['code']) // 动手的是回调：登记簿只管记账
    expect(e.getTtl('code')).toBeNull() // 登记已撤
    expect(e.expired).toBe(1)
    expect(e.lazyCheck('code')).toBe(false) // 再查一次：已是路人
  })

  it('remove：键被删或被覆盖时撤登记——孤儿记录会让活键背黑锅', () => {
    const clock = fakeClock(0)
    const e = new Expirer({ now: clock.now, dropKey: () => {} })
    e.setExpire('a', 100)
    e.remove('a')
    clock.advance(500)
    expect(e.lazyCheck('a')).toBe(false) // 登记没了，到点也视而不见
    expect(e.expired).toBe(0)
  })

  it('activeCycle：池里 60 个全到期、sampleN=20——恰好删 20，一小批一小批地走', () => {
    const clock = fakeClock(0)
    const dropped: string[] = []
    const e = new Expirer({ now: clock.now, random: Math.random, dropKey: (k) => dropped.push(k) })
    const pool = Array.from({ length: 60 }, (_, i) => `k${i}`)
    for (const k of pool) e.setExpire(k, 0) // 全部即刻到期
    clock.advance(1)
    expect(e.activeCycle(() => pool, 20)).toBe(20) // 每轮只删一小批，绝不一口气清场
    expect(e.activeCycle(() => e.keys(), 20)).toBe(20) // 第二轮从剩下的登记里再抽
    expect(e.activeCycle(() => e.keys(), 20)).toBe(20)
    expect(e.activeCycle(() => e.keys(), 20)).toBe(0) // 清完了：空转回 0
    expect(e.expired).toBe(60)
    expect(dropped.length).toBe(60)
  })

  it('activeCycle 只删到期的：没到点的键一根汗毛不动', () => {
    const clock = fakeClock(0)
    const dropped: string[] = []
    const e = new Expirer({ now: clock.now, random: Math.random, dropKey: (k) => dropped.push(k) })
    for (let i = 0; i < 5; i++) e.setExpire(`k${i}`, 10_000)
    expect(e.activeCycle(() => e.keys(), 20)).toBe(0)
    expect(dropped).toEqual([])
    expect(e.keys().length).toBe(5)
  })

  it('抽样不重不漏：注入恒 0 的随机源，抽中的正是池里前 sampleN 个', () => {
    const clock = fakeClock(0)
    const dropped: string[] = []
    const e = new Expirer({ now: clock.now, random: () => 0, dropKey: (k) => dropped.push(k) })
    const pool = ['a', 'b', 'c', 'd', 'e']
    for (const k of pool) e.setExpire(k, 0)
    clock.advance(1)
    expect(e.activeCycle(() => [...pool], 3)).toBe(3)
    expect(dropped.sort()).toEqual(['a', 'b', 'c']) // 部分洗牌在恒 0 随机下退化为「取前三个」
  })
})

describe('SET EX 与 EXPIRE / TTL 命令', () => {
  it('SET k v EX 300：TTL 回 300，手拨 1 秒后回 299', () => {
    const clock = fakeClock(0)
    const db = new MiniRedis({ now: clock.now, cycleMs: Infinity })
    expect(db.execute(['SET', 'k', 'v', 'EX', '300'])).toBe('+OK\r\n')
    expect(db.execute(['TTL', 'k'])).toBe(':300\r\n')
    clock.advance(1000)
    expect(db.execute(['TTL', 'k'])).toBe(':299\r\n')
  })

  it('SET 覆盖清寿命（官方文档口径）：再 SET 不带 EX，TTL 变 -1；DEL 也把登记带走', () => {
    const clock = fakeClock(0)
    const db = new MiniRedis({ now: clock.now, cycleMs: Infinity })
    db.execute(['SET', 'mykey', 'Hello'])
    expect(db.execute(['EXPIRE', 'mykey', '10'])).toBe(':1\r\n')
    expect(db.execute(['TTL', 'mykey'])).toBe(':10\r\n')
    db.execute(['SET', 'mykey', 'Hello World']) // 覆盖：寿命被抹掉
    expect(db.execute(['TTL', 'mykey'])).toBe(':-1\r\n')
    expect(db.execute(['EXPIRE', 'mykey', '10'])).toBe(':1\r\n')
    expect(db.execute(['DEL', 'mykey'])).toBe(':1\r\n')
    db.execute(['SET', 'mykey', 'again'])
    expect(db.execute(['TTL', 'mykey'])).toBe(':-1\r\n') // 老登记没跟着键复活
    expect(infoOf(db.execute(['INFO'])).expires).toBe('0') // 登记簿里没有孤儿
  })

  it('EXPIRE：不存在回 0、存在回 1；非法秒数回 -ERR；过去的时间=下一拍就删', () => {
    const clock = fakeClock(0)
    const db = new MiniRedis({ now: clock.now, cycleMs: Infinity })
    expect(db.execute(['EXPIRE', 'missing', '10'])).toBe(':0\r\n')
    expect(db.execute(['EXPIRE', 'k', 'abc'])).toBe('-ERR value is not an integer or out of range\r\n')
    db.execute(['SET', 'k', 'v'])
    expect(db.execute(['EXPIRE', 'k', '100'])).toBe(':1\r\n')
    expect(db.execute(['EXPIRE', 'k', '0'])).toBe(':1\r\n') // 登记一个过去的时刻
    expect(db.execute(['GET', 'k'])).toBe('$-1\r\n') // 下一次访问就没了
    expect(infoOf(db.execute(['INFO'])).expired).toBe('1')
  })

  it('TTL 三态：-2 键不存在 / -1 没有寿命 / N 剩余整秒', () => {
    const clock = fakeClock(0)
    const db = new MiniRedis({ now: clock.now, cycleMs: Infinity })
    expect(db.execute(['TTL', 'missing'])).toBe(':-2\r\n')
    db.execute(['SET', 'k', 'v'])
    expect(db.execute(['TTL', 'k'])).toBe(':-1\r\n')
    db.execute(['SET', 'k', 'v', 'EX', '100'])
    expect(db.execute(['TTL', 'k'])).toBe(':100\r\n')
  })

  it('SET 的 EX 参数校验：非整数与 0 以下都回 -ERR', () => {
    const db = new MiniRedis()
    expect(db.execute(['SET', 'k', 'v', 'EX', 'abc'])).toBe('-ERR value is not an integer or out of range\r\n')
    expect(db.execute(['SET', 'k', 'v', 'EX', '0'])).toBe("-ERR invalid expire time in 'set' command\r\n")
    expect(db.execute(['SET', 'k', 'v', 'PX', '100'])).toBe('-ERR syntax error\r\n')
    expect(db.execute(['SET', 'k', 'v', 'EX'])).toBe('-ERR wrong number of arguments for SET\r\n')
  })
})

describe('惰性删除：访问那一刻才删（关掉定期，单独钉死这条路径）', () => {
  it('过期后 GET 回 nil 且当场删：KEYS 里先消失、INFO 的 keys 后归零——僵尸键死在 GET 手上', () => {
    const clock = fakeClock(0)
    const db = new MiniRedis({ now: clock.now, cycleMs: Infinity }) // 定期删除关掉，只剩惰性
    db.execute(['SET', 'code', '42', 'EX', '1'])
    clock.advance(2000) // 到期了
    // 僵尸态：还没人访问过——键 physically 还在（keys:1），但 KEYS 已经不认它
    expect(infoOf(db.execute(['INFO']))).toMatchObject({ keys: '1', expires: '1', expired: '0' })
    expect(parseBulkArray(db.execute(['KEYS', '*']))).toEqual([])
    expect(db.execute(['GET', 'code'])).toBe('$-1\r\n') // 访问那一刻：查簿、删键、回不存在
    expect(infoOf(db.execute(['INFO']))).toMatchObject({ keys: '0', expires: '0', expired: '1' })
  })

  it('键级检查不分值类型：跳表键（排行榜）一样能过期', () => {
    const clock = fakeClock(0)
    const db = new MiniRedis({ now: clock.now, cycleMs: Infinity })
    db.execute(['ZADD', 'lb', '10', 'a', '20', 'b'])
    expect(db.execute(['EXPIRE', 'lb', '10'])).toBe(':1\r\n')
    clock.advance(11_000)
    expect(db.execute(['ZCARD', 'lb'])).toBe(':0\r\n') // 访问即删：队伍整个没了
    expect(db.execute(['ZRANGE', 'lb', '0', '-1'])).toBe('*0\r\n')
    expect(infoOf(db.execute(['INFO'])).expired).toBe('1')
  })
})

describe('定期抽样删除：没人访问也被删（单独钉死这条路径）', () => {
  it('五个键到期后只发一条 PING：一个都没 GET 过，INFO 的 expired 已是 5', () => {
    const clock = fakeClock(0)
    const db = new MiniRedis({ now: clock.now }) // 默认节流：每 100ms 一拍
    for (let i = 0; i < 5; i++) db.execute(['SET', `k${i}`, 'v', 'EX', '1'])
    clock.advance(2000)
    db.execute(['PING']) // 唯一的「流量」：节流到点，周期在命令之间跑了一轮
    expect(infoOf(db.execute(['INFO']))).toMatchObject({ keys: '0', expired: '5' })
  })

  it('节流窗口：一个周期拍内不重复跑——窗口没到，僵尸键躺着；窗口一到，PING 一下就走', () => {
    const clock = fakeClock(0)
    const db = new MiniRedis({ now: clock.now, cycleMs: 5000 }) // 拉大到 5 秒一拍，好观察
    db.execute(['SET', 'k', 'v', 'EX', '1'])
    clock.advance(2000)
    db.execute(['PING']) // 距上拍才 2 秒：不跑
    expect(infoOf(db.execute(['INFO']))).toMatchObject({ keys: '1', expired: '0' })
    expect(parseBulkArray(db.execute(['KEYS', '*']))).toEqual([]) // 僵尸键：在，但不可见
    clock.advance(3000) // 满 5 秒
    db.execute(['PING'])
    expect(infoOf(db.execute(['INFO']))).toMatchObject({ keys: '0', expired: '1' })
  })

  it('饱和时一轮接一轮：50 个全过期，一条命令里循环抽到清空', () => {
    const clock = fakeClock(0)
    const db = new MiniRedis({ now: clock.now }) // 固定假钟：时间上限永远没到，全靠 25% 规则收束
    for (let i = 0; i < 50; i++) db.execute(['SET', `k${i}`, 'v', 'EX', '1'])
    clock.advance(2000)
    db.execute(['PING'])
    expect(infoOf(db.execute(['INFO']))).toMatchObject({ keys: '0', expired: '50' })
  })

  it('时间上限兜底：递进钟下每轮删除都花掉假钟 20ms，预算 1ms 一到就收工', () => {
    const clock = steppingClock(1_000_000) // 每读一次时间 +1ms
    const db = new MiniRedis({ now: clock.now, cycleMs: 1000 })
    for (let i = 0; i < 60; i++) db.execute(['SET', `k${i}`, 'v', 'EX', '1']) // 登记时还没到期
    clock.advance(2000) // 全部过期
    db.execute(['PING']) // 一轮抽样删 20 个键，钟已走掉 20ms：预算击穿，收工
    expect(infoOf(db.execute(['INFO']))).toMatchObject({ keys: '40', expired: '20' })
    clock.advance(2000)
    db.execute(['PING']) // 下一拍再来一小批
    expect(infoOf(db.execute(['INFO']))).toMatchObject({ keys: '20', expired: '40' })
    clock.advance(2000)
    db.execute(['PING'])
    expect(infoOf(db.execute(['INFO']))).toMatchObject({ keys: '0', expired: '60' })
  })
})

describe('KEYS：旁观窗，只过滤不动手', () => {
  it('KEYS * 列出活键（排序回给）；过期键被过滤但没被顺手删', () => {
    const clock = fakeClock(0)
    const db = new MiniRedis({ now: clock.now, cycleMs: Infinity })
    db.execute(['SET', 'a', '1'])
    db.execute(['SET', 'b', '2'])
    db.execute(['SET', 'dead', '3', 'EX', '1'])
    expect(parseBulkArray(db.execute(['KEYS', '*'])).sort()).toEqual(['a', 'b', 'dead']) // 还没到点：三个都活着
    expect(db.execute(['KEYS', 'a*'])).toBe('*1\r\n$1\r\na\r\n') // 通配符支持 *
    clock.advance(2000)
    expect(parseBulkArray(db.execute(['KEYS', '*'])).sort()).toEqual(['a', 'b']) // dead 到点：被过滤
    expect(infoOf(db.execute(['INFO'])).keys).toBe('3') // 但它 physically 还在——只过滤，不动手
  })
})

describe('TCP 侧照常：验证码走网络', () => {
  it('SET code 42 EX 1，手拨过期，GET 走网络回 (nil)，INFO 的 expired +1', async () => {
    const clock = fakeClock(0)
    const server = await createMiniRedisServer(new MiniRedis({ now: clock.now }), 0)
    const c = await connect(server.port)
    try {
      expect(await c.cmd('SET', 'code', '42', 'EX', '1')).toBe('+OK\r\n')
      expect(await c.cmd('TTL', 'code')).toBe(':1\r\n')
      clock.advance(2000) // 假钟一拨，服务器那边已过两秒
      expect(await c.cmd('GET', 'code')).toBe('$-1\r\n')
      expect(await c.cmd('INFO')).toContain('expired:1')
      expect(await c.cmd('TTL', 'code')).toBe(':-2\r\n') // 删干净了：键不存在
    } finally {
      await c.close()
      await server.close()
    }
  })
})
