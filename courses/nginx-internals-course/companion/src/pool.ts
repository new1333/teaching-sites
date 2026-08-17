// src/pool.ts —— 请求级内存池：整批进货（大块），零散零售（alloc），整仓清退（reset）
// 「系统级申请」在 JS 里对应 new ArrayBuffer —— 池的意义就是让这个动作的发生次数
// 从「每分配一次一次」降到「每几千次分配一次」。

export interface PoolOptions {
  blockSize?: number // 每次向系统批发的大小（字节）
}

export interface PoolStats {
  allocated: number // 已零售出去的字节数
  blocks: number // 当前持有的块数
  systemBytes: number // 向系统批发到的总字节
}

export interface Pool {
  /** 从池里零售 size 字节；放不下当前块就开新块，比整块还大就单独开一块 */
  alloc(size: number): Uint8Array
  /** 整仓清退：所有块全部归还，计数归零。之后旧引用按约定不得再使用 */
  reset(): void
  systemBlockCount(): number
  stats(): PoolStats
}

export function createPool(opts: PoolOptions = {}): Pool {
  const blockSize = opts.blockSize ?? 8 * 1024

  const blocks: ArrayBuffer[] = []
  const bigs: ArrayBuffer[] = [] // 超大块单独记账：不占公共块的便宜
  let current: ArrayBuffer | null = null
  let offset = 0
  let allocated = 0

  function systemAlloc(bytes: number): ArrayBuffer {
    return new ArrayBuffer(bytes) // 生产代码里，这一行就是「向系统要内存」
  }

  return {
    alloc(size) {
      if (size <= 0) throw new Error('alloc 尺寸必须为正')

      // 超大块直通：比一整块还大的请求，单独开一块，不动公共块的剩余空间
      if (size > blockSize) {
        const big = systemAlloc(size)
        bigs.push(big)
        allocated += size
        return new Uint8Array(big)
      }

      // 公共块装不下 → 批发一块新的
      if (!current || offset + size > current.byteLength) {
        current = systemAlloc(blockSize)
        blocks.push(current)
        offset = 0
      }

      const view = new Uint8Array(current, offset, size)
      offset += size
      allocated += size
      return view
    },

    reset() {
      blocks.length = 0 // 引用全部撒手，等垃圾回收收走——这就是「整池归还」
      bigs.length = 0
      current = null
      offset = 0
      allocated = 0
    },

    systemBlockCount() {
      return blocks.length + bigs.length
    },

    stats() {
      const systemBytes = blocks.length * blockSize + bigs.reduce((s, b) => s + b.byteLength, 0)
      return { allocated, blocks: blocks.length + bigs.length, systemBytes }
    },
  }
}
