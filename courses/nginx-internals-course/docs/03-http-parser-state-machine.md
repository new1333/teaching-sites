---
title: HTTP 解析状态机：半个请求也能接
---

# HTTP 解析状态机：半个请求也能接

上线一周后，日志里出现了一种幽灵般的 400：一天几十条，时间不规律，抓不到现场。你最终靠全量抓包逮到了它——同一个请求，负载均衡转发时分两次发出去，内核把它切成 `GET /ab` 和 `c HTTP/1.1\r\nHost:...` 两段。你的解析代码每次收到数据就当「一个完整请求」处理，第一段 `GET /ab` 不是一个合法请求行，400 就这么出去了。网络没有坏，坏的是你的假设：你以为数据是「一个一个请求」到的，其实不是。

更阴险的版本还有慢速攻击（业界绰号 Slowloris）。攻击者开几百条连接，每条连接每隔几秒发一个字节：`G`……`E`……`T`……攒到天荒地老。如果你的做法是「把字节攒起来，等攒齐一个完整请求再解析」，那你就是在给每个连接无限期出租内存，攒多少你收多少，直到服务器内存见底。攒包的写法不只是偶发 400 的原因，还是一个安全洞。

这一章给 tinysrv 装上真正认字的器官：一个喂多少、消化多少的解析状态机——nginx 里干这活的模块叫 HTTP 解析器，是整个服务器里被反复打磨最深的一块。

## 先看清原料：裸报文长什么样

写业务代码时，HTTP 是 `fetch` 返回的对象；现在得看它的原貌。一个请求去掉所有包装，就是一段这样的文本：

```text
GET /index.html HTTP/1.1\r\n
Host: example.com\r\n
User-Agent: tinysrv-test\r\n
\r\n
```

第一行是请求行：方法（GET）、路径（/index.html）、版本（HTTP/1.1），空格隔开。之后每一行是一个头部：名字、冒号、值。最后是一个空行——它不是排版，是协议里的句号：空行之前是头部，空行之后（如果有）才是请求体。每行结尾的 `\r\n` 是回车加换行两个字符，HTTP 用它当行界。

你现在知道「完整的请求」长什么样了。问题在于：它到达你的服务器时，不长这样。

## 字节流：水管里的水，从来不分杯

第 2 章里连接发来的是一段段字节。关键认知是：**网络传的是字节流，不是报文**。TCP 协议保证字节按序、不丢，但它不保证「发送方一次 write 的内容，接收方一次读到」。中间隔着内核缓冲区、网卡、路由器，数据像水管里的水，一股一股涌出来——一股和一次 write 之间，没有对应关系。

于是有三种到货形态，全都合法且日常：

- **半包**——一次 write 的内容分几次到，`GET /ab` 先到，`c HTTP/1.1` 后到。负载均衡、大请求、网络波动都会造成；
- **粘包**——发送方连发两个请求，接收方一次读到了两个粘在一起的；
- 切在最要命的位置——`\r\n` 的 `\r` 在上一片末尾，`\n` 在下一片开头。行界符本身被劈成两半。

「攒齐了再解析」这条路，除了前述的内存出租问题，还有一个延迟账：攒齐之前你什么都不能做，而「攒齐」的判定本身就需要解析。唯一的出路是反过来：**来多少字节，处理多少字节，处理不了的记下来等下一段**。而「记下来等下一段」需要你随时知道「读到哪儿了」——这就引出了本章的主角。

## 状态机：读到哪儿了，下一步看什么

状态机（state machine）就是那张「读到哪儿了」的地图：一张有限的格子（状态），每读一段内容，按当前格子和内容决定跳到哪个格子，到了特定格子就宣布一件事。锚点很日常：你逐字读「小明打电话给小红」这句话时，读到「打电话」就知道接下来该是人名——你脑子里始终有一个「读到哪儿了、下一个该是什么」的记号，那就是状态机。

我们的解析器只需要三个格子：

```text
（连接建立）
   │ 收到第一行（请求行合法）
   ▼
┌──────────┐   收到「名字: 值」行    ┌──────────┐
│ 请求行中  │ ──────────────────▶ │ 头部行中  │
│  (line)  │                      │ (headers)│──┐
└──────────┘                      └──────────┘  │ 收到空行
   ▲                                  │  ▲       │ 宣布「一个请求完整」
   └──────────────────────────────────┘  └───────┘ 回到 line，等下一个请求

任何格子遇到非法输入 → broken（闭嘴，连接该关了）
```

跟着演算一遍最狠的场景——逐字节喂入。状态在 `line`，手里攒着一个字符串 `pending`：

- 来了 `G`：找不到 `\r\n`，攒着；
- ……攒到第 17 字节，`pending` 是 `GET /index.html `（注意末尾空格还在等版本号），状态仍是 `line`；
- 下一个字节流来 `H`，再一个个来 `T`、`T`、`P`……直到某个时刻 `pending` 里出现了第一个 `\r\n`——切出完整请求行 `GET /index.html HTTP/1.1`，三段合法，记下方法/路径/版本，状态跳到 `headers`；
- 之后每切出一行 `Host: example.com` 就存进头部表，直到切出一个空行——宣布事件「一个请求完整了」，状态跳回 `line`，`pending` 清零等下一个。

整个过程没有任何一步需要「等数据到齐」。每来一片字节，状态要么前进、要么原地攒着——这就是「来多少消化多少」。

## 动手：createHttpParser

先看对外承诺。`feed` 喂一片字节，返回这片字节「催熟」出的事件——零个、一个或多个（粘包时一次吐俩）：

