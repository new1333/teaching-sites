---
title: 一连接一线程的代价：C10K 从哪来
---

# 一连接一线程的代价：C10K 从哪来

还记得上一章结尾留的那笔账吗？v0 的服务循环一次只伺候一个连接：第一个 curl 不说完话，第二个连接连 accept 都排不上。你也已经能指着代码说出为什么——循环钉在 `recv` 上等第一位开口。上一章答应过：这一章让服务器不再干等。手术做完之后，我们马上追问一个更值钱的问题：这副新结构的麻药钱，是多少。

## 一万连接这道题，是 1999 年挂出来的

1999 年，美国工程师 Dan Kegel 在个人网站上挂出一篇长文，把整个业界正在逼近的一道题写成公开挑战：同一台机器，怎么同时伺候一万个客户端连接？这道题后来被叫作 C10K 问题（C10K problem）——C 是 connection（连接），10K 是一万，一个记法层面的名字。那篇页面的版权行从 1999 年起算，这道题的公开记录就从那年算起。

Kegel 点破了题眼。那个年代的主流服务器是「每个连接配一个专属工人」。最重的给整个进程（process，操作系统里一个独立运行的程序实例，有自己的内存空间）。轻一点的给线程（thread，进程里干活的执行工人，同进程的线程共享内存，每人还自带一块栈内存）。栈内存（thread stack）是什么先记下：每个线程预留的工作台内存，闲着也占地方。一万个连接乘上一万份这样的开销，内存先被乘法吃光；剩下的 CPU 时间，还有一大块要花在切换（context switch，CPU 从一条线程换到另一条线程要做的存档/读档动作）上——一万条线程轮着上场，光是换人就很忙。

现实里的需求端早就等在那儿了。2002 年春，在俄罗斯门户 Rambler 给 Apache 写过一年多加速模块（2001 年春的 mod_accel）的 Igor Sysoev 开始写自己的答案；2004 年 10 月 4 日，nginx 0.1.0 作为「The first public version」公开发布。它的形状在当时是异类：几万连接，每进程只有一条线程。凭什么少干活的人反而扛得多？这一章我们把「一连接一线程」亲手装上 v0、亲手压测、亲手把这笔账算出来——算完你就知道 nginx 在躲什么。

## 手术：一行代码解掉干等

第 1 章写 v0 的时候，我们在 `serve` 的 accept 行留过一句注释：「第 2 章的手术刀就落在这里」。现在落刀。新模块 `fable/threaded_server.py`，HTTP 报文的解析与组装一字不改、全部复用 v0 的 `parse_request` 和 `build_response`。动的只有服务循环：

```python
# src/fable/threaded_server.py · serve
def serve(host: str, port: int, handler: Callable[[Request], bytes]) -> None:
    """v1 服务循环：主线程只管 accept，接到一路就派一条线程，然后立刻回来等下一路。"""
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind((host, port))
    server.listen(socket.SOMAXCONN)
    print(f"fable v1 (thread-per-connection) listening on http://{host}:{port}/ ... Ctrl+C 停止", flush=True)
    while True:
        conn, _addr = server.accept()
        threading.Thread(target=_serve_conn, args=(conn, handler), daemon=True).start()
        # ↑ 第 2 章的全部手术就这一行：连接各自的伺候流程搬进各自的线程，
        #   accept 循环立刻回到下一圈——第二个连接从此不再干等。
```

v0 主循环里 `try/except/finally` 那一套，原封不动搬进 `_serve_conn`，只是从此跑在每条连接自己的线程里：

```python
# src/fable/threaded_server.py · _serve_conn
def _serve_conn(conn: socket.socket, handler: Callable[[Request], bytes]) -> None:
    """一条连接的全部伺候流程，跑在它自己的线程里：v0 的 try/except 原样搬进来。"""
    try:
        request = parse_request(conn.recv(65536))
        conn.sendall(handler(request))
    except ValueError:
        _try_send(conn, build_response(400, "Bad Request", b"400 Bad Request\n"))
    except Exception:
        _try_send(conn, build_response(500, "Internal Server Error", b"500 Internal Server Error\n"))
    finally:
        conn.close()  # 连接级隔离不变：这条连接的死活，只影响这条线程
```

