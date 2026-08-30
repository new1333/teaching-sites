// 第 4 章测试：自写哈希表 Dict——链地址、负载因子扩容、双表渐进 rehash；服务器换装后旧命令语义不变。
// 只断言行为：放进什么、取出什么；搬迁期间读写照常；结束后数量不丢不重。
import { describe, expect, it } from 'vitest'
import { Dict } from '../src/dict.ts'
import { MiniRedis } from '../src/db.ts'
import { connect } from '../src/client.ts'
import { createMiniRedisServer } from '../src/server.ts'

describe('Dict 基础：set/get/delete/size 的键值语义', () => {
  it('set 存 get 取往返一致；缺失的键 get 回 undefined', () => {
    const d = new Dict<string>()
    d.set('a', '1')
    expect(d.get('a')).toBe('1')
    expect(d.get('missing')).toBeUndefined()
    expect(d.size).toBe(1)
  })

  it('同键覆盖不增 size；delete 回 true/false；删完 get 回 undefined', () => {
    const d = new Dict<string>()
    d.set('a', '1')
    d.set('a', '2') // 覆盖：还是那一条，值换成新的
    expect(d.size).toBe(1)
    expect(d.get('a')).toBe('2')
    expect(d.delete('a')).toBe(true)
    expect(d.delete('a')).toBe(false)
    expect(d.get('a')).toBeUndefined()
    expect(d.size).toBe(0)
  })
})

describe('链地址法：撞进同一个桶的键，谁也不挤掉谁', () => {
  it('三条注定同桶的键全部可读，删掉中间那条其余照常', () => {
    // 单字符键的哈希值恰好就是字符码（h 从 0 起乘 31 加码，一步到位）：a=97 e=101 i=105，
    // 除以 4 都余 1——起始 4 桶时这三条注定落在同一个桶，正好当链地址法的靶子
    const d = new Dict<string>()
    d.set('a', '1')
    d.set('e', '2')
    d.set('i', '3')
    expect(d.get('a')).toBe('1')
    expect(d.get('e')).toBe('2')
    expect(d.get('i')).toBe('3')
    expect(d.delete('e')).toBe(true) // 删的是链条中间那节
    expect(d.get('a')).toBe('1')
    expect(d.get('i')).toBe('3')
    expect(d.get('e')).toBeUndefined()
  })
})

describe('负载因子：到 1 就翻倍扩容，渐进搬迁', () => {
  it('第 5 个键触发扩容进入 rehash；期间旧键可读、新键可写、覆盖旧键也生效', () => {
    const d = new Dict<string>()
    for (let i = 0; i < 4; i++) d.set(`k${i}`, `v${i}`)
    expect(d.isRehashing()).toBe(false) // 4 键 4 桶：负载因子正好 1，还没过线
    d.set('k4', 'v4') // 第 5 键：插入前 used(4) ≥ 桶数(4)，翻倍成 8 桶、双表进场
    expect(d.isRehashing()).toBe(true)
    // 搬迁进行中：旧键可读（k1 还住在旧表）、新键可写（落进新表）、旧键覆盖也生效
    expect(d.get('k1')).toBe('v1')
    d.set('k5', 'v5')
    expect(d.get('k5')).toBe('v5')
    d.set('k0', 'v0!')
    expect(d.get('k0')).toBe('v0!')
    expect(d.size).toBe(6)
  })

  it('每个操作只搬一个桶：四步搬完收尾，结束后 size 不丢不重', () => {
    // k0..k3 的哈希是 3365/3366/3367/3368，除以 4 余数 1/2/3/0——4 桶各住一条；
    // 扩容后旧表恰有 4 个非空桶，每操作顺路搬一个，四步搬空
    const d = new Dict<string>()
    for (let i = 0; i < 5; i++) d.set(`k${i}`, `v${i}`) // 第 5 键触发扩容
    expect(d.isRehashing()).toBe(true)
    d.get('k1')
    expect(d.isRehashing()).toBe(true) // 搬走 1 桶，剩 3 桶
    d.set('k5', 'v5')
    expect(d.isRehashing()).toBe(true) // 剩 2 桶
    d.delete('k5')
    expect(d.isRehashing()).toBe(true) // 剩 1 桶
    d.get('k3')
    expect(d.isRehashing()).toBe(false) // 最后一桶搬完，收尾
    expect(d.size).toBe(5) // 搬迁前后一个不丢、一个不重
    for (let i = 0; i < 5; i++) expect(d.get(`k${i}`)).toBe(`v${i}`)
    expect(d.get('k5')).toBeUndefined() // 搬迁不复活已删的键
  })

  it('rehashStep 可手动搬：每次一桶，键一个不少', () => {
    const d = new Dict<string>()
    for (let i = 0; i < 5; i++) d.set(`k${i}`, `v${i}`)
    expect(d.isRehashing()).toBe(true)
    d.rehashStep()
    expect(d.isRehashing()).toBe(true) // 才搬 1 桶
    expect(d.size).toBe(5)
    d.rehashStep()
    d.rehashStep()
    expect(d.isRehashing()).toBe(true) // 还剩最后一桶
    d.rehashStep()
    expect(d.isRehashing()).toBe(false)
    expect(d.entries().map(([k]) => k).sort()).toEqual(['k0', 'k1', 'k2', 'k3', 'k4'])
  })
})

