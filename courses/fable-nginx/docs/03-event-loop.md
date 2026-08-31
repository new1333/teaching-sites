---
title: 把「等」集中起来：非阻塞 IO 与事件循环
---

# 把「等」集中起来：非阻塞 IO 与事件循环

上一章结账时留下的画面：300 条连接等于 302 条线程、几十 MiB 的实占内存，而这 300 条伺候线程几乎什么都没干，全钉在 `recv` 上等各自的客户端开口，栈内存的家当照付。**等，本来就不需要专人值守。**这一章解雇 299 条线程、只留 1 条，配一块「到货指示牌」：谁的数据到了就处理谁——这就是 nginx 心脏的形状。三个新词先挂出来。非阻塞 IO（读不到数据就立刻返回「暂时没有」，线程绝不停留）、IO 多路复用（一次系统调用同时盯一堆连接，谁到货只报谁）、事件循环（问谁就绪、逐个处理、再问一圈的 while 循环）。本章把它们一件件讲透，拼成 v2，然后把上一章答应的对照实验当场跑给你看：同一个 bench、同一台机器，302 条线程对几条、47 MiB 对多少 MiB。

## 非阻塞 IO：把「等」改成「问一句就走」

阻塞 `recv` 的契约是「没数据就一直站到有为止」。第 1 章的干等、第 2 章的每连接一条线程，病根都是它。非阻塞 IO（non-blocking IO）改的正是这份契约：有数据就说有，没数据立刻说「暂时没有」，绝不站在原地。

亲手摸一下两种模式的差别（自包含，随时可跑）：

```python
# 用法示例：非阻塞 recv 与阻塞 recv 的对照
import socket, time

recv_end, send_end = socket.socketpair()
recv_end.setblocking(False)                       # 先设非阻塞
try:
    recv_end.recv(65536)                          # 没数据可读
except BlockingIOError as e:
    print(f"非阻塞 recv 立刻返回：{type(e).__name__}（errno {e.errno}）")

recv_end.settimeout(0.5)                          # 换回阻塞模式（带超时）
start = time.perf_counter()
try:
    recv_end.recv(65536)
except socket.timeout:
    print(f"阻塞 recv 等满 {time.perf_counter() - start:.2f} 秒才回")
```

本机输出两行：第一行 `非阻塞 recv 立刻返回：BlockingIOError（errno 10035）`；第二行 `阻塞 recv 等满 0.51 秒才回`。同一个调用，一个立刻回话，一个耗满半秒。

那句 BlockingIOError 不是事故，是一句正常的回话，意思就是「暂时没有」。Python 官方文档对非阻塞模式的承诺写得很谨慎。原话是「operations fail (with an error that is unfortunately system-dependent)」——不能立即完成就失败。错误形式随系统而异：CPython 在本机把它实装成 BlockingIOError，错误号是 EWOULDBLOCK。编号各平台不同——Windows 上是 10035，Linux 上是 11；名字相同。

### 误区一：「非阻塞 IO 是读得更快」

很多人第一反应：非阻塞，就是读得快。跑一遍上面的例子就破——recv 立刻返回了，但它一个字节也没读到，0 字节。它快的不是「读」，是「不等」；它改变的也不是速度，是时间去向：阻塞版把半秒花在等上，非阻塞版把这半秒还给了你。

再反着推一步，看这个直觉会把你带向哪：既然「不等」就是收益，那写个忙等循环——对每条连接挨个 recv 一遍，问完再问——岂不是最快的服务器？算一下：300 条连接问一圈是 300 次系统调用，299 次「暂时没有」，1 次有活干；然后立刻开始下一圈。CPU 百分之百满转，全花在「问」上，没有一刻在「干活」。非阻塞解决了「等」，制造了「问不完的问」——缺的是一块牌子：不用挨个问，数据到了自动亮。这块牌子就是下一节的主角。锚点：宾馆前台那排呼叫铃，一个总台同时盯所有房间，谁按铃亮谁，不用挨个房间敲门。

## 文件描述符：内核发的整数编号牌

