---
title: 出站适配器：直连、拒绝与再套一层 SOCKS5
---

# 出站适配器：直连、拒绝与再套一层 SOCKS5

## 前情：入口和路由已经就绪，还差最后一步

第 2、3 章实现了两种入口协议，第 5、6 章实现了路由决策，`planRoute` 现在能吐出一个明确的 `dialTarget`：该拿什么地址去连接目标。但这两章都没有写"真正发起连接"这一步，本章要补上出站阶段。同时要兑现两句留下的话：第 3 章说 SOCKS5 地址帧的编解码"服务端与客户端共用"，第 6 章说 preserve-domain 命中 `PROXY` 时"域名原样交给出站阶段"。这两句话都要在这一章变成真正能跑的代码。

## 每加一个节点类型，就多一处 if/else

假设最初的实现直接把出站逻辑写在入口处理函数里：如果规则决策是 `DIRECT`，就在 HTTP 处理函数里写一段连接目标的代码；如果是 `REJECT`，就写一段返回错误的代码；后来要支持"转发到另一个 SOCKS5 代理"，又在同一个函数里堆 if/else，加一段建立上游连接、发 SOCKS5 握手的代码。SOCKS5 入口处理函数里也要照抄一遍这三段逻辑，因为它也需要同样的三种出站方式——两套代码渐渐各写各的。

维护一段时间后问题开始暴露：两处入口的 `if/else` 分支慢慢不一致，错误响应也开始漂移，一处的措辞被改了，另一处忘了同步；新增一种出站方式，需要同时改两个入口函数,而不是改一个地方。这种"入口协议和出站方式绑死在一起改"的写法，本章要拆开。

## 出站适配器：把三种连接方式统一成一个函数签名

**出站适配器**（outbound adapter）指的是一个统一接口：不管背后是直连、拒绝还是连接另一个代理，对调用方来说都是同一个函数签名，传入目标地址，返回连接结果。`Dialer` 是本课程自有的接口设计，不是 SOCKS5 或其他标准里的协议字段。companion 里这个契约叫 `Dialer`：

```ts
// src/types.ts · Dialer 与 DialOutcome
export type DialOutcome = { readonly ok: true; readonly result: DialResult } | { readonly ok: false; readonly reason: string }

/** 出站适配器统一接口：不管 DIRECT/REJECT/SOCKS5，上层只认这一个函数签名。 */
export type Dialer = (target: TargetAddress) => Promise<DialOutcome>
```

有了这个统一签名，入口处理函数只需要认识 `Dialer` 这一个类型，完全不需要知道背后连的是哪种目标——这直接推翻了第一个误解：**入口协议并不决定出站协议**。一个 HTTP CONNECT 请求，完全可能被路由到走 SOCKS5 上游代理；一个 SOCKS5 CONNECT 请求，也完全可能被路由到直连。两者是路由决策独立选出来的，跟客户端用什么协议连的代理毫无关系。

## DIRECT 和 REJECT：一个真连，一个假装连了就拒绝

`DIRECT` 出站很直接：拿到目标地址，直接发起一次 TCP 连接。

```ts
// src/dialers.ts · createDirectDialer
export function createDirectDialer(): Dialer {
  return async (target: TargetAddress): Promise<DialOutcome> => {
    try {
      const socket = await connectTcp(target.host, target.port)
      return { ok: true, result: { socket } }
    } catch (err) {
      return { ok: false, reason: `direct dial failed: ${errorMessage(err)}` }
    }
  }
}
```

`REJECT` 出站则完全相反：

```ts
// src/dialers.ts · createRejectDialer
export function createRejectDialer(): Dialer {
  return (): Promise<DialOutcome> => Promise.resolve({ ok: false, reason: 'rejected by rule' })
}
```

