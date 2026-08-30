// 第 9 章测试：RDB 快照——某一瞬间的全库照片（不是历史的命令流）。
// dump/load 纯函数：一行一键的文本照片，往返等价；SAVE/LOAD 命令：拍下 → FLUSHALL 砸库 → 装回，原样回来；
// 寿命随照片走（存绝对时刻：照片躺多久，装回来剩多久都作数）；过期键不入照片（死了的别还魂）；
// 照片拍的是现状不是历史（100 条账 1 行照片——第 8 章欠的「重放慢」的账在这算清）；
// SAVE/LOAD 不进账本（照片与账本是两套独立的持久化装置）。
import { describe, expect, it } from 'vitest'
import { dump, load } from '../src/rdb.ts'
import type { SnapshotEntry } from '../src/rdb.ts'
import { MiniRedis } from '../src/db.ts'
import { Aof } from '../src/aof.ts'
import { RespDecoder } from '../src/resp.ts'

// 手拨的假钟（第 6 章起同款）：advance 把时间往前推，测试不 sleep 的全部秘密
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

describe('照片本身：dump / load 纯函数', () => {
  const entries: SnapshotEntry[] = [
    { key: 'name', type: 'string', value: 'mini', expireAtMs: null },
    { key: 'code', type: 'string', value: '42', expireAtMs: 100_000 },
    { key: 'board', type: 'zset', members: [['bob', 8], ['alice', 10], ['carol', 10]], expireAtMs: null },
  ]

  it('dump 是一行一键的文本：头一行版本标记，每行一条可读记录', () => {
    const lines = dump(() => entries).split('\n')
    expect(lines[0]).toBe('mini-rdb-1')
    expect(lines).toHaveLength(4) // 头 + 三个键
    expect(lines[1]).toBe('{"key":"name","type":"string","value":"mini"}') // 没登记寿命的不写这栏
    expect(JSON.parse(lines[2]!)).toEqual({ key: 'code', type: 'string', value: '42', expireAtMs: 100_000 })
  })

  it('往返等价：load(dump(x)) 与 x 深度相等——换行、引号、unicode、小数分、负分都不走样', () => {
    const nasty: SnapshotEntry[] = [
      { key: 'weird', type: 'string', value: 'a\nb "q" 你好\ttab', expireAtMs: null },
      { key: 'z', type: 'zset', members: [['neg', -1.5], ['zero', 0], ['big', 1e7]], expireAtMs: 1 },
    ]
    expect(load(dump(() => nasty))).toEqual(nasty)
    expect(load(dump(() => entries))).toEqual(entries)
  })
})

