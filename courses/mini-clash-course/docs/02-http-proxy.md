---
title: HTTP 正向代理：两种把流量交出来的方式
---

# HTTP 正向代理：两种把流量交出来的方式

## 2.1 前情：门口的告示牌，门里的规矩

三个问题，把上一章的线头接起来：

- 浏览器为什么一开代理就见效、命令行为什么纹丝不动？——告示牌只给自愿读它的应用看。
- 上一章那台回声服务器，为什么当不了浏览器的代理？——它只会把字节原样弹回，听不懂「按 HTTP 规矩说话」。
- 还记得 TCP 给你的只是字节流、边界要协议自己画吗？这一章就看 HTTP 怎么画——上一章欠下的「正文边界怎么定」那笔账，也在这里清。

## 2.2 一半正常，一半报错：同一个代理的两种结局

先看这一天。你把刚写好的 HTTP 代理跑起来，系统代理指向 `127.0.0.1:7890`，浏览器刷新一个 http:// 网站——一切正常，页面秒开。你顺手点开一个 https:// 网站，弹出来的却是证书错误一类的安全警告页。

证书什么也没做错。出问题的是你的代理：它找目标的唯一办法，是从明文请求行里读域名——而 https 站点的请求行根本不在明文里。死因一句话：请求行没有域名——不是谁漏写了它，是加密通道建成之前，这条线路上根本还没有请求行。你的代理不知道该替浏览器去连谁，浏览器等不来合法的握手，只好把账算到证书头上。

同一个代理，两种结局，因为浏览器交出流量有两种说法：http:// 站点用的是「把整封信交给代理转寄」，https:// 站点用的是「只请代理接通一根管道」。这两种说法——改写转发与 CONNECT 隧道——就是本章要写的全部。写完你再回头看那个证书错误，能一字一句讲清它的因果。

## 2.3 原理：一封信的形状，和两种寄法

### 2.3.1 HTTP 报文：信封加信纸

上一章你亲手验证过：TCP 只给字节流，两次 write 可能合成一段到。那浏览器和服务器怎么知道「一句话说完了没有」？靠两边提前约好的信件格式。先记住这封信的学名叫 HTTP 报文，然后拆开看。

HTTP 报文（HTTP message）——HTTP 通信的基本信件：信封（起始行加头部）写清收发规矩，信纸（正文）装内容，全部是按固定格式拼出来的字节。锚点就是寄信：信封上路谁都能读，信纸装的是内容。

信封的第一行叫请求行（request line）——方法 + 目标 + 版本三格，比如 `GET /where?q=now HTTP/1.1`。下面是 2.5 节实跑时 curl 发出的原话（端口是系统随手分的，`\r\n` 是行尾的两个字节：回车加换行）：

```text
GET http://127.0.0.1:7339/ HTTP/1.1\r\n
Host: 127.0.0.1:7339\r\n
User-Agent: curl/8.18.0\r\n
Accept: */*\r\n
Proxy-Connection: Keep-Alive\r\n
\r\n
```

结构对着数一遍：

| 部位 | 内容 | 边界怎么画 |
| --- | --- | --- |
| 请求行 | 方法 + 目标 + 版本 | 一行，`\r\n` 收尾 |
| 头部 | 若干行「名字与值」 | 每行 `\r\n` 收尾 |
| 空行 | 只有 `\r\n` 的一行 | 信封的终点线 |
| 正文 | 任意字节 | 看 Content-Length 报的字节数 |

现在清上一章的欠账：正文的边界画法。头部有天然的分隔符（换行），正文却是任意字节——里面出现 `\r\n` 也不稀奇，不能靠找符号。HTTP 的办法是长度规矩：信封里写一行 `Content-Length: 10`，正文就从空行后第一个字节起，数够 10 个字节为止。第 11 个字节如果还有，那已经是下一条消息的开头。带正文的请求长这样（正是本章测试里发的那条）：

```text
POST http://127.0.0.1:9200/echo HTTP/1.1\r\n
Host: 127.0.0.1:9200\r\n
Content-Length: 10\r\n
\r\n
1234567890
```

跟着算一遍这三个问题：信封在哪结束？——空行处。信纸从哪开始？——空行后第一个字节。到哪结束？——数够 10 个字节。反过来，没有正文时（比如上面的 GET）连 Content-Length 都可以不写：请求没有长度声明，正文就按 0 个字节算，空行即终点。这套「找空行、再数长度」的规矩，就是 HTTP 给字节流画的边界，2.4 节它会一字不差地长成代码。