牌子要挂在什么东西上？内核给每个打开的东西记账：socket、文件、管道，每打开一个发一张整数编号牌。这张牌就是文件描述符（file descriptor，fd——内核给每个打开的东西发的整数编号牌，你的程序拿它当凭据做一切操作）。亲手看一眼：

```python
# 用法示例：fd 就是内核发的整数编号牌
import socket
a = socket.socket(); b = socket.socket()
print(a.fileno(), b.fileno())   # 本机跑到 384 452（每次进程数字都不同，要点是两个不同的整数）——每打开一个，发一张
a.close(); b.close()
```

两个数字，两张牌。第 2 章的哑连接在内核账本上各占一张；一万个连接至少要一万张牌。下一节会看到：多路复用器就是「一摞编号牌 + 一份谁到货的名单」，它能管多少张牌，直接决定一台服务器能挂多少条连接。

## IO 多路复用：一个总台，同时盯所有房间

一次系统调用问内核「这 N 张牌里谁到货了」——这类调用统称 IO 多路复用。第一代实现叫 select——最早一代的多路复用系统调用，每圈把整张报名单装进一张固定大小的名单递给内核。POSIX（Unix 系操作系统的公共接口标准）收录了它，man page 的 BUGS 一节却直接劝你换人。它的继任者叫 epoll（Linux 的第二代实现：登记名单常驻内核、每次只取就绪名单，下一节专门拆）。先把 select 的工作方式讲透，epoll 好在哪里才说得清。

select 每次调用要干三件事：把你此刻要盯的全部 fd 装进一张叫 fd_set 的名单；把名单递给内核；内核逐个检查、在名单上做记号、递回来。man7.org 的 select(2) 原话三句，照抄如下：

| 出处 | 原话 |
|---|---|
| select(2) | "select() can monitor only file descriptors numbers that are less than FD_SETSIZE (1024)" |
| select(2) | "if using select() within a loop, the sets must be reinitialized before each call" |
| select(2) BUGS | value-result 式的 fd_set 参数是 "a design error that is avoided in poll(2) and epoll(7)" |

三句话三个事实。其一，fd_set 是一张定长位图：每个描述符占一个位，位图长度在编译时就缝死在结构里。能装多少张牌因此由编译期宏 FD_SETSIZE 定死——Linux 的 glibc（Linux 上最常用的 C 标准库）定为 1024。位图若能变长就没有那声报错；它缝死了，才有。其二，名单是一次性的：内核改完还给你，下一圈必须重装再递。其三，连 man page 自己都承认这套「每圈递全量名单」是设计错误。它点名了避开这个错误的继任者：poll 与 epoll。poll 是 select 与 epoll 之间的一代——没有位图上限，但名单仍要每圈全量递。画成图：

```text
select：每圈把整张名单递进去、改完递回来，名额还有硬上限

用户程序                          内核
   │  「盯这 513 个 fd」            │        第 1 圈：整张名单递进去
   │ ────────── fd_set ─────────► │
   │  ◄──────── 就绪的 2 个 ────── │        名单原地改完递回来
   │                               │
   │  「再盯这 513 个 fd」          │        第 2 圈：重装名单，重新递
   │ ────────── fd_set ─────────► │
```

### 现场触到那声报错

「名单有上限」不是传说，本机当场触给你看。新探针 `probe_select_fd_limit` 逐个注册真 socket，每注册一个就真调一次 select：

```python
# src/fable/bench.py · probe_select_fd_limit
def probe_select_fd_limit(max_fds: int = 700) -> dict:
    """向 selectors.DefaultSelector 逐个注册真 socket，实测 select 报名单的硬上限。

    select 每次调用都要把「此刻要盯的全部描述符」装进一张编译期定死大小的
    名单（fd_set）递给内核，装不下就当场报错——这个探针就是把那声报错真实
    触到、原样带回来。epoll（Linux 的 DefaultSelector）是内核常驻登记，
    没有这张要来回递的名单，预期全部注册成功。
    """
    sel = selectors.DefaultSelector()
    socks: list[socket.socket] = []
    registered = 0
    error: str | None = None
    try:
        for _ in range(max_fds):
            s = socket.socket()
            socks.append(s)
            sel.register(s, selectors.EVENT_READ)
            registered += 1
            sel.select(0)  # 注册本身不触上限，装名单的是 select 调用本身
    except (ValueError, OSError) as e:
        error = f"{type(e).__name__}: {e}"
    finally:
        sel.close()
        for s in socks:
            s.close()
    return {
        "platform": sys.platform,
        "selector": type(sel).__name__,
        "max_tried": max_fds,
        "registered": registered,
        "error": error,
    }
```

