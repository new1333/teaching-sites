---
title: 漏桶限流：你抄过的 rate 和 burst 到底是什么
---

# 漏桶限流：你抄过的 rate 和 burst 到底是什么

秒杀零点整，网关的 QPS 曲线从 200 一根直线跳到 20000。后端数据库的连接池是按平时容量配的——瞬间被打满，所有请求排队等连接，超时雪崩，全站瘫了四十分钟。复盘时你翻出 nginx 配置里的救命稻草：`limit_req zone=api burst=20 nodelay`——当初从某篇博客抄的，`rate=10r/s` 是什么、`burst=20` 容的是什么、`nodelay` 不延迟什么，你答不上来。这一章把这三个参数一次讲透：亲手实现一个**漏桶**（leaky bucket）——水先倒进一个固定漏斗、按固定速率漏出去，倒太猛就溢出拒绝——然后把 tinysrv 挂上它。

## 为什么必须在入口拒人

先立一个常常被绕过的认知：限流不是为了「让所有请求都成功」，而是承认容量有限之后的止损策略。后端每秒只能消化 10 个请求，涌来 20000 个——多出来的 19990 个无论怎么排队、怎么优化，这一秒都做不完。排队不是解药：队伍越长，每个请求的等待越久，最终大量请求等到超时才死，还把连接、内存全押在队里——这就是雪崩的形状，慢慢失败比立刻失败贵得多。早拒早超生：入口直接回 503，客户端拿到明确答案立刻重试或降级，后端在容量内平稳服务。限流本质上是把「必然做不完的那部分请求」从队尾拖死，改成门口劝回。

那「劝谁回」就需要一把尺子——怎样的流量模式算超了？答案就是漏桶。

## 漏桶：把猛水整流成细水

想象一个漏斗：不管你从上面倒得多猛，出口永远按固定速率滴；漏斗的肚子有固定容量；倒得太猛、肚子灌满了，再倒就溢出来——溢出的这滴，就是你被拒绝的那个请求。

三个参数各有各的岗位。**`rate=10r/s` 是漏速**——出口每秒漏 10 滴，这是你承诺给后端的长期平均速率；**burst（`burst=20`）是桶容量**——一次允许灌进 20 滴的瞬时突发额度，互联网的流量天然一阵一阵，没有这点弹性，正常抖动也会被误杀；**`nodelay` 是排队策略**——桶里的请求是「立即放行但占住额度」还是「排在桶里等漏到自己」。nginx 不加 nodelay 时是后者：突发请求会在桶里排队，响应延迟变长但没有被拒；加了 nodelay 是前者：立刻转发，但额度占用着，后来者可能因此被拒。tinysrv 实现的是 nodelay 形态——也是被抄得最多的形态。

跟算一遍 `rate=10r/s burst=20` 的一天。上午流量平稳，每秒 8 个请求：入 8 漏 10，水位始终近零，全员放行。午饭前一次活动推送，某秒涌入 30 个：前 20 个把桶灌满并立即放行（nodelay），第 21 到 30 个——溢出，503。下一秒起每秒漏 10，水位 20 逐秒下降，期间新请求继续占用腾出的额度；几秒后桶空，恢复如常。一次可容忍的突发被消化，后端自始至终没见过超过承诺速率太多流量。

顺带把另一个常被混为一谈的词分清：**令牌桶**（token bucket）。它和漏桶就像水往哪边流：漏桶的尺子卡在出口（水必须以固定速率离开），令牌桶的尺子卡在入口（攒了令牌就能瞬时放行一批）。一句话记：漏桶整流，令牌桶限平均但允许攒着突发。nginx 的 `limit_req` 是漏桶家族——它关心的是「送往后端的速率」，不只是「放行的总量」。

## 动手：createLeakyBucket

