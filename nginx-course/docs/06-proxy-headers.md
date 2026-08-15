---
title: 请求头透传与 WebSocket：X-Forwarded-For 和 Upgrade
---

# 请求头透传与 WebSocket：X-Forwarded-For 和 Upgrade

上了 Nginx 之后，两件怪事同时出现。

第一件：风控组拉黑了一个 IP `10.0.0.2`，因为"它每小时发几万条请求"。排查发现那是 Nginx 机器的内网地址——上了反向代理（reverse proxy）之后，后端日志里**所有**请求的来源 IP 都变成了 Nginx 自己。全站用户在后端眼里成了同一个人，按 IP 限流的策略把所有人一起限了。

第二件：站内聊天室每次连接一分钟左右就断线，前端控制台反复报 `WebSocket connection closed abnormally, code 1006`。后端说 WebSocket 服务是好的，直连测试从不断。

两个现象，同一个根源：**有些信息在穿过代理时丢了**。这一章讲清楚哪些信息会丢、为什么丢、怎么补——以及 WebSocket 为什么必须特殊处理。

## 代理遮蔽了什么

后端看到的"来源 IP"来自 TCP 连接，而 TCP 连接是 Nginx 与后端之间的——真实的客户端早已被代理挡在身后。IP 无法凭空补造，但可以在 HTTP 头里"捎话"。Nginx 的做法是在转发前注入三个头：

- `X-Real-IP`：我（代理）亲眼看到的客户端地址；
- `X-Forwarded-For`（XFF）：一路走来的代理链，逗号分隔，**追加**而非覆盖；
- `X-Forwarded-Proto`：客户端最初用的是什么协议（http / https）。

XFF 的追加语义值得细看。客户端完全可以伪造它——`fetch` 时自带一个 `X-Forwarded-For: 1.2.3.4`。链式追加后后端会收到 `1.2.3.4, 10.0.0.9`：左边是"自称"的，右边是"最后一跳代理亲眼看见的"。所以**取真实 IP 要从右往左数，只信你自己的代理追加的那一段**，从左往左数到第一个就把伪造者当真了。给后端的接口文档里写清楚这个约定，比出事后扯皮便宜得多。

`Host` 头是另一个默认会被改写的：Nginx 默认把它设成 upstream 的地址（`$proxy_host`），因为多数后端的虚拟主机路由、签名校验都依赖收到的 Host。想保留客户端原始域名，用 `proxy_set_header Host $host;` 显式改回来。

## WebSocket：逐跳头把连接掐死在代理上

第二件怪事的答案藏在一个分类里：HTTP 头分**端到端**和**逐跳（hop-by-hop）**两种。`Authorization`、`X-Custom-*` 是端到端的，理论上每跳都该透传；`Connection` 和 `Upgrade` 是逐跳的——**只在相邻两个节点之间有意义，代理默认不转发它们**。

WebSocket 的握手恰恰靠它们：

```text
客户端                    Nginx                    后端
  │ GET /ws/chat HTTP/1.1    │                        │
  │ Upgrade: websocket       │                        │
  │ Connection: Upgrade       │  ← 默认被代理吃掉      │
  │─────────────────────────▶│                        │
  │                           │ 转发时没有 Upgrade 头  │
  │                           │───────────────────────▶│
  │                           │                        │ 后端：这是普通请求
  │                           │        普通响应（非 101）│
  │  握手失败 / 连接被挂起 → 客户端超时报 1006            │
```

后端没收到 `Upgrade: websocket`，就不认为这是升级请求，握手永远完不成。修法是三条指令（真实 Nginx 语法）：

```nginx
location /ws/ {
  proxy_pass http://backend;
  proxy_http_version 1.1;                     # Upgrade 依赖 1.1
  proxy_set_header Upgrade $http_upgrade;     # 把客户端的 Upgrade 透传给上游
  proxy_set_header Connection "upgrade";      # Connection 也一并带上
}
```

握手成功后（后端应答 `101 Switching Protocols`），这条连接就不再是 HTTP 了——它退化成一条**裸 TCP 隧道**，两端随便传什么帧，代理只负责搬运字节。这正是 WebSocket 能全双工的原因：它只借 HTTP 用了一次，用完就走了。

## mini-nginx 实现：注入头，重放握手

普通请求的头处理集中在 `src/proxy.ts` 的 `buildProxyHeaders`：

