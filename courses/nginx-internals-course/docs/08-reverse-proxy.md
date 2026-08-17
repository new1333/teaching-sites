---
title: 反向代理：前台接待员的艺术
---

# 反向代理：前台接待员的艺术

流量翻倍的那个大促前夜，架构组做了一个后来被证明救了命的决定：把 Node 服务从公网撤回来，前面垫一层 nginx。当晚压测，一部模拟弱网的手机客户端用 30 秒才收完一个 500 KB 的响应。直连 Node 的对照组里，这次发送把 Node 的事件循环拖住了整整 30 秒（socket 的发送暂存区满，发送变成同步等待），全站所有用户陪着卡死；垫了 nginx 的组里，Node 在 8 毫秒内就吐完了响应，那部慢手机由 nginx 慢慢喂了 30 秒，其他用户毫无感知。

「反向代理」这四个字你抄配置时写过无数遍（`proxy_pass http://backend;`），但垫了它为什么就不卡——这一章讲清这笔账，并让 tinysrv 亲自当一次前台。

## 前台接待员是干什么的

**反向代理**（reverse proxy）——站在真实服务器前面的前台接待员：客人（客户端）只见前台，真正的服务躲在后面——upstream（后台真正干活的服务器名单）。正向代理替客户端出门办事，反向代理替服务器接客——方向相反，名字由此而来。

它顺手能干的事很多（这章之后的两章讲其中两件：分发、限流）。但它的看家本领、也是前面那个救命故事的核心，是另一件事。**缓冲**（buffering）——在两个速度不一致的人之间摆一张桌子：快的那方先把东西堆桌上，慢的那方按自己的节奏来取。

把账算细。弱网手机收数据的速度是 17 KB/s，Node 生成响应的速度是每秒几百兆。直连时这两个速度被强行焊在一起：Node 必须等手机收完才算「这个响应发完了」——快的一方陪着慢的一方磨。事件循环是单线程的，它一陪，全站都陪。垫上反代之后，速度差被前台吸收：Node 对 nginx 吐完（毫秒级），转身服务下一位；数据堆在 nginx 的缓冲里，nginx 守着那条慢连接慢慢喂。慢的一方从「服务器的负载」变成「代理的账面」——一条挂着数据的连接而已，第 1 章早就论证过：挂着，不费钱。

你此刻应该能把这个故事和第 1 章的命门串起来：单线程事件循环怕慢活，而「写给慢客户端」恰是最常见的慢活——反代就是这道命门的工程解。

## 动手：proxyRequest

tinysrv 的代理是三个动作的串联：向 upstream 拨号、转发请求（顺手盖一枚邮戳）、把响应收齐后回写。先看全貌：

```ts
// src/proxy.ts · proxyRequest
export function proxyRequest(
  client: ManagedConn,
  head: RequestHead,
  target: ProxyTarget,
): Promise<ProxyOutcome> {
  return new Promise((resolve) => {
    const upstream = net.connect(target.port, target.host)

    upstream.on('error', () => {
      // 上游失联：给客户端一个结构化的坏消息，而不是挂死
      const body = 'bad gateway'
      const text =
        `HTTP/1.1 502 Bad Gateway\r\n` +
        `Content-Length: ${Buffer.byteLength(body)}\r\n` +
        `Connection: close\r\n` +
        `\r\n` +
        body
      client.write(encoder.encode(text))
      client.destroy()
      resolve({ ok: false, status: 502 })
    })

    upstream.on('connect', () => {
      // 转发请求行与头部，盖一枚「我经过了一道前台」的邮戳
      const lines = [`${head.method} ${head.path} ${head.version}`]
      for (const [k, v] of Object.entries(head.headers)) {
        if (k === 'connection') continue // 代理与上游之间的连接语义由代理自己定
        lines.push(`${k}: ${v}`)
      }
      lines.push(`x-forwarded-for: ${client.remote}`)
      lines.push('connection: close')
      lines.push('', '')
      upstream.write(encoder.encode(lines.join('\r\n')))
    })

    // 缓冲整个响应：头部到空行、体按 Content-Length 收齐，然后一次性回写
    let buf = ''
    upstream.on('data', (chunk: Buffer) => {
      buf += chunk.toString('latin1')
      const headerEnd = buf.indexOf('\r\n\r\n')
      if (headerEnd === -1) return
      const headerLines = buf.slice(0, headerEnd).split('\r\n')
      const lenLine = headerLines.find((l) => l.toLowerCase().startsWith('content-length:'))
      const len = Number(lenLine?.split(':').slice(1).join(':').trim() ?? 0)
      if (buf.length - headerEnd - 4 >= len) {
        client.write(encoder.encode(buf.slice(0, headerEnd + 4 + len)))
        upstream.destroy()
        client.destroy()
        resolve({ ok: true, status: Number(headerLines[0].split(' ')[1]) })
      }
    })
  })
}
```

