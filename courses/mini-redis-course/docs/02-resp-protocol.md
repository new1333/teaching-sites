---
title: RESP：两个进程怎么对话
---

# RESP：两个进程怎么对话

先对个账：第 1 章把 Redis 拆成三层——键值存储、内存数据库、数据结构服务器，你还记得各自凭什么吗？旁路缓存模式的写路径那段关不上的窗口，最后靠什么兜底？答得上来，地基就还在。那章结尾答应的事现在兑现：亲手写一个解析器，让你自己的服务器第一次听懂 redis-cli 说话。

## redis-cli 连上来，收到一串「乱码」

你给上一章的心愿起了个头：用 Node 的 net 模块开了个 TCP 服务，`socket.on('data')` 里拿到字符串就按空格切，等着解析 `SET a 1` 这样的裸文本。然后 redis-cli 连上来，你把收到的东西打印出来：

```text
*3\r\n$3\r\nSET\r\n$1\r\na\r\n$1\r\n1\r\n
```

星号、美元符、一大堆回车换行——第一反应是乱码。但它规律得可疑：每个「词」前面都顶着 `*` 或 `$`，后面都跟着数字。这不是乱码，是 redis-cli 在说另一种语言，而你的服务器只听得懂裸文本。

第二堵墙更隐蔽。同一条命令，有时一次 data 事件就到齐；有时劈成两截，前半截先到，你按空格切出来的是半句残句。反过来，你一口气发三条命令，它们也可能挤在同一次 data 里一起到达。前者叫半包，后者叫粘包，合称半包与粘包（一条消息分两次到、几条消息挤一次到——不是故障，是 TCP 的本性）。

问题的根子只有一个：TCP 递给你的不是一条条消息，而是一条字节流——一串按序到达、却没有边界的连续字节。「消息」这个概念，TCP 根本不认识。这一章做三件事：读懂那串「乱码」（它叫 RESP）；驯服半包与粘包（靠缓冲，不靠运气）；最后把两者接起来，让服务器真正答上话。

## 那不是乱码，是 RESP

先把 `\r\n` 说清楚：它是两个真实字符——回车加换行。下面把开头那串字节逐段拆开：

```text
SET a 1 在网络上实际长这样（共 27 字节）：
*3        数组：后面跟着 3 个元素
$3 SET    批量串：接下来 3 个字节是 SET
$1 a      批量串：接下来 1 个字节是 a
$1 1      批量串：接下来 1 个字节是 1
每一段都以 \r\n 收尾
```

这套格式叫 RESP 协议（REdis Serialization Protocol，REdis 串行化协议）——Redis 的客户端与服务端之间约好的对讲机话术。规矩三条：每条消息先亮类型（`+ - : $ *` 五个标记之一），需要时再报长度（内容占几个字节），最后才是内容本身；行尾一律 `\r\n`。你敲的命令出发前被 redis-cli 翻译成这样，服务器的回答也按同样的规矩翻译回来。

### 为什么不就用裸文本

官方给 RESP 立过三条设计目标：好实现、解析快、人眼能读。裸文本行看着也占前两条，为什么还要发明新格式？做个反事实：值本身含有空格或换行怎么办？空格切分立刻翻车，得引入引号和转义；解析器从「读一个数字、拷 n 个字节」退化成「逐字符扫描找分隔符」，内容里出现转义符还得解开。RESP 用前缀长度把这一切整个绕开：读一个数字，闭着眼拷 n 个字节，内容里出现什么都伤不到这一帧。帧，就是按协议规矩打包完整的一条消息——协议术语叫二进制安全（binary-safe）。锚点：对讲机的回令——先报「收到」（类型），再报「内容多长」（长度），再报内容；双方从不需要在内容里找暗号。

### 五种类型，一张表认全

RESP2 一共五种类型，首字节定型。先上表混个脸熟，下面逐个过：

