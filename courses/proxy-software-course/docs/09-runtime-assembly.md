---
title: 组装运行时：两个入口，共用一条决策管线
---

# 组装运行时：两个入口，共用一条决策管线

## 前情：积木都做好了，还没拼成一个程序

到这里，入口协议（第 2、3 章）、双向转发（第 4 章）、路由决策（第 5、6 章）、出站适配器（第 7 章）、配置校验（第 8 章）都已经分别做好，也分别测试过。但它们还从来没有被真正组装成一个"跑起来的代理进程"：一个能同时监听两个端口、共享同一套判断逻辑、能被优雅关闭的程序。这一章把它们拼在一起。

## 同一个目标，两个入口给出不同的答案

假设已经把这些模块简单拼起来：HTTP 入口和 SOCKS5 入口各自维护一份"该怎么路由"的逻辑（可能是各自持有一份规则、各自调用 DNS 解析）。测试的时候发现一件怪事：同一个目标地址，从 HTTP 入口连过去被拒绝了，从 SOCKS5 入口连过去却直连成功——配置文件明明只有一份规则。退出测试进程时又发现另一个问题：进程一直不结束，`vitest` 要手动等超时才退出，因为还有几个 socket 悬挂着没有被清理。

这两个问题的根源相同：入口和它背后的判断逻辑绑得太紧，而资源清理这件事没有人负责到底。

## 一条共享的 connect 函数，两个入口都调用它

解决第一个问题的思路很直接：路由、DNS、出站这一整条判断链路只写一次，两个入口都调用同一个函数。companion 里这个函数就叫 `connect`：

```ts
// src/runtime.ts · connect
  async function connect(target: TargetAddress): Promise<DialOutcome> {
    const plan = await planRoute(target, config.dnsStrategy, config.rules, resolver)
    if (!plan.ok) {
      sink?.({ type: 'dial-error', message: plan.reason, detail: { host: target.host, port: target.port } })
      return { ok: false, reason: plan.reason }
    }
    sink?.({
      type: 'route',
      message: plan.decision.action,
      detail: { host: target.host, port: target.port, outbound: plan.decision.outbound ?? null },
    })
    const dialer = pickDialer(plan.decision)
```

`createHttpForwardServer({ connect })` 和 `createSocks5Server({ connect })` 传入的是同一个闭包实例，不是两份逻辑相同但各自维护的代码，是完全同一个函数引用。第 2 章留下 HTTP 入口，第 4 章把两个入口依赖的 `relay` 黑盒打开；这里把它们接入同一条共享管线。HTTP 的普通转发和 CONNECT、SOCKS5 的 CONNECT 命令，最终都会调用这同一个 `connect` 函数，走同一条 `planRoute` 决策、同一套出站适配器、同一个 `relay`。这就是为什么两个入口面对同一份规则时必须给出一致的结果：它们背后根本是同一段代码在做决定，不是两份需要保持同步的实现。

`pickDialer` 负责把路由决策翻译成具体的 `Dialer`：

```ts
// src/runtime.ts · pickDialer
  function pickDialer(decision: RouteDecision): Dialer | null {
    if (decision.action === 'DIRECT') return directDialer
    if (decision.action === 'REJECT') return rejectDialer
    if (decision.outbound === undefined) return null
    return proxyDialers.get(decision.outbound) ?? null
  }
```

入口处理函数自始至终只认识 `Dialer` 这一个类型。它完全不需要知道 `pickDialer` 内部是怎么在 `DIRECT`、`REJECT`、若干个 SOCKS5 上游之间做选择的。运行时按 `RouteDecision` 挑出适配器，入口不需要关心出站细节，这正是第 7 章埋下的那句承诺。

还有一点值得说清楚：`createProxyRuntime` 的第一个参数就是 `ProxyConfig` 类型，也就是第 8 章 `parseProxyConfig` 校验通过之后返回的那份配置。运行时本身不会再去猜"端口是不是合法""规则末尾有没有兜底"，这些问题在配置阶段已经问过一次；`createProxyRuntime` 只管拿着一份已经确认过形状的配置去组装监听和管线，不用在每个模块里重复做一遍默认值猜测。

