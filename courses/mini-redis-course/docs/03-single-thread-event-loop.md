---
title: 单线程的事件循环：一个线程照看一千个连接
---

# 单线程的事件循环：一个线程照看一千个连接

先对个账。第 2 章末尾埋的那颗雷，你还记得吗——你的服务器「真能同时伺候好几个连接吗」？一个连上却一言不发的客户端，会不会把别人卡死？另外还欠着一场管道——一口气发一批命令、一次收回全部应答——的正经实验。这一章两笔账一起清：先造出会被卡死的最笨版，亲眼看它冻结；再弄明白第 2 章的正式版为什么不冻结；最后把十连问一次发的实验做掉。

## 一个不敲字的 telnet，冻结了整个服务器

给第 2 章的服务器做个「最笨版」：规则只有一条——连上一个客户端，就从它连上那一刻伺候到它断开，期间谁来都不理。三个终端就能看见它的下场：

- 终端 1：`node src/boot-naive.ts` 起动最笨版（实验场里已经写好，演练第一步把它的演进拆开看）。
- 终端 2：`telnet 127.0.0.1 6398` 连上，然后什么都别敲。telnet——一个极简的 TCP 客户端，敲什么发什么；此刻它连着，一言不发。
- 终端 3：`redis-cli -p 6398 PING`。

现象具体到这个样子：终端 3 的光标挂住，一动不动。等 10 秒，不回；等 30 秒，还是不回。这不是网络故障，也不是 redis-cli 卡了——去终端 2 按 Ctrl+C 断开那个不敲字的客户端，终端 3 瞬间打出 PONG。

一个什么都不干的用户，把后面所有人全部卡死了。服务器进程还活着，CPU 几乎为零——阻塞的荒谬就在这里：等的人不累，被连累的人最惨。这一章拆三件事：最笨版笨在哪；操作系统怎么让一个线程照看上千个连接；以及单线程为什么不但不是劣势，还恰好合身。管道的十连问实验压轴。

## 原理：笨在哪，以及三件工具

### 线程睡在了 read 门口

教科书上最笨版长这样（伪码，真实服务器都是这个骨架的变体）：

```ts
// 用法示例·教学示意（伪码）：教科书式的串行服务器骨架
while (true) {
  const socket = accept() // 接客：卡到有人连上来才返回
  serve(socket)           // 卡到这个连接关闭才返回：里面每个 read 都在等数据
}
```

accept（接客）是服务器从内核手里接过一个已完成握手的连接；内核（kernel）是操作系统的核心部分，网卡收到的数据先由它保管。read 是「从连接读数据」的系统调用（syscall——程序请内核办事的正式入口，读 socket、写文件都走它）。这段代码的要害不在循环，在「卡」：socket 默认工作在阻塞 IO（blocking IO）模式——线程走到 read 这一步，如果还没有数据可读，它就原地睡着，数据不来它不醒；期间这个线程什么都干不了，连「去看看别人有没有话」都不行。

于是那个 telnet 的行为有了解释：最笨版进入 serve(那个不敲字的连接) 之后，睡死在 read 门口。注意一个微妙处：telnet 什么都没做错——「连上但不说话」本来就是 TCP 连接的合法状态。罪魁是服务器把「等一个人」和「没法服务其他人」绑在了一起。

反事实一问：如果 read 不阻塞、没数据就立刻返回空呢？那外层循环会变成疯转的轮询——一万个连接挨个问「有了吗」，一秒钟问几万遍，CPU 烧干在问路上。所以出路不是「不等」，而是「等得聪明」：让一个地方替你同时等所有连接，谁好了叫你一声。

这里先向你交代一处诚实边界：Node 的 net 模块底下本来就是非阻塞 socket，你在 JS 里写不出「真的睡在 read 上」的代码。所以实验场的最笨版换了个写法，一比一复刻教科书行为——串行队列：没轮到你的连接，连数据监听都没挂，数据到了只能躺在内核缓冲里，没人读。对外表现与线程睡死完全一致：后来的客户端冻结，直到占位者离场。演练第一步，我们把这个演进拆开看——想跟手敲的话，照着实验场的 src/naive-server.ts 逐段敲进编辑器，效果相同。

### 逃跑路线一：一个连接一个线程？

