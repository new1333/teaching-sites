// 第 8 章测试：AOF——写后日志（先执行、成功才记账）、重启重放（新实例加载同一本账恢复原值）、
// 重写瘦身（按当前内存反推最小命令集：等价但条数变少）、两层落盘（write 每笔走、fsync 三档钉——注入回调，不真写盘）。
// 「重启」在教学版里 = 新建 MiniRedis 实例加载同一个 Aof——账本活得比实例久，这就是磁盘扮演的角色。
// 服务器自发删除（过期、淘汰）必须补记一条 DEL，重放才与内存一致——第 6、7 章埋的两笔承诺在此兑现。
import { describe, expect, it } from 'vitest'
import { Aof } from '../src/aof.ts'
import { MiniRedis } from '../src/db.ts'
import { RespDecoder } from '../src/resp.ts'
import { connect } from '../src/client.ts'
import { createMiniRedisServer } from '../src/server.ts'

// 手拨的假钟（第 6、7 章同款）：advance 把时间往前推，测试不 sleep 的全部秘密
function fakeClock(start = 0) {
  let t = start
  return { now: () => t, advance: (ms: number) => (t += ms) }
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

describe('Aof：记账与两层落盘（write 每笔走，fsync 按三档钉）', () => {
  it('append 逐笔记账，entries 是原样的命令流；不挂回调时账只活在内存', () => {
    const aof = new Aof()
    aof.append(['SET', 'k', 'v1'])
    aof.append(['SET', 'k', 'v2'])
    aof.append(['DEL', 'k'])
    expect(aof.entries()).toEqual([
      ['SET', 'k', 'v1'],
      ['SET', 'k', 'v2'],
      ['DEL', 'k'],
    ])
    expect(aof.size).toBe(3)
  })

  it('always：每笔命令 write 完当场 fsync——各叫一次，最稳最慢', () => {
    const writes: string[] = []
    let pins = 0
    const aof = new Aof({
      policy: 'always',
      write: (t) => writes.push(t),
      fsync: () => pins++,
    })
    aof.append(['SET', 'a', '1'])
    aof.append(['SET', 'b', '2'])
    expect(writes.length).toBe(2)
    expect(pins).toBe(2)
    expect(aof.syncs).toBe(2)
  })

  it('everysec：write 每笔都走（进程崩了不丢），fsync 一秒至多钉一次（断电至多丢一秒）', () => {
    const clock = fakeClock(1_000_000)
    let writes = 0
    let pins = 0
    const aof = new Aof({
      policy: 'everysec',
      now: clock.now,
      write: () => writes++,
      fsync: () => pins++,
    })
    aof.append(['SET', 'a', '1']) // 开机第一笔：距上一钉「无穷久」，立刻钉
    expect(writes).toBe(1)
    expect(pins).toBe(1)
    clock.advance(400)
    aof.append(['SET', 'b', '2']) // 距上钉 0.4s：写归写，钉先欠着
    clock.advance(400)
    aof.append(['SET', 'c', '3']) // 距上钉 0.8s：还是欠着
    expect(writes).toBe(3)
    expect(pins).toBe(1)
    clock.advance(300)
    aof.append(['SET', 'd', '4']) // 距上钉 1.1s：这笔进门时顺路钉一把
    expect(writes).toBe(4)
    expect(pins).toBe(2)
    expect(aof.size).toBe(4) // 钉不钉，内存账本都是全的——盘只是副本
  })

  it('no：write 照走，fsync 一次不叫——交给内核自己的脾气', () => {
    const clock = fakeClock(0)
    let writes = 0
    let pins = 0
    const aof = new Aof({
      policy: 'no',
      now: clock.now,
      write: () => writes++,
      fsync: () => pins++,
    })
    for (let i = 0; i < 5; i++) {
      clock.advance(5000)
      aof.append(['SET', `k${i}`, 'v'])
    }
    expect(writes).toBe(5)
    expect(pins).toBe(0)
    expect(aof.syncs).toBe(0)
    expect(aof.size).toBe(5)
  })
})

describe('重写：按内存反推，等价但更小', () => {
  it('rewriteFrom：100 条同键 SET 只剩 1 条，账本当场换新', () => {
    const aof = new Aof()
    for (let i = 0; i < 100; i++) aof.append(['SET', 'hot', `v${i}`])
    expect(aof.size).toBe(100)
    const fresh = aof.rewriteFrom(() => [['SET', 'hot', 'v99']])
    expect(fresh).toEqual([['SET', 'hot', 'v99']])
    expect(aof.entries()).toEqual([['SET', 'hot', 'v99']])
    expect(aof.size).toBe(1)
  })

  it('带寿命的键重写时补一条 EXPIRE（剩余秒数）：重放后寿命还在', () => {
    const clock = fakeClock(0)
    const aof = new Aof({ now: clock.now })
    const db1 = new MiniRedis({ aof, now: clock.now, cycleMs: Infinity })
    db1.execute(['SET', 'code', '42', 'EX', '100'])
    clock.advance(40_000) // 剩 60s
    expect(db1.execute(['BGREWRITEAOF'])).toBe('+OK\r\n')
    expect(aof.entries()).toEqual([
      ['SET', 'code', '42'],
      ['EXPIRE', 'code', '60'],
    ])
    const db2 = new MiniRedis({ aof, now: clock.now, cycleMs: Infinity }) // 「重启」
    expect(db2.execute(['TTL', 'code'])).toBe(':60\r\n')
  })
})

describe('重启重放：写序列 → 新库等价', () => {
  it('里程碑剧本：SET 十轮同键，「重启」后 GET 仍返回最后一轮的值', () => {
    const clock = fakeClock(0)
    const aof = new Aof({ now: clock.now })
    const db1 = new MiniRedis({ aof, now: clock.now, cycleMs: Infinity })
    for (let i = 1; i <= 10; i++) db1.execute(['SET', 'counter', `v${i}`])
    expect(aof.size).toBe(10)
    const db2 = new MiniRedis({ aof, now: clock.now, cycleMs: Infinity }) // 新实例、同一本账
    expect(db2.execute(['GET', 'counter'])).toBe('$3\r\nv10\r\n')
  })

  it('字符串与排行榜都回来；重放本身不重复记账（账不边放边抄）', () => {
    const clock = fakeClock(0)
    const aof = new Aof({ now: clock.now })
    const db1 = new MiniRedis({ aof, now: clock.now, cycleMs: Infinity })
    db1.execute(['SET', 'name', 'mini'])
    db1.execute(['ZADD', 'racer', '10', 'alice', '8', 'bob'])
    db1.execute(['SET', 'name', 'mini-redis'])
    const before = aof.size
    const db2 = new MiniRedis({ aof, now: clock.now, cycleMs: Infinity }) // 重放发生在构造里
    expect(aof.size).toBe(before) // 重放的三笔没有再进账本
    expect(db2.execute(['GET', 'name'])).toBe('$10\r\nmini-redis\r\n')
    expect(parseBulkArray(db2.execute(['ZRANGE', 'racer', '0', '-1', 'WITHSCORES']))).toEqual([
      'bob',
      '8',
      'alice',
      '10',
    ])
  })

  it('写后日志只记干成的：OOM 拒写与 WRONGTYPE 不进账本', () => {
    const clock = fakeClock(0)
    const aof = new Aof({ now: clock.now })
    const db = new MiniRedis({ aof, now: clock.now, cycleMs: Infinity })
    db.execute(['CONFIG', 'SET', 'maxmemory', '1'])
    db.execute(['SET', 'a', '1']) // 干成了：记
    db.execute(['SET', 'b', '2']) // -OOM：没干成，不记
    db.execute(['ZADD', 'a', '5', 'x']) // WRONGTYPE：没干成，不记
    expect(aof.entries()).toEqual([['SET', 'a', '1']])
  })

  it('过期补记 DEL：惰性删除那一刻账上多一笔死讯，「重启」后键不还魂（第 6 章承诺兑现）', () => {
    const clock = fakeClock(0)
    const aof = new Aof({ now: clock.now })
    const db1 = new MiniRedis({ aof, now: clock.now, cycleMs: Infinity })
    db1.execute(['SET', 'code', '42', 'EX', '100'])
    clock.advance(200_000)
    expect(db1.execute(['GET', 'code'])).toBe('$-1\r\n') // 惰性删除：没人下过 DEL，键却没了
    expect(aof.entries()).toEqual([
      ['SET', 'code', '42', 'EX', '100'],
      ['DEL', 'code'], // 服务器自发删除也要记账——否则重放会把键连本带利救活
    ])
    const db2 = new MiniRedis({ aof, now: clock.now, cycleMs: Infinity })
    expect(db2.execute(['GET', 'code'])).toBe('$-1\r\n')
    expect(db2.execute(['TTL', 'code'])).toBe(':-2\r\n') // 不是「还魂再等 100 秒」，是压根没有它
  })

  it('淘汰补记 DEL：被 allkeys-lru 踢出键空间的活键，「重启」后也真没了（第 7 章承诺兑现）', () => {
    const clock = fakeClock(0)
    const aof = new Aof({ now: clock.now })
    const db1 = new MiniRedis({ aof, now: clock.now, cycleMs: Infinity, random: () => 0 })
    db1.execute(['CONFIG', 'SET', 'maxmemory', '2'])
    db1.execute(['CONFIG', 'SET', 'maxmemory-policy', 'allkeys-lru'])
    db1.execute(['SET', 'a', '1'])
    clock.advance(1000)
    db1.execute(['SET', 'b', '2'])
    db1.execute(['SET', 'c', '3']) // 满 2：踢 idle 最大的 a
    expect(db1.execute(['GET', 'a'])).toBe('$-1\r\n')
    const db2 = new MiniRedis({ aof, now: clock.now, cycleMs: Infinity })
    expect(db2.execute(['GET', 'a'])).toBe('$-1\r\n') // 账上有 a 的死讯：重放照样把它删掉
    expect(db2.execute(['GET', 'b'])).toBe('$1\r\n2\r\n')
    expect(db2.execute(['GET', 'c'])).toBe('$1\r\n3\r\n')
  })

  it('BGREWRITEAOF 命令与 INFO 的 aof 条数：重写后肉眼可见变小', () => {
    const clock = fakeClock(0)
    const aof = new Aof({ now: clock.now })
    const db = new MiniRedis({ aof, now: clock.now, cycleMs: Infinity })
    for (let i = 0; i < 100; i++) db.execute(['SET', 'hot', `v${i}`])
    expect(infoOf(db.execute(['INFO'])).aof).toBe('100')
    expect(db.execute(['BGREWRITEAOF'])).toBe('+OK\r\n')
    expect(infoOf(db.execute(['INFO'])).aof).toBe('1')
    const db2 = new MiniRedis({ aof, now: clock.now, cycleMs: Infinity }) // 换新后的账照样能复活数据
    expect(db2.execute(['GET', 'hot'])).toBe('$3\r\nv99\r\n')
  })
})

describe('TCP 侧：关服再开，真「重启」走一遍', () => {
  it('两台服务器先后共用同一本 AOF：旧键原样回来', async () => {
    const clock = fakeClock(0)
    const aof = new Aof({ now: clock.now })
    const s1 = await createMiniRedisServer(new MiniRedis({ aof, now: clock.now, cycleMs: Infinity }), 0)
    const c1 = await connect(s1.port)
    await c1.cmd('SET', 'login:alice', 'token-1')
    await c1.cmd('ZADD', 'board', '10', 'alice')
    await c1.close()
    await s1.close() // 「断电」：进程没了，账还在
    const s2 = await createMiniRedisServer(new MiniRedis({ aof, now: clock.now, cycleMs: Infinity }), 0)
    const c2 = await connect(s2.port)
    try {
      expect(await c2.cmd('GET', 'login:alice')).toBe('$7\r\ntoken-1\r\n')
      expect(await c2.cmd('ZCARD', 'board')).toBe(':1\r\n')
    } finally {
      await c2.close()
      await s2.close()
    }
  })
})