## 依赖注入：让 DNS 和事件都可以被换成假实现

`connect` 函数用到的 `resolver`（域名解析器）不是硬编码调用 Node 的 `dns.lookup`。它是作为一个参数从外部传进来的：

```ts
// src/runtime.ts · createProxyRuntime（签名与默认 resolver）
export async function createProxyRuntime(config: ProxyConfig, options: ProxyRuntimeOptions = {}): Promise<ProxyRuntime> {
  const resolver = options.resolver ?? defaultResolver
```

这种"把外部依赖作为参数传入，而不是在函数内部直接创建"的做法叫**依赖注入**（dependency injection）。它戳穿了第二个误解：**测试里用真实 DNS 并不会让测试更可靠**。反而会让测试结果依赖公网状况、依赖被测域名当时是否能解析，还会让每次测试运行的时间变得不可控。本课程从第 6 章开始，所有测试都注入固定的假 resolver，这一章的 `createProxyRuntime` 同样支持注入，默认值只在真正运行 CLI 时才会用上真实 DNS。

事件通知走的也是同一个思路：`sink` 参数接收一个回调函数，运行时在路由、拨号出错、连接关闭等时刻都会调用它。传入的是一个**结构化事件**（structured event），带类型字段和结构化的 `detail`，不是拼接成一句话的日志文本。测试代码可以传入一个把事件推进数组的 `sink`，之后用 `events.filter(e => e.type === 'route')` 这样的方式去断言"两个入口是不是真的走了同一条路由"，比解析一行行拼接好的日志字符串要可靠得多。

## 优雅关闭：close 不是"喊一声就完事"