（真协议还有另一种画法：Transfer-Encoding 的「分块」模式，边发边报每块长度。教学版不实现，登记进与真实实现的差异清单：我们只认 Content-Length。）

### 2.3.2 absolute-form：走代理时，目标写全名

注意上面两条请求行里的目标：不是 `/where?q=now` 这种路径，而是带 `http://` 的完整 URL。这不是 curl 随性，是规矩。

直连一个网站时，你已经拨通了它的门牌（connect 的参数就是目标），请求行里只写路径就够——这叫 origin-form。走代理时不一样：代理一个端口要接待所有网站，它必须有人告诉它「去哪」。所以 RFC 9112 规定，客户端发给代理的明文请求，必须把目标写成完整 URL——绝对地址形式（absolute-form）——这是「告诉代理去哪」的信号。

反事实检验一下这条规矩的分量：假如没有它，代理也不是完全没辙——头部里那行 `Host` 同样写着目标。但请求行是代理读的第一行、也是最不会缺席的一行，把最要命的信息放在最前面，解析逻辑就不必为了知道去哪而读完整个信封。RFC 同时还要求代理转发时按请求行里的目标重建 Host 头、不得照抄收到的——收到的 Host 可能与真实目标不一致（本章测试就故意发一个错的来验证这条）。收到的目标若已是路径（个别客户端就这么发），去哪只能看 Host——实现里我们留了这条后路。

### 2.3.3 CONNECT：先接管道，再谈加密

https 把上面这套整个堵死了，死结有两个。

其一，先有加密，才有请求行。TLS——https 用的那套加密规矩；握手——双方开场商量「怎么加密」的几步对话。TLS 的握手发生在任何 HTTP 字节之前；真正的请求行发出来时已在密文里。你那套「从请求行读目标」的办法，等的是一个永远不会以明文出现的信号。其二，端到端。浏览器要亲手验证目标站的证书、亲手跟目标站协商密钥，中间人一个字节都不能替它做主——否则「安全」二字就名存实亡。

解法是浏览器换一种说法：不寄信了，先请代理接通一根管道。它发一行 `CONNECT a.com:443 HTTP/1.1`——目标只写门牌（host:port，端口必须写明，RFC 9110 专门强调了这条，没有默认端口）。代理拨通目标、回一行 2xx（成功类状态码，200～299），从这一刻起这条连接对代理只剩一件事：双向搬运字节。

CONNECT 隧道（CONNECT tunnel）——HTTPS 走代理的办法：先让代理拨通目标，之后代理只当双向透传的管道，看不到加密内容。时序上是这样：

```text
浏览器                        你的代理                    目标站
  │ ① CONNECT a.com:443         │                          │
  │ ──────────────────────────▶ │ ② 替它拨号               │
  │                             │ ────────────────────────▶│
  │ ◀── ③ HTTP/1.1 200 ──┐      │ ◀──────── 接通 ─────────│
  │                      └──────┴── 应答走代理这一侧 ───────┤
  │                                                     │
  │ ═ ④ TLS 握手与之后的全部密文：两个方向都只是搬字节 ═ ═▶│
```

两条细节值得钉死。第一，应答必须是 2xx 才算隧道开通，开通即刻生效——空行之后的第一批字节可能已经是 TLS 握手的开头，代理要原样送进管道。第二，管道里装的不一定是 TLS：CONNECT 只管接通，里面走什么协议代理既不知道也不管。这个「不管」是刻意的分工——隧道里的代理不是 HTTP 通信的当事人，只做中继（把两条 socket 对接起来双向搬运，这个词第 4 章当主角）。

回头看 2.2 的证书错误，因果链已经齐了：你的明文代理在等一个带域名的请求行，https 站点永远不会发——它说的是 CONNECT。听懂这句话，就是下面代码的后半件事。

## 2.4 演练：把两种说法写成代码

实验场这一章开工。`src/http-proxy.ts` 是实现，`tests/http-proxy.test.ts` 是裁判——测试先写、先跑出红（模块还不存在，测试文件连加载都失败，红得干脆），再写实现转绿，这是「渐进」两个字的机械证明。门槛命令照旧：`cd companion && npm run typecheck && npm test`。

