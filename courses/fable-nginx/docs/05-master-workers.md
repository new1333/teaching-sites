---
title: master 与 worker：nginx 的多进程骨架
---

# master 与 worker：nginx 的多进程骨架

第 4 章结账时留了一句承诺：「下一站把这条已经结实的事件循环，长成 master 带多个 worker 的多进程骨架」。还记得 v3 交到你手里的样子吗——单进程、单线程，一条事件循环加每连接一本记账，慢网与反压都奈何不了它。但它有一个天花板：整台服务器只有一条线程在干活，一个核忙、其余核闲。本章把这条循环复制成 N 份装进 N 个进程，外加一个管事的 master——nginx 的骨架，到此长齐。

## ps 里的 nginx：一个管事的，一群干活的

如果你在装了 nginx 的机器上敲 `ps` 看它的进程列表，会看到很特别的形状：一个 master 进程，底下挂着几个 worker 进程，数量不多不少，恰好等于 CPU 核数。更神的是 `nginx -s reload` 的瞬间——配置换了、worker 全换了一批，而正在下载的连接一个不断，一个字节都不丢。

第一次看到这个形状的人多半会问：多个 worker？多进程？共享内存不是更省吗——进程切换比线程贵、内存各占各的，教科书都是这么教的。这个直觉错得很有质量：**在事件循环的世界里，多进程不是将就，恰好是最配的单元**。为什么？三条账本章逐条算：事件循环里「一个连接一段状态」天然各管各的，共享内存只会让每一行代码跟锁打交道（无锁）；一台进程的地址空间谁也踩不进谁的，坏一台不坏全身（故障隔离）；进程还是天然的「换班」单位，换引擎不熄火（热升级）。

这个形状有个名字：master-worker 架构（master 与 worker 的分工架法——master 是管大局的父进程，建监听、派工人、盯监控；N 个 worker 是干活的子进程，各自带着一条独立的事件循环伺候连接）。锚点：一个店长带几个店员共用一台叫号机。本章结束时，你的 Windows 任务管理器里会出现同一个形状——1 个 master、2 个 worker，全是亲手写出来的。

## 原理：为什么是多进程 × 单线程

先把误解摆正。你可能以为「多进程是过时设计、多线程才现代」——确实，教科书说线程比进程轻、共享内存比复制内存快，各种教程也都在教怎么开线程池。这套判断在「线程里跑业务逻辑」的世界成立；但 nginx 的 worker 里跑的是事件循环，换到这个世界，账要重算。三条论证，每条都过一遍反事实检验——「不这样会怎样」。

**第一条：无锁。**事件循环把连接的全部状态（解析器、缓冲区、「此刻在等什么」）都挂在连接自己身上，第 3、4 章一路就是这么写的。反事实：若 v4 用多线程共享内存实现——所有线程挤进同一个事件循环、同一份连接表——每一次登记、注销、记账都要上锁，否则两个线程同时改一条连接的账就是数据踩踏。锁的代价不止是慢：忘了锁哪一处，就是一颗不定时炸弹。而进程版的 v4 里，两台 worker 之间没有任何共享变量，想踩都踩不到。算笔具体的账：本机实测 20 个并发请求，两台 worker 的记账是 12 与 8——没有一行同步代码，分摊自然发生。

**第二条：故障隔离。**进程有独立的地址空间。反事实：多线程共享地址空间，任何一个线程把内存写坏（数组越界、悬空指针），整个进程连同所有连接一起死；nginx 若是单进程多线程，一处崩溃就是全站宕机。进程版里一台 worker 崩了，它手头的连接跟着它死（客户端收到连接重置），其余连接活在别的进程的内存里，毫发无损；master 发觉尸体，拉一台新的补位。本章的隔离测试做的就是这件事：硬杀一台 worker，服务不断。

**第三条：热升级。**进程是可以整台替换的单元。反事实：单进程服务器换代码只能停机重启，正在下载的连接全部断掉；多线程共享内存里更没法「换一半」。进程版里，老 worker 停接新客、干完手头连接再退场，新 worker 同时上岗——正在进行的下载不断线。这就是钩子里那个「reload 的瞬间连接一个不断」的机制本体，nginx 官方叫法见下文「优雅重载」一节。

