// tests/memory-pool.test.ts —— 第 5 章：请求级内存池
import { describe, it, expect } from 'vitest'
import { createPool } from '../src/pool'

describe('批发与零售', () => {
  it('1000 次小分配只触发常数次大块申请', () => {
    const pool = createPool({ blockSize: 4096 })
    for (let i = 0; i < 1000; i++) pool.alloc(64)
    expect(pool.systemBlockCount()).toBeLessThanOrEqual(16) // 1000×64=64000B ≈ 16 块，远小于 1000
  })

  it('分配的内存在块内依次排开，互不重叠', () => {
    const pool = createPool({ blockSize: 4096 })
    const a = pool.alloc(16)
    const b = pool.alloc(16)
    expect(a.byteLength).toBe(16)
    expect(b.byteLength).toBe(16)
    // 两段不同的内存：写 a 不影响 b
    a.fill(0xaa)
    b.fill(0x55)
    expect(a[0]).toBe(0xaa)
    expect(b[0]).toBe(0x55)
  })

  it('一块用完自动开新块，旧块保留（分配过的数据不失效）', () => {
    const pool = createPool({ blockSize: 256 })
    const first = pool.alloc(200)
    first.fill(0x11)
    const second = pool.alloc(200) // 256 的块装不下第二个 200，自动开新块
    expect(second.byteLength).toBe(200)
    expect(first[0]).toBe(0x11) // 旧块的数据还在
    expect(pool.systemBlockCount()).toBe(2)
  })
})

describe('超大块直通', () => {
  it('比 blockSize 大的请求单独开块，不浪费公共块的剩余空间', () => {
    const pool = createPool({ blockSize: 1024 })
    pool.alloc(16)
    const big = pool.alloc(4096)
    expect(big.byteLength).toBe(4096)
    expect(pool.systemBlockCount()).toBe(2) // 1 公共块 + 1 超大块
    // 公共块还有 1008B 余量，不被 4096 的大块污染
    const tiny = pool.alloc(1008)
    expect(tiny.byteLength).toBe(1008)
    expect(pool.systemBlockCount()).toBe(2)
  })
})

describe('清仓：整池归还', () => {
  it('reset 后块归零，可重新分配', () => {
    const pool = createPool({ blockSize: 4096 })
    for (let i = 0; i < 100; i++) pool.alloc(64)
    const blocksBefore = pool.systemBlockCount()
    expect(blocksBefore).toBeGreaterThan(0)

    pool.reset()
    expect(pool.systemBlockCount()).toBe(0)

    const again = pool.alloc(64)
    expect(again.byteLength).toBe(64)
    expect(pool.systemBlockCount()).toBe(1)
  })

  it('reset 之后旧引用全部作废——池的约定：活人不得引用池内存', () => {
    const pool = createPool({ blockSize: 4096 })
    const a = pool.alloc(16)
    expect(() => {
      pool.reset()
      a[0] = 1 // 池不阻止写，但按约定这内存已还——此行仅为说明，无断言
    }).not.toThrow()
  })
})

describe('记账透明', () => {
  it('stats 汇报已分配字节与块数', () => {
    const pool = createPool({ blockSize: 4096 })
    pool.alloc(100)
    pool.alloc(28)
    const s = pool.stats()
    expect(s.allocated).toBe(128)
    expect(s.blocks).toBe(1)
    expect(s.systemBytes).toBe(4096)
  })
})