第二个问题，也就是进程退出时悬挂的 socket，出在 `close()` 这一步。`server.close()` 本身戳穿了第三个误解：**它并不会自动断开所有已经建立的连接**。[Node.js `server.close()` 文档](https://nodejs.org/api/net.html#serverclosecallback)说明，调用后服务器停止接受新连接，但要等现有连接结束才真正关闭。如果这时候还有 CONNECT 隧道处于活跃状态，进程会一直等着这些连接自然结束，可能永远不会退出。

companion 的解法是主动追踪每一个已建立的连接，`close()` 时强制断开它们：

```ts
// src/runtime.ts · trackConnections
function trackConnections(server: net.Server): { closeAll: () => void } {
  const sockets = new Set<net.Socket>()
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  return {
    closeAll: () => {
      for (const socket of sockets) socket.destroy()
      sockets.clear()
    },
  }
}
```

`createProxyRuntime` 返回的 `close()` 会先调用两个 `trackConnections` 的 `closeAll()`，把所有仍然连着的 socket 强制 `destroy()`，再等 `server.close()` 的回调真正 resolve。这就是**优雅关闭**（graceful shutdown）的完整含义：不是简单调用一次 API 就假设万事大吉，而是明确追踪资源、主动清理，确保进程真的能够退出。`cli.ts` 里的 `installGracefulShutdown` 把这一步接到了 `SIGINT`/`SIGTERM` 信号上，让命令行运行时按 Ctrl+C 能等 `close()` 跑完再退出，而不是被系统直接杀死、留下没清理干净的资源。

## 动手验证：先猜两个入口会不会一致，再核对

`tests/09-assembly.test.ts` 用 `port: 0` 启动一个真实的运行时（内核会自动分配空闲端口），配置里只有一条 `PORT: 9999 → REJECT` 规则加一条兜底 `DIRECT`。运行之前先猜：

1. 从 HTTP 入口和 SOCKS5 入口分别对端口 9999 发起连接，两边的规则判断结果会不会一致？
2. 运行时 `close()` 之后，一个仍处于 CONNECT 隧道中的客户端 socket，最终会收到什么？

运行命令：

```bash
cd courses/proxy-software-course/companion
pnpm vitest run tests/09-assembly.test.ts
```

预期 15 个用例全部通过。"HTTP 入口：DIRECT 规则放行，REJECT 规则拦截"和"SOCKS5 入口：DIRECT 规则放行，REJECT 规则拦截"这两条用例，分别验证了两个入口面对同一条 `PORT: 9999` 规则给出一致的判断结果。"route 事件里能看到两条入口共用同一条决策"这条用例直接从事件流里断言确实存在共享的 `DIRECT` 判断记录。"close 会强制断开仍处于 CONNECT 隧道中的连接"这条用例先建立一条隧道，再调用 `runtime.close()`，断言客户端 socket 会收到连接结束的信号，而不是永远挂起等待。这正好回答了第二个问题。

再看一个变体：如果去掉 `trackConnections` 这一层追踪逻辑，只依赖 `server.close()` 默认行为会怎样？这条用例仍然会通过，因为 `port: 0` 加上测试框架本身也会在用例结束后清理残留资源，短时间内看不出差异。但如果把这个运行时部署成一个长期运行的进程，且总有活跃隧道存在，缺少连接追踪的 `close()` 会导致进程在信号处理里迟迟等不到所有连接自然结束。这也是为什么本章特意把这一层写成显式追踪，不依赖默认行为。

## 自查：换个角度看依赖注入和事件

<details>
<summary>如果不传 resolver，会发生什么</summary>

`createProxyRuntime(config)` 不传 `options.resolver` 时，`resolver` 最终会是什么？这时候运行一条命中 `DIRECT` 且目标是域名的规则，会不会触发真实的公网 DNS 查询？

<details>
<summary>参考答案</summary>

会使用 `defaultResolver`，它内部调用的是 `dns.lookup(host, { family: 4 })`——也就是 Node.js 真实的 DNS 解析。如果这时候确实命中一条需要解析域名的 `DIRECT` 规则，会触发真实查询。这也是为什么本章和之前所有章节的自动化测试都必须显式传入一个固定的假 resolver：不传的话，测试行为会依赖真实网络环境，不再是可重复的判定。
</details>
</details>

<details>
<summary>两个入口各自维护一份规则副本，会有什么风险？</summary>

假设有人重构代码时手滑，让 `createSocks5Server` 拿到了一份和 HTTP 入口不同的规则数组，哪怕内容当时看起来一样。这种写法本身有什么问题，即使两份数组眼下内容相同？

<details>
<summary>参考答案</summary>

问题在于"两份独立数据恰好相同"是一种脆弱的巧合，不是被结构保证的事实。后续任何一次只改了其中一份规则的修改（哪怕是无心之失），都会让两个入口出现行为分歧，而且这种分歧很可能不会被立刻发现，因为大部分测试用例可能仍然覆盖不到这个新出现的差异。本章的设计从根本上避免了这个风险：只有一份 `config.rules`，只有一个 `connect` 闭包引用它，两个入口拿到的是同一个函数引用，不存在"保持同步"这件事需要人为维护。
</details>
</details>

## 回到开头的两个怪问题

现在能解释开头的两个现象了：同一目标从两个入口得到不同结果，是因为最初设想的实现让每个入口各自维护判断逻辑；这一章把 `connect` 做成一个两个入口共享的闭包之后，同一份配置、同一次调用路径，不会再出现分歧。进程退出时悬挂的 socket，是因为 `server.close()` 本身不负责断开已建立的连接；`trackConnections` 主动追踪并在 `close()` 时强制清理，让进程真的能够退出，而不是无限期等待。

到这里，双入口运行时已经可以启动、可以关闭、事件也可以观察到。下一章要做的是收官：把 HTTP、CONNECT、SOCKS5、拒绝规则和转发到另一个 SOCKS5 上游这几条路径，放进一次完整的本地端到端验证里。同时也要看清这个 mini-proxy 距离真实生产环境还差多远。
