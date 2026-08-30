---
title: 对账真 nginx：我们写的和它差在哪
---

# 对账真 nginx：我们写的和它差在哪

六章之前，你是一个「写过代码、用过 HTTP，但没碰过套接字」的人。现在你的 `companion/src/fable/` 里躺着一部从 v0 长到 v5 的迷你 nginx：阻塞版、线程版、事件循环版、状态机版、master-worker 版、反向代理版，56 条测试全绿，全部亲手写出。开篇那道题——同一台机器，一连接一线程的服务器几千连接就趴下，nginx 为什么能扛几万——现在的你能亲口讲出每一层的所以然。

但把你的服务器和真 nginx 并排摆在一起，最自然的问题反而是：**差在哪？**这一章把每一笔账摆上桌面：哪些差距是形状本来相同、只是功力没到家；哪些是骨架选型不同；哪些是人家有、我们压根没造的整块功能。这也是全书的收口。先学最后三门新功课：sendfile 与零拷贝（把「文件进程序、程序发网络」的来回省掉）与内存池（整块领、统一还）；再结清第 5、6 章留下的两张欠条。

## 主线问题收口：一道题的三个答案

第一问：一连接一线程，为什么几千连接就趴下？——乘法。第 2 章的实测：300 个只连不发的保活连接，线程版进程 302 条线程（线程——进程里干活的执行工人，每人自带一块栈内存；栈内存是预留的工作台内存，闲着也占）。实占内存从 19.2 MiB 涨到 47.4 MiB，每条闲置连接约 96 KiB。外加每次唤醒约 7.5 µs 的上下文切换——CPU 从一条线程换到另一条要做的存档/读档动作，纯开销不产出。线性外推一万条，就是 938 MiB 实占、一万零二条线程——只为了「让连接保持接着」。机器不是被算死的，是被养死的。

第二问：nginx 为什么扛得住？——它把「等」从按人头收费改成了按事件收费。每台 worker 一条线程，守一张 IO 多路复用的就绪名单（select/epoll 这类：一次系统调用盯一堆文件描述符，谁就绪只报谁）；每条连接一个小状态机，记着「读到哪、还欠多少」；master-worker 架构（一个管大局的 master 加 N 台各带一条事件循环的 worker）把这条循环按 CPU 核数复制。第 3 章的对照实测：

| 300 个保活连接 | v1（一连接一线程） | v2（事件循环） |
|---|---|---|
| 线程数 | 302 | 2 |
| 内存增量 | +28.1 MiB | +532 KiB |
| 每连接实占 | ≈ 96 KiB | ≈ 1.8 KiB |

每连接 96 KiB 对 1.8 KiB，差 54 倍。nginx 官网自报的账更狠：

| 出处 | 原话 |
|---|---|
| nginx.org 首页 | "10,000 inactive HTTP keep-alive connections take about 2.5M memory;" |

第三问：我们能不能亲手写一个？——已经写完了。v0 给出 HTTP 报文的最小闭环，v1 量出旧模型的账单，v2 换上事件循环的心脏，v3 修成扛得住半读半写的状态机，v4 长出多进程骨架，v5 学会转身当反向代理。56 条测试全绿，全程 127.0.0.1，零第三方依赖。

所以「差在哪」先给一句总纲：**模型全对，功力未满。**剩下的差距，一张地图看完。

## 差距地图：先看全景

三个标签的准星先立好：

- 工程优化——形状一个字不变，把每个动作的单价再往下压。我们的事件循环装得下它们，只是还没装。
- 架构差异——骨架选型本来就不同。不是「没做完」，是「不是同一种做法」。
- 功能缺口——真 nginx 有、我们没造的整块功能。造不造是取舍，不是懂不懂的问题。