三个值得停留的决策。

**邮戳 `x-forwarded-for`。** upstream 看到的连接来自代理——真实的客户端 IP 藏在代理肚子里。不补一枚邮戳，后端日志、限流、风控全都会把所有流量记成「来自 nginx 的那一台机器」。`X-Forwarded-For` 是业界通用的这枚邮戳：每经过一道代理，就把请求发起者的地址追加进去。你在后端服务里读「客户端 IP」时读的那个头，就是某道前台盖的。

**502 是前台的最后职责。** upstream 拨号失败（进程死了、端口没人听），代理不能跟着挂死或沉默——回一个 `502 Bad Gateway`，把「坏网关」这个结构化事实告诉客户端。你调后端时见过的每一个 502，都是某个前台在说：我后面那位没应门。

**缓冲就发生在那个 `buf` 字符串里。** 收齐（头部到空行、体按 Content-Length 齐了）才回写——这就是「摆桌子」的代码形状。快慢双方彻底解耦：upstream 按它的速度吐完走人，客户端按它的速度收。

组装层的接驳只有三行（`src/server.ts` 的 `respond` 开头）：配置了 `proxy` 目标就交给 `proxyRequest`，否则走原来的 handler——配置驱动行为，第 6 章那套规则的直接受益者。

## 诚实的差异账

tinysrv 的代理做了三处简化，每处都要跟真实 nginx 对齐着讲清差在哪：

- **每请求一条上游连接。** 真实 nginx 会维护 upstream 连接池（对上游也 keep-alive），省掉每个请求的三次握手——第 4 章那笔账在这里同样成立；
- **收齐再回写。** 真实 nginx 是流式转发 + 环形缓冲：上游数据一到就往客户端方向搬，缓冲只是蓄洪池，不是蓄水池。大文件场景下「收齐再转」会把内存吃爆；
- **转完即挂断。** 真实代理对客户端侧维持 keep-alive 语义，连续请求复用前后两段连接。

这三处简化换来的是三十行能一眼看懂的代理——机制的骨架（拨号、邮戳、缓冲、502）全都在，工程 flesh（池、流、复用）是往骨架上长肉的方向。

## 验证

进 `companion/` 跑 `pnpm test`：

```text
✓ tests/reverse-proxy.test.ts (3 tests) 50ms
✓ tests/http-parser-state-machine.test.ts (10 tests) 11ms
✓ tests/config-inheritance.test.ts (9 tests) 8ms
✓ tests/keepalive-reuse.test.ts (4 tests) 43ms
✓ tests/memory-pool.test.ts (7 tests) 5ms
✓ tests/connection-registry.test.ts (7 tests) 255ms
Test Files  6 passed (6)
     Tests  40 passed (40)
```

双跳全链路用例：测试里起一个真的手写 upstream（一个只回固定响应的裸 TCP 服务），tinysrv 配上 `proxy` 指向它，真客户端连 tinysrv 发请求。断言层层对上——客户端拿到 upstream 的原话（`hello-from-upstream` 一字不差）；upstream 侧的账本记到 `host: shop.local` 原样透传、`x-forwarded-for` 邮戳在场；三个请求恰好在 upstream 侧造成三条新连接（代理发起，不是客户端的那条）。失联用例：把 upstream 端口先占后放，制造「无人应门」，客户端如约收到 502 而不是挂死。

## 读完本章，你该能回答

- 慢客户端为什么拖得死直连的服务器、拖不死反代？速度差被谁吸收了？
- 「挂着不费钱」这个第 1 章的结论，在反向代理里变成了什么资产？
- X-Forwarded-For 是谁盖的、为什么必须有？502 是谁说的、说的是什么？
- tinysrv 的三处简化各自差在哪儿、正确的工程做法是什么？

前台已经站好了，但它身后还只有一位员工。三台后端坏一台、用户全然无感——下一章给前台一份名单和一套分活规则。