对外只开一个口：`startHttpProxy({ port, connectTarget })`。`connectTarget` 是个翻译钩子——把「客户端想去哪」翻译成「实际连谁」，缺省直连；将来规则引擎接管分流时，就在这里改写出口。本章测试会用它当探针。

### 2.4.1 认头：拆请求行，读长度

第一块砖是「读信封」。头部是文本协议，允许按 `\r\n` 拆行——这是文本协议相对二进制协议最大的便宜，下一章写 SOCKS5 时就没有这个待遇了。

```ts
// src/http-proxy.ts · parseRequestHead / splitAbsoluteForm / parseAuthority
// 头部是文本协议，允许按 \r\n 拆行（二进制协议没有这个便宜）
function parseRequestHead(headText: string): RequestHead | null {
  const lines = headText.split('\r\n')
  const parts = lines[0].split(' ')
  if (parts.length !== 3 || !parts.every(Boolean)) return null
  let bodyLength = 0
  for (const line of lines.slice(1)) {
    const m = /^content-length:\s*(\d+)\s*$/i.exec(line)
    if (m) bodyLength = Number(m[1])
  }
  return { method: parts[0], target: parts[1], headers: lines.slice(1), bodyLength }
}

// absolute-form（GET http://host:port/path?x=1 HTTP/1.1）拆成：
// authority——去哪（host[:port]）；path——要什么（路径 + 查询串）
function splitAbsoluteForm(target: string): { authority: string; path: string } | null {
  const m = /^http:\/\/([^/?#]+)([^#\s]*)$/.exec(target)
  if (!m) return null
  return { authority: m[1], path: m[2] === '' ? '/' : m[2] }
}

// host[:port] → { host, port }。不写端口时，http 的默认房间号是 80
// （CONNECT 除外：RFC 9110 规定它必须写明端口，openTunnel 里另查）
function parseAuthority(authority: string): ProxyTarget {
  const i = authority.lastIndexOf(':')
  if (i < 0) return { host: authority, port: 80 }
  const port = Number(authority.slice(i + 1))
  return Number.isInteger(port) && port > 0 ? { host: authority.slice(0, i), port } : { host: authority, port: 80 }
}
```

三个函数各管一件事：`parseRequestHead` 把信封拆成结构（顺带把 Content-Length 读出来），`splitAbsoluteForm` 认出 absolute-form 并拆成「去哪 + 要什么」，`parseAuthority` 把「去哪」变成能交给 connect 的两个数字。

### 2.4.2 攒边界：一台小状态机

2.3.1 的两条边界规矩，在这里长成代码。先认识一个新面孔：Buffer——Node 里装字节的一段可变长数组，TCP 的读和写都以它为单位（`alloc(0)` 开一段空字节、`concat` 把两段接起来、`subarray` 切出其中一段）。每条客户端连接有自己的状态：

```ts
// src/http-proxy.ts · handleClient 的连接状态
// 一条客户端连接的一生：攒字节 → 认头部 → （攒正文 → 转发）循环，或 CONNECT 后转纯搬运
function handleClient(client: net.Socket, hook?: ConnectTargetHook): void {
  let buffered = Buffer.alloc(0) // 还没消费的字节：TCP 只给字节流，到没到齐只能自己攒、自己判
  let upstream: net.Socket | null = null // 本连接对着的「上一程」目标
  let pending: RequestHead | null = null // 头已读全、正文没攒齐的那条请求
  let busy = false // 异步步骤进行中：新字节先攒着，结束后重跑 pump
  let tunnel = false // CONNECT 应答之后：只剩搬运，不再解读
```

驱动它的是 `pump`——每有新字节到，就试试「还能往前走多远」：

```ts
// src/http-proxy.ts · pump 与数据入口
  // 状态机：head（攒头部）→ body（攒正文）→ head → …；CONNECT 应答后进 tunnel
  const pump = () => {
    if (busy || tunnel) return
    if (pending === null) {
      const headEnd = buffered.indexOf(HEAD_END)
      if (headEnd < 0) return // 头部还没到齐
      const head = parseRequestHead(buffered.subarray(0, headEnd).toString('latin1'))
      if (!head) return fail('请求行看不懂')
      const rest = buffered.subarray(headEnd + HEAD_END.length)
      buffered = Buffer.alloc(0)
      if (head.method === 'CONNECT') {
        busy = true
        void openTunnel(head, rest)
        return
      }
      pending = head
      buffered = rest
    }
    const req = pending
    if (req && buffered.length >= req.bodyLength) {
      // 正文攒够 Content-Length 报的字节数：一条完整请求到齐，可以动身了
      const body = buffered.subarray(0, req.bodyLength)
      buffered = buffered.subarray(req.bodyLength)
      pending = null
      busy = true
      void forwardPlain(req, body)
    }
  }

  client.on('data', (chunk) => {
    if (tunnel) {
      upstream?.write(chunk) // 隧道态：一个字节都不看
      return
    }
    buffered = Buffer.concat([buffered, chunk])
    pump()
  })
```