| # | 差距 | 我们（v0–v5） | 真 nginx | 类别 |
|---|---|---|---|---|
| 1 | sendfile / 零拷贝 | read_bytes 整读进 Python 再 send | sendfile 指令一开，文件在内核里直送 socket | 工程优化 |
| 2 | 内存池 | 每对象各领各的，GC 各还各的 | 按请求建池，请求结束整池销毁 | 工程优化 |
| 3 | 通知档位 | 水平触发（有账每圈提醒） | 边缘触发 + 一口气读到空 | 工程优化 |
| 4 | accept 惊群应对 | 不应对，抢到算谁的 | accept_mutex → EPOLLEXCLUSIVE → reuseport 三代 | 工程优化 |
| 5 | 上游分单与保命 | 纯轮询、即摘不愈、每请求新连接 | 权重轮询 / 最少连接 / max_fails 节奏 / keepalive 连接池 | 功能缺口 |
| 6 | TLS（https） | 全程明文 | ngx_http_ssl_module，listen 443 ssl | 功能缺口 |
| 7 | 配置系统 | 命令行参数 + 触发文件 | nginx.conf 声明式指令，reload 重读 | 功能缺口 |
| 8 | 过滤器链 | handler 一锤子买卖 | 响应沿 filter chain 逐环加工 | 架构差异 |
| 9 | 运行平台 | Windows select（实测第 513 个 fd 报错） | 主场 Linux epoll；其 Windows 版也只有 select/poll 这类老方法（1.15.9 起并用，无 epoll） | 架构差异 |
| 10 | 语言与运行时 | 解释执行的 Python | C，机器码直达 | 架构差异 |
| 11 | 缓存 / TCP·UDP / 邮件代理 | 无 | 自我介绍里还有这三顶帽子 | 功能缺口 |

真 nginx 官网第一句自我介绍：

| 出处 | 原话 |
|---|---|
| nginx.org 首页 | "nginx ("engine x") is an HTTP web server, reverse proxy, content cache, load balancer, TCP/UDP proxy server, and mail proxy server." |

我们造出了前两顶帽子（Web 服务器、反向代理——替服务器出头的门面；替客户端出头的那种叫正向代理），后三顶没碰。每一笔未实现项都在[差异清单附录](./simplifications)有账可查。下面把最重的几笔展开：1、2 两笔是新功课，学透；4、5 两笔是旧欠条，结清；3、6–11 各给一段短账，出处照旧。

## 功课一：sendfile 与零拷贝——让文件自己走

### 成因：字节两过家门

先看我们怎么发一个静态文件。这条路 v0 到 v5 一路没变过：

```python
# src/fable/blocking_server.py · demo_handler
def demo_handler(request: Request) -> bytes:
    """开机演示用的处理器：/ 打招呼，/big 给大文件，其余按 www/ 里的静态文件找。"""
    text = [("Content-Type", "text/plain; charset=utf-8")]
    if request.path == "/":
        return build_response(200, "OK", b"Hello from fable v0!\n", text)
    if request.path == "/big":
        return build_response(200, "OK", _big_body(), text)
    target = (WWW_ROOT / request.path.lstrip("/")).resolve()
    if target.is_file() and WWW_ROOT.resolve() in target.parents:  # 只准读 www/ 里面
        ctype = CONTENT_TYPES.get(target.suffix, "application/octet-stream")
        return build_response(200, "OK", target.read_bytes(), [("Content-Type", ctype)])
    return build_response(404, "Not Found", b"404 Not Found: " + request.path.encode("latin-1") + b"\n", text)
```

盯住那行 `target.read_bytes()`：文件字节从内核的页缓存（内核替你留在内存里的文件内容副本）搬进你的 Python 进程，装进 bytes；紧接着 send 把同一批字节从 Python 进程搬回内核的 socket 缓冲，发往网卡。两趟搬运，你的程序只是个中转仓库——一个字节都没加工。Linux 对这条路有一条更短的替代，man page 两句话：

| 出处 | 原话 |
|---|---|
| man7.org · sendfile(2) | "sendfile() copies data between one file descriptor and another." |
| man7.org · sendfile(2) | "Because this copying is done within the kernel, sendfile() is more efficient than the combination of read(2) and write(2), which would require transferring data to and from user space." |

这就是 sendfile（一个系统调用：让内核直接把一只文件描述符里的内容送进另一只——通常是通往网卡的 socket；用户程序只报文件名，不碰任何一个字节）。它省下的「内核与用户程序之间的来回搬」，统称零拷贝（zero-copy：凡是要消灭这趟来回搬运的技术都算，sendfile 是代表）。锚点：快递直发——read + write 是「包裹先搬进网点、再从网点搬出来装车」，sendfile 是「包裹从厂家直接上高速」，你的进程连包裹的面都没见。nginx 官网把它列进架构卖点：

