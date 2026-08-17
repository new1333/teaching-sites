---
title: 请求内存池：整批进货，整仓清退
---

# 请求内存池：整批进货，整仓清退

凌晨三点的告警把你叫醒：nginx 所在容器的内存曲线像爬坡的锯齿，一路向右上，两小时后撞到容器上限，进程被内核一枪打死（OOM kill），流量切到备机，你损失了半小时。复盘代码找到的「元凶」平庸得让人叹气：一个请求处理路径上十几处临时分配，某处新加的分支忘了在出错路径上释放——每个请求漏一点点，一小时几百万请求，曲线就上了天。更要命的是，泄漏点混在几十处分配里，肉眼根本找不出来。

这是 C 语言世界的日常。nginx 用一招几乎把这个品类的事故整个消灭掉：**内存池**（memory pool）——整批进货再零售的仓库；请求结束时不逐件清点，整仓清退。它的核心洞察只有一句话，但值得专门一章：**请求的内存，天生有完美的生命周期**。

## 先补一课：分配内存本身是要花钱的

写 JavaScript 时你没付过这笔钱，因为垃圾回收器（GC，garbage collect，自动寻找并回收不再使用的内存的运行时机制）替你付了。但 nginx 是 C 写的。C 程序员要内存，得伸手向**内存分配器**（memory allocator，操作系统提供的一套「给我一块内存 / 我还一块内存」的服务，业界标准实现叫 malloc）去要——这个动作不是免费的。

要一块内存时，分配器要在自己的账本上找到一块够大的空闲区域、记账、返回；还回去时再销账。三个代价跟着来。第一，每次要还都是一次跑腿，一秒钟几万次请求、每次十几处分配，光记账就忙不过来。第二，**内存碎片**（fragmentation）——反复进货退货之后，仓库里到处是塞不进大件的小空格。明明总空闲 100 MB，最大的一块连续空闲却只有 1 MB——旧分配把空格切得七零八落。第三，多线程环境下大家共用一本账，谁记账谁锁账本，排队等着吧。

那怎么办？答案藏在一个被忽视的事实里。

## 请求的内存，天生有完美的生命周期

一个 HTTP 请求从头到尾要分配什么？解析出的请求头、拼接中的响应、中间处理的临时字符串——它们有一个共同点：请求结束的那一刻，全部作废。没有任何合法代码会在这个请求结束后还要引用「上一个请求的临时变量」。

这意味着：分配时不必记「谁借的」（反正一起还），释放时不必逐个还（反正一起扔）。于是：

- 分配改成批发零售：一次向系统要一大块（比如 8 KB），请求里的小分配就在这块上依次排开、指针往后挪——分配从「查账本找空位」变成「指针加法」；
- 释放改成整仓清退：请求结束，整块扔掉。不需要知道里面分了多少次、谁还没还——忘记释放这件事在结构上不可能发生，因为压根没有「逐个释放」这个动作。

跟着算一笔：一万个请求 × 每请求 100 次小分配。逐次分配是一百万次分配器记账；池化后，每请求 2-3 次大块批发，一共两三万次——少一个数量级，而且每次都是最便宜的「指针往后挪」。防泄漏的账更漂亮：逐次分配的世界里，一处忘还就是一条泄漏；池的世界里，没有「还」这个动作，就没有「忘了还」。

nginx 里每个请求挂着一个小小的内存池，请求结束整池销毁——这是它敢在极高压力下跑 C 代码而不漏内存的底气之一。

## 在 JavaScript 里造它，还有意义吗

有意义，但账要诚实。JS 有 GC，没有「忘了 free」这个事故品类；但「向系统要内存」这个动作仍然存在——`new ArrayBuffer(n)` 就是。池化把它从「每分配一次一次」压到「每几千次分配一次」，这在不同语境下分别意味着：少打扰 GC、大块申请次数可控、以及（最重要的）让你亲手摸到 nginx 那套机制的形状。下面动手，就是造这个形状。

```ts
// src/pool.ts · createPool
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
```

三个决策值得停留。

**分配是指针加法。** `alloc` 的公共块路径只有一次比较加一次 `new Uint8Array(现有块, offset, size)`——没有搜索、没有记账、没有锁。这就是「批发再零售」在代码上的样子。

**超大块直通。** 一旦某次请求比整块还大（比如上传一个大文件的处理缓冲），给它单独开一块，绝不为了塞下它而新开一块公共块再浪费剩余空间——公共块的余量留给后续小分配继续用。nginx 的池同样有这条「大块走大块的路」的规则。

**reset 是整个设计的灵魂。** 注意它多简单：几个引用清空，完事。没有遍历、没有逐个析构。「请求结束」在组装层里对应的就是这一行调用——将来你会在第 8 章看到它挂在请求生命周期的哪个位置。代价也必须说透：整仓清退的前提是**没有人还握着仓里的货**。池内存的约定就一条：请求结束后不得再引用池里分配的任何东西。C 世界里违反这条是未定义行为；JS 世界里是读到旧数据——都不会崩，但都错。

## 验证

进 `companion/` 跑 `pnpm test`：

```text
✓ tests/memory-pool.test.ts (7 tests) 5ms
✓ tests/keepalive-reuse.test.ts (4 tests) 43ms
✓ tests/http-parser-state-machine.test.ts (10 tests) 7ms
✓ tests/connection-registry.test.ts (7 tests) 243ms
Test Files  4 passed (4)
     Tests  28 passed (28)
```

最承重的断言：`alloc(64)` 调一千次，`systemBlockCount()` 不超过 16（1000 × 64B ÷ 4096B ≈ 16 块）——零售一千次，批发十六次。其余断言逐条对应承诺：块内分配互不重叠、块满自动开新块且旧数据不失效、超大块单独记账且不污染公共块余量、`reset()` 后块数归零且能立刻重新分配、`stats()` 的账目与手工计算一致。

## 读完本章，你该能回答

- malloc 的三次记账开销是什么？碎片是怎么把「总空闲够、连续不够」变成现实的？
- 「请求的内存天生有完美生命周期」这句话怎么推出「不需要逐个释放」？
- 超大块为什么要直通？reset 之后引用池内存为什么是错的？
- 在有 GC 的语言里造内存池，剩下的价值是什么？

下一章从内存转向另一种「规则怎么来」：你天天写的那些花括号——server 块套 location 块——是怎么变成服务器行为的。