顺带结清第 2 章的旧账：多进程会不会把栈内存和上下文切换的开销再请回来？不会。一连接一线程的账是「连接数 × 每线程 MB 级栈内存」；这里每台 worker 固定一条线程，N 等于核数，栈内存是「核数 × 一条栈」，与连接数无关——300 个连接还是 3 万个，进程还是那几个。C10K 问题在 v3 已经从「内存乘法」里解出来了，v4 补上另一半：多核的算力，也用上了。

### worker 数为什么配核数

nginx 官方文档对 worker 数有明确说法，原话对照：

| 出处 | 原话 |
|---|---|
| nginx.org · worker_processes | "Defines the number of worker processes." |
| nginx.org · worker_processes | Default: `worker_processes 1;` |
| nginx.org · worker_processes | "…setting it to the number of available CPU cores would be a good start (the value “auto” will try to autodetect it)." |

默认值是 1（省着用），推荐的起点是 CPU 核数，`auto` 就是自动探测核数。为什么是核数？每台 worker 只有一条线程，worker 数等于核数时每核恰有一条满负荷的线程；超过核数，同一核上就要在多条线程之间来回换人——上下文切换的账第 2 章算过（本机实测约 7.5 µs 一次，纯开销不产出），多出来的 worker 只是把这笔账重新请回来。Python 里核数一行就有：`os.cpu_count()`，本机返回 20。我们 CLI 的默认是 2 台，不为省，为的是进程列表里一眼看得清。

### accept 惊群：全员抬头，活只有一个

N 台 worker 共用一只监听 socket（套接字），门口来连接时谁去接？都可能去。这里有个著名现象：accept 惊群（accept thundering herd，直译「雷鸣般的兽群」）。每台 worker 都把监听 socket 这一路文件描述符（fd，内核给每个打开的东西发的整数编号牌）登记进自己的 IO 多路复用名单。select、epoll 都是非阻塞 IO 路线上的实现。门口来一个连接，名单上在等的 worker 全被内核喊醒、抬头扑向 accept（接受连接，把等在门口的连接接进来）。但活只有一个：抢到的那台拿到连接，其余全部白醒一场，付出的上下文切换纯属浪费。锚点回到那台叫号机：叫一个号，全员抬头。

你可能会想：这不是内核 bug 吗？好好的一个连接把所有进程都叫醒。不是 bug——「多个人等同一份资源，资源一到全员被通知」是通知机制的固有行为，不是缺陷；nginx 官方文档把它当成一个正常现象来配置，两段原话：

| 出处 | 原话 |
|---|---|
| nginx.org · accept_mutex | "If accept_mutex is enabled, worker processes will accept new connections by turn. Otherwise, all worker processes will be notified about new connections, and if volume of new connections is low, some of the worker processes may just waste system resources." |
| nginx.org · accept_mutex | "There is no need to enable accept_mutex on systems that support the EPOLLEXCLUSIVE flag (1.11.3) or when using reuseport. Prior to version 1.11.3, the default value was on." |

读出三层信息。其一，全员被通知是默认行为（不开 accept_mutex 时），文档甚至直说「一些 worker 进程纯属浪费系统资源」。本机实测到过同一个脸色：5 个顺序到达的请求全被同一台 worker 包场（记账 5 比 0），另外一台在旁边干看着；换成 20 个并发请求就分摊成 12 比 8。顺序请求谁先醒谁接，比例由时序决定——你的机器上可能是近似对半，也可能包场，都是这张脸色的变体。其二，nginx 自己的解法是 accept_mutex（让 worker 轮流接客的进程间锁），但它在 1.11.3 之后默认关闭了——因为其三：更新的系统给了更好的路。EPOLLEXCLUSIVE 是 Linux epoll 的「排他唤醒」标志，与第 4 章讲过的边缘触发同属 epoll 在通知方式上开的档位；SO_REUSEPORT 更釜底抽薪，socket(7) man page 原话：

| 出处 | 原话 |
|---|---|
| socket(7) · SO_REUSEPORT | "Permits multiple AF_INET or AF_INET6 sockets to be bound to an identical socket address." |
| socket(7) · SO_REUSEPORT | "…this option allows accept(2) load distribution in a multi-threaded server…" |
| socket(7) · SO_REUSEPORT | "This option must be set on each socket (including the first socket) prior to calling bind(2)…" |

