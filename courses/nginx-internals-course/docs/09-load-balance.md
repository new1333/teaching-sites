---
title: 负载均衡与故障转移：三台坏一台，用户看不见
---

# 负载均衡与故障转移：三台坏一台，用户看不见

后端一共三台，昨晚挂了一台（磁盘满了，进程还在但拒绝连接）。今早投诉电话就进来了：用户说刷页面「一会儿好一会儿坏」——统计下来正好，每三个请求里有一个 502。三台坏一台，凭什么坏一个就毁了三分之一的请求？因为你的流量入口根本不知道后端名单：分活的那个部件把请求机械地轮着发给三台，坏的那台也照发不误，发给它一个，用户就吃一个 502。

同样的故障，nginx 配了 upstream 名单后用户完全无感。这一章把「无感」拆开：一份名单、一套轮着来的规则、一本失败账、一段摘除期。你抄过的 `max_fails=2 fail_timeout=10s`，就是这本失败账的参数。

## 分活：轮询——按名单顺序轮着来

**负载均衡**（load balancing）——把活分给名单上几台服务器的分配规则。最朴素的规则叫**轮询**（round robin）——按名单顺序一家一个轮着来：a、b、c、a、b、c……不需要知道谁忙谁闲，平均主义就够公平。nginx 的 upstream 默认就是它；更聪明的规则还有「最少连接」（least_conn，谁手头活少把新活给谁）等，思路都是把「忙闲」纳入计算——轮询是其中唯一不需要任何状态基础的，我们从它动手。

名单本身上一章已经见过：upstream，后台真正干活的服务器名单。这一章给它配上脑子。

## 失败账：摘除与试探回归

真正的课题是坏了一台怎么办。直觉方案「失败就立刻换下一台重试」只做对了一半——它救得了那一个请求，救不了下一个：下一个请求来了，轮值的名单还是会轮到坏的那台，再失败、再重试。每个轮到它的请求都要先白撞一次南墙，延迟白白多一截，坏的那台还要被上千个连接反复敲门。

解法是给名单加一本失败账，规则三条：

- **记账**：这台连接失败，记一笔；
- **摘除**：连续失败达到阈值（比如 2 次），把它从轮值表里划掉一段时间（比如 10 秒）——不是开除，是停职；
- **试探回归**：期满自动放回名单。下一个轮到它的请求就是一次试探：成了，失败账清零；败了，继续摘除。万一它是被误伤的（网络抖了两下），这条规则让它有机会自动洗白。

对应到 nginx 的配置语法：`server backend2 max_fails=2 fail_timeout=10s` 读作「连续失败 2 次，摘除 10 秒」。真实 nginx 的记账口径是「fail_timeout 窗口内的失败次数」，tinysrv 简化为「连续失败」（成功一次就清零）——差异在正文外记住即可，形状是同一个。

摘除解决的是「谁来接盘」：坏台被划掉后，轮询自动把它的份额摊给剩下的——三台坏一台，流量变成两台对半分，每一份都落到活人手里。**故障转移**（failover，一台坏了自动换下一台重试，别让客人看见失败）于是有了两层：摘除是长期的（这 10 秒别找它），重试是瞬时的（这一次换人接）。两层缺一不可：只重试不摘除，每个轮到坏台的请求都要白撞一次；只摘除不重试，撞上坏台的那个请求就成了 502。

重试还得有边界：换人不能无限换——名单就那么长，转完一整圈都失败，就老老实实回 502。无限重试的代理在故障时会放大流量，把最后一点活气也压死。

## 动手：UpstreamPool