直觉解法：连接多了，那就来一个连接开一个线程，各自睡各自的，互不连累。这条路真的能工作，老一辈服务器也走过——但三笔账算下来它不合身：

1. 内存账：一千个连接就是一千个线程，每个线程光默认栈就要以 MB 计的内存预留。一万个连接还没开口说话，几十 GB 的账单先到。
2. 切换账：线程一多，内核在它们之间倒手 CPU（上下文切换——保存和恢复每个线程的执行现场）本身就变成大头；每次倒手，CPU 缓存里的热点数据也跟着凉一分。
3. 锁账：键值服务器的数据是大家共享的。两个线程同时写同一张哈希表，就得加锁排队；锁竞争一起，多线程的收益先被吞掉一半。

要紧的是别矫枉过正：多线程不是错误答案，它是「计算重、需要真并行」的负载的正解。但键值服务器的负载长得不一样——命令是微秒级的内存操作（官方延迟文档说真 Redis 的大多数命令在亚微秒级完成），大头全在等网络。等网络这种事，不需要八个人一起等。

### 逃跑路线二：IO 多路复用——把盯场子外包给内核

IO 多路复用（IO multiplexing）——把「盯着一堆连接、谁的数据到了叫我」这件事整个交给内核。一个线程、上千连接，谁的活来了干谁的。锚点还是那家餐厅：服务员不再盯死一桌，改盯叫号屏——哪桌按铃去哪桌，没人按铃就歇着。

这件能力是三代系统调用一步步长出来的。

第一代 select：你把整份关注清单交给内核，内核挨个检查。手册 BUGS 一节里有句以 According to POSIX 开头的话——select 应当检查三个清单里的每一个描述符，直到上限；查完把结果改写在清单上还给你，你自己再从头扫一遍找出就绪的。两个要命处。其一，清单是位图（一串连排的比特，每个比特顶一个描述符），glibc（Linux 的标准 C 库）实现里定死 1024 个描述符。select(2) 手册自己吐槽这个上限「unreasonably low（低得不合理）」，并指路超过 1023 就改用 poll 或 epoll。其二，每调用一次就整单交、整单查、整单还，一千个连接里只有三个有数据，它也要过目一千次。

第二代 poll：把位图换成数组，1024 的硬上限没了。但每次调用还是整份清单交进内核、内核还是挨个查——events 字段进、revents 字段出。连接数一大，浪费不再卡在限制上，落回了「每次全量过目」本身。

第三代 epoll（Linux 特有）：关键一步是把「交清单」改成「登记」。连接建立时用 epoll_ctl 把它登记进内核的 interest list（关注名单）——登记一次，常驻内核。数据真的到达时，内核把这个连接挂进就绪列表——手册原话「由内核在 I/O 活动发生时动态填充」；你的线程调 epoll_wait 时，拿到的只是就绪的那几个。一万个连接、三个活跃：select 和 poll 每轮过目一万个，epoll 过目三个。手册给它的定语是「对大量被监视的描述符扩展性良好」。

补一句平台差异：epoll 是 Linux 的方言；macOS 和 BSD 家用 kqueue，Windows 用 IOCP。Node 的底层库 libuv 按平台各取所长，设计文档原话：`epoll on Linux, kqueue on OSX and other BSDs, event ports on SunOS and IOCP on Windows`。你在任何平台写 `socket.on('data', ...)`，底下都是这套机制在替你盯场子。

### 事件循环与事件驱动：主角的正式名字

有了多路复用，就能组装出本章标题那个东西。事件循环（event loop）——一个永动的调度循环：问一次内核「哪些连接好了」，依次执行它们对应的处理，没有就绪事件就歇着等下一轮。你天天在用它：setTimeout 的回调就是它派发的，socket 的 data 事件只是多了一种「这家来事了」的来源。

在这个循环上写程序的方式叫事件驱动（event-driven）——程序不主动等任何客户，而是登记「这件事发生时叫我」的回调，然后把控制权交还给循环。对照着看就明白了：最笨版是控制权攥在 serve 手里，攥到这个客户离场；事件驱动版是每个回调干完自己的活就撒手，循环继续派下一个。

回头重读第 2 章的正式版（节选）：