man page 以多线程服务器举例；同一机制对多进程同样成立（「须同一有效 UID」的约束正是佐证）。既然 Linux 3.9 起允许每台 worker 自己 bind 同一个端口，内核替它们分摊连接。「全员等同一扇门」从根上就不存在了，惊群自然无从谈起。真 nginx 用哪条路、和我们这只共享监听 socket 的做法差在哪，终章的差距地图展开（已登记承诺）。

如实声明（登记差异清单）：accept 惊群是 Linux 上的现象，本机 Windows 的 select 模型下不复现，本段对照公开文档讲概念，非本机实测。v4 也不做任何惊群应对——两台 worker 抢同一扇门，抢到算谁的，低流量时偏斜（包场或近似对半，时序决定）是实测出现过的事实。

### 优雅重载：换发动机不熄火

优雅重载（graceful reload，换配置不断服务）的完整机制，nginx 官方控制文档对 SIGHUP 信号（信号：Unix 世界的进程间指令条，kill 命令发的就是它，Windows 没有这套东西；`nginx -s reload` 发的就是它）的描述原话：

| 出处 | 原话 |
|---|---|
| nginx.org · control | "If this succeeds, it starts new worker processes, and sends messages to old worker processes requesting them to shut down gracefully. Old worker processes close listen sockets and continue to service old clients. After all clients are serviced, old worker processes are shut down." |

三句话拆开：拉新 worker；老 worker 关掉监听 socket（不再接新客）、继续伺候手头的老客户；全部伺候完，老 worker 退场。锚点：换发动机不熄火，老员工干完手头的活再下班。

Windows 没有 POSIX 信号，本课程用「触发文件」模拟这条指令链：master 盯一个文件（默认 reload.txt），它一出现就执行「拉新在前、排干在后」。差距如实登记（差异清单）：真 nginx 重载会重读配置、换二进制升级走 SIGUSR2（新老两个 master 并存、监听 socket 跨进程继承）；我们轮换的是同一份代码，演示的是进程语义本身——「排干退场」这四个字的实现，一板一眼和上面三句话对齐。

## 演练：v4 手术——先过一个平台关，再装骨架

### 平台关：监听 socket 传得进子进程吗

真 nginx 在 Unix 上用 fork 派生 worker：子进程天然继承父进程的一切，监听 socket 白送。Windows 没有 fork，Python 的 multiprocessing 在这里默认走 spawn——起的是全新解释器进程，不白送任何东西。官方两段原话：

| 出处 | 原话 |
|---|---|
| Python 文档 · start methods | "The default on Windows and macOS."（指 spawn） |
| Python 文档 · start methods | "Starting a process using this method is rather slow compared to using fork…" |

spawn 的子进程默认不继承多余句柄，那监听 socket 怎么给它？答案是 multiprocessing 在传递 socket 对象时会做句柄复制——multiprocessing.reduction 把内核对象的使用权复制一份给子进程。机制文档点到为止；能不能用，实验说了算：

```python
# 用法示例：第 5 章的第一个实验——spawn 子进程能否接过监听 socket 接客
import multiprocessing as mp
import socket

def worker(listening):
    conn, _ = listening.accept()  # 子进程直接从「传进来的」监听 socket 接客
    conn.recv(1024)
    conn.sendall(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok")
    conn.close()

if __name__ == "__main__":
    server = socket.socket(); server.bind(("127.0.0.1", 0)); server.listen(8)
    ctx = mp.get_context("spawn")
    ctx.Process(target=worker, args=(server,)).start()
    c = socket.create_connection(("127.0.0.1", server.getsockname()[1]))
    c.sendall(b"GET / HTTP/1.1\r\n\r\n"); print(c.recv(1024)); c.close()
```

本机实测输出 `b'HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok'`——传得进，接得了。真·多进程共享监听 socket 的路在 Windows 上是通的，第 5 章不需要降级成线程变体。代价记下：spawn 起一台 worker 要一两秒（文档说 rather slow，实测吻合），轮换比真 nginx 的 fork 慢一个量级。

### worker 入口：旧循环，新账本

新模块 `fable/worker_pool.py`。worker 的伺候能力一行未重写：事件循环还是 `EventLoop`（Reactor 模式的骨架：登记、等就绪、分发），连接状态机直接借 `event_server._Connection`。v3 的全部功课——HTTP 报文解析、部分读与部分写的记账、水平触发下的冲账——原样复用；`event_server` 本身一行未动，`event_loop` 只加了一个小判据：