```ts
// src/upstream.ts · createUpstreamPool 的核心（拼版：结构定义见 tests 与源码）
export function createUpstreamPool(opts: UpstreamOptions): UpstreamPool {
  const maxFails = opts.maxFails ?? 1
  const failTimeoutMs = opts.failTimeoutMs ?? 10_000
  const now = opts.now ?? Date.now

  const states = new Map<string, PeerState>()
  for (const peer of opts.peers) {
    states.set(`${peer.host}:${peer.port}`, { peer, consecutiveFails: 0, downUntil: 0 })
  }
  const ring = [...states.values()]
  let cursor = 0

  function alive(s: PeerState): boolean {
    return s.downUntil <= now()
  }

  return {
    pick() {
      // 从 cursor 起走一整圈，摘除中的跳过
      for (let i = 0; i < ring.length; i++) {
        const s = ring[cursor % ring.length]
        cursor++
        if (alive(s)) return { ok: true, peer: s.peer }
      }
      return { ok: false, reason: 'all-down' }
    },

    report(peer, ok) {
      const s = states.get(`${peer.host}:${peer.port}`)
      if (!s) return
      if (ok) {
        s.consecutiveFails = 0
        s.downUntil = 0
      } else {
        s.consecutiveFails++
        if (s.consecutiveFails >= maxFails) {
          s.downUntil = now() + failTimeoutMs // 摘除：期满后 alive 自动放行（试探性回归）
        }
      }
    },

    isDown(peer) {
      const s = states.get(`${peer.host}:${peer.port}`)
      return s ? !alive(s) : false
    },

    size() {
      return ring.length
    },
  }
}
```

两个设计点。`cursor` 是轮询的全部状态——一个不断往前走的指针，走到谁谁接活，摘除的跳过，仅此而已；`alive` 的实现里藏着试探回归：摘除不是「删除」而是「标记一个到期时刻」，时间一到 `downUntil <= now()` 自然为真，无需任何清理动作——**回归不是事件，是时间流逝本身**。

代理侧的改动是一次重构加上一个新函数。重构：第 8 章的 `proxyRequest` 里「连接失败回 502」这个动作被抽出来——底层函数只做「试一台、成败如实上报」，对客户端不动作；502 的决定权上移给调用方：

```ts
// src/proxy.ts · 池化代理
export async function proxyRequestPooled(
  client: ManagedConn,
  head: RequestHead,
  pool: UpstreamPool,
): Promise<ProxyOutcome> {
  const maxTries = pool.size()
  for (let i = 0; i < maxTries; i++) {
    const pick = pool.pick()
    if (!pick.ok) break // 全员摘除
    const outcome = await proxyOnce(client, head, pick.peer)
    pool.report(pick.peer, outcome.ok)
    if (outcome.ok) return outcome
  }
  write502(client)
  return { ok: false, status: 502 }
}
```

循环体就是那两层保障的直译：挑一台（摘除的被跳过）→ 试 → 报账（成功清零、失败累加）→ 成了就收工，败了换下一台；`maxTries = pool.size()` 圈定了重试边界——一整圈全败，才对客户端说 502。第 8 章的单目标 `proxyRequest` 现在是「不配池」时的退化路径，行为一字未变（旧测试全绿作证）。

## 验证

进 `companion/` 跑 `pnpm test`：

```text
✓ tests/load-balance.test.ts (6 tests) 39ms
✓ tests/reverse-proxy.test.ts (3 tests) 43ms
✓ tests/http-parser-state-machine.test.ts (10 tests) 11ms
✓ tests/config-inheritance.test.ts (9 tests) 11ms
✓ tests/keepalive-reuse.test.ts (4 tests) 40ms
✓ tests/memory-pool.test.ts (7 tests) 10ms
✓ tests/connection-registry.test.ts (7 tests) 246ms
Test Files  7 passed (7)
     Tests  46 passed (46)
```

五个单测把失败账逐条钉死：轮询均分（六次挑选拿到 a,b,c,a,b,c）、连续两次才摘除（一次不够）、摘除期整场缺席、期满回归（假时钟推进 10 秒，b 重新可被选中）、断断续续的失败摘不掉（成功清零）、全员摘除明确返回 all-down。集成用例复现开头的事故现场：真起两台 upstream，外加一个「起完就关」的幽灵端口，六连发——每个请求都 200，响应序列 a,c,a,c,a,c（b 的位置全被接住），幽灵被记满两笔、划出名单。三台坏一台，用户看不见。

## 读完本章，你该能回答

- 只重试不摘除有什么代价？只摘除不重试呢？两层各自兜住哪一半？
- 摘除为什么是「停职」而不是「开除」？试探回归的机制为什么不需要任何清理代码？
- `max_fails=2 fail_timeout=10s` 各自对应失败账的哪一栏？tinysrv 的「连续失败」与 nginx 的「窗口内失败」差在哪？
- 重试为什么以「一整圈」为界？

名单会分活了，坏台能自动隔离了。还剩最后一种失控：后端没坏、来客太多——下一章讲你抄过的 `limit_req rate=10r/s burst=20` 到底在挡什么。