describe('十万键压舱：扩容一路翻倍，读写全程照常', () => {
  it('灌 10 万键，途中抓到 rehash 进行中且 GET 照常；灌完 size 与逐键 GET 全对', () => {
    const N = 100_000
    const d = new Dict<string>()
    let sawRehashing = false
    let checkedMidRehash = false
    for (let i = 0; i < N; i++) {
      d.set(`key:${i}`, `v${i}`)
      if (d.isRehashing()) {
        sawRehashing = true
        if (!checkedMidRehash) {
          expect(d.get('key:0')).toBe('v0') // 搬迁半路上，最老的键照常秒回
          checkedMidRehash = true
        }
      }
    }
    expect(sawRehashing).toBe(true)
    expect(d.size).toBe(N)
    for (const i of [0, 1, 49_999, 99_998, 99_999]) expect(d.get(`key:${i}`)).toBe(`v${i}`)
  })
})

describe('服务器换装：Dict 上膛，旧命令一个不改', () => {
  it('execute 的 SET/GET/DEL 应答与 Map 时代逐字节一致', () => {
    const db = new MiniRedis()
    expect(db.execute(['SET', 'a', '1'])).toBe('+OK\r\n')
    expect(db.execute(['GET', 'a'])).toBe('$1\r\n1\r\n')
    expect(db.execute(['GET', 'missing'])).toBe('$-1\r\n')
    expect(db.execute(['DEL', 'a', 'missing'])).toBe(':1\r\n')
    expect(db.execute(['SET', 'a', '1']))
    expect(db.execute(['SET', 'a', '2'])).toBe('+OK\r\n') // 覆盖
    expect(db.execute(['GET', 'a'])).toBe('$1\r\n2\r\n')
  })

  it('INFO 报键数与搬迁状态：第 5 键让 rehash 从 0 翻到 1', () => {
    const db = new MiniRedis()
    for (let i = 0; i < 4; i++) db.execute(['SET', `k${i}`, 'v'])
    expect(db.execute(['INFO'])).toContain('keys:4')
    expect(db.execute(['INFO'])).toContain('rehash:0')
    db.execute(['SET', 'k4', 'v']) // 第 5 键：扩容进场
    expect(db.execute(['INFO'])).toContain('rehash:1')
  })

  it('TCP 侧照常：管道灌 60 键跨过多次扩容，GET 逐键全对', async () => {
    const server = await createMiniRedisServer(new MiniRedis(), 0)
    const c = await connect(server.port)
    try {
      const batch: string[][] = []
      for (let i = 0; i < 60; i++) batch.push(['SET', `k${i}`, `v${i}`])
      const oks = await c.pipe(...batch)
      expect(oks.every((r) => r === '+OK\r\n')).toBe(true)
      expect(await c.cmd('GET', 'k0')).toBe('$2\r\nv0\r\n')
      expect(await c.cmd('GET', 'k31')).toBe('$3\r\nv31\r\n')
      expect(await c.cmd('GET', 'k59')).toBe('$3\r\nv59\r\n')
    } finally {
      await c.close()
      await server.close()
    }
  })
})