| 出处 | 原话 |
|---|---|
| nginx.org 首页 | "Data copy operations are kept to a minimum." |

### 载体：两条路的数据流

```text
# 拼版：同一个文件、两条路（→ 代表一次数据搬运）
read + write（我们的路）：
  磁盘 → 内核页缓存 → Python 进程 → 内核 socket 缓冲 → 网卡
        └─ read 搬一次 ─┘             └─ send 搬一次 ─┘
  字节两过家门：进来一次、出去一次，全程有你的进程陪跑

sendfile（nginx 的路）：
  磁盘 → 内核页缓存 → 内核 socket 缓冲 → 网卡
        └──── 全程不出内核，用户程序零字节 ────┘
```

### 演算：1 GiB 的文件过两条路

只数两样：用户程序过手的字节数、系统调用次数。

- 我们的路：`read_bytes` 让 1 GiB 全部进 Python，SendBuffer 再按每块 64 KiB 冲出去——1,024 MiB ÷ 64 KiB = 16,384 次 send。用户程序过手 2 GiB：进 1 GiB、出 1 GiB。
- sendfile 的路：nginx 给单次调用设了默认 2 MiB 的上限（为什么有上限，见下一段引文），1,024 ÷ 2 = 512 次调用，用户程序过手 0 字节。

搬运量 2 GiB 对 0，调用数 16,384 对 512——每步都除得尽，可以拿笔复算。那条 2 MiB 上限，是事件循环的纪律在 sendfile 身上的化身。

| 出处 | 原话 |
|---|---|
| nginx.org · sendfile_max_chunk | Default: `sendfile_max_chunk 2m;` |
| nginx.org · sendfile_max_chunk | "Limits the amount of data that can be transferred in a single sendfile() call. Without the limit, one fast connection may seize the worker process entirely." |

一次 sendfile 塞满 2 MiB 就必须回主循环看一眼别人——「不许一家独占 worker」正是第 3 章立的规矩，nginx 用指令默认值替它守着。顺带一处如实：sendfile 指令本身的默认值是 off（"Enables or disables the use of sendfile()"）。要不要开、在哪开是配置的事；有没有这门功力，是内核的事。

最后一步落到你自己：想在自家 Windows 机器上亲手摸 sendfile，会碰壁。

| 出处 | 原话 |
|---|---|
| Python 文档 · socket.sendfile | "Send a file until EOF is reached by using high-performance os.sendfile and return the total number of bytes which were sent." |
| Python 文档 · socket.sendfile | "If os.sendfile is not available (e.g. Windows) or file is not a regular file send() will be used instead." |
| Python 文档 · socket.sendfile | "Non-blocking sockets are not supported." |

Windows 上它退回普通 send，而且它本来就不吃非阻塞 socket，塞不进 v3 的事件循环。所以这笔账我们只能「算清、不开」。这也正好说明它为什么归在工程优化一类：事件循环的模型一分不靠它——少了它，v0 到 v5 照样全部成立；装上它，静态文件这条最热的路径再省一截。

## 功课二：内存池——整块领，统一还

### 成因：作废时间整齐的东西，不该逐个退场

一条 HTTP 请求有个整齐的性质：它养活的所有临时小物件——解析出来的行、头部字典、各种簿记——全都活到「响应发完」那一刻，然后同一时刻集体作废。对这种整齐的生命期，逐个分配、逐个释放是最笨的记账法：每次分配要找空位，每次释放要销账，释放过的地方还留下大小不一的洞（碎片）。nginx 的做法是按请求开池。开发者指南三句原话：

| 出处 | 原话 |
|---|---|
| nginx.org · 开发者指南 · Pool | "Most nginx allocations are done in pools. Memory allocated in an nginx pool is freed automatically when the pool is destroyed. This provides good allocation performance and makes memory control easy." |
| nginx.org · 开发者指南 · Pool | "A pool internally allocates objects in continuous blocks of memory." |
| nginx.org · 开发者指南 · Pool | "A pool is usually tied to a specific nginx object (like an HTTP request) and is destroyed when the object reaches the end of its lifetime." |