| 首字节 | 类型 | 长相 | 本章用在哪 |
| --- | --- | --- | --- |
| `+` | 简单串 | `+OK\r\n` | 短状态回话：OK、PONG |
| `-` | 错误 | `-ERR ...\r\n` | 出错：错误前缀 + 消息 |
| `:` | 整数 | `:3\r\n` | 计数：DEL 删掉了几个键 |
| `$` | 批量串 | `$5\r\nhello\r\n` | 键的值；`$-1\r\n` 表示「没有」 |
| `*` | 数组 | `*2\r\n` + 元素 | 命令本身；集合类应答 |

- 简单串：一行到底的短回话，头戴加号、尾踩 `\r\n`。便宜，但内容里不许出现 `\r` 和 `\n`——装不下就换批量串。
- 错误：长得像简单串，首字节换成减号。客户端见到它该抛异常，而不是当普通字符串。减号后第一个大写词叫错误前缀——`ERR` 是通用错，`WRONGTYPE` 是类型错，客户端扫一眼前缀就知道错的种类。
- 整数：冒号开头、带符号的十进制数。数本身没含义，含义由命令定：DEL 回删了几个，别的命令各有各的解读。
- 批量串：自带长度前缀的字符串，按字节计数，想装什么装什么——值、键名、命令词，全是它。
- 数组：星号后报元素个数，然后依次嵌入任意类型的元素，还能嵌套。你敲的每条命令，redis-cli 都编码成「批量串数组」发上来——所以服务端解码器只需要认这一种形状。

字符串的两种形态合称简单串与批量串（simple string 与 bulk string）：前者是一行到底的短回话，不能含换行；后者带长度前缀，二进制安全。GET 的值为什么必须用批量串回？两个硬理由：值里可能含 `\r\n`，简单串直接非法；「空串」与「不存在的键」必须分得开——`$0\r\n\r\n` 是空串，`$-1\r\n` 是没有。这个 `-1` 是 RESP2 特有的历史包袱：它没有专门的空值类型，只能借长度说「无」（数组的「无」记作 null 数组 `*-1\r\n`，空数组是 `*0\r\n`）。

两处边界事实，防止你以为这就是全部。真 Redis 还收 telnet 手敲的裸文本命令（inline command，内联命令——因为没有任何命令以 `*` 开头，服务端分得清两种口音）；本课实验场只实现 redis-cli 走的数组格式，这是一处登记进差异清单的简化。另外新版文档里还有 RESP3——Redis 6.0 起可经 HELLO 命令协商升级，新增布尔、双精度浮点、映射表等类型；但连接刚建立时默认说的仍是 RESP2，本课全程 RESP2，RESP3 当视野储备。

## 字节流没有边界

现在拆第二堵墙。你八成带着这样的直觉：「我一次 send，对面就一次 recv，两边一帧对一帧。」先替这个直觉说句公道话：日常写 HTTP 时，fetch 一调、完整响应到手，帧的切分被库和协议层层包办了。没写过 socket 的人根本没机会看见「切分」这件事——所以它是个合理的默认，只是恰好不成立。

证伪不用出门：实验场的「半包：切在参数中间的两段」与「极端切法：逐字符喂」两条测试就是干这个的——同一条命令切成任意几段，都是同一个下场。拿三段举例：

```text
第 1 段：'*3\r\n$3\r\nSE'     → 解出 0 条（命令没到齐）
第 2 段：'T\r\n$1\r\na\r\n'   → 还是 0 条（还缺最后一个参数）
第 3 段：'$1\r\n1\r\n'        → 解出 1 条：['SET', 'a', '1']
```

发送方明明只 send 了一次，接收方却看见命令被切成了任意的段；反过来，连着 send 三条，接收方可能一次读到三条半。**TCP 是字节流协议：它承诺字节按序、不丢、不重；它不承诺分段。**切几段、合几段，由两头的内核看着办：一段超过单次能塞进 IP 包的上限（MSS）会被切开；挨得很近的几个小段可能被合并了再发（Nagle 算法干的就是这个）；接收端也可能攒一攒再交给应用。