对照 2.3.1 的三个问题逐行看：`indexOf(HEAD_END)` 找空行，是信封的终点；`buffered.length >= req.bodyLength` 数够 Content-Length 报的字节数，是信纸的终点；切走一条完整请求后 `buffered` 里剩下的字节不丢——它们留在原地，等下一轮当新请求的开头。keep-alive 连接上的第二条请求，就是靠这点「剩余」接上的。`busy` 是异步闸：拨号期间新到的字节只攒不解析，拨完回来重跑一次 `pump` 补课。

还有两件小家具本章不再展开。`HEAD_END` 是模块顶上的一行常量 `const HEAD_END = '\r\n\r\n'`——「空行 = 连着两个 CRLF」，就是信封终点线的字面值。`fail` 是 `handleClient` 里的收摊函数：记一行日志、拆掉两侧 socket，`pump` 里那句 `fail('请求行看不懂')` 走的就是它。读头部那行还有个 `toString('latin1')`——每个字节原样映射成一个字符的读法，保证头部字节不被改写。

### 2.4.3 明文转发：只改一行，重建一个头

信到了齐，动身。拨号统一走 `connectTo`——`net.connect` 的 Promise 包装，连不上时 reject、怎么回话由调用方决定（明文与隧道都按惯例回 502）。它在本章先住在本地；后来两跳一章要第三次用它，提取成了共用模块 `src/dial.ts`，本文件改为 import——下面是它的现行形态（全书纪律：正文引用的代码始终等于代码终态）。注释里 REP、回执那两个编号是后面章节的回话方言，此处按下不表。

```ts
// src/dial.ts · connectTo
import net from 'node:net'
import type { ProxyTarget } from './http-proxy' // 只借「host + port」这个形状，type 引用不带运行时依赖

// net.connect 的 Promise 包装。HTTP 入口、SOCKS5 入口与远端中继都用它拨号：
// 接通即 resolve；连不上 reject，之后怎么回话（502 / REP=01 / 回执 01）由调用方决定
export function connectTo(t: ProxyTarget): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const s = net.connect(t.port, t.host)
    s.once('connect', () => resolve(s))
    s.once('error', (e) => {
      s.destroy()
      reject(e)
    })
    s.on('error', () => s.destroy()) // 接通之后的事故只收尾，不让进程崩
  })
}
```

改写的幅度小得意外——请求行换掉目标、Host 按请求行重建，其余逐字节原样：

```ts
// src/http-proxy.ts · relayUpstream 与 forwardPlain
  // 上游的响应不解读、不改写，原样回流给客户端。
  // 同一连接的第二条请求会换新拨一条上游线（真代理会复用旧线，教学版不做）
  const relayUpstream = (remote: net.Socket) => {
    if (upstream && upstream !== remote) upstream.destroy() // 换线：旧上游收摊
    upstream = remote
    remote.on('data', (b) => client.write(b))
    remote.on('error', (e) => {
      if (remote === upstream) fail(`上游出错：${e.message}`)
    })
    remote.on('close', () => {
      if (remote !== upstream) return // 已换下岗的旧线：安静退场，不牵连客户端
      client.end() // 当前这根线收摊：把话尾送完，跟着收线
    })
  }

  // 明文请求：改写请求行（URL → 路径）、按请求行目标重建 Host（RFC 9112：不得照抄收到的 Host）
  const forwardPlain = async (head: RequestHead, body: Buffer): Promise<void> => {
    try {
      const abs = splitAbsoluteForm(head.target)
      let dest: ProxyTarget
      let path: string
      let authority: string
      if (abs) {
        authority = abs.authority
        dest = parseAuthority(abs.authority)
        path = abs.path
      } else {
        // origin-form（目标直接写路径）：去哪只能看 Host 头
        authority = head.headers.find((l) => /^host:/i.test(l))?.slice(5).trim() ?? ''
        dest = parseAuthority(authority)
        path = head.target
      }
      const use = (await hook?.(dest)) ?? dest
      const remote = await connectTo(use)
      relayUpstream(remote)
      const headers = [`Host: ${authority}`, ...head.headers.filter((l) => !/^host:/i.test(l))]
      remote.write([`${head.method} ${path} HTTP/1.1`, ...headers].join('\r\n') + HEAD_END)
      if (body.length > 0) remote.write(body)
    } catch (e) {
      // 连不上/发不出：按惯例回 502，让客户端知道这一跳断了
      client.write(`HTTP/1.1 502 Bad Gateway${HEAD_END}`)
      client.end()
      console.error(`[http-proxy] 转发失败：${(e as Error).message}`)
    } finally {
      busy = false
      pump()
    }
  }
```