```ts
// src/server.ts · createMiniRedisServer 的挂接回调（节选）
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
```

没有队列，没有 busy 标志。连接一建立就领到自己的解码器；data 一到，回调就由事件循环派发。那个不敲字的 telnet 只是在内核的就绪名单之外挂着名——铃不响，循环根本不会为它花一个时钟周期。静默连接不占线程、不占 CPU，这就是「不会卡死别人」的全部机制。

但铁律有另一半，务必现在记下：**事件驱动免掉的是「等 IO」的阻塞，免不掉「干活本身慢」。**回调里一段同步的重活会把唯一的线程占住，全场照样冻结。两分钟自证（粘进 node 交互环境）：

```js
// 用法示例（自包含：粘进 node 交互环境就能跑）
const start = Date.now()
setTimeout(() => console.log('定时器在第', Date.now() - start, '毫秒才触发'), 1000)
const t = Date.now()
while (Date.now() - t < 3000) {} // 同步空转 3 秒：唯一的线程被占住，定时器只能排队
```

1 秒的定时器会等到第 3000 毫秒上下才触发——while 循环在同步地烧时间，事件循环根本没机会派发任何回调。真 Redis 受同一条铁律管：官方延迟文档明说，一条命令慢的时候，所有其他客户端都得等它。后面讲过期删除时你会看到，真 Redis 连删过期键都掐着时间上限分小批做，就是怕在主线程上一次干太久——这个动机第 6 章展开。

### 两颗误区拆弹

误区一：「单线程 = 并发低」。先把这话复述得像样一点：一千个连接排队等一个线程伺候，吞吐肯定上不去吧？看起来无比合理，错在把「伺候」当成了重活。键值命令是亚微秒级的内存操作，一次请求的时间大头是网络往返和进出内核的系统调用，不是计算。单线程加多路复用让线程永远在「处理已就绪的命令」，从不在任何一个客户身上干等——瓶颈根本不在线程数。官方口径里真 Redis 就这么活着：一个进程、多路复用、顺序伺候所有请求，文档还补了一句「这与 Node.js 的工作方式非常相似」。

误区二：「多线程一定更快」。复述：八核机器跑八个线程，不就该快八倍吗？上一节的三笔账已经拆了一半——锁、切换、内存。另一半更根本：多线程提速的前提是「有足够重的计算可以并行」，而这里没有。活儿太轻了，轻到锁和切换的固定开销都比活本身贵。真 Redis 的选择是命令执行单线程（免锁，顺序执行天然原子），从 2.4 版起只把慢磁盘杂活（fsync——把数据真正钉进磁盘的系统调用，第 8 章正式登场）交给后台线程，并明确说「这不改变所有请求由单线程伺候的事实」。**多线程不是银弹，是一种换了计价方式的代价。**

## 演练：先造反例，再钉死并发语义

本章的演进三件事：写出反例服务器；给并发语义上测试——第 2 章的雏形已经事件驱动，我们把它「冻结不了任何人」的承诺钉进测试，谁改坏谁红；给客户端补上管道能力，让十连问一次发一次收从客户端侧成立。

### 第一步：最笨版，serveClient 加串行队列

```ts
// src/naive-server.ts · serveClient
// 伺候一个连接直到它离场：数据到就解、解出就答；连接关闭时 Promise 才 resolve。
function serveClient(socket: net.Socket, db: MiniRedis): Promise<void> {
  return new Promise((done) => {
    const decoder = new RespDecoder() // 同款解码器：反例笨在并发模型，不在协议
    socket.on('data', (chunk) => {
      try {
        for (const args of decoder.feed(chunk.toString('utf8'))) socket.write(db.execute(args))
      } catch (err) {
        socket.end(encodeError(err instanceof Error ? err.message : 'ERR protocol error'))
      }
    })
    socket.on('close', () => done()) // 离场 = 连接关闭；半路断掉也一样
    socket.on('error', () => done())
  })
}
```

外层是「最笨」的全部所在：