```python
# src/fable/event_loop.py · idle
    def idle(self) -> bool:
        """名单空了吗（一个被盯的 IO 都没有）——worker 优雅排干的退场判据。"""
        return not self._selector.get_map()
```

worker 进程入口全貌如下，新增的只有三件事：接客记账（账本文件自报身份）、排干退场、以及一只看门狗。

```python
# src/fable/worker_pool.py · _worker_main
def _worker_main(
    listening_sock: socket.socket,
    handler: Callable[[Request], bytes],
    stats_dir: str,
    drain_event: object,
    worker_id: int,
) -> None:
    """worker 进程入口：把 master 给的监听 socket 挂上自己的事件循环，开始接客。

    事件循环与连接状态机全是旧章的旧货；本函数新增的只有三件事——接客记账
    （accepted / served 写进账本文件），「排干退场」（drain_event 一亮，先
    注销监听 socket 不再接新客，已接进来的连接继续伺候，名单清空才退场），
    与看门狗（master 没了就自行退场，不留孤儿）。
    """
    pid = os.getpid()
    stats_path = Path(stats_dir) / f"worker-{pid}.json"
    state: dict = {"pid": pid, "accepted": 0, "served": 0, "draining": False}
    parent = multiprocessing.parent_process()  # 看门狗的表：master 死没死，问它
    _write_stats(stats_path, role="worker", **state)
    print(f"[worker {worker_id}] pid={pid} 上岗：继承监听 socket，单线程事件循环接客", flush=True)
    orphaned = False
    try:
        loop = event_loop.EventLoop()
        listening_sock.setblocking(False)
        loop.register(listening_sock, _on_accept(loop, listening_sock, handler, stats_path, state))
        while not (state["draining"] and loop.idle()):
            if parent is not None and not parent.is_alive():
                orphaned = True  # master 没了：不留孤儿 worker 僵着（真 nginx 同款纪律）
                break
            if not state["draining"] and drain_event.is_set():
                loop.close(listening_sock)  # 门口摘牌：新客请找别的 worker
                state["draining"] = True
                _write_stats(stats_path, role="worker", **state)
                print(f"[worker {worker_id}] pid={pid} 排干退场：不再接新客，干完手头的就走", flush=True)
                continue
            loop.step(timeout=0.5)
        loop.close_all()
    except KeyboardInterrupt:
        pass  # 控制台 Ctrl+C 广播到整组进程：worker 收到就当排干处理，不吐 traceback
    if orphaned:
        print(f"[worker {worker_id}] pid={pid} master 已不在，自行退场", flush=True)
    else:
        print(f"[worker {worker_id}] pid={pid} 手头连接已清空，退场", flush=True)
```

四个细节。其一，循环条件 `while not (state["draining"] and loop.idle())` 就是排干语义的全部：进入排干后，名单上只剩手头连接，`idle()` 为真（一条不剩）才放行退场——「干完手头的活再下班」由循环条件直接表达。其二，看门狗每圈问一次 master 死没死：本机实测硬杀 master 后 worker 一般在一秒内自知退场。但不是铁律——个别场景（比如大传输刚结束的 worker）会滞留十几秒甚至更久，那段时间端口仍被占着；教学实现不设硬性退场时限，如实声明（登记差异清单）。其三，`drain_event` 是 multiprocessing 的跨进程事件——master 喊话的通道。其四，Ctrl+C 在控制台是广播给整组进程的，worker 收到就当排干处理，不吐 traceback。

门口的回调与 event_server 的那三步一字不差，多记一笔「接进来」的账。排干测试靠它确认一条连接挂在哪台 worker 身上：

```python
# src/fable/worker_pool.py · _on_accept
    def on_accept(_fileobj: object, _mask: int) -> None:
        try:
            conn, _addr = listening_sock.accept()
        except OSError:
            return  # 偶发竞争（对端连上又立刻断开）：下一圈就绪名单还会报
        state["accepted"] += 1
        _write_stats(stats_path, role="worker", **state)
        conn.setblocking(False)
        connection = event_server._Connection(loop, conn, _counting(handler, stats_path, state))
        loop.register(conn, connection.on_readable)
```