内存池（memory pool：整块领、统一还的内存管理——按请求批量领一大块，结束一次归还）就是「给生命期整齐的分配按批发价」。锚点：工厂耗材统一领用还箱——不是不准你单件领，是成批走账便宜。

### 载体：两种记账法

```text
# 拼版：一条请求的临时物件们，两种记账
逐个分配（C 的裸 malloc、我们的每对象一领）：
  立对象 1 → 领一次；立对象 2 → 领一次；…… 立对象 N → 领一次
  请求结束：N 次逐个归还 + N 次销账（洞口大小不一，留下碎片）

池（nginx）：
  请求开始：整块领一大格
  池内领用：指针 + n，在连续块里挪一格
  请求结束：destroy 一次，整格退还（"Free all pool memory, including the pool object itself."）
```

### 演算：我们这边一条请求的物价，量给你看

nginx 池内的分配是「指针加 n」量级，释放是「每请求一次」。我们这边一条请求要立多少物件？别估，量（cwd = `companion/src`）。

```python
# 用法示例：tracemalloc 数一条请求的分配账
import tracemalloc
from fable.http_parser import HttpRequestParser

req = b"GET /big HTTP/1.1\r\nHost: 127.0.0.1:8000\r\nUser-Agent: curl/8.0\r\nAccept: */*\r\n\r\n"
p = HttpRequestParser()  # 解析器先建好：只量「这一条请求」本身
tracemalloc.start()
r = p.feed(req)
current, peak = tracemalloc.get_traced_memory()
tracemalloc.stop()
print(len(req), current, peak)
```

本机输出 `78 1054 1227`。一条 78 字节的 GET（请求行加 3 行头部），解析一轮在 Python 堆上立起峰值 1,227 字节、请求结束仍存活 1,054 字节。账单上的名字：bytes 拷贝、split 出的碎片、头部字典、Request 对象，一大家子。十万条这样的请求，就是十万场「立一堆小物件、再一场散掉」。对照池的算术（纸笔可复算）：池内一次领用约等于两次加法，整条请求的释放是 1 次 destroy。物件越碎、请求越多，批发价越划算。

如实声明一笔：这个实验量的是「我们这边的物价」，不是「池能省多少」——CPython 本来就是对象级自动回收，把池照抄过去收益很小。这门功课值得带走的是思路：生命期整齐的分配，合并成批。你其实写过它的同族：RecvBuffer 攒够一行才放行、SendBuffer 记完账一次冲——都是「攒一批、动一次」。

类别归位：工程优化。形状（每连接一个状态机小本本）一分没动，省的是记账本身。

## 欠条一：惊群的三档应对（第 5 章结账）

第 5 章末尾留的话：SO_REUSEPORT 与真 nginx 的惊群应对，终章展开。欠条兑现，从我们的现状说起——v4 两台 worker 共享一只监听 socket，门口来一个连接，谁都可能扑上去接受连接（accept），低流量时一台包场是实测过的脸。真 nginx 的同一扇门，备着三档应对——下面按激进程度排，不是时间序：内核与 nginx 的落地顺序其实是 reuseport（Linux 3.9 / nginx 1.9.1，2015）在前，EPOLLEXCLUSIVE（Linux 4.5 / nginx 1.11.3，2016）在后。

第一档，应用层排队锁。accept_mutex 让 worker 轮班接客：

| 出处 | 原话 |
|---|---|
| nginx.org · accept_mutex | "If accept_mutex is enabled, worker processes will accept new connections by turn. Otherwise, all worker processes will be notified about new connections, and if volume of new connections is low, some of the worker processes may just waste system resources." |
| nginx.org · accept_mutex | "There is no need to enable accept_mutex on systems that support the EPOLLEXCLUSIVE flag (1.11.3) or when using reuseport. Prior to version 1.11.3, the default value was on." |

轮班消灭了「全员白醒」，代价是多一把要维护的进程间锁。1.11.3 之后它默认关了——因为更新的系统给了更好的路。