那 TCP 为什么不干脆把边界也管了，省得大家操心？反事实想一下：「带边界的消息传输」要求协议理解消息——多长算一条、谁定的规矩、应用想只发半条流怎么办。TCP 选的抽象更低一层：一根可靠的字节管道，只保证字节级别的不丢不乱。正因为不管语义，HTTP、RESP 才能各自用最合适的方式定边界：HTTP 靠 Content-Length，RESP 靠长度前缀。锚点：快递按箱签收，每箱一个单号；传送带上连续流过的货没有箱隔板——要认出「一件货」，你得自己在传送带边上加个计长器。RESP 的长度前缀就是这个计长器。

解法的形状自己浮出来了：服务端留一块缓冲，data 事件来了先追加；从缓冲头部试着解析，解析得动就消费，解不动就留着等下一段——**不完整就等，完整才消费**。这就是本章主角 RespDecoder 的全部性格。

## 演练：从编码器到一个能对话的服务器

四步走：先把话说出去（编码），再把话听进来（解码），然后听懂了要会办（命令分发），最后把电话线插上（TCP 挂接）。全部代码都在实验场里，下面的片段与当前形态逐字一致。

### 第一步：应答侧——把话说出去

编码器是五个纯函数，一种 RESP 类型一个：

```ts
// src/resp.ts · encodeSimpleString 起
const CRLF = '\r\n'

// ---- 应答编码：一个函数对应一种 RESP 类型 ----

export function encodeSimpleString(s: string): string {
  // 简单串不能含 \r 和 \n——要装任意内容请用批量串
  return `+${s}${CRLF}`
}

export function encodeError(message: string): string {
  return `-${message}${CRLF}`
}

export function encodeInteger(n: number): string {
  return `:${n}${CRLF}`
}
```

批量串与数组这两个「带长度的」，多一个心眼：

```ts
// src/resp.ts · encodeBulkString 起
export function encodeBulkString(s: string): string {
  // 长度前缀按 UTF-8 字节数计：'你好' 是 2 个字符、6 个字节
  return `$${Buffer.byteLength(s, 'utf8')}${CRLF}${s}${CRLF}`
}

export function encodeNullBulkString(): string {
  // RESP2 没有专门的空值类型：缺失的键用长度 -1 的批量串表示
  return `$-1${CRLF}`
}

export function encodeArrayOfStrings(items: string[]): string {
  return `*${items.length}${CRLF}` + items.map((it) => encodeBulkString(it)).join('')
}
```

`Buffer.byteLength` 那行注释是踩坑点：长度前缀数的是字节，不是字符。`'你好'` 在 JS 字符串里是 2 个字符，编码成 UTF-8 是 6 个字节（UTF-8：把字符编成字节的通用方案，英文字母一字节、常用汉字三字节）。前缀写 2，对面的客户端就只拿 2 个字节当完整值，帧从这一刻起错位。

### 第二步：命令侧——RespDecoder 全貌

解码器是本章的承重墙，全貌如下：