describe('SAVE / FLUSHALL / LOAD：拍下、砸库、装回', () => {
  it('里程碑剧本：字符串与排行榜都在照片里，FLUSHALL 清空后 LOAD 原样回来', () => {
    const clock = fakeClock(0)
    const db = new MiniRedis({ now: clock.now, cycleMs: Infinity })
    db.execute(['SET', 'name', 'mini'])
    db.execute(['ZADD', 'board', '10', 'alice', '8', 'bob', '10', 'carol'])
    expect(db.execute(['SAVE'])).toBe('+OK\r\n')
    expect(infoOf(db.execute(['INFO'])).rdb).toBe('2') // 照片里拍到了两个键
    expect(db.execute(['FLUSHALL'])).toBe('+OK\r\n')
    expect(infoOf(db.execute(['INFO'])).keys).toBe('0')
    expect(db.execute(['GET', 'name'])).toBe('$-1\r\n') // 砸空了：照片是唯一的指望
    expect(db.execute(['LOAD'])).toBe('+OK\r\n')
    expect(db.execute(['GET', 'name'])).toBe('$4\r\nmini\r\n')
    expect(parseBulkArray(db.execute(['ZRANGE', 'board', '0', '-1', 'WITHSCORES']))).toEqual([
      'bob',
      '8',
      'alice',
      '10',
      'carol',
      '10', // 同分成员按名字排：装回来还是这个序
    ])
    expect(db.execute(['ZCARD', 'board'])).toBe(':3\r\n')
  })

  it('寿命随照片走：照片存绝对时刻，躺了 50 秒再装，剩的正是剩下的秒数', () => {
    const clock = fakeClock(0)
    const db = new MiniRedis({ now: clock.now, cycleMs: Infinity })
    db.execute(['SET', 'code', '42', 'EX', '100']) // 寿命到 t=100s
    clock.advance(40_000) // 剩 60s 时拍照
    db.execute(['SAVE'])
    db.execute(['FLUSHALL'])
    clock.advance(50_000) // 照片在抽屉里躺到 t=90s
    db.execute(['LOAD'])
    expect(db.execute(['TTL', 'code'])).toBe(':10\r\n') // 绝对时刻原样入簿：剩 10s，不是拍照那刻的 60s
  })

  it('过期键不入照片：僵尸键不还魂，活键对照组照常回来', () => {
    const clock = fakeClock(0)
    const db = new MiniRedis({ now: clock.now, cycleMs: Infinity })
    db.execute(['SET', 'code', '42', 'EX', '100'])
    db.execute(['SET', 'keep', 'me'])
    clock.advance(200_000) // code 到点但没人访问：僵尸态（主表还在，寿命已尽）
    db.execute(['SAVE'])
    expect(infoOf(db.execute(['INFO'])).rdb).toBe('1') // 照片里只有 keep：死了的别拍进去
    db.execute(['FLUSHALL'])
    db.execute(['LOAD'])
    expect(db.execute(['GET', 'code'])).toBe('$-1\r\n')
    expect(db.execute(['TTL', 'code'])).toBe(':-2\r\n')
    expect(db.execute(['GET', 'keep'])).toBe('$2\r\nme\r\n')
  })

  it('照片拍的是现状不是历史：100 条账，1 行照片', () => {
    const clock = fakeClock(0)
    const aof = new Aof({ now: clock.now })
    const db = new MiniRedis({ aof, now: clock.now, cycleMs: Infinity })
    for (let i = 0; i < 100; i++) db.execute(['SET', 'hot', `v${i}`])
    expect(infoOf(db.execute(['INFO'])).aof).toBe('100') // 账本记下了每一步
    db.execute(['SAVE'])
    expect(infoOf(db.execute(['INFO'])).rdb).toBe('1') // 照片只看现状：一个键一行
  })

  it('排行榜键的寿命也入照片：过期住在键上，不住在值类型上', () => {
    const clock = fakeClock(0)
    const db = new MiniRedis({ now: clock.now, cycleMs: Infinity })
    db.execute(['ZADD', 'board', '5', 'a'])
    db.execute(['EXPIRE', 'board', '500'])
    db.execute(['SAVE'])
    db.execute(['FLUSHALL'])
    clock.advance(100_000)
    db.execute(['LOAD'])
    expect(db.execute(['TTL', 'board'])).toBe(':400\r\n')
    expect(db.execute(['ZCARD', 'board'])).toBe(':1\r\n')
  })
})

describe('照片与账本：两套独立的持久化装置', () => {
  it('SAVE 与 LOAD 都不进账本；FLUSHALL 逐键补记 DEL（统一删键路径）', () => {
    const clock = fakeClock(0)
    const aof = new Aof({ now: clock.now })
    const db = new MiniRedis({ aof, now: clock.now, cycleMs: Infinity })
    db.execute(['SET', 'a', '1'])
    db.execute(['SET', 'b', '2'])
    db.execute(['SAVE'])
    expect(aof.size).toBe(2) // 拍照不是命令，账本不知道照片的事
    db.execute(['FLUSHALL'])
    expect(aof.entries()).toEqual([
      ['SET', 'a', '1'],
      ['SET', 'b', '2'],
      ['DEL', 'a'], // 清场的每一步走统一删键路径：账上留下死讯
      ['DEL', 'b'],
    ])
    db.execute(['LOAD'])
    expect(aof.size).toBe(4) // 装照片同样不记账
    expect(db.execute(['GET', 'a'])).toBe('$1\r\n1\r\n')
  })

  it('没拍过照片就 LOAD：明确报错，不装空气', () => {
    const db = new MiniRedis({ cycleMs: Infinity })
    expect(db.execute(['LOAD'])).toBe('-ERR no snapshot saved\r\n')
  })
})