```ts
// src/ratelimit.ts · createLeakyBucket
export function createLeakyBucket(opts: LeakyBucketOptions): LeakyBucket {
  const now = opts.now ?? Date.now
  const buckets = new Map<string, BucketState>()

  function leak(state: BucketState, t: number): void {
    const elapsedSec = (t - state.last) / 1000
    state.water = Math.max(0, state.water - elapsedSec * opts.ratePerSec)
    state.last = t
  }

  return {
    allow(key) {
      const t = now()
      let state = buckets.get(key)
      if (!state) {
        state = { water: 0, last: t }
        buckets.set(key, state)
      }
      leak(state, t)
      if (state.water + 1 > opts.burst) {
        return { ok: false, queue: state.water } // 溢出：这一滴不进桶
      }
      state.water += 1
      return { ok: true, queue: state.water }
    },

    level(key) {
      const state = buckets.get(key)
      if (!state) return 0
      const copy = { ...state }
      leak(copy, now()) // 观测也按当前时刻折算
      return copy.water
    },
  }
}
```

两个实现决策值得停留。

**漏水是懒结算。** 桶底没有定时器在真实地滴水——每次 `allow` 才按「距上次的时长 × 漏速」把水位一次折算到位（`leak` 函数）。省掉一个每秒醒来的定时器不说，更妙的是数学上完全等价：水位本来就是时间的线性函数，问的时候现算，永远精确。这与第 9 章试探回归的 `downUntil <= now()` 是同一个品味——**回归和下漏都不是事件，是时间流逝本身**，代码只需要在查询时「顺着时间算一遍」。

**一人一桶。** `allow(key)` 按 key 分桶——nginx 的 `limit_req_zone ... key=$binary_remote_addr` 限的就是「每个来源 IP 一个桶」。如果全站共用一个桶，一个刷子就能把你所有用户的额度喝光。组装层的接驳点在 `server.ts` 的数据入口：请求解析出来、还没碰任何 handler 之前，先 `allow(ip)`——溢出的当场回 503（nginx `limit_req` 的默认拒绝码；也可以配成 429），连 handler 都不用惊动。限流挡在业务之前，正如前台挡在员工之前。

还有个实现期真实踩过的坑值得留档：集成测试第一版把桶的 key 写成了 `conn.remote`——它带着端口号，等于「每条连接一个桶」。三个请求来自三条连接，各自的新桶永远装不满，限流形同虚设。按「人」限流而不是按「连接」限流，key 必须取到 IP 段。这种「实现看起来对、语义悄悄漏气」的坑，正是要用集成测试钉死的那一类。

## 验证

进 `companion/` 跑 `pnpm test`：

```text
✓ tests/rate-limit-leaky-bucket.test.ts (6 tests) 37ms
✓ tests/load-balance.test.ts (6 tests) 49ms
✓ tests/reverse-proxy.test.ts (3 tests) 49ms
✓ tests/keepalive-reuse.test.ts (4 tests) 43ms
✓ tests/http-parser-state-machine.test.ts (10 tests) 13ms
✓ tests/config-inheritance.test.ts (9 tests) 8ms
✓ tests/memory-pool.test.ts (7 tests) 4ms
✓ tests/connection-registry.test.ts (7 tests) 257ms
Test Files  8 passed (8)
     Tests  52 passed (52)
```

三段行为全部用假时钟钉死：匀速到达（每 100ms 一滴，恰等于漏速）十连全过；瞬时六连发配 burst=5，前五过第六拒；满桶静置一秒（漏 10、水位 5 归零）后额度恢复。key 隔离用例证明一人一桶；集成用例里 tinysrv 挂上 `ratePerSec=1, burst=2` 的桶，第三个瞬时请求如实收到 503——秒开章那个抄来的配置，现在是你的第 52 个绿灯。

## 读完本章，你该能回答

- 为什么说「慢慢失败比立刻失败贵得多」？限流保护的到底是谁？
- rate、burst、nodelay 各自在漏桶的哪个部位？没有 burst 会怎样？
- 漏桶与令牌桶「水往哪边流」各指什么？各自适合卡什么？
- 懒结算的水位为什么不需要定时器也精确？key 为什么必须按人不按连接？

流量的三件大事——转发、分发、限流——已经齐了。最后一章回到数据本身的旅程：响应从哪来、到哪去，路上能少搬几次。
