---
title: 'SOCKS5：把目标地址装进二进制握手'
---

# SOCKS5：把目标地址装进二进制握手

## 换一种入口协议

上一章实现的 HTTP 正向代理靠文本请求行和请求头传递目标地址，人眼就能读懂。这一章实现第二种入口协议 SOCKS5，它完全不用文本，靠一套定长加变长字段拼成的二进制帧来交待"要连去哪"。两种协议服务的是同一个入口阶段，但携带信息的方式完全不同，这一章会把这种差异一路拆到字节上。

## 客户端只写了 10 个字节，服务端却要先回答一句

用最简单的方式复现一次 SOCKS5 握手：客户端连上服务端之后，先写下这样一段字节（用十六进制表示）：

```
05 01 00
```

只有 3 个字节。服务端读完之后，会先回一句话，再等客户端发第二段数据，客户端才会补上目标地址，通常又是十几个字节。如果客户端图省事，把这两段拼在一起用一次 `socket.write` 发出去，数据总长可能刚好 10 字节左右。服务端这一次 `data` 事件收到的，未必是完整的 10 个字节。网络传输可能把它拆成两次、三次，甚至一字节一字节地到达。“一次 `data` 事件正好等于一条 SOCKS5 消息”这个直觉,在真实网络里并不成立,这正是本章要处理的第二个问题。

## 方法协商：先谈好怎么证明身份