第二档，内核排他唤醒。EPOLLEXCLUSIVE 是 Linux epoll（4.5 起）的标志位，加在「把监听 socket 登记进 epoll 名单」的那一步。

| 出处 | 原话 |
|---|---|
| man7.org · epoll_ctl(2) · EPOLLEXCLUSIVE | "Sets an exclusive wakeup mode for the epoll file descriptor that is being attached to the target file descriptor, fd."（since Linux 4.5） |
| man7.org · epoll_ctl(2) · EPOLLEXCLUSIVE | 同一目标被多只 epoll 名单盯着时，唤醒事件到来只有 "one or more of the epoll file descriptors will receive an event"——不再是全体点名。 |

门还是一只，但来客只叫醒一家，应用层连锁都不用拿——这就是上面那句「1.11.3 后没必要开 accept_mutex」的来历。

第三档，连门都分掉。reuseport 是 nginx listen 指令的参数（1.9.1 起）。每台 worker 自己 bind 一只同端口的监听 socket，内核把新连接直接匀到各扇门上。

| 出处 | 原话 |
|---|---|
| nginx.org · listen 的 reuseport 参数 | "this parameter (1.9.1) instructs to create an individual listening socket for each worker process (using the SO_REUSEPORT socket option on Linux 3.9+ and DragonFly BSD, or SO_REUSEPORT_LB on FreeBSD 12+), allowing a kernel to distribute incoming connections between worker processes." |
| NGINX 官方博客 · Socket Sharding | "This socket option allows multiple sockets to listen on the same IP address and port combination." |
| NGINX 官方博客 · Socket Sharding | "The kernel then load balances incoming connections across the sockets." |

官方博客的实测："reuseport increases requests per second by 2 to 3 times"；分单的脸色也匀了——"With reuseport, the load was spread evenly across the worker processes."。第 5 章那张 12 比 8、偶尔包场的时序脸，内核直接替你抹平。

取舍在哪？分门的代价，博客写明了：

| 出处 | 原话 |
|---|---|
| NGINX 官方博客 · Socket Sharding | "However, it can also mean that when a worker is stalled by a blocking operation, the block affects not only connections that the worker has already accepted, but also connection requests that the kernel has assigned to the worker since it became blocked." |

共享一只门时，一台卡住只是浪费自己的一次唤醒；分了门，卡住的那扇会把内核已经分给它、还在排队的新客一起拖住。文档另有两笔小账。其一，reuseport 一开，accept_mutex 对这只 socket 自动失效。原因官方博客（Socket Sharding）一句话说清："because the mutex is redundant with reuseport"（锁是冗余的）。其二，"Inappropriate use of this option may have its security implications."——用不合适，还有安全暗示。

我们的位置：v4 是「第 0 代」——共享一只门、不做任何应对。而且这门功课在本机连学费都交不了：accept 惊群在 Windows 的 select 下不复现（第 5 章实测声明）；reuseport 这扇门 Windows 也开不了，文档明说它 "works only on Linux 3.9+, DragonFly BSD, and FreeBSD 12+"。类别：工程优化。master-worker 的形状一个字没动，动的只是「同一批客怎么分到门口」。

## 欠条二：分单器的高档位（第 6 章结账）

第 6 章末尾留的话：真 nginx upstream 的带权重轮询、最少连接、健康检查，终章对账。先看我们的分单器全部家当：

```python
# src/fable/proxy_server.py · _UpstreamPool._pick
    def _pick(self) -> tuple[str, int] | None:
        """轮询发牌：第 1 张给名单头家，第 2 张给二家，第 3 张又回到头家。"""
        if not self._candidates:
            return None
        addr = self._candidates[self._cursor % len(self._candidates)]
        self._cursor += 1
        return addr
```

七行，游标取模——轮询（负载均衡的最基础档：按固定顺序一圈圈发牌）的全部。同一个位置，nginx 有四层高档。

第一层，权重轮询，而且是 nginx 的默认策略（第 6 章对过账）。每台上游一个权重，按权重比例发牌：