每台 worker 伺候完一条连接，都在响应头里自报家门——`_with_worker_id` 在状态行后插一行 `X-Fable-Worker: {pid}`，curl 加 `-i` 就看得见；另有 `/status` 路由回报自家的完整记账。这不是花活：master 从不伺候连接这件事，靠它变得肉眼可查。

```python
# src/fable/worker_pool.py · _with_worker_id
def _with_worker_id(response: bytes) -> bytes:
    """在状态行后插一行 X-Fable-Worker：哪台 worker 伺候了你，curl -i 看得见。"""
    if b"\r\n" not in response:
        return response  # 不是本课程 handler 的回话格式：原样放行
    line_end = response.index(b"\r\n") + 2
    return response[:line_end] + f"X-Fable-Worker: {os.getpid()}\r\n".encode("ascii") + response[line_end:]
```

### master：建门、派工、监控、收摊

master 建监听 socket 后自己一次也不 accept；派工时把 socket 塞进 Process 参数：

```python
# src/fable/worker_pool.py · _spawn
def _spawn(
    ctx: multiprocessing.context.BaseContext,
    server: socket.socket,
    handler: Callable[[Request], bytes],
    stats: Path,
    worker_id: int,
) -> _WorkerProc:
    """派一台 worker：监听 socket 经 Process 参数传过去（spawn 负责句柄复制）。"""
    drain = ctx.Event()
    proc = ctx.Process(
        target=_worker_main,
        args=(server, handler, str(stats), drain, worker_id),
        daemon=True,  # 兜底：master 正常退出时收割 worker；硬杀场景靠看门狗
    )
    proc.start()
    return _WorkerProc(proc, drain, worker_id)
```

主循环三件事，一圈看一遍。

```python
# src/fable/worker_pool.py · run_master 的监控主循环
        while not stop.is_set():
            changed = False
            for i, w in enumerate(slots):  # ① 监控：意外退场的，立刻补一个
                if not w.proc.is_alive():
                    w.proc.join()  # 收尸
                    print(f"[master] worker {w.pid} 意外退场（exitcode={w.proc.exitcode}），补一个", flush=True)
                    slots[i] = _spawn(ctx, server, handler, stats, next(ids))
                    changed = True
            still: list[_WorkerProc] = []
            for w in retired:  # ② 排干收尾：确认走干净了的，记入 retired 名册
                if w.proc.is_alive():
                    still.append(w)
                else:
                    w.proc.join()
                    retired_done.append(w.pid)
                    print(f"[master] worker {w.pid} 已排干退场", flush=True)
                    changed = True
            retired = still
            if reload_path is not None and reload_path.exists():  # ③ 优雅轮换指令
                reload_path.unlink(missing_ok=True)
                old = slots.pop(0)
                new = _spawn(ctx, server, handler, stats, next(ids))  # 拉新在前
                old.drain.set()  # 排干在后：任何时刻门口都有人接客
                retired.append(old)
                slots.append(new)
                print(
                    f"[master] 优雅轮换：新 worker {new.pid} 上岗，老 worker {old.pid} 停接新客、干完手头再退",
                    flush=True,
                )
                changed = True
            if changed:
                _write_stats(
                    stats / "master.json",
                    role="master",
                    pid=os.getpid(),
                    workers=[w.pid for w in slots],
                    retired=retired_done,
                )
            stop.wait(poll_interval)
```

①是故障隔离的另一半：发现尸体先收（join），再补一台。注意补位用的还是那只监听 socket，master 手里的副本一直开着。②给排干中的老 worker 收尾记账。③就是优雅轮换：注意注释里的顺序——先拉新、后排干。为什么必须是这个顺序？先留个悬念，本章自查第 3 问回来算这笔账。收摊也在 finally 里：先喊全员排干、限时等待，超时才硬停。

```python
# src/fable/worker_pool.py · run_master 的收摊（finally 块）
        for w in slots:  # 优雅收摊：全员喊排干（干完手头连接再退），限时等待
            w.drain.set()
        for w in slots + retired:
            w.proc.join(timeout=8.0)
        for w in slots + retired:
            if w.proc.is_alive():
                w.proc.terminate()  # 排干超时才硬停：教学实现的兜底
                print(f"[master] worker {w.pid} 排干超时，硬停", flush=True)
        server.close()
        _write_stats(stats / "master.json", role="master", pid=os.getpid(), workers=[], retired=retired_done)
```