`python -m fable.bench fdlimit` 本机输出：

```json
{
  "platform": "win32",
  "selector": "SelectSelector",
  "max_tried": 700,
  "registered": 513,
  "error": "ValueError: too many file descriptors in select()"
}
```

名单装到第 513 张牌，select() 当场报 `ValueError: too many file descriptors in select()`（报错原文如此；整数不背书——FD_SETSIZE 是各平台编译期自定的，本机这张名单比 Linux 的 1024 还小）。这个数字对 v2 是硬约束，而且后果比「挂不上去」狠。v2 的名单上除了连接还有 1 张监听牌：挂到第 512 条连接（1+512=513 张牌）时，同一个 ValueError 在 `serve` 里炸响。这个错它没接——整条事件循环一条线崩到底。已挂着的 511 条连接全部失能，后来的连接直接被拒。万级连接的完整答案在 Linux 的 epoll 上。这条平台差异连真 nginx 也躲不开。nginx 官方文档 Windows 页承认：连接处理只用 select() 与 poll()（1.15.9 起）。原话是「so high performance and scalability should not be expected」，官方自认 beta 档期。差异如实登记差异清单。

## epoll：不是提速版，是换了记账方式

### 误区二：「epoll 只是 select 的提速版」

这个想法把 epoll 想成同一场考试的快判卷：还是每圈报名单，只是内核查得更快。man7.org 的 epoll(7) 不支持这个画面。它说 epoll 实例是「an in-kernel data structure」，从用户空间看是两张名单的容器：登记名单（interest list）装着你登记过要盯的 fd；就绪名单（ready list）由内核「dynamically populated … as a result of I/O activity」——数据一到，内核自己往里记。登记走一次 epoll_ctl；之后每圈 epoll_wait 只取就绪名单。

```text
epoll：登记一次，名单常驻内核；内核记账，只交就绪名单

用户程序                          内核
   │ 「登记 fd 7」（只此一次）     │ ┯ 登记名单（常驻）：fd 3、fd 7、…、fd 9999
   │ ─────── epoll_ctl ────────► │ ┷ 就绪名单：数据一到，内核自动往里记
   │                               │
   │ 「谁就绪了？」                 │
   │ ◄────── epoll_wait ──────── │  只交就绪的：fd 7、fd 3
```

对照上一节的图：名单从用户态搬进了内核，从「每圈重装全量递」变成「登记一次、按需取就绪」。**这不是同一件事变快了，是「名单」这个概念搬了家**——模型换了。跟着算一遍规模账：10,000 条连接、某一圈只有 3 条到货。select 每圈要在用户态和内核之间搬 10,000 项名单——它必须带着全部连接问一遍，哪怕另外 9,997 条毫无动静；epoll 每圈只取就绪名单里的 3 项。名单往来量差三个数量级还多，而且连接越多拉得越开。epoll(7) 说它 "scales well to large numbers of watched file descriptors"，算术就在这里。

如实声明两件事。其一，本机没有 epoll，本节行为断言全部出自 man7.org 的 epoll(7) 与 select(2) 文档，不是本机实测（登记差异清单）。其二，v2 不用自己挑：Python 标准库的 selectors 模块替我们选。官方文档说它就是「the most efficient implementation available on the current platform」——当前平台上最可用的实现。本机实测它落成 SelectSelector（上面 fdlimit 输出的 selector 字段自证），Linux 机器上同一行代码落成 EpollSelector。v2 一行不用改，就换了心脏。

## 事件循环与 Reactor：三件事转成一个圈

