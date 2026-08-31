---
title: HTTP 正向代理：改写请求与打通 CONNECT
---

# HTTP 正向代理：改写请求与打通 CONNECT

## 从入口到第一条能跑的路径

第 1 章把一条连接拆成入口、路由、出站三段，并解释了浏览器为什么能进入代理入口，裸 socket 脚本为什么进不去。这一章开始动手：实现两种入口协议里的第一种——HTTP 正向代理，让"入口"这一段第一次变成可以运行、可以测试的代码。

## 同一个 GET，两种写法

打开抓包工具，观察浏览器配置了 HTTP 代理之后发出的请求，会看到一个奇怪的现象。同一个 `GET /hello`，如果浏览器直接连目标服务器，请求行长这样。

```
GET /hello HTTP/1.1
Host: example.com
```

这是直连源站时的写法。但如果浏览器把请求发给代理，请求行却带上了完整 URL。

```
GET http://example.com/hello HTTP/1.1
Host: example.com
```

同一个 GET，两种截然不同的请求行。而如果目标是 HTTPS，浏览器发给代理的甚至不是 GET，是一个直连场景里从没见过的方法。

```
CONNECT example.com:443 HTTP/1.1
```

请求行的写法为什么会变，`CONNECT` 之后又发生了什么，是这一章要拆开看的问题。

## origin-form 与 absolute-form：请求目标的两种写法

HTTP 请求行里跟在方法后面的那一段，标准称为"请求目标"（request-target）。当客户端直接连接源站（origin server，也就是最终提供内容的服务器）时，请求目标只写路径和查询字符串，比如 `/hello?x=1`，这种写法叫 origin-form。这是我们最熟悉的形态，因为客户端和服务器之间已经通过 TCP 连接和 Host 头确定了"连的是谁"，请求行里不需要再重复。