```ts
// src/naive-server.ts · createNaiveMiniRedisServer
export function createNaiveMiniRedisServer(db: MiniRedis, port = 6379): Promise<MiniRedisServer> {
  return new Promise((resolve) => {
    const server = net.createServer()
    const queue: net.Socket[] = [] // 还没轮到的连接：数据躺在内核缓冲里，没人读
    const sockets = new Set<net.Socket>()
    let busy = false // 一次只伺候一个连接——「最笨」的全部含义就在这个标志位

    // 从队列领一个连接，伺候到它离场，再领下一个——教科书阻塞版 accept 循环的直译
    async function takeNext(): Promise<void> {
      if (busy) return
      const socket = queue.shift()
      if (socket === undefined) return
      busy = true
      await serveClient(socket, db)
      busy = false
      await takeNext()
    }

    server.on('connection', (socket) => {
      sockets.add(socket)
      socket.on('close', () => sockets.delete(socket))
      queue.push(socket)
      void takeNext()
    })
    server.listen(port, '127.0.0.1', () => {
      resolve({
        port: (server.address() as net.AddressInfo).port,
        close: () => {
          for (const s of sockets) s.destroy() // 清场：没伺候完的一并断掉
          return new Promise((done) => server.close(() => done()))
        },
      })
    })
  })
}
```

serveClient 与正式版的连接回调几乎逐行相同——同款解码器、同款应答循环。全部差别在外层：正式版对每个连接当场伺候；最笨版用 busy 标志和队列把它串成「上一个离场了才轮到下一个」，而 serveClient 的 resolve 条件是连接关闭。**两种服务器的全部差距，就是这层串行守卫。**没轮到的连接连 data 监听都没挂——它的数据到达后躺在内核缓冲里，没人读。冻结不是事故，是这几行代码的必然。

### 第二步：先写断言，再看它红转绿

测试文件新增 `tests/single-thread-event-loop.test.ts`，六条断言分三组：反例组两条、事件驱动组两条、管道组两条。钉「冻结与解冻」的那条长这样：

```ts
// tests/single-thread-event-loop.test.ts · 反例组「离场解冻」
  it('占位者一离场，冻结的应答立刻解冻', async () => {
    const server = await createNaiveMiniRedisServer(new MiniRedis(), 0)
    const holder = await connect(server.port)
    expect(await holder.cmd('PING')).toBe('+PONG\r\n')
    const queued = await connect(server.port)
    try {
      const pong = queued.cmd('PING') // 发出去了，但没人伺候
      expect(await within(pong, 150)).toBe('timeout')
      await holder.close() // 占位者离场
      expect(await pong).toBe('+PONG\r\n') // 同一个 Promise 此刻解冻
    } finally {
      await queued.close()
      await server.close()
    }
  })
```

within 是个「限时擂台」：150 毫秒内 settle 就返回结果，否则返回 'timeout' 字符串。这个负窗口不是竞速——排队的连接连 data 监听都没有，应答在结构上不可能到达；窗口只是留出「如果会回、早就回了」的余量。写测试时先跑了一遍红：当时 naive-server.ts 还不存在，import 直接失败。实现落地后转绿。

事件驱动组那两条（静默连接不阻塞活跃连接、沉默者随后开口也被照常伺候）一写就绿。它们钉的是第 2 章雏形已有的行为，这正是「固化」的意思——从今往后，谁把 server.ts 改出「静默连接挡路」的毛病，这两条当场红给他看。

### 第三步：对照——正式版少的那层守卫

把原理一节那段节选与第一步并排看：正式版的挂接回调里没有 queue、没有 busy、没有「等离场」。伺候资格不设席位，谁的 data 到了谁被伺候。两份实现摆在一起，比任何图解都直白：并发模型不是「加功能」加出来的，是「要不要那层串行守卫」这一个决定。

### 第四步：管道——十连问一次发出

管道的主角其实在客户端：服务器侧第 2 章就「到齐几条答几条」了，欠的是一个会一口气发一批的客户端。补上：

```ts
// src/client.ts · pipe（MiniRedisClient 新增的能力）
        pipe: (...batch) => {
          // 管道：N 条命令一次 write 全发出去，N 条应答按序到齐才 resolve——
          // 复用同一套 waiters，应答帧的泵（上面的 data 处理器）不用动
          const replies = batch.map(
            (args) =>
              new Promise<string>((res, rej) => {
                waiters.push({ resolve: res, reject: rej })
              }),
          )
          socket.write(batch.map(encodeCommand).join(''))
          return Promise.all(replies)
        },
```