| 出处 | 原话 |
|---|---|
| nginx.org · upstream | "By default, requests are distributed between the servers using a weighted round-robin balancing method." |
| nginx.org · upstream · weight | "sets the weight of the server, by default, 1." |
| nginx.org · upstream | "In the above example, each 7 requests will be distributed as follows: 5 requests go to backend1.example.com and one request to each of the second and third servers." |

文档的算例：三台上游、头家配 5，每 7 张牌头家拿 5 张、其余两家各 1 张。异构集群就靠它：8 核机器配 2 核机器，权重 4 比 1，牌自然多给强的。

第二层，最少连接。轮询按张数分，不看各家积压；请求时长悬殊时，慢请求扎堆的那台会越欠越多。least_conn 换了个挑法：

| 出处 | 原话 |
|---|---|
| nginx.org · upstream · least_conn | "Specifies that a group should use a load balancing method where a request is passed to the server with the least number of active connections, taking into account weights of servers. If there are several such servers, they are tried in turn using a weighted round-robin balancing method." |

谁手头活少给谁，打平了再按权重轮询——两层嵌着用。

第三层，保命节奏。我们是「连不上立刻永久划名、重启才回名单」（第 6 章第四场实验亲眼看过它不自愈）；nginx 的摘除带节奏，max_fails 与 fail_timeout 两个参数：

| 出处 | 原话 |
|---|---|
| nginx.org · upstream · max_fails | "sets the number of unsuccessful attempts to communicate with the server that should happen in the duration set by the fail_timeout parameter to consider the server unavailable for a duration also set by the fail_timeout parameter. By default, the number of unsuccessful attempts is set to 1." |
| nginx.org · upstream · fail_timeout | "By default, the parameter is set to 10 seconds." |

窗口内失败够数才摘，摘的时长也是同一个 fail_timeout——到期自动回到候选名单。失败换台重试那一半我们倒是同型，v5 的 _fail 做的就是这个动作：

| 出处 | 原话 |
|---|---|
| nginx.org · upstream | "If an error occurs during communication with a server, the request will be passed to the next server, and so on until all of the functioning servers will be tried." |

至于「不等真实请求失败、主动定期探活」的健康检查，开源版没有——那是商业版的功能：

| 出处 | 原话 |
|---|---|
| nginx.org · upstream | "Dynamically configurable group with periodic health checks is available as part of our commercial subscription:"

第四样，keepalive 连接池。v5 每条请求朝上游新开一条连接、用完即关——一单一命；nginx 的 worker 会攒空闲的上游连接复用，省的是每请求一次完整的 TCP 握手。

| 出处 | 原话 |
|---|---|
| nginx.org · upstream · keepalive | "The connections parameter sets the maximum number of idle keepalive connections to upstream servers that are preserved in the cache of each worker process." |
| nginx.org · upstream · keepalive | "Since 1.29.7, keepalive connections are enabled by default, with a default limit of 32 connections per each worker process." |

这一笔为什么归功能缺口而不是工程优化：权重与最少连接不是「同样的牌发得更快」，是「会发我们不会发的牌」。异构集群按比例吃活、慢请求场景自动纠偏、坏上游按节奏回血、握手成本摊薄——四样都是行为差异。

## 其余几笔：短账也要有出处

通知档位（#3，工程优化）。第 4 章讲过的一对词：我们全程水平触发（账没冲完每圈提醒），nginx 选边缘触发（状态变化只提醒一次，收到就一口气读到空——必须配合非阻塞 IO 的纪律）。省的是每圈重复报名的成本；我们 v3 的缓冲区记账里已经练过同款纪律，只是用不着它。

TLS（#6，功能缺口）。v0 到 v5 全程明文 HTTP。TLS 由专门模块提供——"The ngx_http_ssl_module module provides the necessary support for HTTPS."。配法是 `listen 443 ssl` 一类的写法。加解密是横在 socket 与 HTTP 之间的一整层，我们没让它进场；想补课，方向是 OpenSSL（Python 的 ssl 模块就是它的封装）。

配置系统（#7，功能缺口）。我们的端口靠命令行参数、优雅重载靠触发文件；nginx 是一套 nginx.conf 声明式指令（你写「要什么」，它决定怎么干），http/server/location 分层。官方 reload 流程的第一步——检查并应用新配置（第 5 章引文三句的前文）——正是我们的触发文件模拟掉的那一环。