但客户端如果不是直接连源站，而是把请求发给一个正向代理，问题就来了。代理程序面前可能同时服务着很多个目标，仅凭一个不带主机名的路径，它无法判断这次请求该转发去哪台服务器。于是 HTTP 协议为这种场景定义了另一种请求目标写法：absolute-form，也就是请求行里携带完整 URL（包含协议、主机、端口），例如 `GET http://example.com/hello?x=1 HTTP/1.1`。这样代理只看请求行本身就能确定目标，不用依赖其他头部。这两种写法的语义边界，在 [RFC 9112 第 3.2 节](https://www.rfc-editor.org/rfc/rfc9112.html#section-3.2) 里有明确定义。

代理收到 absolute-form 请求之后，不能原样把这行请求转发给源站——源站是按 origin-form 的约定实现的服务器，它不认识请求行里带着完整 URL 这种写法。所以代理必须把 absolute-form 改写回 origin-form，再转发出去。这正好戳破一个常见误解：**HTTP 代理并不是把所有请求原样复制给目标**，至少请求行本身就必须先被改写。

## 把 absolute-form 拆开：companion 里的改写逻辑

先看请求行怎么被拆成方法、目标、版本三段。

```ts
// src/authority.ts · parseRequestLine
export function parseRequestLine(line: string): RequestLine | null {
  const match = /^(\S+) (\S+) (HTTP\/\d\.\d)$/.exec(line.replace(/\r$/, ''))
  if (!match) return null
  const method = match[1]
  const target = match[2]
  const version = match[3]
  if (method === undefined || target === undefined || version === undefined) return null
  return { method, target, version }
}
```

拿到 `target` 字段之后，`rewriteAbsoluteForm` 会判断它是不是一个 `http:` 协议的绝对 URL。如果是，就用 `URL` 对象拆出路径、查询字符串和主机端口，拼出新的 origin-form 请求行。

```ts
// src/authority.ts · rewriteAbsoluteForm
export function rewriteAbsoluteForm(line: RequestLine): AbsoluteFormRewrite | null {
  if (line.target.startsWith('/')) return null
  let url: URL
  try {
    url = new URL(line.target)
  } catch {
    return null
  }
  if (url.protocol !== 'http:') return null

  const defaultPort = 80
  const portRaw = url.port === '' ? defaultPort : Number(url.port)
  const origin = `${url.pathname}${url.search}` || '/'
  const requestLine = `${line.method} ${origin} ${line.version}`
```

`line.target.startsWith('/')` 这一行顺带处理了另一种情况。如果请求目标本来就是 origin-form（以 `/` 开头），说明客户端把这条 TCP 连接当成了直连源站来用。函数直接返回 `null`，调用方会原样转发，不做多余改写。改写完成后，代理还要把 `Host` 请求头也换成新目标的主机名。这是因为很多源站会用 `Host` 头判断该把请求路由给哪个虚拟主机，如果保留客户端写的旧 `Host`，源站可能会返回错误的内容，或者直接拒绝请求。

mini-proxy 在这里有一条必须说清的教学简化。它只读到请求头结束，不解析后续消息体，也不校验 `Content-Length` 或 chunked framing。头部之后已经收到和稍后到达的字节都会交给 `relay` 原样转发。生产代理必须按 [RFC 9112 第 6 节](https://www.rfc-editor.org/rfc/rfc9112.html#section-6)处理消息边界。不同节点对边界理解不一致会带来请求走私风险。本课把这一缺口登记在[差异清单](./divergence)中，不把“透明搬运”冒充“完整 HTTP 代理”。

## CONNECT：目标是 HTTPS 时，代理连内容都看不到

普通 HTTP 转发有个前提：代理能读懂请求的每个字段，所以才能改写。但 HTTPS 不允许这样，TLS 握手和加密内容必须由客户端和目标服务器直接协商，中间任何一方都不能读懂或篡改。这就是 **TLS 端到端**（TLS 会话建立在真正通信的两端之间，普通隧道代理只搬运密文，不持有解密密钥）的含义。既然代理读不懂 HTTPS 的内容，那它能为 HTTPS 做的最大帮助，就是先在客户端和目标之间凿开一条纯字节通道，不再解释里面的任何内容。

这就是 `CONNECT` 方法的作用：客户端请求代理连接 `host:port`，代理连上目标之后回一个 200 状态码。从这一刻起，这条 TCP 连接的双向字节流会被原样转发，代理不再关心里面装的是什么协议。这种约定叫 **CONNECT 隧道**，语义定义在 [RFC 9110 第 9.3.6 节](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.3.6)。

这里也能拆穿另外两个常见误解。第一，**CONNECT 返回的 200 不代表目标网站返回了一个成功页面**。它只表示代理成功连上了目标端口，这时候客户端和目标服务器之间的 TLS 握手甚至还没开始，网站层面的任何响应都还没发生。第二，**普通的 CONNECT 代理看不到隧道里的 HTTPS 明文**。因为 TLS 握手发生在隧道建立之后，由客户端和目标服务器直接协商密钥，代理只是搬运已经加密好的字节，它没有密钥去解密。companion 里对应的逻辑很短。

```ts
// src/http-server.ts · handleConnect
  async function handleConnect(socket: Socket, reader: ReturnType<typeof createSocketReader>, targetRaw: string): Promise<void> {
    const authority = parseAuthority(targetRaw, 443)
    if (!authority) {
      writeStatus(socket, 400, 'Bad Request')
      return
    }
    const target = toTargetAddress(authority.host, authority.port)
    sink?.({ type: 'route', message: 'connect', detail: { host: target.host, port: target.port } })

    const outcome = await options.connect(target)
    if (!outcome.ok) {
      sink?.({ type: 'dial-error', message: outcome.reason, detail: { host: target.host, port: target.port } })
      writeStatus(socket, 502, 'Bad Gateway')
      return
    }

    socket.write(`HTTP/1.1 200 Connection Established${CRLF}${CRLF}`)
    reader.release()
    await relay(socket, outcome.result.socket, sink)
  }
```

拨号成功才写 200，拨号失败则回 502；写完 200 之后，函数把解析请求头时用的 `reader` 释放掉（把可能多读到的字节还给 socket），再调用 `relay` 做双向转发。这里首次看到了 `SocketReader`，它负责 `readUntil` 和释放缓冲；本章只使用结果，下一章讲 SOCKS5 时再正式拆开它如何按字段顺序读取。`relay` 具体怎么处理背压和半关闭，是后续一章的主题，这里先只当它是一个“把两个 socket 接起来”的黑盒。

## 动手验证：先猜字节，再核对测试

`tests/02-http-forward-proxy.test.ts` 起了一个真实的 HTTP 源站和一个 `createHttpForwardServer` 代理，都只监听 `127.0.0.1`。在运行它之前，先根据前面的原理写下你的预测：

1. 客户端往代理发 `GET http://127.0.0.1:<originPort>/hello?x=1 HTTP/1.1`，源站实际收到的请求行会是什么？
2. 源站把收到的 `Host` 头原样回显在响应里，这个值会是客户端发的 `this-should-be-overwritten`，还是别的？
3. 客户端对代理发 `CONNECT 127.0.0.1:<echoPort> HTTP/1.1`，代理返回的前几十个字节，第一行会是什么？

写下预测后，在 `courses/proxy-software-course/companion` 目录运行：

```bash
cd courses/proxy-software-course/companion
pnpm vitest run tests/02-http-forward-proxy.test.ts
```

预期看到 4 个用例全部通过。核对断言能确认三件事：请求行被改写成了 `GET /hello?x=1 HTTP/1.1`（路径和查询字符串保留，主机部分被去掉）；`Host` 头变成了 `127.0.0.1:<originPort>`，说明客户端原来写的值确实被覆盖；`CONNECT` 请求换来的第一行是 `HTTP/1.1 200 Connection Established`，随后写入隧道的 `ping-through-tunnel` 会原样从另一端回显。

再看一个变体，帮助确认“为什么”而不只是“是什么”：如果把请求行换成 `GET ftp://example.com/x HTTP/1.1`（协议不是 http，也不是 origin-form），会发生什么？测试里专门有一条用例覆盖了这种情况，代理会返回 400 Bad Request——因为 `rewriteAbsoluteForm` 判断协议不是 `http:` 就直接返回 `null`，代理没有办法确定目标，只能拒绝这条请求，而不是猜一个目标勉强转发。这个失败案例反过来证明了改写逻辑确实在校验协议，不是简单地把请求原样透传。

## 自查：换个协议再想一遍

<details>
<summary>如果目标是 HTTP，还需要 CONNECT 吗</summary>

假设客户端要访问的是 `http://example.com`（普通 HTTP，不是 HTTPS），代理还需要走 CONNECT 隧道吗？为什么？

<details>
<summary>参考答案</summary>

不需要。CONNECT 隧道存在的原因是代理读不懂 TLS 加密内容，只能搬运密文。但普通 HTTP 请求本身就是明文，代理完全可以读懂请求行和头部。它可以正常做 absolute-form 到 origin-form 的改写，转发给源站，再把响应转发回客户端。这也是为什么本章的实现区分了两条路径：请求行以 `CONNECT` 开头走隧道，其他方法走改写转发。
</details>
</details>

<details>
<summary>改写 Host 头这一步，漏掉会怎样</summary>

如果 `rewriteAbsoluteForm` 只改写了请求行，却没有同步把 `Host` 头也改成新目标的主机名，转发给一个基于虚拟主机（一台服务器用 `Host` 头区分多个网站）的源站时，可能会出现什么现象？

<details>
<summary>参考答案</summary>

源站可能会把请求路由到错误的虚拟主机上，返回一个客户端没有请求过的网站内容。也可能因为 `Host` 值和它认识的域名对不上而直接报错。这是因为很多 HTTP 服务器用 `Host` 头而不是 TCP 连接本身来决定"这次请求该找哪个网站"；只改请求行、不同步改 `Host` 头，会让这两个信号互相矛盾。
</details>
</details>

## 回到开头的两种写法

现在可以完整解释开头看到的现象了。浏览器直连源站时用 origin-form，因为 TCP 连接已经锁定了对方是谁；发给代理时改用 absolute-form，因为代理面前可能有很多目标，必须在请求行里说清楚要去哪。HTTPS 场景下浏览器发的是 `CONNECT` 而不是 `GET`，因为代理根本读不懂后续的加密内容，只能先凿开一条不解释内容的隧道，把解密的工作完全留给客户端和目标服务器自己完成。

这一章实现的入口只处理了 HTTP 一种协议。下一章会实现另一种常见的入口协议 SOCKS5，它不认识请求行和 Host 头，靠的是一套二进制握手来交待目标地址。等两种入口都实现完，第 4 章会补上它们背后共用的双向转发细节：`relay` 这个黑盒到底怎么处理背压和连接关闭。再往后组装运行时时，HTTP 与 SOCKS5 入口还会共用同一个 route-DNS-dial 连接函数，入口本身不再各写一套路由。