十连问的实验：

```ts
// tests/single-thread-event-loop.test.ts · 管道组「十连问」
  it('单连接一次发 10 条命令，按序收回 10 条应答', async () => {
    const server = await createMiniRedisServer(new MiniRedis(), 0)
    const c = await connect(server.port)
    try {
      const batch: string[][] = []
      for (let i = 0; i < 9; i++) batch.push(['SET', `k${i}`, `v${i}`])
      batch.push(['GET', 'k0'])
      const replies = await c.pipe(...batch)
      expect(replies).toHaveLength(10)
      expect(replies.slice(0, 9)).toEqual(Array.from({ length: 9 }, () => '+OK\r\n'))
      expect(replies[9]).toBe('$2\r\nv0\r\n') // 应答顺序与命令顺序一一对应
    } finally {
      await c.close()
      await server.close()
    }
  })
```

pipe 把 N 条命令编码后一次 write 发出。网络上它是一整段字节流，TCP 爱怎么切就怎么切——第 2 章的半包与粘包在这里照常生效；服务器的解码器到齐几条答几条，客户端的应答泵按帧归还，N 条到齐才 resolve。应答顺序与命令顺序一一对应：replies[9] 正是第 10 条 GET 的应答。另一条管道测试让两个连接同时各发十连问，各自收回自己的十条、互不串门——每连接一份解码缓冲的红利。

为什么值得多这一手？官方 pipelining 文档算过三笔账。RTT 账（RTT——round trip time，网络往返时延）：一问一答最少付一次往返；文档举例 250 毫秒的慢链路上，哪怕服务器每秒能处理 10 万条命令，逐条等应答的客户端每秒最多完成 4 条——慢在路，不在店。十连问一次发，十次往返并成一次。系统调用账：逐条伺候时每条命令各付一次 read 和一次 write；管道化后一批命令常由一次 read 收进、应答由一次 write 发出，文档说吞吐最终能到无管道时的十倍上下。内存账：服务器要排队攒应答，官方建议大批量按一万条一批发、收完应答再发下一批，免得应答把内存堆高。文档还有个朴素的演示——用 netcat（类似 telnet 的命令行收发工具）直发三行 PING 就能收回三个 PONG；那是连真 Redis 的玩法，我们实验场只收数组格式命令（差异清单已登记），裸文本会被自己的服务器回一条 -ERR 送客，正好顺手验证上一章的协议错误路径。

## 验证：亲手冻结，亲手解冻

1. 跑测试：`cd companion`，然后 `npx vitest run tests/single-thread-event-loop.test.ts`——本章 6 条全绿（用 `npm test` 跑全量也行，只是测试会随章节越积越多）。
2. 亲手冻结，本章里程碑的可感知面：三个终端照开头玩一遍。终端 1 `node src/boot-naive.ts`；终端 2 `telnet 127.0.0.1 6398` 连上后什么都别敲（Windows 没装 telnet 的话，用 `redis-cli -p 6398` 交互模式连上不敲，同样占席位）；终端 3 `redis-cli -p 6398 PING`。先猜后跑：会回 PONG 吗？再等 30 秒呢？然后关掉终端 2——终端 3 瞬间打出 PONG。第 2 章末尾那颗雷，当场拆除。
3. 对照实验：终端 1 换 `node src/boot.ts`（端口 6399），重复同样的玩法。先猜：这次的 PING 会不会被占位者挡住？跑完你应该看到秒回——两台服务器一层守卫之差、两种命运。
4. 拖住定时器：把原理一节那段自包含示例粘进 node 交互环境。先写下预言（1 秒的定时器实际第几毫秒触发）再回车对照。
5. 指认一处小破坏：打开 `src/naive-server.ts`，把 takeNext 的串行守卫拆掉——`if (busy) return`、`busy = true`、`busy = false` 三行，连同 busy 那行声明一起删。先猜哪组测试会红；再跑 `npx vitest run tests/single-thread-event-loop.test.ts` 对照：反例组两条全红——没了守卫，「串行」消失，冻结不复存在，反例不再是反例；事件驱动组与管道组四条照常绿，它们从不依赖那份串行。改回来，回到全绿。