对比着看就明白干等为什么消失了。v0 里「读请求、算响应、写回、关」全部串在一条执行流上，前一路不走完，`accept` 执行不到；v1 里主线程接了线就发牌——每 accept 到一路连接，就新起一条线程去伺候它，自己立刻回到 `accept` 等下一路。第 1 章那个哑巴客户端实验重放一遍：第一个连接一言不发，v1 只是多了一条钉在 `recv` 上干等的线程；第二个 curl 的请求由另一条线程立刻接走。监听套接字还是那个总机，区别是总机后面从一个人接线，变成每路呼入配一个接线员。

连接级隔离也原样成立，而且更值得看：坏信回 400、handler 崩了回 500，烧掉的都只是那一条线程，主循环和别的连接毫发无损。`daemon=True` 是说这些工人线程随主程序退场而退场，不必善后——验证槽里有一个专门针对它的小实验。

解药吃下去了，副作用也开始显形：每接一路连接，进程里就多一条线程。线程不是免费的。要算这笔账，得先把三个名词说透。

## 线程不是免费的：进程、栈、切换

### 进程与线程：为什么存在

先问为什么会有进程。你的电脑同时跑着浏览器、音乐、几十个后台服务，互不相扰；一个程序崩了，别的照常活着。这靠的是隔离：操作系统给每个程序实例一套自己的内存空间，谁也写不进别人的地盘。反过来想：要是没有这层隔离，任何一个程序的野指针都能写花别人的账本，一个崩溃就是全体崩溃。进程就是这层隔离的载体——一个独立运行的程序实例，配一套私有内存。

那为什么还要线程？进程这栋楼太贵：建一栋是一整套内存空间，楼与楼之间搬家（通信）要走系统手续。可多数时候我们要的只是「同一套数据、多条执行流」——服务器就是个典型：所有连接共享同一份代码和文件，但每条连接的对话要各走各的。线程就是进程楼里的工人：共享整栋楼的内存，各自有一条执行流。图一张：

```text
进程（一套独立内存空间，操作系统眼中的一个程序实例）
├─ 共享区：代码、数据、打开的文件……楼里所有工人都能用
├─ 线程 1 ── 栈 1（这个工人的专属工作台：局部变量、调用到哪了）
├─ 线程 2 ── 栈 2
└─ 线程 N ── 栈 N        ← 在 v1 里，N = 连接数，一路一条
```

v1 的形状在图上一眼可见：连接数涨多少，N 就涨多少，一比一。

### 栈内存：每个工人一间工具间

每个线程为什么要自带一块栈？函数调用需要有人记账：调到哪一层了、这层的局部变量放哪、返回时从哪继续——这笔账就记在栈上。每条线程的调用链各走各的，所以各要各的栈；两条线程共用一块栈会互相踩踏，A 的返回地址被 B 的局部变量写花，程序当场乱套。这笔账还有个要命的细节：预留的上限在建线程那一刻就定死、不能再调大（Kegel 原文说的正是这句，还限定「多数线程库」如此，所以他建议程序省着用栈）——于是只能按「最坏情况」预留。但预留不等于花掉：栈实际碰到的页才按需提交，这正是后面量出「实占远小于预留」的机制。

这里必须拆开三个常被混为一谈的词。预留（reserved）是地址空间里划出的上限。提交（committed）是向内核立据要下的内存量。实占（RSS，常驻内存集）是真被碰过、真占着物理内存的页。流传最广的说法「每线程 8 MB」说的是 Linux 上常见的默认栈预留（`ulimit -s` 的 8192 KiB）；Kegel 文中的算例用的是 2 MB——他原话叫「not an uncommon default value」（不算罕见的默认值）。这些数说的都是预留，不是实占。本机实占多少？不背书、上探针，下一节现场量。先记住结构：**预留、提交、实占是三笔不同的账，算 C10K 时混着用就会算错量级**。