过滤器链（#8，架构差异）。我们的 handler 是一锤子买卖：函数交出完整响应字节，进发送缓冲（buffer，攒没发完的字节的账本），发完即关。nginx 的响应要过一条链，每一环是一个模块：

| 出处 | 原话 |
|---|---|
| nginx.org · 开发者指南 | "The last phase is intended to generate a response and pass it along the filter chain." |

开发者指南点名了两端。排头的 copy filter 负责喂数据（"reads the data for other filter modules"）；收尾的 write filter 负责写 socket（"writes the data to the client socket"）。压缩、改写这类加工都是链上的一环——指南自己举的缓冲例子是 sub_filter。我们的响应路径是一根直线，nginx 的是流水线：这是「handler 函数」与「模块化服务器」的骨架之别。

平台（#9，架构差异）。本章好几门功课（epoll 边缘触发、EPOLLEXCLUSIVE、reuseport）都是 Linux 专属——真 nginx 的主场。而真 nginx 的 Windows 版，处境跟你的实验机一模一样：

| 出处 | 原话 |
|---|---|
| nginx.org · Windows 版说明 | "Only the select() and poll() (1.15.9) connection processing methods are currently used, so high performance and scalability should not be expected. Due to this and some other known issues version of nginx for Windows is considered to be a beta version." |
| nginx.org · Windows 版说明 | "Although several workers can be started, only one of them actually does any work." |

你用 fdlimit 探到的「第 513 个 fd 报错」，和这两句是同一面墙。这不是安慰奖：你在 select 的天花板上把模型亲手写了一遍，恰好把「模型」与「平台功力」拆开看清——nginx 能扛几万的那具身板，是 Linux 内核给装备出来的。

语言与运行时（#10，架构差异）。我们的每一行 Python 都要过解释器；nginx 是 C 写的（它的开发者指南通篇就是 C 的结构体与 API）。同一条事件循环，Python 版每个事件的固定开销明显更高。对教学这无所谓——第 3 章量出的 54 倍内存差、302 对 2 的线程差，比的是模型，跟语言无关；对工程这是一行小字：fable 别上生产。

## 你已经能做什么：六章对账

以你亲手跑过的为准：

- 第 1 章：用套接字写出第一台 Web 服务器（v0），curl 拿到响应与静态文件，用 send_raw 手打 HTTP 报文证明它是纯文本，复现「第二个 curl 干等」。
- 第 2 章：起 v1，用 bench 探针量出一连接一线程的三笔账——302 线程、每条 96 KiB、交接 7.5 µs，把 C10K 问题的乘法亲手算过。
- 第 3 章：写出 v2 单线程事件循环（Reactor 模式的骨架：登记、等就绪、分发）。同机同探针跑出 2 线程对 302、532 KiB 对 28.1 MiB 的对照，用 fdlimit 触到 select 的描述符上限。
- 第 4 章：把「读一次当读全」重写成增量状态机，用 slow_client 复现并修掉读残（400）与截断两起事故，部分读、部分写的账都会记。
- 第 5 章：起 1 master + 2 worker，在任务管理器指认进程树，用 /status 与账本看分摊，触发优雅轮换验证半截连接不断，硬杀 worker 看补位。
- 第 6 章：起两台上游加一个代理，十次 curl 验 A/B 轮询分单，杀一台上游零报错继续服务。按 Content-Length 攒齐的 256 KiB 正文逐字节过桥，全倒由代理自己回一句状态码 502 兜底。

官方博客对我们这套骨架的描述，你会觉得眼熟：

| 出处 | 原话 |
|---|---|
| NGINX 官方博客 · Inside NGINX | "Each worker process is single-threaded and runs independently, grabbing new connections and processing them." |
| NGINX 官方博客 · Inside NGINX | "These connections are assigned to a state machine" |
| NGINX 官方博客 · Inside NGINX | "The state machine is essentially the set of instructions that tell NGINX how to process a request." |