## 收束：冻结的从来不是服务器，是串行这个决定

回到开头那个不敲字的 telnet。现在你能亲口解释它了：最笨版把整个伺候资格押在它身上，它不开口，serveClient 不 resolve，队列里所有人陪等；正式版只是在内核的就绪名单之外记它一笔，铃不响就当它不存在，别人的 data 照样一到就伺候。卡死的从来不是服务器进程，是「一次只伺候一个」这个决定本身。

五个新词各收一句。阻塞 IO——线程睡在 read 门口，等一个人，误所有人。IO 多路复用——盯场子外包给内核：select 整单交整单查，poll 拆了上限没拆全量，epoll 登记一次只取就绪。事件循环——一问一派的永动调度，setTimeout 与 data 同住其中。事件驱动——登记回调、交还控制权。管道——一口气发一批、一次收回全部，把 N 次往返并成一次。你的第三个里程碑落定：服务器的并发语义钉进了测试，客户端会打十连发。

自查三问（先自己答，再展开对）：

1. naive 版上，占位者敲了一串 SET/GET 但始终不退出——第三位客户端的 PING 会被应答吗？占位者突然断网（没有优雅告别）后呢？
2. 五万个连接在线、其中只有十个在发命令：select 模型和 epoll 模型的伺候线程每一轮各自要「过目」多少个连接？差别出在哪个机制上？
3. c.pipe 十连发里第 5 条拼错了（NOPE）——pipe 返回的 Promise 会怎样？服务端那边其余九条命令的命运呢？

<details>
<summary>第 1 问答案</summary>

不会被应答。串行的划界是「离场」——serveClient 的 resolve 条件是连接关闭，不是「空闲」；占位者敲得再勤快，只要不离场，席位不放。突然断网也算离场：socket 半路断掉同样触发 close/error，队列立刻轮到下一位。锚点：演练第一步的 busy 守卫与反例组测试。
</details>

<details>
<summary>第 2 问答案</summary>

select 每轮过目全部五万个：每次调用把整份清单交进内核，内核挨个检查，回来还要自己再扫一遍。epoll 只过目就绪的十个：连接登记一次常驻内核，数据到达时才进就绪列表，epoll_wait 只取列表里的。差别机制：「每次交清单」对「登记加就绪列表」。锚点：「逃跑路线二」。
</details>

<details>
<summary>第 3 问答案</summary>

服务端照旧逐条伺候，命令层错误是应答、不是异常。前四条正常执行，NOPE 回一条 -ERR unknown command，后五条也照常执行。客户端侧：应答泵见到减号开头的帧走 reject，Promise.all 第一个 reject 就整体 reject——你拿到的是异常，不是十条应答的数组。所以管道适合装「预检过的成批命令」。锚点：src/client.ts 的 cmd 错误路径与 pipe。
</details>

从下一章起，路这么走（本章已走到「不怕慢客户」）：

| 走到哪了 | 你已亲手弄懂或写出 |
| --- | --- |
| 「磁盘太慢了」 | 延迟标尺、键值存储、缓存、旁路缓存模式、内存数据库、数据结构服务器、缓存雪崩 |
| 「RESP：两个进程怎么对话」 | RESP 协议、字节流、半包与粘包、解码器与编码器 |
| 「单线程的事件循环」（本章） | 阻塞 IO、IO 多路复用、事件循环、事件驱动、管道 |
| 下一站「全局哈希表」 | 哈希函数、哈希冲突、负载因子、渐进式 rehash |
| 更远的路 | 「跳表」：跳表、有序集合、对象编码；「过期删除」：过期字典、惰性删除、定期删除；「内存满了」：内存淘汰、近似 LRU；「AOF」与「RDB 快照」：AOF、AOF 重写、刷盘策略、fork、写时复制；「复制、哨兵与集群」：主从复制、哨兵、哈希槽 |

留一个尾巴当钩子：execute 里那个 Map 还是 JS 白送的暂住房——第 4 章亲手写哈希表时换掉它。你会撞上「扩容能不能不停机」的问题，而它的解法（渐进搬迁）正是本章「把一次长阻塞摊薄」的亲戚；再往远看，重启进程键全没了，AOF 与 RDB 快照在「内存会断电」部分等着。