### 上下文切换：换人上场要交的税

一颗 CPU 核在同一时刻只能执行一条线程的指令——这是硬件事实，不是软件选择。多条线程都想跑，就只能轮流上场。换人不是瞬移：CPU 要把当前线程的现场（寄存器、执行到哪了）存档，再把下一条线程的现场读回来，这个动作就是上下文切换。它本身不产出任何业务——像干活的人被频繁叫去填表，填表本身不产出。反过来想它的必要性：如果永不切换，一条死循环的线程就独占整颗核，其余全饿死。切换是「等待中的大多数」与「跑着的那一个」能共存的代价。

```text
CPU 时间 ──────────────────────────────────────────►
[线程 A 干活][存档 A][读档 B][线程 B 干活][存档 B][读档 A][线程 A …]
              └────── 换人上场：只交税，不产出 ──────┘
```

一次切换多贵？不引文献，下一节用探针在本机量。有一个口径要先交代：Windows 上没有标准库口径直接数「每秒切换了多少次」。所以我们不数次数，改量两个可测的现象。一个是线程间交接一次的时延（事件乒乓），一个是令牌在一圈线程里传递的吞吐（接力环）。量的是什么，账就算什么，不冒充内核计数器。

另外诚实声明：Python 的线程还共用一把 GIL（Global Interpreter Lock，全局解释器锁——同一时刻只允许一条线程执行 Python 字节码的门锁）。我们量到的交接时延里含这把锁的交接，所以量出来的是「这门课的跑法里真实的换人成本」，比裸内核切换略贵。学的是结构和量法，数字的绝对值不必外推到别的语言。

### C10K：把单价乘上一万

三个名词齐了，Kegel 那笔账现在可以亲手复算。他文中的算例：32 位机器上用户程序可用的虚拟内存约 1 GiB，每线程栈按 2 MiB 算，`(2^30 / 2^21)`——512 条线程就到顶，一万连接连地址空间都装不下。今天的 64 位机器虚拟地址不缺了，可乘法的结构一点没变：每连接一份栈、一份内核簿记、一个调度名额，乘上一万，再加上万条线程轮转的切换税。服务器扛不住往往不是「算得慢」，是「养不起」。这笔账在本机值多少钱，接下来全部用数字说话。

## 压测探针：把代价量成数字

新模块 `fable/bench.py` 是一支压测探针（probe——把系统的某个量量出来、打成结构化数字的小程序）。它做三件事：起一个进程内的 v1，逐级挂上「只连不发」的哑连接（模拟现实里保活着却闲置的长连接：开着的浏览器标签页、挂着不说话的 App），量每级的线程数和内存；再用事件乒乓量交接时延；用接力环量轮转吞吐。

先看内存口径。实占用工作集（RSS）量，Windows 上走系统自带的 psapi 接口（Windows 提供的查进程内存的现成系统接口），Linux 上回退读 `/proc/self/status`：

```python
# src/fable/bench.py · _windows_memory
def _windows_memory() -> tuple[int, int]:
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    psapi = ctypes.WinDLL("psapi", use_last_error=True)
    kernel32.GetCurrentProcess.restype = ctypes.c_void_p  # 64 位 HANDLE，不能让 ctypes 默认当 32 位 int 截断
    psapi.GetProcessMemoryInfo.argtypes = (
        ctypes.c_void_p,
        ctypes.POINTER(_ProcessMemoryCounters),
        ctypes.c_uint32,
    )
    psapi.GetProcessMemoryInfo.restype = ctypes.c_int
    pmc = _ProcessMemoryCounters()
    pmc.cb = ctypes.sizeof(pmc)
    ok = psapi.GetProcessMemoryInfo(kernel32.GetCurrentProcess(), ctypes.byref(pmc), pmc.cb)
    if not ok:
        raise ctypes.WinError(ctypes.get_last_error())
    return pmc.WorkingSetSize, pmc.PagefileUsage
```