```ts
// src/resp.ts · RespDecoder
export class RespDecoder {
  // 每个连接一份缓冲：TCP 不保证命令按发送切段到达，没到齐的先攒着
  private buf = ''

  feed(chunk: string): string[][] {
    this.buf += chunk
    const commands: string[][] = []
    for (;;) {
      const cmd = this.tryParseCommand()
      if (cmd === null) break // 不完整（半包）：留着等下一段，绝不猜
      commands.push(cmd)
    }
    return commands
  }

  // 尝试从缓冲头部解析一条完整命令；任何一处不完整就返回 null 且不消费缓冲。
  // 用下标 pos 走位而不是边走边切，天然做到「没到齐就当没来过」。
  private tryParseCommand(): string[] | null {
    let pos = 0
    const header = this.lineAt(pos)
    if (header === null) return null
    if (!/^\*\d+$/.test(header.text)) {
      throw new Error(`protocol error: 期望 '*' 开头的命令数组，收到 '${this.buf[0]}'`)
    }
    pos = header.end
    const count = Number(header.text.slice(1))
    const args: string[] = []
    for (let i = 0; i < count; i++) {
      const lenLine = this.lineAt(pos)
      if (lenLine === null) return null
      if (!/^\$\d+$/.test(lenLine.text)) {
        throw new Error(`protocol error: 期望 '$' 开头的批量串，收到 '${this.buf[pos]}'`)
      }
      pos = lenLine.end
      const data = this.bytesAt(pos, Number(lenLine.text.slice(1)))
      if (data === null) return null
      args.push(data.text)
      pos = data.end
      if (!this.crlfAt(pos)) return null
      pos += 2 // 跳过数据尾部的 \r\n
    }
    this.buf = this.buf.slice(pos) // 整条到齐，才真正消费缓冲
    return args
  }

  // 从 pos 起读到 \r\n；没等到 \r\n 返回 null（半包）
  private lineAt(pos: number): Span {
    const idx = this.buf.indexOf('\r\n', pos)
    if (idx === -1) return null
    return { text: this.buf.slice(pos, idx), end: idx + 2 }
  }

  // 从 pos 起按「UTF-8 字节数」取数据：长度前缀说的是字节数，
  // 而字符串下标按字符走——'你好' 占 2 个下标但算 6 个字节，必须逐字符折算。
  private bytesAt(pos: number, n: number): Span {
    let bytes = 0
    for (let i = pos; i < this.buf.length; i++) {
      if (bytes >= n) return { text: this.buf.slice(pos, i), end: i }
      const c = this.buf.charCodeAt(i)
      // ASCII 一字节；两字节区（含代理项的一半，高低代理合成四字节）两字节；其余三字节
      bytes += c < 0x80 ? 1 : c < 0x800 || (c >= 0xd800 && c <= 0xdfff) ? 2 : 3
    }
    return bytes >= n ? { text: this.buf.slice(pos), end: this.buf.length } : null
  }

  private crlfAt(pos: number): boolean {
    return this.buf[pos] === '\r' && this.buf[pos + 1] === '\n'
  }
}
```

三个要点。其一，`feed` 只做两件事：追加、循环尝试；半包处理不在任何 if 分支里，而在结构里——解析不动就 break，缓冲原样留着。其二，`tryParseCommand` 用下标 `pos` 走位、整条到齐才 `slice` 消费，「没到齐就当没来过」由写法保证，不靠小心。其三，`bytesAt` 是唯一有点绕的地方：前缀数的是字节、下标走的是字符，所以要逐字符折算——协议在字节的世界里，JS 字符串在字符的世界里，这座桥必须有人架。

协议错误（收到既不是 `*` 也不是 `$` 开头的东西）直接 throw。这不算「异常穿透网络层」：网络层会接住它，翻译成一条 `-ERR` 应答再送客，见第四步。

### 第三步：命令分发——PING/SET/GET/DEL

听懂了要会办。`execute` 收参数数组、回应答字符串：

```ts
// src/db.ts · MiniRedis.execute
  execute(args: string[]): string {
    this.maybeExpireCycle() // 定期删除的驱动：夹在命令之间——单线程里没有别的空隙可站
    if (args.length === 0) return encodeError('ERR empty command')
    const name = args[0]!.toUpperCase() // 命令名大小写不敏感
    const rest = args.slice(1)
    switch (name) {
      case 'PING':
        return this.ping(rest)
      case 'SET':
        return this.set(rest)
      case 'GET':
        return this.get(rest)
      case 'DEL':
        return this.del(rest)
      case 'EXPIRE':
        return this.expire(rest)
      case 'TTL':
        return this.ttl(rest)
      case 'KEYS':
        return this.keys(rest)
      case 'ZADD':
        return this.zadd(rest)
      case 'ZRANGE':
        return this.zrange(rest)
      case 'ZCARD':
        return this.zcard(rest)
      case 'INFO':
        return this.info(rest)
      case 'CONFIG':
        return this.config(rest)
      case 'BGREWRITEAOF':
        return this.bgrewriteaof(rest)
      case 'FLUSHALL':
        return this.flushall(rest)
      case 'SAVE':
        return this.save(rest)
      case 'LOAD':
        return this.load(rest)
      default:
        return encodeError(`ERR unknown command '${args[0]}'`)
    }
  }
```