一张图看全 v4 的形状，与实现一字对应：

```text
# 拼版：v4 的进程与 socket 拓扑（结构示意）
              master 进程（建 socket、派工、监控、轮换、收摊；从不 accept）
                │  bind + listen：内核门口挂上一只监听 socket
                │  派工：这只 socket 经 Process 参数复制给每台 worker（句柄复制）
        ┌───────┴────────┐
        ▼                ▼
   worker 进程 1     worker 进程 2
   自己的事件循环     自己的事件循环
   select（监听副本   select（监听副本
     + 自己的连接们）    + 自己的连接们）
        │                │
        └───────┬────────┘
                ▼
    内核：同一扇门、同一条排队队列
    连接到来 → 在等的都被喊到 → 谁先 accept 到就归谁伺候
```

master 的账本（fable-stats/master.json）里只有 pid、workers、retired 三栏——没有连接这一栏。master 不伺候连接，不是风格偏好，是分工。它腾出手来，才能做监控、补位、轮换这些「伺候连接时没空做」的事。

## 亲手验证

以下每条都请你自己跑。环境同前四章：本机 Python 3.10+，全程 127.0.0.1，不需要外网；命令都从 `companion/src` 目录制（git-bash 用户照旧无裸斜杠参数之虞）。

第一场，开机看进程树。终端 1：

```bash
cd companion/src
python -m fable.worker_pool 127.0.0.1 8000 2
```

应看到 banner：`fable v4 (master pid=xxxx + 2 workers) listening on http://127.0.0.1:8000/ ... Ctrl+C 停止；优雅轮换：新建文件 reload.txt`，随后两行 `[worker 1] pid=… 上岗：继承监听 socket，单线程事件循环接客`。现在去任务管理器的「详细信息」页（或 PowerShell 里跑 `Get-Process python`）：三个 python 进程——banner 里那个 pid 是 master，两行上岗日志里的 pid 是 worker。钩子里 ps 看到的形状，你自己的机器上现在就有。

第二场，先猜后跑：谁在伺候你。先写下预言——连发 5 次 `curl -si http://127.0.0.1:8000/`，响应头里的 `X-Fable-Worker:` 会是两个 pid 轮着来，还是一台包场？然后跑，并记下你自己的比例。本机跑出过一台包场（顺序请求来得慢，总被同一台醒着的 worker 抢先）——这是时序决定的偶发脸，复跑也可能接近对半。再并发来一波：Git Bash 里 `seq 1 20 | xargs -P 20 -I{} curl -s -o /dev/null http://127.0.0.1:8000/`，然后看第四场的账本——分摊明显趋匀（本机 12 比 8）。低流量偏斜、并发趋匀，正是 nginx 文档那句「低流量时一些 worker 进程纯属浪费系统资源」的样子。

第三场，worker 自报家底。连发几次 `curl -s http://127.0.0.1:8000/status`，每次应看到类似 `role=worker pid=… accepted=3 served=1 draining=False`——pid 换、计数涨。这就是 nginx 里 `ngx_http_stub_status` 一类状态页的雏形。

第四场，翻账本。`cat fable-stats/master.json` 与 `cat fable-stats/worker-*.json`（cmd 用户用 `type`）。master.json 只有 pid、workers、retired 三栏；每台 worker 一份 accepted（接进来几条）/ served（完整伺候几条）/ draining（是否在排干）。

第五场，优雅轮换，正在下载的连接一个不断。终端 2 先起一个大响应慢客户端（约 4 秒的传输窗口）：

```bash
cd companion/src
python -m fable.slow_client 127.0.0.1 8000 --path=big --window 4096 --stall 2
```

传输进行中，终端 3 触发轮换：`touch reload.txt`（cmd 用户：`type nul > reload.txt`）。终端 1 应看到轮换日志——拉新、老 worker 排干；终端 2 照常收完，末尾 `[完整]`（对账凭据是响应头里的 Content-Length，字节数收满才算完整）。正在下载的那个连接由老 worker 伺候到底，中途进来的新连接归新 worker——nginx 官方对 SIGHUP 的三句描述，你刚刚逐句演了一遍。