```ts
const clientIp = req.socket.remoteAddress ?? ''
const headers: Record<string, string> = { ...req.headers } as Record<string, string>
headers['x-real-ip'] = clientIp
const xff = req.headers['x-forwarded-for']
headers['x-forwarded-for'] = xff ? `${xff}, ${clientIp}` : clientIp
headers['x-forwarded-proto'] = target.protocol === 'https:' ? 'https' : 'http'
headers.host = target.host
for (const [key, value] of Object.entries(loc.proxy_set_header ?? {})) {
  headers[key.toLowerCase()] = value
}
```

前四行是默认注入（对齐 nginx 行为），最后一行是 `proxy_set_header` 覆盖——配置里写什么，最后就以什么为准，与 nginx 的优先级一致。

WebSocket 升级走的是另一条路。Node 的 HTTP 服务器把带 `Upgrade` 头的请求派发给 `upgrade` 事件而不是 `request`，所以 `src/server.ts` 里单独注册了它，命中代理块就交给 `proxyUpgrade`：向上游重放握手，收到 101 后把状态行和头写回客户端，然后两条 pipe 接成隧道：

```ts
socket.write(lines.join('\r\n') + '\r\n\r\n')
if (upstreamHead?.length) socket.write(upstreamHead)
// end:false——不让 pipe 自动发 FIN：半开的隧道没有意义，任何一侧断开都整体拆除
upstreamSocket.pipe(socket, { end: false })
socket.pipe(upstreamSocket, { end: false })
let dropped = false
const drop = () => {
  if (dropped) return
  dropped = true
  socket.destroy()
  upstreamSocket.destroy()
}
for (const s of [upstreamSocket, socket]) {
  s.on('error', drop)
  s.on('close', drop)
  s.on('end', drop)
}
```

那段注释是本章调试时踩出来的真实坑，值得展开讲给每个要写代理的人。客户端断开时（尤其收完数据后 destroy），到达 mini 侧的往往是一个安静的 FIN——socket 触发的是 `end` 事件，不是 `close` 更不是 `error`。如果只监听 `close`/`error`，隧道另一侧会永远挂着；而 pipe 默认的 `end: true` 还会先把 FIN 优雅地传给上游，让上游停在"半开"状态——上上游的服务器如果等到的是 FIN 而不是 RST，它的连接也收不了尾。第一版实现就是这样：测试全部通过、断言全部正确，然后整个测试套件在 teardown 阶段挂起十秒超时。修复就是你现在看到的组合：`end: false` 切断 pipe 的自动 FIN，`end`/`close`/`error` 三事件任一触发即双侧 `destroy()`。**隧道语义：一侧断开，整体拆除**——真实 Nginx 对客户端断开的行为也是立即关闭上游连接，没有"替客户端续命"这回事。

与真实 Nginx 的一个差异要说破：mini-nginx 对代理块**自动**透传 Upgrade（有 `upgrade` 事件可依赖），真实 Nginx 需要 `proxy_set_header Upgrade $http_upgrade` 显式声明——因为它严格遵守"逐跳头不转发"，把选择权交给你。漏配那两行，就是你家聊天室 1006 的原因。

## 验证

`npm run typecheck && npm test`，32 个断言全绿，本章新增五条：

```text
✓ 默认注入 X-Real-IP / X-Forwarded-For / X-Forwarded-Proto
✓ 客户端伪造的 X-Forwarded-For 被追加而非覆盖
✓ proxy_set_header 覆盖 Host
✓ 未配置覆盖时 Host 默认为 upstream 主机
✓ 完成 101 握手并双向转发一帧
```

最后一条用原生 TCP socket 手写了整个握手：发握手请求、发一帧 masked 文本、解析返回的 101 状态行和一帧服务端文本。测试替身也学了一课——mock 上游收到对端 FIN 要主动收尾（`socket.on('end', () => socket.end())`），否则它自己就是下一个挂起点。

下一章把单台上游变成一组：`upstream`，发版不再陪葬 502。

---

**本章要点**：代理遮蔽 TCP 层信息，靠 `X-Real-IP` / `X-Forwarded-For` / `X-Forwarded-Proto` 头捎话；XFF 链式追加、可伪造，取真实 IP 从右往左数；`Connection`/`Upgrade` 是逐跳头，代理默认不转发，WebSocket 握手必须显式透传；101 之后是裸 TCP 隧道，一侧断开就整体拆除。