两处值得指认。`headers` 那行先放重建的 Host、再滤掉收到的所有 Host——一条进一条出，正是 2.3.2 那条 RFC 要求的落点（测试里客户端故意发 `Host: wrong.example`，断言目标收到的是重建值）。`relayUpstream` 里响应方向一个字节都不解析——所以代理不需要懂响应的边界，收多少转多少。

### 2.4.4 开隧道：应答 200，闭眼搬运

```ts
// src/http-proxy.ts · openTunnel
  // CONNECT：拨通目标、应答 2xx，从此这条连接对代理只是一根管道
  const openTunnel = async (head: RequestHead, early: Buffer): Promise<void> => {
    try {
      if (!head.target.includes(':')) throw new Error('CONNECT 必须写明端口（RFC 9110：无默认端口）')
      const requested = parseAuthority(head.target)
      const use = (await hook?.(requested)) ?? requested
      const remote = await connectTo(use)
      relayUpstream(remote)
      client.write(`HTTP/1.1 200 Connection Established${HEAD_END}`) // 2xx = 隧道即刻开通
      if (early.length > 0) remote.write(early) // 头后面紧跟的字节：TLS 握手可能已经开始
      tunnel = true
    } catch (e) {
      // 连不上目标：不开隧道，回 502（RFC 只要求「非 2xx」）
      client.write(`HTTP/1.1 502 Bad Gateway${HEAD_END}`)
      client.end()
      console.error(`[http-proxy] 隧道开不起来：${(e as Error).message}`)
    } finally {
      busy = false
      pump()
    }
  }
```

结构比明文路径还简单：拨号、应答、置 `tunnel = true`，完事。`early` 是紧跟在 CONNECT 头之后收到的字节——守规矩的客户端会等 2xx 应答再开下一幕（TLS 握手），但万一有客户端没等应答就抢先说了下一句，这批先到的字节也不能丢。`tunnel` 一置位，`pump` 永久退场，数据入口只剩 `upstream.write(chunk)`：上一章那台「听不懂规矩」的回声服务器，在这一态里反而是唯一正确的形态。

两处教学简化登记进差异清单附录。其一，目标缺端口时教学版统一回 502——RFC 9110 建议的口径是 400，这里少分一种回话。其二，本章代理不实现认证；真代理可要求先交 Proxy-Authorization 凭据才办事。

### 2.4.5 开机：startHttpProxy

```ts
// src/http-proxy.ts · startHttpProxy
export function startHttpProxy(opts: HttpProxyOptions): Promise<HttpProxyHandle> {
  return new Promise((resolve, reject) => {
    const sockets = new Set<net.Socket>()
    const server = net.createServer((client) => {
      sockets.add(client)
      client.on('close', () => sockets.delete(client))
      handleClient(client, opts.connectTarget)
    })
    server.once('error', reject)
    server.listen(opts.port, opts.host ?? '127.0.0.1', () => {
      resolve({
        port: (server.address() as net.AddressInfo).port,
        close: () => {
          for (const s of sockets) s.destroy() // 先拆连接，close 才不必等它们自然结束
          return new Promise((res) => server.close(() => res()))
        },
      })
    })
  })
}
```

每条连接交给一个 `handleClient`（第 1 章见过的模式：一个回调一条连接）。`sockets` 集合是为了 `close()` 能干脆收摊——测试每个用例都靠它善后。整机就这些：两百行上下，两种说法都听得懂了。

## 2.5 验证：亲手开机

两个动作，各带一次「先猜后跑」。