多路复用只回答「谁就绪」，还差一个骨架把「登记、等就绪、处理」转起来——这就是事件循环（event loop）。你可能从 JavaScript 听过这个词：浏览器里它就是那个圈；服务器端同一个形状，只是「事件」从鼠标点击换成了「连接到货」。锚点就一句：while True，查就绪名单，逐个处理，再问。这套「事件循环加就绪分发」结构的学名是 Reactor 模式（Reactor pattern——事件来了交给登记时留下的处理逻辑，不来不动）。

新模块 `fable/event_loop.py` 把 selectors 封装成这个圈，核心是一个类三个动词：

```python
# src/fable/event_loop.py · EventLoop 的登记与注销
class EventLoop:
    """Reactor 模式的最小骨架：注册/注销、run 循环、回调分发。"""

    def __init__(self) -> None:
        # DefaultSelector 挑当前平台最合适的实现：Windows 落到 select，
        # Linux 是 epoll。同一份事件循环代码、两种内核机制，差异正文里量给你看。
        self._selector = selectors.DefaultSelector()
        self._stopping = False

    def register(
        self,
        fileobj: object,
        callback: Callable[[object, int], None],
        events: int = selectors.EVENT_READ,
    ) -> None:
        """登记：把 fileobj 交给内核盯，并留下「就绪后该喊谁」。"""
        self._selector.register(fileobj, events, data=callback)

    def unregister(self, fileobj: object) -> None:
        """注销：这路 IO 不用再盯了。没登记过的直接放过（幂等）。"""
        try:
            self._selector.unregister(fileobj)
        except KeyError:
            pass
```

登记时留下的不是 fd，是回调——「这路 IO 就绪后该喊谁干」。还有两个收尾动词先记一句。`close`：对单个 socket 先注销再关闭——对端断开时只埋这一条。`close_all`：收摊时把名单上每一个都这样关掉，再关 selector 本身。跑一圈是 `step`：

```python
# src/fable/event_loop.py · step
    def step(self, timeout: float | None = 1.0) -> int:
        """跑一圈：问内核「谁就绪了」，逐个喊对应的回调；返回就绪了几路。"""
        if not self._selector.get_map():
            # Windows 的 select 见到空名单会报 WinError 10022（无效参数），
            # 没有要盯的就睡一拍再回——就绪名单自然是空。
            if timeout and timeout > 0:
                time.sleep(timeout)
            return 0
        ready = self._selector.select(timeout)
        for key, mask in ready:
            key.data(key.fileobj, mask)  # data 里存的就是登记时留下的回调
        return len(ready)
```

（开头那个空名单护栏是一条真实的 Windows 脾气：select 连一张空名单都不肯收，实测报 WinError 10022；没有要盯的就睡一拍。差异清单见。）`step` 转成圈就是 `run`：

```python
# src/fable/event_loop.py · run
    def run(self, poll_interval: float = 1.0, stop_flag: threading.Event | None = None) -> None:
        """事件循环本体：一圈一圈跑 step，直到 stop() 或 stop_flag 喊停。"""
        self._stopping = False
        while not self._stopping:
            if stop_flag is not None and stop_flag.is_set():
                break
            self.step(timeout=poll_interval)
```

拿 v2 的规模跟跑一圈：select 带着全部 301 张牌（1 个监听加 300 条连接）问内核；就绪名单返回 2 路——连接 37 可读、连接 208 对端断开；喊 2 个回调，各自处理；回到 select 再问。一圈里 CPU 只花在真正有事的连接上；没动静的 299 条不占一丝 CPU，只在名单里躺着。**等从「每人一条线程」改成了「名单里一个条目」。**

## 演练：v2 手术——监听 socket 也上名单

v1 的手术在 accept 之后（派线程）；v2 的手术在 accept 之前（挂号）。新模块 `fable/event_server.py`，HTTP 报文的功课一行不改：`parse_request` 照旧解析请求行与头部，`build_response` 照旧标 Content-Length。换的是服务循环：