```python
# src/fable/bench.py · rss_bytes
def rss_bytes() -> int:
    """本进程此刻的常驻内存（工作集）字节数：真占着的物理内存页。"""
    if sys.platform == "win32":
        return _windows_memory()[0]
    with open("/proc/self/status", encoding="ascii") as f:  # Linux 回退口径
        for line in f:
            if line.startswith("VmRSS:"):
                return int(line.split()[1]) * 1024
    raise OSError(f"no RSS source on {sys.platform}")
```

`GetProcessMemoryInfo` 一次带回整本账：`WorkingSetSize` 是工作集（实占），`PagefileUsage` 是提交量。`committed_bytes()` 是它的孪生函数——同一趟调用取 `PagefileUsage` 字段（Linux 近似取 VmData），源码就在旁边。线程数用 `threading.active_count()`：本进程此刻活着的线程条数。

主探针的流程用一句话讲完：起 v1 → 记基线 → 挂到每级连接数就量一次（线程、RSS、提交）→ 挂满最后一级时，再挤进 24 个真并发请求验正确性（探针轮询等线程上岗，不裸 sleep 赌竞速）。跑 `python -m fable.bench 300`，本机实测输出（节选；你的机器数字会不同，量级应该同档）：

```json
"levels": [
 { "connections": 0,   "threads": 2,   "rss_bytes": 20164608, "committed_bytes": 12001280 },
 { "connections": 100, "threads": 102, "rss_bytes": 29839360, "committed_bytes": 24391680,
   "rss_per_connection_bytes": 96747,   "committed_per_connection_bytes": 123904 },
 { "connections": 300, "threads": 302, "rss_bytes": 49655808, "committed_bytes": 50593792,
   "rss_per_connection_bytes": 98304,   "committed_per_connection_bytes": 128641 }
],
"burst": { "while_holding": 300, "concurrent_requests": 24, "ok": 24 },
"ping_pong": { "rounds": 2000, "handoffs": 4000, "handoff_us_mean": 7.5, "handoff_us_median": 7.15 }
```

（环境口径：win32，Python 3.12.10。表内 MiB 为四舍五入，原始字节以探针输出为准。）

| 哑连接数 | 线程数 | 实占 RSS | 相对基线 | 提交内存 | 相对基线 |
|---|---|---|---|---|---|
| 0 | 2 | 19.2 MiB | — | 11.4 MiB | — |
| 100 | 102 | 28.5 MiB | +9.2 MiB（94.5 KiB/条） | 23.3 MiB | +11.8 MiB（121 KiB/条） |
| 300 | 302 | 47.4 MiB | +28.1 MiB（96 KiB/条） | 48.2 MiB | +36.8 MiB（约 126 KiB/条） |

四个事实直接从数字里读出来：

- **线程数一比一**：302 = 主线程 + accept 主循环 + 300 条伺候线程，一条不多一条不少。代码里那行 `threading.Thread(...).start()` 的机械后果，在这里被明码标价。
- **内存线性上涨**：每连接单价从 100 级的 94.5 KiB 到 300 级的 96 KiB，几乎纹丝不动——单价恒定，总量就是直线。斜率就是那个 `// n` 算出来的 `rss_per_connection_bytes`。
- **「8 MB」到本机缩水成百 KiB 级**：每条闲置伺候线程实占约 96 KiB、提交约 126 KiB。比流传的预留数字小两个数量级——预留是地址空间的上限，实占是今天真碰过的页。传说没有全错，错的是把预留当实占去算账。
- **满载之下业务无恙**：挂着 300 条哑连接的同时打进 24 个并发真请求，24 个全部正确响应。v1 的并发正确性没得挑——本章挑的不是它的错，是它的贵。