**开机。** 进 `companion/` 跑 `npm run demo:http-proxy`。应看到输出的关键三行：目标站端口、代理端口，和一条拼好的 curl 命令。全部角色照旧住在回环地址上，实验不出你这台机器。curl——命令行里的最简浏览器：给它一个网址，它替你发一次 HTTP 请求，把响应打在终端上；`-x` 的意思是「请经这个代理走」。

**先猜后跑（请求行长什么样）。** 跑之前先写下预言：curl 经代理发出的请求行，目标写的是完整 URL 还是路径？然后照屏幕上那条命令原样跑（带 `-v`），在 `>` 开头的行里找答案。应看到 `> GET http://127.0.0.1:{目标端口}/ HTTP/1.1`——正是 2.3.2 说的绝对地址形式，亲眼所见。响应正文随后就到：

```text
<html><body><h1>hello via proxy</h1></body></html>
```

**先猜后跑（边界不是摆设）。** 打开 `tests/http-proxy.test.ts` 的「正文边界」用例，看它的关键四行：

```ts
// tests/http-proxy.test.ts · 正文边界用例
    client.write(`POST http://127.0.0.1:${target.port}/echo HTTP/1.1\r\nHost: 127.0.0.1:${target.port}\r\nContent-Length: 10\r\n\r\n`)
    client.write('123456789') // 正文先到 9 个字节
    await settle()
    expect(seen).toHaveLength(0) // 没攒齐：连目标都还没去连
```

先猜：把 `Content-Length: 10` 改成 `9`，再跑 `npm test`，这条用例的哪一行断言会红？写下答案再跑验证。预期变红的是 `expect(seen).toHaveLength(0)`——长度规矩一改，攒 9 个字节就「够数」了，代理提前动身，`seen` 里从此有记录。改完记得改回来。不改的话，六条用例应当全绿。

## 2.6 收束：两种说法，一台机器

回到开头那个证书错误。现在你能亲口讲完它的因果：你的明文代理在等一个带域名的请求行，而 https 站点在加密通道建成前不会发那样的行——它先说 `CONNECT a.com:443`。本章写出的 `openTunnel` 听得懂这句：拨通、应答 200、置 `tunnel = true`，从此闭眼搬运。证书没有错过，错的只是当时还没人接电话。明文改写与 CONNECT 隧道，两种说法一台机器全接住了。

你手里现在有了第一块真正的零件：`startHttpProxy`——识别 absolute-form 并改写转发，CONNECT 应答后双向透传成隧道，`connectTarget` 钩子给将来的分流决策留了口。概念去向地图：

- HTTP 入口的边界：它只听得懂 HTTP 的两种说法，别的协议一概不认——通用的 SOCKS5 入口，下一章（第 3 章）；
- 隧道那头的搬运：现在目标就在本机直连，两跳链路、中继、帧这三个词，第 4 章逐个当主角；
- 这条链路为什么还不能裸奔上线，第二部分算账。

### 自查

1. 预测：把 2.5 的 curl 命令去掉 `-x`（直连目标站）再跑一次，`>` 开头的请求行会变成什么样？哪个头部两次的值一样？
2. 推理：明文路径里代理必须重建 Host、不照抄收到的；隧道路径里它连一个字节都不看。两种态度各自的理由是什么？
3. 迁移：客户端把「头部 + 正文 + 下一条请求的开头几个字节」一次 write 全发过来，`pump` 靠什么把三段各归各位？

::: details 参考答案与锚点
1. 直连时目标写路径：`GET / HTTP/1.1`（origin-form）——直连已知道去哪，无需全名；走代理时才是完整 URL（absolute-form）。`Host` 两次的值一样，都写目标站门牌（回查 2.3.2）。
2. 明文路径里，代理是转发 HTTP 信件的当事人，收到的 Host 可能与请求行目标不一致（本章测试故意发 `wrong.example` 验证），RFC 9112 要求按请求行重建，防止错投。隧道路径里，代理不是 HTTP 通信的当事人，管道里走的也不是 HTTP——HTTP 头部全在密文里，根本没有 Host 可看（回查 2.3.3 与 2.4.4）。
3. 头部靠第一处空行（`\r\n\r\n`）切出；正文按 Content-Length 数够切出；剩下的字节留在 `buffered`，`pending` 归零后回到攒头部状态等下一轮——两条边界规矩加一点剩余（回查 2.4.2 的 `pump`）。
:::