```python
# src/fable/event_server.py · serve
def serve(
    host: str,
    port: int,
    handler: Callable[[Request], bytes],
    poll_interval: float = 1.0,
    stop_flag: threading.Event | None = None,
) -> None:
    """v3 服务循环：连接升级为状态机对象，循环骨架与 v2 一字不差。"""
    loop = event_loop.EventLoop()
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind((host, port))
    server.listen(socket.SOMAXCONN)
    server.setblocking(False)  # 监听 socket 也非阻塞：accept 不再卡住整条循环
    loop.register(server, _on_accept_ready(loop, server, handler))
    print(
        f"fable v3 (event loop + connection state machine) listening on http://{host}:{port}/ ... Ctrl+C 停止",
        flush=True,
    )
    try:
        loop.run(poll_interval, stop_flag)
    finally:
        loop.close_all()  # 收摊：登记过的 socket 全部关闭，不留悬空连接
```

docstring 和横幅里的 v3 是第 4 章演进后的名字——你跑的始终是仓库终态代码，本章只看循环骨架，它与 v2 一字不差。注意那个观念转折：监听 socket（套接字）自己也是一路 IO——「门口有客户端等着接受连接」同样是一种「到货」。所以它第一个上名单；accept（接受连接——把等在门口的连接接进来）从此由就绪名单驱动：

```python
# src/fable/event_server.py · _on_accept_ready
def _on_accept_ready(
    loop: event_loop.EventLoop,
    server: socket.socket,
    handler: Callable[[Request], bytes],
) -> Callable[[object, int], None]:
    """监听 socket 就绪 = 门口有连接排队：接进来、设非阻塞、发一本记账本。"""

    def on_accept(_fileobj: object, _mask: int) -> None:
        try:
            conn, _addr = server.accept()
        except OSError:
            return  # 偶发竞争（对端连上又立刻断开）：下一圈就绪名单还会报
        conn.setblocking(False)
        connection = _Connection(loop, conn, handler)
        loop.register(conn, connection.on_readable)

    return on_accept
```

接进来的连接 socket 设非阻塞、登记进同一个循环，各带一个「到货回调」（那行 `_Connection(...)` 是下一章的升级——给连接发一本记账本；本章先把它读成登记时留下的回调）：

```python
# src/fable/event_server.py · _on_readable（拼版·v2 历史形态，终态是第 4 章带收发缓冲的 _Connection 状态机）
def _on_readable(
    loop: event_loop.EventLoop,
    conn: socket.socket,
    handler: Callable[[Request], bytes],
) -> Callable[[object, int], None]:
    """连接 socket 就绪 = 这条连接有字节到货：读、解析、回话、关——一问一答即关。"""

    def on_read(_fileobj: object, _mask: int) -> None:
        try:
            data = conn.recv(65536)
        except (BlockingIOError, InterruptedError):
            return  # 就绪名单偶发抢跑：暂时没读到就先回，下一圈再说
        except OSError:
            loop.close(conn)  # 对端重置连接：只关这一条，循环毫发无损
            return
        if not data:  # recv 读到空字节 = 对端已关闭
            loop.close(conn)
            return
        try:
            response = handler(parse_request(data))  # 简化：一次 recv 当读全（第 4 章拆）
        except ValueError:
            response = build_response(400, "Bad Request", b"400 Bad Request\n")
        except Exception:
            response = build_response(500, "Internal Server Error", b"500 Internal Server Error\n")
        _try_send(conn, response)  # 简化：一次 sendall 当发全（第 4 章拆）
        loop.close(conn)  # v2 一问一答即关（keep-alive 不在本课程范围，见差异清单）

    return on_read
```

对照 v1 读这段代码，三件事值得看仔细。哑连接在 v2 里是「登记着、永不就绪」的一个 fd 条目——不占线程、不占 CPU，只占一张编号牌和一小段簿记。坏信回 400、handler 崩了回 500、对端断开关闭——每条连接的死活只动自己的回调，连接级隔离在单线程里照样成立。v2 资源账里没有 ping_pong 和 relay 的位置——没有第二条线程，就没有「换人上场」，上一章量到的约 7.5 µs 交接单价，在 v2 里根本没有发生的机会。