把单价乘上一万，就是本机版 C10K 账单：10,000 × 98,304 B ≈ **938 MiB 实占、约 1.2 GiB 提交，外加一万零二条线程**——只为了「让一万条连接保持接着」。这是线性外推（万级线程本机没有实测，如实声明），但斜率是实测的。对照组就在同一页网页上。nginx 官网自报的数字接得正好：一万个闲置的 HTTP keep-alive 连接（keep-alive——一单谈完不挂断，连接留着等下一单），约只吃 2.5 MB 内存。原话是——「10,000 inactive HTTP keep-alive connections take about 2.5M memory」。两边口径不完全对等（我们量的是整进程增量和 Python 线程的全部家当，nginx 报的是它自己的每连接开销），但差着近三个数量级的鸿沟不是口径能解释的。这个差距怎么来的，下一章拆。

### 交接税：乒乓与接力

内存是「养」的成本，切换是「动」的成本。事件乒乓量的是最小交接：主线程与工人线程各守一个 `threading.Event`，我喊你、你应我，一来一回算两次交接：

```python
# src/fable/bench.py · ping_pong_handoff_us
def ping_pong_handoff_us(rounds: int = 2000) -> dict:
    """事件乒乓：主线程与工人线程各守一个 Event，一来一回记一轮（2 次交接）。

    每次交接 = 唤醒对方 + 自己让出——这是上下文切换成本里用户态可测的那部分
    （调度器换人 + 唤醒时延）。注意：Python 线程还共用一把 GIL 锁，交接时延
    里含 GIL 的取得与释放，量出来的数字是「本课程线上真实的换人成本」。
    """
    to_worker = threading.Event()
    to_main = threading.Event()
    laps_ns: list[int] = []

    def worker() -> None:
        for _ in range(rounds):
            to_worker.wait()
            to_worker.clear()
            to_main.set()

    t = threading.Thread(target=worker)
    t.start()
    for _ in range(rounds):
        start = time.perf_counter_ns()
        to_worker.set()
        to_main.wait()
        to_main.clear()
        laps_ns.append(time.perf_counter_ns() - start)
    t.join()
    per_handoff_us = [ns / 1000 / 2 for ns in laps_ns]  # 一轮 = 2 次交接
    return {
        "rounds": rounds,
        "handoffs": rounds * 2,
        "handoff_us_mean": round(statistics.mean(per_handoff_us), 2),
        "handoff_us_median": round(statistics.median(per_handoff_us), 2),
    }
```

本机测得每次交接均值 7.5 µs、中位数 7.15 µs。接力环再看规模效应：n 条线程围一圈传令牌，每条拿到只做一丁点活就传给下家——活越少，时间越被换人吃掉。核心是嵌套在 `relay_tokens_per_sec` 里的这个工人（缩进原样）：

```python
# src/fable/bench.py · relay_tokens_per_sec 里的 runner
    def runner(i: int) -> None:
        mine, nxt = flags[i], flags[(i + 1) % n_threads]
        while not stop.is_set():
            if not mine.wait(timeout=0.05):  # 超时醒来只为看一眼停不停
                continue
            mine.clear()
            counts[i] += 1
            nxt.set()
```

两个环的实测：2 人环每秒传 130,067 个令牌（折合 7.69 µs/次交接）；32 人环每秒 127,432 个（7.85 µs/次）——环大了 16 倍，单价只涨了约 2%。如实记下这个结果：**在本机、几百线程的规模内，切换单价本身没有爆炸**；接力环里每个令牌的活趋近于零，吞吐几乎完全由交接单价决定——CPU 满转，产出的却全是「换人」。真正的万级场景（调度队列、内核簿记、缓存污染的代价）本机量不到，不装懂；Kegel 那页同样提醒过，「许多操作系统处理几百条以上的线程就吃力」。

### 两个想当然，当场对账