```ts
// src/http-parser.ts · 类型面
export interface RequestHead {
  method: string
  path: string
  version: string
  headers: Record<string, string> // 键统一小写：HTTP 头部名大小写不敏感
}

export type ParseEvent =
  | { type: 'request'; head: RequestHead }
  | { type: 'error'; reason: ParseErrorReason }
```

实现全貌。核心是三样东西的配合：跨次 `feed` 存活的 `pending` 缓冲、`state` 变量、以及那个外层 `for(;;)` 循环——它让一次 `feed` 能连续切出多行（粘包时一口气消化完）：

```ts
// src/http-parser.ts · createHttpParser
export function createHttpParser(opts: ParserOptions = {}): HttpParser {
  const maxLineBytes = opts.maxLineBytes ?? 8 * 1024
  const decoder = new TextDecoder('latin1') // 逐字节映射，任意字节都不会解码失败

  // 三种状态：line（读请求行）→ headers（读头部行）→ 回到 line 等下一个请求
  // broken：出过错，永不再产出——连接应该关闭
  let state: 'line' | 'headers' | 'broken' = 'line'
  let pending = '' // 跨次 feed 存活的未完成行（可能停在任何字节处，包括 \r\n 的中间）
  let head: RequestHead | null = null

  function fail(events: ParseEvent[], reason: ParseErrorReason): void {
    events.push({ type: 'error', reason })
    state = 'broken'
  }

  return {
    feed(bytes) {
      const events: ParseEvent[] = []
      if (state === 'broken') return events

      pending += decoder.decode(bytes)

      for (;;) {
        const idx = pending.indexOf('\r\n')
        if (idx === -1) {
          // 手里没有完整行。若未完成部分已超上限，说明对端在灌一行无限长的东西
          if (pending.length > maxLineBytes) fail(events, 'line-too-long')
          break
        }
        const line = pending.slice(0, idx)
        pending = pending.slice(idx + 2)

        if (line.length > maxLineBytes) {
          fail(events, 'line-too-long')
          break
        }

        if (state === 'line') {
          const parts = line.split(' ')
          if (parts.length !== 3 || !parts[2].startsWith('HTTP/')) {
            fail(events, 'bad-request-line')
            break
          }
          head = { method: parts[0], path: parts[1], version: parts[2], headers: {} }
          state = 'headers'
        } else {
          // state === 'headers'
          if (line === '') {
            // 空行 = 头部结束，请求完整了
            events.push({ type: 'request', head: head as RequestHead })
            head = null
            state = 'line' // 回到起点，等同一个连接上的下一个请求（keep-alive 的地基）
          } else {
            const colon = line.indexOf(':')
            if (colon <= 0) {
              fail(events, 'bad-header')
              break
            }
            const name = line.slice(0, colon).trim().toLowerCase()
            const value = line.slice(colon + 1).trim()
            ;(head as RequestHead).headers[name] = value
          }
        }
      }
      return events
    },
  }
}
```

四个值得停留的决策。

**pending 活在 feed 之外。** 它是闭包变量，不是 `feed` 的局部变量——半包的记忆必须跨调用存活。切在 `\r\n` 中间的情况也不需要任何特判：`\r` 留在 pending 尾部，下一片字节拼上来，`indexOf('\r\n')` 自然找得到。

**broken 之后就闭嘴。** 出过错的连接已经不可信任（你不知道它嘴里含着哪半句话），继续解析只会在垃圾里捞结论。`broken` 状态下 `feed` 直接返回空数组，把「关连接」的决定权交给上层。

**maxLineBytes 就是慢速攻击的解药。** 攒行不再是无限出租内存：一行攒到 8 KB 还没等到换行，判 `line-too-long`，连接出局。攻击者想用几百条慢连接拖着你的内存，现在每条最多只能赖 8 KB。前面那个安全洞，补上了。

**解析完跳回 line，而不是「结束」。** 状态机没有终点格——请求解析完回到起点，`pending` 里剩下的字节（粘包里第二个请求的开头）自动成为下一轮的原料。同一个连接顺序说多件事，这件事的语法地基在这里就打好了，下一章讲 keep-alive 时直接站上来。

## 验证

进 `companion/` 跑 `pnpm test`：

```text
✓ tests/http-parser-state-machine.test.ts (10 tests) 6ms
✓ tests/connection-registry.test.ts (7 tests) 237ms
Test Files  2 passed (2)
     Tests  17 passed (17)
```

本章新增的 10 个断言里，最承重的是那组「切法一致性」：同一个请求，分别按整块、每 3 字节、每 7 字节、逐字节四种切法喂入，产出的请求头完全一致——半包在它面前不存在了。粘包用例一次喂两个完整请求，拿到两个按序事件；畸形输入（坏请求行、坏头部、超长行）各自拿到结构化错误而非崩溃；出错后的 parser 喂什么都不再产出。第 2 章的 7 个测试原样全绿——新器官没有伤到旧地基。

## 读完本章，你该能回答

- 半包和粘包各是什么？为什么说它们不是网络故障，而是字节流的常态？
- 「攒齐了再解析」有哪两笔死账？慢速攻击（Slowloris）利用的是哪一笔？
- 解析器的三个状态各负责什么？空行为什么是一个事件而不是排版？
- pending 为什么必须是跨 feed 存活的？maxLineBytes 堵住的是什么洞？

现在 tinysrv 有账本、有认字的器官——但每来一个请求还要重新拨一次号。下一章：让一条连接说完一件事不挂电话，接着说下一件。