两笔欠账也要当场立据：`on_read` 里注释着「一次 recv 当读全」——掰成几段发的请求，v2 只读第一段就当完整报文去解析；「一次 sendall 当发全」——响应大到内核发送缓冲塞不下时，多出去的字节会静默丢失。这两个简化第 4 章现场复现再修。还有一条天生软肋要认：**单线程里干活必须快**。demo 处理器的 /big 要花约 4 秒攒正文，这 4 秒唯一的事件循环线程在攒字节，全部连接一起冻结——v1 里同样的 /big 只拖住一条线程，v2 里是全部。真 nginx 对做不成事件的磁盘读写另派了线程池去等——官方博客（Thread Pools in NGINX）把读盘列为 worker 里最典型的阻塞操作，解法是 aio threads 配置把阻塞读挪出 worker。守的还是同一条铁律：worker 里不能干等。

## 亲手验证

以下每条都请你自己跑。环境同前两章：本机 Python 3.10+，全程 127.0.0.1，不需要外网。

开机 v2，curl 一切如常。第一个终端：

```bash
cd companion/src
python -m fable.event_server
```

应看到 `fable v3 (event loop + connection state machine) listening on http://127.0.0.1:8000/ ... Ctrl+C 停止`（v2 已被下一章原位演进为 v3，横幅跟着改名，循环骨架就是本章这套）。终端 2 跑 `curl http://127.0.0.1:8000/` 应看到 Hello——接口跟 v0、v1 一模一样，换的是内账。

哑巴实验，先猜后跑。终端 2 挂哑巴客户端（`python -c "import socket,time; s=socket.create_connection(('127.0.0.1',8000)); time.sleep(30)"`，`s=` 必须留住连接）。先写下预言：v2 下终端 3 的 `curl` 会不会立刻返回？跑——应看到 Hello 立刻返回，跟 v1 一样。区别不在响应速度，在下面这份账。

对照实验，再猜一次。先押数字：v2 挂 300 条哑连接，进程几条线程？实占涨多少 MiB？然后同机连跑两支探针（各带一个文件名参数即把 JSON 报告落盘）：

```bash
cd companion/src
python -m fable.bench 300
python -m fable.bench event 300
```

v2 报告节选（本机实测，win32 / Python 3.12.10；threads 列从上到下纹丝不动）。

```json
"selector": "SelectSelector",
"levels": [
 { "connections": 0,   "threads": 2, "rss_bytes": 20123648, "committed_bytes": 11935744 },
 { "connections": 100, "threads": 2, "rss_bytes": 20209664, "committed_bytes": 11943936,
   "rss_per_connection_bytes": 860 },
 { "connections": 300, "threads": 2, "rss_bytes": 20668416, "committed_bytes": 12251136,
   "rss_per_connection_bytes": 1815 }
],
"burst": { "while_holding": 300, "concurrent_requests": 24, "ok": 24 }
```

两份报告摆在同一张表里算账。v1 那份与第 2 章落盘的账同档：302 线程、47 MiB 级（同机每天复跑略有浮动）。

| 口径（300 条哑连接） | v1 线程版 | v2 事件循环版 |
|---|---|---|
| 进程线程数 | 302 | 2 |
| 其中伺候连接的 | 300 条（一比一） | 1 条 |
| 实占 RSS | 49,623,040 B（47.3 MiB） | 20,668,416 B（19.7 MiB） |
| 相对基线增量 | +28.1 MiB | +532 KiB |
| 折算每连接实占 | 96 KiB | 1.8 KiB |
| 满载 24 并发请求 | 24/24 正确 | 24/24 正确 |

两个进程的基线几乎同一条起跑线（实占都约 19.2 MiB），所以增量可以直接比：**线程 302 对 2，每连接实占 96 KiB 对 1.8 KiB，差约 54 倍**。表里的增量类数字是单次快照，复跑有百 KiB 级浮动（v2 增量本机复跑见过 296 KiB）。线程数的平线与倍数级结论不受影响。预告里说「1 线程」，实测是 2——多出的那条是跑探针的主线程，真正伺候 300 条连接的只有 1 条。把 v2 的单价乘上一万：10,000 × 1,815 B ≈ 17.3 MiB——与 nginx 自报的「一万个闲置 keep-alive 连接约 2.5 MB」终于同量级（口径仍不对等，同第 2 章）。如实声明：这是线性外推，而且本机的 select 名单根本挂不上一万条——万级要 Linux 加 epoll，上面 fdlimit 已经量给你看了。