单线程 worker、每连接一个状态机——你在 Windows 上用几百行 Python 复刻的，正是这三句话。

## 去向与延伸

- [练习路线](./exercises)：clone 这套 companion、清空实现、按章序把 56 条测试从红跑绿——再写一遍，比再读一遍扎实。
- [差异清单](./simplifications)：全书每一处对现实的简化逐条可查，本章差距地图的每一笔在那里都有细账。
- [术语表](./glossary)：全书词条的首现定义都在。
- 往外走：nginx 官方文档（每条指令一页）、kegel.com 的 C10K 原文、man7 的 sendfile(2) 与 epoll(7)/epoll_ctl(2)、MDN 的 HTTP 指南。有 Linux 机器的话，strace 挂一台真 nginx，sendfile 与 epoll_wait 的调用序列一眼可见——本章每一句「真 nginx 如此」都能亲眼对账。

## 收束：那道题，交卷

开篇问「差在哪」，现在的答案是一张你亲手填过的地图，三类各一句。**形状你已经写过**——事件循环、连接状态机、master-worker、反向代理，每一根梁你都亲手立过。所以地图上每一笔你都看得懂它动在哪里；**功力是同一副骨架上的省钱手艺**——sendfile 省搬运、内存池省记账、边缘触发省重复报名、三代惊群应对省白醒，全都不改形状；**整块功能是取舍不是鸿沟**——TLS、配置系统、过滤器链、分单高档位，造不造取决于你要什么，不取决于你懂不懂。

至于 1999 年那道题——同一台机器，怎么同时伺候一万个连接——你交出的答卷分两层。模型层：把等待改按事件收费（一条线程、一张就绪名单、每连接一个状态机），再按核数配上几台单线程 worker；实测 300 连接 2 线程、每连接 1.8 KiB，万级线性外推约 17.3 MiB——与 nginx 自报的 2.5 MB 同一量级（口径不对等，第 2、3 章已声明）。功力层：本章地图上的每一笔，就是从「扛得住」走到「工业品」之间还剩下的路。nginx 为什么能扛？你现在能讲。能不能亲手写一个？你已经写完了。

自查三问（先自己答，再展开）：

<details>
<summary>1. 预测一下：把 v5 的代理转发路径换成 sendfile 直送，会在哪两步碰壁？</summary>

第一步，sendfile 的入口必须是「能按文件方式读的东西」，socket 不行——man page 原话点名 "(i.e., it cannot be a socket)"。代理转发的字节来自上游 socket，压根不是文件。第二步，平台与模型：本机 Windows 上 Python 的 sendfile 退回普通 send，且它不支持非阻塞 socket，进不了事件循环。所以 sendfile 是静态文件路径的专属功力；代理转发的优化是另一门功课，不在本书账本（差异清单有记）。锚点：功课一的演算与本机注脚。
</details>

<details>
<summary>2. 把内存池照抄进我们的 Python 实现——每条请求的对象塞进一个「请求级袋子」、结束一把丢——收益大吗？判别式是什么？</summary>

很小。CPython 本来就是对象级自动回收，逐对象销账的活解释器已经替你干了；nginx 的池省的是 C 世界里 malloc/free 的簿记与碎片。判别式：分配次数 × 每次簿记成本，两端都大才值得成批。值得带走的是思路——生命期整齐的分配合并成批；我们代码里的同族是「攒一批、动一次」：RecvBuffer 攒够一行才放行、SendBuffer 记完账一次冲。锚点：功课二的演算与如实声明。
</details>

<details>
<summary>3. reuseport 把「一只门」分成「每 worker 一扇门」之后，一台 worker 被阻塞操作卡住时，受影响的除了它手头的连接还有谁？</summary>

还有「内核已经分到它那扇门、还在排队等它接的新连接」。官方博客点名的正是这部分。原话："connection requests that the kernel has assigned to the worker"——内核已经分给它的排队新客。对照共享一只门的世界：一台卡住只浪费自己的一次唤醒，单条队列里别的 worker 照样能取。分门用「故障域切小」换「谁的客谁负责到底」——所以官方文档同时提醒它有安全暗示、不合适别乱用。锚点：欠条一的取舍段。
</details>