这段的当前形态里藏着六处后话：本章初写时，`data` 还是 JS 白送的 `Map` 暂住房；到「全局哈希表」一章，你亲手写的哈希表 `Dict` 换掉了它——用「算下标」代替「挨个找」的查表结构，顺路添的 `INFO` 命令报键数与搬迁状态；到「跳表」一章，值的类型多了一种——有序集合与字符串同住一个键空间，`ZADD/ZRANGE/ZCARD` 三个 case 进了分发；到「过期删除」一章，键多了一本寿命登记簿，`EXPIRE/TTL/KEYS` 三个 case 进了分发，进门那行 `maybeExpireCycle` 是定期删除的驱动；到「内存淘汰」一章，内存关的开关 `CONFIG` 也进了分发——键数上限与淘汰策略运行时可改；到「AOF」一章，账本换新的 `BGREWRITEAOF` 也进了分发；到「RDB 快照」一章，拍照与装回的 `SAVE/LOAD`、清场的 `FLUSHALL` 也进了分发。命令分发这个壳从本章立起就没换过骨架：往里换引擎、添房客，switch 的形状没动过。

四个命令各自的小身体：

```ts
// src/db.ts · ping/set/get/del
  private ping(args: string[]): string {
    if (args.length !== 0) return encodeError('ERR wrong number of arguments for PING')
    return encodeSimpleString('PONG')
  }

  // SET key value [EX 秒]：EX 是「顺手带寿命」——SET 与 EXPIRE 两步并一步（短信验证码的标配写法）
  private set(args: string[]): string {
    if (args.length !== 2 && args.length !== 4) return encodeError('ERR wrong number of arguments for SET')
    let ttlMs: number | null = null
    if (args.length === 4) {
      if (args[2]!.toUpperCase() !== 'EX') return encodeError('ERR syntax error')
      const secs = this.toInt(args[3]!)
      if (secs === null) return encodeError('ERR value is not an integer or out of range')
      if (secs <= 0) return encodeError(`ERR invalid expire time in 'set' command`)
      ttlMs = secs * 1000
    }
    // 新键进门前的内存关：满了按策略腾座位（allkeys-lru）或拒写（noeviction）。
    // 覆盖旧键不占新座位，不必过这关
    if (this.data.get(args[0]!) === undefined && !this.admitNewKey())
      return encodeError("OOM command not allowed when used memory > 'maxmemory'") // 真货同款 OOM 应答
    this.data.set(args[0]!, args[1]!) // 同一个键放什么都行：老值是跳表也被整个换掉
    this.evictor.touch(args[0]!) // 写入也是一次「用」：idle 时钟拨到此刻
    if (ttlMs === null) this.expirer.remove(args[0]!) // 覆盖即清寿命：不带 EX 的 SET 抹掉老登记——官方文档口径
    else this.expirer.setExpire(args[0]!, this.now() + ttlMs)
    this.aofLog(['SET', ...args]) // 干成了才记账（写后日志）：回 OK 前一笔
    return encodeSimpleString('OK')
  }

  private get(args: string[]): string {
    if (args.length !== 1) return encodeError('ERR wrong number of arguments for GET')
    const value = this.lookup(args[0]!) // 进门先查寿命簿：过期键当场删、按不存在处理
    if (value === undefined) return encodeNullBulkString()
    if (typeof value !== 'string') return this.wrongType() // 字符串的门，跳表不走
    return encodeBulkString(value)
  }

  private del(args: string[]): string {
    if (args.length === 0) return encodeError('ERR wrong number of arguments for DEL')
    let removed = 0
    for (const key of args) if (this.dropKey(key)) removed++ // 删键的活全部交给统一路径
    return encodeInteger(removed)
  }
```