第六场，指认好的破坏：杀一台 worker。先从账本里挑一个 worker pid，写下预言——硬杀它，正在服务的其余请求会怎样？master 会做什么？然后 `taskkill //F //PID 那个pid`（任务管理器里右键结束任务等效）。应看到 master 打出「意外退场…补一个」并拉起新 pid，curl 一切照常。测试台里守这个行为的是 `test_master_workers.py` 的隔离那条：验证物工程现有 56 条测试（全书累计；本章贡献 3 条）：

```bash
python -m unittest discover -s tests -t .
```

应看到 `Ran 56 tests` 与 `OK`（49 条旧测试未动，本章新增 3 条：分摊与 master 不伺候、杀 worker 补位、优雅轮换半截连接；第 6 章还有 4 条）。半截连接那条值得读一遍测试代码：一条只发了请求行的连接攥在老 worker 手里，轮换开始后补上剩余半截，照样拿到完整响应——优雅，是断言出来的。

## 收束：ps 里那个形状的来历

开篇 ps 里那个「一个 master、几个 worker、恰好等于核数、reload 不断线」的形状，现在你能从头到尾讲出来。worker 数配核数，是因为每台 worker 单线程：多了白付上下文切换，少了浪费核。连接不断线，是因为老 worker 收到的是「停接新客、干完手头」的排干指令，而不是一刀切的退出。master 闲着不接客，是在盯监控、补位、轮换。三条当初反着直觉的账——无锁、故障隔离、热升级——每一条都有本机实测背书。

v4 的清单：`worker_pool`（master + worker 全部逻辑）、`event_loop` 加 `idle()` 判据、`event_server` 一行未动、3 条新测试、全书 56 条全绿。读者已能：起 1 master + 2 worker 的多进程服务器、在任务管理器里指认进程树、用 /status 与账本目录看分摊、触发优雅轮换并亲眼验证下载不断线。仍如实挂账的（差异清单）：accept 惊群在 Windows 上未复现，概念对照公开文档；优雅重载是触发文件模拟，无信号、无配置重读、无 SIGUSR2 二进制升级；SO_REUSEPORT 与真 nginx 的惊群应对，欠终章差距地图一张交代。下一章给这台多进程骨架装上当代主职——反向代理：既当前台，又当传话员。

自查三问（先自己答，再展开）：

<details>
<summary>1. master 从头到尾不 accept，会不会「浪费」？让它顺手也接几个连接不好吗？</summary>

不好，两个理由。其一，master 的职责（监控补位、优雅轮换、收摊）恰恰要求它随时能动手。若它也扛着连接进事件循环，一个慢 handler 就能把它钉死几秒——第 3 章实测 /big 要 4 秒。这期间死的 worker 没人补、轮换指令没人理。其二，master 挂了等于全组没了大脑，让它离连接这种「易碎品」越远越好；worker 反正可以补。真 nginx 同款分工：master 只管配置、信号、派工。锚点：演练槽 master 一节与 fable-stats/master.json 的三栏账本。
</details>

<details>
<summary>2. taskkill 硬杀一台 worker 时，它手头正开着的连接会怎样？其余连接为什么毫发无损？</summary>

手头的连接跟着进程一起死：内核回收该进程的全部 socket，客户端收到连接重置——硬杀本来就谈不上优雅。其余连接不受影响，是因为它们活在别的进程的地址空间里：一台进程的内存另一台进程碰不到，这正是「故障隔离」的物理基础。master 发觉后拉新 worker 补位，服务面恢复。对照：优雅轮换走的是排干路径（停接新客、干完手头），硬杀与排干是两种退场。锚点：亲手验证第六场与隔离测试。
</details>

<details>
<summary>3. 把 run_master 轮换里的「拉新在前、排干在后」反过来写，会出现什么现象？为什么测试照样可能是绿的？</summary>

现象：一个一两秒的窗口里没有任何 worker 在 accept（spawn 派生慢），新连接全部堆在内核排队队列里，客户端干等至新 worker 上岗才被接走；低并发下看不出错，高并发或慢客户端下延迟肉眼可见。测试可能照样绿，因为正确性没坏（连接最终都被服务），坏的只是「任何时刻门口都有人」这个连续性——这正是性能与连续性类问题常常逃过功能测试的原因。锚点：演练槽 run_master ③ 的两行注释。
</details>