「服务器扛不住，是因为 CPU 太慢」——这个直觉听起来无懈可击：卡了，就加核、升配。上面两段数字合力证伪它。300 条哑连接压在身上，24 个并发请求照样全部即刻正确——CPU 根本没出汗；哑连接们压根不耗 CPU（全阻塞在 `recv` 上等人开口），它们耗的是每条 96 KiB 的实占和一条线程名额。而接力环给出了反面：CPU 满转时干的活趋近零，时间几乎全数上缴给交接。两场合起来看：瓶颈常常不是算力，是「每人一间工具间」的固定成本，加上「换人上场」的税——前者随连接数线性涨，后者在活少的时候吃掉全部产出。

「一个闲置连接不占什么资源」——带宽是零，直觉就说它免费。探针的账本不这么认为：300 个只连不发的连接，进程从 2 条线程变 302 条，实占从 19.2 MiB 涨到 47.4 MiB。在线程模型里，闲置连接占着一整条线程——栈、簿记、调度名额一样不少，唯一没发生的是执行。对照 nginx 自报的 2.5 MB/万闲置连接，「闲置」在两种架构里是两种物价。

## 亲手验证

以下每条都请你自己跑。机器要求同第 1 章：本机 Python 3.10+，全程 127.0.0.1，不需要外网。数字会因机器而异，结构和量级应当一致。

开机 v1，复测干等。第一个终端：

```bash
cd companion/src
python -m fable.threaded_server
```

应看到 `fable v1 (thread-per-connection) listening on http://127.0.0.1:8000/ ... Ctrl+C 停止`。现在重放第 1 章的哑巴实验，先猜后跑：终端 2 跑哑巴客户端（`python -c "import socket,time; s=socket.create_connection(('127.0.0.1',8000)); time.sleep(30)"`——注意 `s=` 必须留着：不接住返回值，Python 会在下一行当场关掉这条连接，哑巴 30 秒就不存在了），趁这 30 秒终端 3 跑 `curl http://127.0.0.1:8000/`。第 1 章它干等到超时，这次你的预言是什么？应看到 Hello 立刻返回。服务器里多了一条线程在陪哑巴干等，但干等从此是「一条线程的私事」，不再绑架整个服务循环。

跑探针，猜一个单价。 跑之前先写预言：每条闲置伺候连接的实占内存，10 KiB / 100 KiB / 1 MB / 8 MB，你押哪个？然后：

```bash
cd companion/src
python -m fable.bench 300
```

输出末尾的 `connections.levels` 里找 `rss_per_connection_bytes`——本机是 98304（96 KiB）。押 8 MB 的读者刚被「预留 vs 实占」上了一课；押 10 KiB 的低估了 Python 线程的家当（栈之外还有线程状态、内核簿记）。顺手再跑一次 `python -m fable.bench 5`（快很多），对照看 `ping_pong` 与 `relay` 两节。

接力环，再猜一次。`relay` 里 `ring_size` 为 2 和 32 的两行 `tokens_per_sec`——你猜差几倍？跑完看：本机只差约 2%。解释给自己听：交接单价在几百线程规模内基本恒定，苦主从来不是切换单价，而是内存那笔乘法。这道题的意义在于替你排除一个错误的怀疑对象：把 C10K 全记在「切换变贵」头上，量一下就知道站不住。

daemon 破坏。先把 `threaded_server.py` 的 `serve` 里 `daemon=True` 删掉，再按这个顺序做：起服务；终端 2 挂一路哑巴客户端（上面那条修好的命令）——它会拖住一条非守护的伺服线程；终端 3 随便 `curl` 一次（让别的伺服线程都干完退场，只剩哑巴这一条挂着）；然后回终端 1 按 Ctrl+C，再随便连一路新连接（比如再 curl 一次）。这里有个 Windows 的真实行为要先交代：主线程阻塞在 `accept()` 上时，Ctrl+C 不会立刻打断它——KeyboardInterrupt 积压着，要等 `accept` 返回那一刻才落地（CPython 在 Windows 上的已知行为，已登记差异清单；启动横幅里的「Ctrl+C 停止」在 Windows 上实际是这个样子）。所以那一下新连接就是让 `stopped` 打印落地用的。先猜进程退不退——应看到：`stopped` 打印之后进程挂着不退，被那条还在 `recv` 上陪哑巴连接的非守护线程拖住，直到哑巴客户端 30 秒到点断开，进程才退场。非守护线程会拖住进程陪它善后；`daemon=True` 是「主人退场、工人不必等」的决断。验完把参数放回去。