触一次上限。跑 `python -m fable.bench fdlimit`，先猜：注册到第几个报错、报什么？本机第 513 个，报错原文在上文。注意两个语境的差：fdlimit 探针里说的是第 513 张牌；放到 v2 身上，监听牌先占一张，挂到第 512 条连接时就引爆。Linux 读者跑同一条命令应看到 `error: null` 且 `registered: 700`——同一行代码，另一种内核。

测试台与指认破坏。验证物工程现有 56 条测试（全书累计；本章贡献 12 条）：

```bash
python -m unittest discover -s tests -t .
```

应看到 `Ran 56 tests` 与 `OK`（前两章 23 条 + 本章 12 条 + 后续章新增）。最后来一次指认好的小破坏：把 `_on_accept_ready` 里那行 `loop.register(conn, connection.on_readable)` 换成 `pass`（连接照接、名单不登）。先猜本章 12 条里哪几条红，再跑核对：应看到 6 条红——hello、哑巴加活跃、并发、400、500 这五条（连接接了却没人盯，请求石沉大海）加 bench 对照那条（burst 24 个全失败）；线程平线那条居然还绿，它守的是「不偷起线程」，伺候得好不好由别的测试守。旧 23 条不受影响。验完还原，重跑应全绿。

## 收束：账清了，新欠账也立好了

开篇那 300 条干等的线程，现在你能亲口讲清它们的下场：解雇 299 条，留 1 条带名单的。等不再按人头收费，改按事件收费——线程 302 对 2，每连接实占 96 KiB 对 1.8 KiB，内存增量 28.1 MiB 对 532 KiB，满载 24 并发照样全对。1999 年那道 C10K 问题，v2 在模型层给出了答案的形状：万级连接的单价从「一条线程」降到「一个 fd 条目」。select 到 epoll 的换代，把这张名单从「每圈全量递」换成了「内核常驻记账」。

v2 也立了两笔新欠账：掰成几段发的请求会读残、写不下的响应会截断——慢网上的手机用户第一个踩中。下一章现场复现这两起事故，再把每条连接从「一锤子回调」升级成「有记忆的状态机」。

自查三问（先自己答，再展开）：

<details>
<summary>1. 在 v2 上 curl /big（约 4 秒攒正文）：一条早已连上、请求发了一半的慢客户端，和一个此刻才发起的新 curl，谁先恢复？v1 上同样三个角色呢？</summary>

v2：两个都要等 /big 攒完——循环钉在 handler 里，既不会去读慢客户端的后半段，也不会去 accept 新 curl；/big 一完，两者几乎同时恢复。v1：三者各占各的线程，互不打扰，慢客户端和新 curl 全程正常。判别点就在「恢复的先后」：单线程里被冻结的所有人同一时刻解冻，多线程里各过各的。锚点：演练槽末段的 v2 软肋。
</details>

<details>
<summary>2. 20,000 条连接、某圈 5 条就绪：select 与 epoll 每圈各要在用户态和内核之间搬多少项名单？差距随连接数怎么变？</summary>

select：整张 20,000 项名单递进递出——19,995 条毫无动静也得带着问；epoll：登记一次常驻内核，每圈只取就绪的 5 项。select 的每圈成本随连接总数涨，epoll 随「有事的多寡」涨，连接数越大差得越开——C10K 的缝就在这里。锚点：epoll 小节的图与跟算。
</details>

<details>
<summary>3. 如果 v2 报告里 threads 是 3 而不是 2，最可能多了什么？怎么用一个数字证明多的不是「按连接偷起的线程」？</summary>

多的只可能是外围的线程（探针驱动、宿主进程之类）——v2 的伺候路径里没有起线程的代码。证明法：看 threads 列是否随 connections 的级数增长；只要从 0 到 300 级它纹丝不动（本机全程 3 或 2），就没有「一连接一线程」这回事。锚点：对照实验小节的表与 v1 的 302 那一列。
</details>