注意错误的处理姿势：命令不存在、参数个数不对，一律回 `-ERR` 应答，不 throw。这是全书立的约定——命令层错误是业务应答，该让客户端看见；程序崩溃才是异常。`get` 先分「没有」与「空串」再回值——空串回的是 `$0` 长度前缀、没有回的是 `$-1`，正是上一节说的「空串与没有，必须分得开」。本章只看四个方法的主干：验参、动 data、回应答。四处后话也长在这里：中间那行门禁是第 5 章添的（值多了跳表这一种，走错门的命令要被打回）；`set` 里那段 EX 选项、`get` 进门的 `lookup`、`del` 里的 `remove`，都是「过期删除」章的寿命簿挂钩——键到时候会「到期」；`set` 回 OK 前那笔 `aofLog` 是「AOF」章的记账挂钩——干成了才记一笔。这本书后面几章一步步长成现在的样子。

### 第四步：挂上 TCP

电话线插上，前三步的零件全部串起来：

```ts
// src/server.ts · createMiniRedisServer
export function createMiniRedisServer(db: MiniRedis, port = 6379): Promise<MiniRedisServer> {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => {
      const decoder = new RespDecoder() // 每个连接各一份缓冲：命令不会跨连接串门
      socket.on('data', (chunk) => {
        let commands: string[][]
        try {
          commands = decoder.feed(chunk.toString('utf8'))
        } catch (err) {
          // 协议错误：回一条错误应答，然后送客
          socket.end(encodeError(err instanceof Error ? err.message : 'ERR protocol error'))
          return
        }
        for (const args of commands) socket.write(db.execute(args)) // 到齐几条答几条，天然支持管道
      })
    })
    server.listen(port, '127.0.0.1', () => {
      resolve({
        port: (server.address() as net.AddressInfo).port,
        close: () => new Promise((done) => server.close(() => done())),
      })
    })
  })
}
```

data 事件由 Node 的事件循环派发——你天天用的 setTimeout 就跑在同一个循环上，socket 只是多了一种「数据到了」的事件。每连接一份解码缓冲，谁的命令也不会串到别人家里；到齐几条就答几条，客户端一口气发多条、一次收回全部应答——这就是管道（pipelining），RESP 的解析模型天然撑得住，下一章拿它做正经实验。

还有一处要登记进差异清单的边界：`chunk.toString('utf8')` 假设每段到达的数据都是完整的字符。若 TCP 恰好把一个多字节字符从中间切开（『你』的三个字节被分在两段里），残缺字节会被替换成乱码符号，那条命令永远凑不齐、也不报错。真 Redis 在字节层解码，没有这个问题——本课以 JS 字符串为载体、手工折算字节，这条简化连同「只收数组格式命令、仅支持 RESP2」一并进差异清单。

测试里还住着一个最小客户端 `src/client.ts`：把解码器反着用——发出去的是批量串数组，收回来的是应答帧，同样「不完整就等」。它的帧解析长这样：