测试台与指认破坏。验证物工程现有 56 条测试（全书累计；本章贡献 10 条）：

```bash
python -m unittest discover -s tests -t .
```

应看到 `Ran 56 tests` 与 `OK`（第 1 章 13 条 + 本章 10 条 + 后续章新增）。本章测试里 `test_second_connection_answered_while_first_is_silent` 守的就是你刚才复测的干等解药。最后来一次指认好的小破坏：把 `serve` 里 `threading.Thread(target=_serve_conn, args=(conn, handler), daemon=True).start()` 整行换成 `_serve_conn(conn, handler)`（就地伺候——v1 退化回 v0）。先猜哪几条会红（提示：红的都在用到 v1 线程版的那组里；第 1 章的 13 条不碰 v1，应照旧绿），再跑核对；验完还原，重跑应全绿。

## 收束：C10K 的账，你现在算得动笔

开篇那道 1999 年挂出来的题，现在你不只能复述，还能在自己机器上把账亲手量出来。一连接一线程的 v1，线程数与连接数一比一，每条闲置伺候连接实占约 96 KiB、提交约 126 KiB。乘上一万，就是 GB 级的内存外加一万条线程。它的并发正确性无懈可击，它的干等顽疾药到病除；它输的地方不在对错，在单价。**「一连接一线程」不是错的答案，是乘不起的答案**——Kegel 那页算例里 512 条就到顶的世界已成历史，但乘法的獠牙还在。

下一章换一种养法：300 条连接里几乎全部线程都在 `recv` 上干等——等，本来就不需要专人值守。把「等」集中到一条线程身上，谁来数据谁就绪就处理谁，这个结构叫事件循环（event loop——一个循环：问内核「哪路连接就绪了」，逐个处理，再问）。同一个 bench、同一台机器，我们把 302 线程对 1 线程、47 MiB 对多少 MiB 的对照实验现场跑给你看。

自查三问（先自己答，再展开）：

<details>
<summary>1. 基线那一行里实占 RSS（19.2 MiB）反而比提交内存（11.4 MiB）大，这不是说反了吗？</summary>

没说反。工作集（RSS）里含共享页——加载进来的解释器、系统 DLL、映射文件，这些页不计入「本进程提交」的账；而提交是本进程立据要下的私有量。所以两条线各是各的账：基线上共享页占优，RSS 看着大；增量部分（每线程的栈与簿记）几乎全是私有提交页，于是 300 连接后反超——提交增量（36.8 MiB）大于实占增量（28.1 MiB），差值就是「立了据还没碰」的页。锚点：资源账小节的表。
</details>

<details>
<summary>2. 把 300 个哑连接换成 300 个「每秒发一条 GET」的慢客户端，进程的线程数和内存会怎么变？</summary>

线程数还是 302——一连接一线程的结构与忙闲无关，连接在，线程就在；内存那份「工具间房租」也照收。变的只是执行账：每条 GET 到达时多付一次唤醒交接（本机约 7.5 µs）。这正是本章的落点：闲置养它，忙时再给它交税。锚点：两个想当然小节。
</details>

<details>
<summary>3. 不看正文，向同事讲清「每线程 8 MB」这句话错在哪、对在哪，并报出本机实测单价。</summary>

对的部分：那是 Linux 常见的默认栈预留（ulimit -s 8192），说的是地址空间上限；Kegel 文中算例也用了「2 MB 不算罕见」的同款口径。错的部分：把预留当实占去算内存账。本机实测：每条闲置伺候线程实占约 96 KiB、提交约 126 KiB——两个数量级的差距；但乘上一万仍是 GB 级，乘法不豁免。锚点：栈内存小节与资源账表。
</details>