SOCKS5 协议定义在 [RFC 1928](https://www.rfc-editor.org/rfc/rfc1928.html) 里。连接建立后的第一步叫**方法协商**（method negotiation）：客户端先列出自己支持的认证方法，服务端从中选一种双方都能接受的方法。握手的第一段（greeting）格式是：

| 字段 | 长度 | 含义 |
| --- | --- | --- |
| VER | 1 字节 | 协议版本，固定 `0x05` |
| NMETHODS | 1 字节 | 后面 METHODS 字段有几个字节 |
| METHODS | NMETHODS 字节 | 客户端支持的认证方法编号列表 |

`05 01 00` 翻译过来就是：版本 5，接下来有 1 个方法，这个方法是 `0x00`（NO AUTH，不需要认证）。服务端选定一个方法后回 2 字节：版本号加选中的方法编号。

| 服务端选择 | 返回字节 | 后续动作 |
| --- | --- | --- |
| 接受 NO AUTH | `05 00` | 客户端继续发送命令请求 |
| 没有可接受方法 | `05 FF` | RFC 1928 要求客户端关闭连接；mini-proxy 服务端也主动 `end()` |

这里要澄清一个常见误解。**SOCKS5 本身不是加密协议**。方法协商决定的是“用什么方式证明身份”，不涉及后续数据是否加密。本课程的 mini-proxy 只实现最简单的 `NO_AUTH`，即完全不做身份验证。服务端额外主动结束 `05 FF` 连接是课程实现选择，不能改写成 RFC 对服务端的强制要求。

服务端读握手的逻辑很直白：

```ts
// src/socks5-server.ts · handleConnection（握手片段）
    let greeting: { version: number; methods: Buffer }
    try {
      const version = (await reader.readExact(1)).readUInt8(0)
      const nmethods = (await reader.readExact(1)).readUInt8(0)
      const methods = await reader.readExact(nmethods)
      greeting = { version, methods }
    } catch {
      socket.destroy()
      return
    }
```

注意这里连续调用了三次 `readExact`，第二次读到的 `nmethods` 决定了第三次要读多少字节。第 2 章代码里出现过、但一直没展开的 `SocketReader`，这一章才正式拆开：它会在内部缓冲数据，直到攒够指定字节数才把 `Promise` 兑现，不管这些字节是一次到达还是被拆成很多次到达。这就是解决“一次 `data` 事件不等于一条消息”的关键——把“攒够 N 字节再继续”从每个协议处理函数里抽出来，做成可复用读取器。

## 地址类型：三种写法共用一套帧结构

方法协商通过之后，客户端发第二段请求，格式是：

| 字段 | 长度 | 含义 |
| --- | --- | --- |
| VER | 1 字节 | 固定 `0x05` |
| CMD | 1 字节 | 命令：`0x01` CONNECT，`0x02` BIND，`0x03` UDP ASSOCIATE |
| RSV | 1 字节 | 保留字段，恒为 `0x00` |
| ATYP | 1 字节 | **地址类型**：`0x01` IPv4，`0x03` 域名，`0x04` IPv6 |
| DST.ADDR | 变长 | 目标地址，长度和格式由 ATYP 决定 |
| DST.PORT | 2 字节 | 目标端口，大端序 |

**地址类型**（ATYP）这个字段决定了 `DST.ADDR` 该怎么解释：IPv4 固定 4 字节；域名先有 1 字节长度前缀，再跟对应长度的字符串；IPv6 固定 16 字节。三种类型共用同一套读取思路：先读地址帧头，再按类型读定长或变长数据。

```ts
// src/socks5-wire.ts · encodeAddress
export function encodeAddress(target: TargetAddress): Buffer {
  if (target.kind === 'ipv4') {
    return Buffer.concat([Buffer.from([ATYP.IPV4]), ipv4ToBytes(target.host), portBytes(target.port)])
  }
  if (target.kind === 'ipv6') {
    return Buffer.concat([Buffer.from([ATYP.IPV6]), ipv6ToBytes(target.host), portBytes(target.port)])
  }
  const hostBuf = Buffer.from(target.host, 'utf8')
  return Buffer.concat([Buffer.from([ATYP.DOMAIN, hostBuf.length]), hostBuf, portBytes(target.port)])
}
```

解码方向的 `readAddressFrame` 反过来做同样的事。它同样借助上一节的 `SocketReader`，逐字段调用 `readExact`，不关心这些字节实际是怎么到达的。

```ts
// src/socks5-wire.ts · readAddressFrame
export async function readAddressFrame(reader: SocketReader): Promise<ReadAddressOutcome> {
  const atypBuf = await reader.readExact(1)
  const atyp = atypBuf.readUInt8(0)
  if (atyp === ATYP.IPV4) {
    const addr = await reader.readExact(4)
    const portBuf = await reader.readExact(2)
    const host = `${addr.readUInt8(0)}.${addr.readUInt8(1)}.${addr.readUInt8(2)}.${addr.readUInt8(3)}`
    return { ok: true, target: { kind: 'ipv4', host, port: portBuf.readUInt16BE(0) } }
  }
  if (atyp === ATYP.DOMAIN) {
    const lenBuf = await reader.readExact(1)
    const len = lenBuf.readUInt8(0)
    const hostBuf = await reader.readExact(len)
    const portBuf = await reader.readExact(2)
    return { ok: true, target: { kind: 'domain', host: hostBuf.toString('utf8'), port: portBuf.readUInt16BE(0) } }
  }
  if (atyp === ATYP.IPV6) {
    const addr = await reader.readExact(16)
    const portBuf = await reader.readExact(2)
    return { ok: true, target: { kind: 'ipv6', host: bytesToIPv6(addr), port: portBuf.readUInt16BE(0) } }
  }
  return { ok: false, reason: 'address-type-not-supported' }
}
```

拨号成功后，服务端要回一个完整响应帧：

| VER | REP | RSV | BND.ATYP + BND.ADDR | BND.PORT |
| --- | --- | --- | --- | --- |
| `0x05` | 1 字节响应码 | `0x00` | 代理实际绑定地址 | 2 字节大端端口 |

响应码里最常用的是 `0x00`（SUCCEEDED）。本课程的 mini-proxy 只实现 `CONNECT` 命令。如果客户端请求 `BIND` 或 `UDP ASSOCIATE`，服务端会回 `0x07`（COMMAND_NOT_SUPPORTED）再关闭连接，这正是 RFC 1928 规定的响应方式。这也戳破了另一个误解。**遇到不支持的命令，直接断开连接不算正确实现**。服务端要先回明确响应码，让客户端知道“这不是网络故障，是命令不被支持”，再结束本次会话。

## 动手验证：握手被拆成一字节一字节，还能成功吗

`tests/03-socks5-server.test.ts` 里有一个专门的用例，把整段握手和请求拆成一字节一字节地发送（每次只写 1 字节，让出一次事件循环再写下一个字节），模拟最极端的 TCP 分片情况。运行之前先猜一下：

1. 如果 `readExact` 没有内部缓冲、每次都直接读 socket 当前收到的数据，逐字节发送的握手会不会解析出错误的字段？
2. 服务端最终返回的响应码，会不会因为分片方式不同而不一样？

运行命令：

```bash
cd courses/proxy-software-course/companion
pnpm vitest run tests/03-socks5-server.test.ts
```

预期 7 个用例全部通过。其中"握手与请求被拆成逐字节分片依然能完成 CONNECT"这一条直接回答了第一个问题。因为 `readExact`/`readUntil` 会持续缓冲直到攒够字节数，不管数据是一次到达还是被拆成任意分片，最终解析出来的字段完全一致，响应码也和不分片时相同。分片方式不影响结果,这也证明了"读到分隔符或定长再继续"的读取器设计确实解决了协议边界问题。

再看一个反例变体："客户端不提供 NO AUTH 时回 NO_ACCEPTABLE 并关闭连接"这条用例，客户端握手时只声明支持 `0x02`（GSSAPI），服务端不认识这个方法。预期响应是 `05 FF`，随后连接关闭。这验证了方法协商真的在做选择，而不是无条件接受任何客户端。

## 自查：换一种字段推一遍

<details>
<summary>ATYP 是未定义的值时会怎样</summary>

假设客户端在请求帧里把 ATYP 写成 `0x02`，RFC 1928 没有定义这个值。服务端应该如何响应？对照本章代码，`readAddressFrame` 遇到不认识的 ATYP 时返回什么？

<details>
<summary>参考答案</summary>

`readAddressFrame` 的三个 `if` 分支只认 `0x01`、`0x03`、`0x04`，遇到其他值会落到最后一行 `return { ok: false, reason: 'address-type-not-supported' }`。调用方（`socks5-server.ts`）看到这个结果后，会回一个 `ADDRESS_TYPE_NOT_SUPPORTED`（`0x08`）响应码并关闭连接，而不是尝试猜测这个未知类型该怎么解析。这和"命令不支持先回响应码再关闭"是同一种设计取向：遇到不认识的字段，明确拒绝，不去做危险的猜测。
</details>
</details>

<details>
<summary>域名长度前缀和实际内容不匹配会怎样</summary>

如果客户端发送的域名帧长度前缀写的是 10，但实际只发了 5 个字节的域名内容就断开了连接，`readAddressFrame` 会返回结果，还是一直挂起？

<details>
<summary>参考答案</summary>

会挂起等待，直到 `SocketReader` 收到连接关闭事件。`readExact(len)` 在攒够 `len` 字节之前不会 resolve；一旦 socket 触发 `end` 或 `close`，`SocketReader` 内部的 `terminated` 会被置位，所有等待中的读取都会被 reject，`handleConnection` 里对应的 `try/catch` 会捕获这个错误并调用 `socket.destroy()`，不会无限期挂起整个进程。
</details>
</details>

## 回到开头的握手

现在可以确认开头那个疑问了。客户端确实可能一次性把握手和请求拼在一起发送，但服务端能否正确解析，靠的不是"一次 `data` 事件刚好对齐一条消息"这种运气。真正起作用的是 `SocketReader`：它按照协议里明确定义的每个字段长度，主动攒够字节数再继续，不管数据实际被拆成了几次到达。方法协商、地址类型、握手分片这三块拼在一起，就是这一章实现的 SOCKS5 入口。

这一章和上一章分别实现了两种入口协议，但它们最后一步都是同一件事：把已经建立好的目标连接和客户端连接接起来，做双向转发。下一章会把这一步的细节补上，解释为什么不能简单地"收到数据就转发"。