这里能戳穿第二个误解：**`REJECT` 不是一次失败的 `DIRECT` 拨号**。它甚至不发起任何网络操作，函数体里没有 `connectTcp`、没有 `socket`，直接返回一个失败结果。这个区别在排障时很重要：如果代理返回"连接拒绝"，`DIRECT` 拨号失败通常意味着目标网络不可达（可能超时，也可能连接被目标方拒绝）。`REJECT` 出站则意味着本地规则主动决定不让这条连接建立。两者的失败原因字符串也不一样（`direct dial failed: ...` 对比 `rejected by rule`），上一章 SOCKS5 服务端就是靠这个字符串区分，返回不同的响应码。

## SOCKS5 上游客户端：把服务端逻辑反过来做一遍

`PROXY` 出站要连接另一个 SOCKS5 代理，充当这台上游代理的客户端。这正是第 3 章埋下的伏笔：地址帧编解码函数（`encodeAddress`、`readAddressFrame`）当时就是按“服务端和客户端都要用”设计的，现在轮到客户端这一侧登场。流程按 [RFC 1928](https://www.rfc-editor.org/rfc/rfc1928.html) 与服务端握手镜像对应：先做方法协商，再发 CONNECT 请求，最后读完整响应。

```ts
// src/dialers.ts · createSocks5Dialer（握手片段）
    try {
      socket.write(Buffer.from([SOCKS5_VERSION, 1, METHOD.NO_AUTH]))
      const methodReply = await reader.readExact(2)
      if (methodReply.readUInt8(0) !== SOCKS5_VERSION || methodReply.readUInt8(1) !== METHOD.NO_AUTH) {
        return fail('socks5 upstream did not accept NO AUTH method')
      }

      const requestHeader = Buffer.from([SOCKS5_VERSION, CMD.CONNECT, 0x00])
      socket.write(Buffer.concat([requestHeader, encodeAddress(target)]))
```

这里的 `encodeAddress(target)` 直接决定了第 6 章那句承诺怎么落地。如果 `target` 是一个未解析的域名（`preserve-domain` 策略下 `PROXY` 决策没有做任何解析），`encodeAddress` 会按照 ATYP `0x03`（域名）编码，把域名字符串原样放进请求帧发给上游。上游 SOCKS5 代理收到的是完整域名，不是本地代理擅自解析出的某个 IP，域名信息没有在中途丢失或换成别的东西。

读响应这一步藏着第三个误解，也是最容易被跳过的一步。

```ts
// src/dialers.ts · createSocks5Dialer（读响应片段）
      const replyHeader = await reader.readExact(3) // VER REP RSV
      if (replyHeader.readUInt8(0) !== SOCKS5_VERSION) {
        return fail('socks5 upstream sent an invalid reply version')
      }
      const rep = replyHeader.readUInt8(1)
      // 无论成功与否，回复里都带 BND.ADDR/PORT，必须读完才能保证流对齐
      const addrOutcome = await readAddressFrame(reader)
      if (rep !== REPLY.SUCCEEDED) {
        return fail(`socks5 upstream reply code ${rep}`)
      }
```

**代理链**（proxy chain，本地代理不直接连目标，而是把连接请求交给另一台上游代理）这一层的响应帧，不管成功还是失败，都固定带着一个地址帧，也就是 `BND.ADDR` 和 `BND.PORT`。这戳穿了第三个误解：**SOCKS5 上游客户端不能只发送 CONNECT 就不管响应里的地址帧**。即便已经知道 `rep` 不等于 `SUCCEEDED`（连接失败），也必须先把这个地址帧读完。TCP 是字节流，如果响应里还留着没读走的字节，这条连接后续复用或关闭时，残留字节会导致读取位置错位。代码里 `readAddressFrame` 的调用写在判断 `rep` 之前，就是为了保证这个字节对齐步骤不会被跳过，不管成功还是失败都一样。

## 动手验证：让假上游记录收到了什么

`tests/07-outbound-adapters.test.ts` 里有一组测试，会真的起一个本地 SOCKS5 服务端当作"上游"，让它把收到的目标地址记录下来。运行之前先猜一下：如果 `createSocks5Dialer` 收到的目标是一个域名（比如 `my-target.example`），这个"上游"实际收到的地址帧里，会是域名还是这个域名解析出的 IP？

运行命令核对：

```bash
cd courses/proxy-software-course/companion
pnpm vitest run tests/07-outbound-adapters.test.ts
```

预期 8 个用例全部通过。核对"通过真实 SOCKS5 服务端成功建立 CONNECT 隧道并转发数据（域名目标）"这条用例会发现：`seenTargets` 数组里记录的确实是原始域名 `my-target.example`，没有换成任何 IP。这直接证明了域名信息在客户端这一层完整地传给了上游。

再看一个反例变体："上游返回非成功响应码时返回失败原因"这条用例搭了一个手写的假上游，它会故意回一个 `HOST_UNREACHABLE` 响应码，并且照样带上一个哑地址帧（IPv4 `0.0.0.0:0`）。断言确认 `createSocks5Dialer` 会先把这个哑地址帧读完，再返回带响应码的失败原因，不会读到 `rep` 不对就立刻放弃后续读取。如果实现跳过了这一步，同一个假上游的另一个成功场景用例（响应里同样带地址帧）会因为字节错位解析出错误的字段，测试会用明确的失败暴露这个问题。

## 自查：换个角度想一想适配器的边界

<details>
<summary>如果给 REJECT 出站传一个从未见过的目标地址，会报错吗</summary>

`createRejectDialer` 返回的函数完全没有使用参数 `target`。如果调用方传一个格式完全错误的目标（比如端口是负数），`REJECT` 出站会不会因为校验目标格式而抛异常？

<details>
<summary>参考答案</summary>

不会。`createRejectDialer` 返回的函数体只有一行 `Promise.resolve({ ok: false, reason: 'rejected by rule' })`，参数 `target` 根本没有被读取，更谈不上校验。这也是"`REJECT` 不是一次失败的 `DIRECT` 拨号"的另一层含义：它对目标地址完全不敏感。不管目标是什么、合不合法，结果永远是同一个拒绝原因。
</details>
</details>

<details>
<summary>SOCKS5 上游客户端遇到不支持 CONNECT 的目标，会怎样？</summary>

如果上游 SOCKS5 服务端收到 CONNECT 请求后，判断自己不支持这个命令，比如上游本身只支持 BIND，会发生什么？`createSocks5Dialer` 这一侧会怎么处理？

<details>
<summary>参考答案</summary>

上游会按照第 3 章讲过的规范回一个 `COMMAND_NOT_SUPPORTED` 响应码。`createSocks5Dialer` 读到 `rep !== REPLY.SUCCEEDED` 后，会先读完地址帧保证字节对齐，再返回一个包含具体响应码的失败原因（`socks5 upstream reply code 7`），调用方可以从这个字符串里看出失败原因是"命令不被上游支持"，而不是网络层面的连接失败。
</details>
</details>

## 回到开头的 if/else 堆积问题

现在可以回头看开头那个维护问题了：把 `DIRECT`、`REJECT`、`PROXY` 统一成同一个 `Dialer` 签名之后，入口处理函数只需要拿到一个 `Dialer` 就调用它，完全不关心背后连的是哪一种。新增一种出站方式，只需要新写一个满足 `Dialer` 签名的函数，两个入口协议的代码一行都不用改。错误响应的措辞也只需要在一处维护，不会再出现两处慢慢漂移的情况。上一章 SOCKS5 服务端和这一章 SOCKS5 上游客户端共用同一套地址帧编解码，同样是靠这种"统一接口、各自实现"的思路。

路由决定"该怎么处理"，出站决定"具体怎么连"，两者到这里都已经就绪，但配置文件本身还没有被校验过：如果一条 `PROXY` 规则引用的 outbound 名字拼错了，会发生什么？下一章要在真正监听端口之前，把这类错误挡在外面。