```ts
// src/client.ts · parseFrame
    // 从 pos 起解析一条完整应答帧，返回「原始字节切片 + 结束下标」；不完整返回 null。
    // + - : 是一行一帧；$ 还带 n 字节数据；* 套 n 个子帧。
    function parseFrame(pos: number): { end: number } | null {
      const line = lineAt(pos)
      if (line === null) return null
      const kind = line.text[0]
      const body = line.text.slice(1)
      pos = line.end
      if (kind === '+' || kind === '-' || kind === ':') {
        return { end: pos }
      }
      if (kind === '$') {
        const n = Number(body)
        if (!Number.isInteger(n)) return null
        if (n === -1) return { end: pos } // $-1：空值，没有数据段
        const data = bytesAt(pos, n)
        if (data === null) return null
        if (!(buf[data.end] === '\r' && buf[data.end + 1] === '\n')) return null // 尾部 \r\n 未到齐
        return { end: data.end + 2 }
      }
      if (kind === '*') {
        const n = Number(body)
        if (!Number.isInteger(n) || n === -1) return { end: pos } // *-1 是 null 数组（表「无」，空数组为 *0）：无数据段
        for (let i = 0; i < n; i++) {
          const sub = parseFrame(pos)
          if (sub === null) return null
          pos = sub.end
        }
        return { end: pos }
      }
      return null
    }
```

和 RespDecoder 同一个思路、反着朝向：服务器解「命令帧」，客户端解「应答帧」；配套的 lineAt / bytesAt 与服务端同款，全文见实验场。

这份雏形还埋着一颗没拆的雷：它真能同时伺候好几个连接吗？一个连上却一言不发的客户端，会不会把别人卡死？第 3 章专门拆这颗雷，那时的主角叫阻塞 IO 与 IO 多路复用。

## 验证：开机，让 redis-cli 跟你说话

1. 跑测试：`cd companion`，首次先 `npm install`，然后 `npx vitest run tests/resp-protocol.test.ts`——本章 18 条全绿（用 `npm test` 跑全量也行，只是后续章的测试会越积越多）。其中「极端切法：逐字符喂」那条，就是上一节误区证伪的机械版；「粘包：三条命令挤在一次到达」那条钉的是粘包。
2. 先猜后跑：GET 一个不存在的键，redis-cli 会显示什么？把猜测写下来再往下走（提示：想想 `$-1\r\n` 到了客户端会被翻译成什么样）。
3. 开机：`node src/boot.ts`（默认听 6399 端口，被占就 `node src/boot.ts 6400`；直接跑 .ts 需要 Node 23.6 及以上，旧版本加 `--experimental-strip-types`）。另开一个终端：

   ```text
   redis-cli -p 6399 PING         → PONG
   redis-cli -p 6399 SET greet 你好 → OK
   redis-cli -p 6399 GET greet     → "你好"
   redis-cli -p 6399 GET nope      → (nil)
   redis-cli -p 6399 DEL greet     → (integer) 1
   ```

   对照第 2 步的猜测：`(nil)` 背后流过的正是 `$-1\r\n`——redis-cli 替你把「没有」翻译成了好读的样子；中文值能往返，靠的是编码和解码两侧都按字节计数。
4. 指认一处小破坏：打开 `src/resp.ts`，把 `tryParseCommand` 里的 `pos += 2` 改成 `pos += 1`（少跳过一个换行符）。先猜哪几组测试会红、哪几组照常绿、为什么；再跑 `npx vitest run tests/resp-protocol.test.ts` 对照——解码与 TCP 挂接两组共 7 条全红：每个参数尾部都多出一个悬空字符，解码器从第二个参数起就在错位的世界里读帧。而编码与命令分发两组照常绿——这次破坏只伤解码路径，破坏的杀伤半径就是它的依赖面。改回来，回到全绿。

## 收束：从乱码到对话

回到开头那两堵墙。那串「乱码」现在你能逐字节念出含义：`*3` 报三个参数，`$n` 报字节长度，`\r\n` 收段——RESP 是一门把「类型 + 长度 + 内容」钉死的极简语言，换来的是免转义的二进制安全和按数字拷贝的快解析。半包与粘包也不再是玄学：TCP 本来就只承诺字节、不承诺分段，你的 RespDecoder 靠一块缓冲和「不完整就等，完整才消费」驯服了它。此刻你的服务器能被真 redis-cli 连上、答 PONG、存取删除——上一章结尾那个愿望，兑现了。

留两个尾巴当钩子。一是第四步埋的雷：并发模型，下一章拆。二是 `execute` 里键暂住的那个 JS `Map`（上面引用的已是换装后的形态）——JS 白送的暂住房终究要换，第 4 章就换上你亲手写的哈希表，那才是「键住在什么结构里」的正题。再往远看：重启进程，键全没了——缓存雪崩的引信就是这么埋下的，AOF、RDB 快照这些「内存会断电」的解法，在第四部分一一拆。

自查三问（先自己答，再展开对）：

1. 解码器先后收到两段：`*2\r\n$3\r\nGET\r\n$1\r\na` 和 `\r\n`。第一段喂进去返回什么？第二段呢？如果两段到达顺序颠倒，还能解出命令吗？
2. 客户端要发 `SET msg <值>`，值是一个真含换行的两行文本。写出这条命令的 RESP 字节；再说明「空格切分 + 按行读」的裸文本服务器会在哪一刀上死。
3. redis-cli 里敲 `DEL greet`（删掉刚设的键）显示 `(integer) 1`，再敲 `SET n 1; GET n` 会显示 `"1"`。同样是 1，写出这两条应答各自的 RESP 字节，并说明：为什么同一个数字要选两种类型装？

<details>
<summary>第 1 问答案</summary>

第一段返回 `[]`——最后一个批量串缺尾部 `\r\n`，命令没到齐。第二段补上后返回 `[['GET', 'a']]`。至于顺序颠倒：先到的那段 `\r\n` 会被当成一条空命令头，解码器当场报协议错误——好在这在真实网络里不会发生，TCP 承诺字节按序到达，段只会迟到、不会插队。锚点：「演练」第二步 RespDecoder 的结构与注释。
</details>

<details>
<summary>第 2 问答案</summary>

值「两行\n文本」按 UTF-8 是 13 字节，整条命令是 `*3\r\n$3\r\nSET\r\n$3\r\nmsg\r\n$13\r\n两行\n文本\r\n`。裸文本服务器死在值里的换行：它把 `\n` 当命令结束符，第一行读到 `SET msg 两行` 就以为命令完了，`文本` 被当成下一条命令的开头——帧从含换行的那一拍起错位。锚点：「为什么不就用裸文本」的反事实推演。
</details>

<details>
<summary>第 3 问答案</summary>

DEL 回 `:1\r\n`（整数），GET 回 `$1\r\n1\r\n`（批量串）。应答类型本身在报语义：整数装的是「计数」这类由命令定义的数字，客户端见到 `:` 就知道该当数读；批量串装的是任意字节的数据值，长度前缀说的是值的大小。同为 1，一个是「删了几个」的答案，一个是「值的内容」本身——若 DEL 也用批量串回，客户端就没法从类型上区分「计数」与「恰好是一位数字的值」了。锚点：「五种类型，一张表认全」。
</details>

从下一章起，路这么走（本章已走到「能对话」）：

| 往后的章 | 你会亲手弄懂或写出 |
| --- | --- |
| 「单线程的事件循环」 | 阻塞 IO、IO 多路复用、事件循环、事件驱动、管道 |
| 「全局哈希表」 | 哈希函数、哈希冲突、负载因子、渐进式 rehash |
| 「跳表」 | 跳表、有序集合、对象编码 |
| 「过期删除：惰性与定期」 | 过期字典、惰性删除、定期删除 |
| 「内存满了：不精确的 LRU」 | 内存淘汰、近似 LRU |
| 「AOF：把每一步写下来重放」 | AOF、AOF 重写、刷盘策略 |
| 「RDB 快照：fork 与写时复制」 | RDB 快照、fork、写时复制 |
| 「复制、哨兵与集群」 | 主从复制、哨兵、哈希槽 |
