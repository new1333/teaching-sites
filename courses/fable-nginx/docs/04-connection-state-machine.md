---
title: 半读半写的世界：事件驱动的连接状态机
---

# 半读半写的世界：事件驱动的连接状态机

上一章结账时 v2 留了两笔欠账：掰成几段发的请求会读残、写不下的响应会截断——「慢网上的手机用户第一个踩中」，原话立据在本章兑付。先交代手术台上的变化：v2 的模块 `event_server` 在本章直接演进成 v3（同一条时间线，不另立副本），但它出生时的两处简化各有各的复现办法——读残这处，v0 原样带着同一副基因，拿它当事故标本；截断这处，我们去内核的物理现场和内存里的微缩内核取证。

## 事故现场：两起都在本机复现

第 3 章压测全绿之后的故事：一个手机网络上的用户把 v2 玩挂了。他的 GET 请求走了三秒、分四段到达，事件循环第一段没读全就当完整请求去解析，回了个 400；大响应方向反过来——内核发送缓冲写满，写出去的只有一半，页面显示到一半戛然而止，剩下的一半静默丢了。

先复现第一起。新工具 `slow_client`（慢客户端）登场：它把一个正常请求掰成 N 段、隔着延迟逐段发，专门扮演「慢网上的用户」。先把 v0 起在终端 1（`cd companion/src` 后 `python -m fable.blocking_server`），终端 2 跑：

```bash
cd companion/src
python -m fable.slow_client 127.0.0.1 8000 --frags 8 --delay 0.3
```

命令不到一秒就回来了——请求掰成的 7 段（--frags 8 按块长取整只能切出 7 段）还只发出去第 1 段，响应先到：

```text
HTTP/1.1 400 Bad Request
body: 16 bytes (Content-Length: 16) [完整]
```

服务器在 `recv` 返回处只收到了 `b'GET /'` 这 5 个字节，就拿它当完整报文去解析：请求行凑不齐三段，判罚 400。慢网用户什么都没做错——他发的请求和 curl 的一字不差，只是到货的节奏不同。

再把段切大一点，同一台 v0：

```bash
python -m fable.slow_client 127.0.0.1 8000 --frags 4 --delay 0.3
```

这次回的是 200。别松口气——这比 400 更糟。v0 收到的是 `b'GET / HTT'`，按「方法 SP 路径 SP 版本」切三段居然切得出来：方法 GET、路径 `/`、版本 `HTT`，解析「成功」，回了个内容完整、判断全错的 200。部分读的事故不总是面目狰狞的 400，**它常常伪装成一次成功的应答**。

第二起事故（写一半静默丢）的现场在「部分写」一节——它需要先讲清楚 write 的契约才看得懂。

## 字节流没有消息边界：部分读是常态

你大概一直默认：`read`（在 Python 里是 `recv`）返回的数据就是「一条完整的请求」。这是一个从用高层库的年代悄悄带进来的直觉——框架替你把报文攒齐了才给你。裸 TCP 不提供这个服务：它是字节流（byte stream），只保证字节按序到达，不承诺「一次读到的恰好是一条消息」。这条没有消息边界的性质是 TCP 的立身之本——发 1 字节也发 1 MB 都只是一个字节序列，怎么切消息是应用层的事。所以一次 `recv` 读到半条请求，不是异常，是常态；v0 在本机一直没出事，只因为 curl 的请求小到总是整体到达。

那「一条请求什么时候算完」由谁说了算？由报文语法说了算。RFC 9112 定的 HTTP/1.1 报文结构：一行请求行、若干行头部、一个空行收尾——空行就是「头部完了」的语法记号。换言之，「读完」是一个语法事件，不是一次到达事件；服务器要做的是攒字节、直到语法上凑齐。锚点：像逐字听抄电报，听到句号才算一句完整的话；每来一段就推进一步。

「每来一段就推进一步」——把「进行到哪一步了」写成显式状态的东西，叫状态机（state machine）。为什么非它不可？反事实摆在这：v2 的连接回调是一锤子买卖，函数调用结束，关于这条连接的记忆就没了——它不知道「我已经读到请求行的第 5 个字节」，下一批字节到货时它只能从头瞎猜。要接得住任意切分的到达，进度本身必须显式记下来；记进度的地方就是状态，推动它的输入就是每一段到货的字节。这就是状态机的成因：**没有记忆的回调接不住有进度的协议**。

## 解析器：请求行 → 头部 → 空行 → 完成

新模块 `fable/http_parser.py`，增量解析状态机。对外只有一份契约：`feed(bytes)` 喂一段到货字节，返回 `ParseResult`——三种回话之一：

```python
# src/fable/http_parser.py · 解析器的三种回话
NEED_MORE = "need_more"  # 还没读完：先攒着，等下一段
DONE = "done"            # 完成：一条完整请求已可交出
BAD = "bad"              # 坏信：请求行不合语法，该回 400
```

内部状态与转移，和实现一字对应：

| 当前状态 | 读到什么 | 转移 |
|---|---|---|
| request_line | 攒齐一行且合语法 | → headers（记下方法/路径/版本） |
| request_line | 攒齐一行但语法不对 | → 终态 bad（400 的判据） |
| headers | 攒齐一行、非空 | 留在 headers（记一个头部） |
| headers | 攒齐一行、是空行 | → 终态 done（交出 Request） |
| 任一状态 | 行还没攒齐 | 停在原状态，回话 need_more |

推进逻辑全部在一个函数里：

```python
# src/fable/http_parser.py · HttpRequestParser._advance 及两个小助手
    def _advance(self) -> ParseResult:
        """贪心推进：只要攒够了下一条完整行就往前走，推不动了才回话。"""
        while True:
            if self.state == REQUEST_LINE:
                line = self._recv.read_line()
                if line is None:
                    return self._need_more()
                parts = line.decode("latin-1").split(" ")
                if len(parts) != 3 or not all(parts):  # 方法 SP 路径 SP 版本，SP 只能一个
                    return self._bad(f"malformed request line: {line!r}")
                self._method, self._path, self._version = parts
                self.state = HEADERS
            elif self.state == HEADERS:
                line = self._recv.read_line()
                if line is None:
                    return self._need_more()
                if not line:  # 空行 = 头部结束 = 一条完整请求
                    self.state = COMPLETE
                    self._request = Request(self._method, self._path, self._version, self._headers)
                    return ParseResult(DONE, request=self._request)
                name, _, value = line.decode("latin-1").partition(":")
                self._headers[name.strip()] = value.strip()
            else:  # done / bad 是定态：重复 feed 不改判，回话保持一致
                if self._request is not None:
                    return ParseResult(DONE, request=self._request)
                return ParseResult(BAD, error=self._error)

    def _need_more(self) -> ParseResult:
        return ParseResult(NEED_MORE)

    def _bad(self, why: str) -> ParseResult:
        self.state = COMPLETE
        self._error = why
        return ParseResult(BAD, error=why)
```

三个设计点值得看仔细。其一，`feed` 之后是 while 循环贪心推进：一次到货可能带着好几行（curl 的常态），够走几步走几步；推不动（`read_line` 返回 None）才回 need_more。其二，「攒」的动作不在解析器里——`self._recv.read_line()` 来自下一节的收缓冲，解析器只管状态与判断，攒字节外包给专门的载体。其三，终态是定态：解析一问一答，bad 之后来再多字节也不改判，服务器该做的是回 400 然后关闭，而不是反复咀嚼坏信。

跟着算一遍（测试台里就是这么断言的）：把 `GET /docs/index.html HTTP/1.1\r\nHost: example.com\r\nUser-Agent: fable\r\n\r\n` 掰成 5 段 `GET /docs/i` / `ndex.html HTTP/1.1\r\nHo` / `st: example.com\r\nUser-Ag` / `ent: fable\r` / `\n\r\n`。第 1 段：没有行攒齐，need_more。第 2 段：请求行齐了，进 headers，`Ho` 没齐，need_more。第 3 段：Host 行放行、记入头部，`User-Ag` 没齐，need_more。第 4 段结尾是孤零零一个 `\r`——行尾记号被切在两段中间，find 找不到完整的 `\r\n`，照旧 need_more（这正是「攒到分隔符才放行」要过的坎）。第 5 段补上 `\n`，User-Agent 行放行，空行放行，done，交出 Request。前 4 段一律「还没读完」，第 5 段一次交清。

边界如实声明（与 v0 一脉相承，登记差异清单）：解析到空行即判完成，正文一字不读——本课程的 handler 只看请求行与头部，带正文的请求照常得到响应，正文字节被忽略；行尾只认 CRLF；请求行判罚一律 400。

## 缓冲区：攒收与记账的两本账

字节没到齐要先攒着——攒字节的内存就是缓冲区（buffer）。锚点：门口的邮筒，塞满了要等邮差清空才能接着塞。新模块 `fable/buffers.py` 给两个方向各配一本账。

收方向 `RecvBuffer`：「读到没到齐就攒着、到了齐再放行」。放行的判据两种，对应报文的两类读法：按行（请求行与头部）、按定长（正文按 Content-Length 读）。定长读法本课程不用，留作生长点。

```python
# src/fable/buffers.py · RecvBuffer 的按行放行与定长放行
    def read_line(self) -> bytes | None:
        """放行一条完整行（不含行尾 CRLF）；行没攒齐返回 None（还没读完）。"""
        i = self._buf.find(CRLF)
        if i < 0:
            return None
        line = bytes(self._buf[:i])
        del self._buf[: i + len(CRLF)]
        return line

    def read_upto(self, n: int) -> bytes:
        """定长放行：交出至多 n 字节，剩下的继续攒着等下次。"""
        take = bytes(self._buf[:n])
        del self._buf[:n]
        return take
```

`read_line` 的三行就是「没到齐就攒着」的全部：找不到行尾就返回 None，找到就连行带尾一起销账。第 4 段那个孤零零的 `\r` 之所以不误判，靠的是 find 找的是完整的 `\r\n`——分隔符跨段切断，自然要多等一段。

发方向 `SendBuffer` 解决的是另一半世界。先看 write 的真实契约——很多人默认「write 调用成功就全发出去了」，Python 官方文档不这么承诺，两句原话摆出来：

| 出处 | 原话 |
|---|---|
| Python 文档 · send() | "Returns the number of bytes sent." |
| Python 文档 · send() | "Applications are responsible for checking that all data has been sent; if only some of the data was transmitted, the application needs to attempt delivery of the remaining data." |

第一句：send 的回话是实发字节数，不是「发完了」。第二句把责任挑明：发没发完、续发剩下的，都是你应用自己的事。所以部分写（partial write）——一次 write 只写出去一部分——不是故障模式，是正常返回值的一部分。反过来看 sendall，文档的承诺更瘆人：

| 出处 | 原话 |
|---|---|
| Python 文档 · sendall() | "On error, an exception is raised, and there is no way to determine how much data, if any, was successfully sent." |

出错时抛异常，而且实发多少无从知晓。v2 恰好把两个坑各踩一半：非阻塞 socket 上调 `sendall`，再把 OSError 整个吞掉。一旦写不满，剩下的字节静默丢，连接照关。这就是第二起事故的全部代码形状。

那内核到底什么时候会写不下？本机实测，写端反压（backpressure——内核收不下时，把「写不动」顶回写端）有三副面孔。

```python
# 用法示例：写端反压的三副面孔（对端连上后一个字节都不读）
import socket, time

def tight_loop_chunks(window, total=4 * 1024 * 1024):
    srv = socket.socket(); srv.bind(("127.0.0.1", 0)); srv.listen(1)
    cli = socket.socket()
    if window:
        cli.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, window)
    cli.connect(("127.0.0.1", srv.getsockname()[1]))
    conn, _ = srv.accept(); conn.setblocking(False)
    sent, err = 0, None
    try:
        while sent < total:
            sent += conn.send(b"x" * 65536)
    except BlockingIOError:
        err = "BlockingIOError"
    print(f"紧循环分块 window={window}: 收下 {sent} 字节后 {err}")
    conn.close(); cli.close(); srv.close()

def single_mega_send(size=64 * 1024 * 1024):
    srv = socket.socket(); srv.bind(("127.0.0.1", 0)); srv.listen(1)
    cli = socket.socket()
    cli.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 4096)
    cli.connect(("127.0.0.1", srv.getsockname()[1]))
    conn, _ = srv.accept(); conn.setblocking(False)
    t0 = time.perf_counter()
    n = conn.send(b"x" * size)
    print(f"单发 {size} 字节（window=4096）: 一次全收，{n} 字节，{(time.perf_counter() - t0) * 1000:.1f} ms")
    conn.close(); cli.close(); srv.close()

tight_loop_chunks(None)
tight_loop_chunks(4096)
single_mega_send()
```

本机（win32，收发缓冲各 64 KiB）输出：

```text
紧循环分块 window=None: 收下 327680 字节后 BlockingIOError
紧循环分块 window=4096: 收下 131072 字节后 BlockingIOError
单发 67108864 字节（window=4096）: 一次全收，67108864 字节，19.7 ms
```

三副面孔逐条看。其一，分块紧着写、对端不读：内核收满一堵墙就报「暂时没有」——真实的写端反压，BlockingIOError 就是它的声音。墙的位置每次运行有浮动（本机默认窗下见过 320 KiB 到 448 KiB），要点是墙真实存在、缩窗后变矮。其二，把对端接收窗（SO_RCVBUF，内核替应用暂存到货字节的额度）压到 4 KiB：墙挪到 128 KiB。其三，同一副内核，单发一整块 64 MB，竟一次全收。第 1 章实测「读端零读取时 256 MB 照样吞下」的谜底在这里：Windows 回环对单次大块写几乎不设防，反压只在「分块写、对端不收」的节奏下现身。这份平台脾气带来两个如实声明（登记差异清单）。其一，v2 那种「sendall 一发大响应」的截断事故在本机回环上端到端复现不了——内核把单发大块整吞了，物理条件凑不齐。本章对它的复现是三件套：代码形状、内核物理（上面的墙）、内存里的微缩内核。其二，v3 按事件循环的节奏分块冲大响应（如 /big 的约 3.8 MB）在本机回环上一次撞墙都没有——反压没有现身。部分写的逻辑因此由一个记账严格透明的假字节流（内存微缩内核）在测试台里守着：物理不复现，逻辑必须成立。

`SendBuffer` 就是那本账，规矩一句：写不下去先攒着，下次可写再冲多少记多少。

```python
# src/fable/buffers.py · SendBuffer.flush
    def flush(self, write: Callable[[bytes], int], chunk_size: int = 65536) -> int:
        """冲一轮：把账上开头的一段递给 write（一次只递一块），返回本轮实冲字节数。

        write 得是非阻塞写（如 conn.send）：能收多少收多少、返回实收字节数，
        一个空位都没有时抛 BlockingIOError——那不是事故，是「下次可写再冲」
        的信号，差额原封不动留在账上。
        """
        if not self._pending:
            return 0
        sent = write(bytes(self._pending[:chunk_size]))
        if sent:
            del self._pending[:sent]
        return sent
```

一次只递一块（chunk_size）不是小气。每次写事件做一次有界的活，这是事件循环「谁就绪处理谁、处理完就走」的纪律——一块写不下去就回到循环，别的连接不受牵连。`pending` 归零，这条响应才算发完。测试台的假内核只有 30 字节容量，对 100 字节先收 30。对端读走 10，再冲 10。几轮下来 100 字节一个不少地送达——「冲完才关」这四个字，就是靠这本账撑着的。

## 水平触发与边缘触发：内核怎么喊「可以写了」

缓冲解决「记得住」，还剩「喊得对」：账上还有字节没冲出去时，写事件什么时候来喊我们？

多路复用的通知方式有两代脾气，关键原话从 man7.org 的 epoll(7) 摘出来对照：

| 出处 | 原话 |
|---|---|
| epoll(7) | "The epoll event distribution interface is able to behave both as edge-triggered (ET) and as level-triggered (LT)." |
| epoll(7) | "…a level-triggered interface (the default, when EPOLLET is not specified), epoll is simply a faster poll(2)…" |
| epoll(7) | "An application that employs the EPOLLET flag should use nonblocking file descriptors…" |
| epoll(7) | "…by waiting for an event only after read(2) or write(2) return EAGAIN." |

第一句说同一套接口有两种通知方式。水平触发（level-triggered，LT）是「条件还成立就一直提醒」——只要还写得动、还有数据没读完，每圈就绪名单都报你；第二句说这是默认档位。边缘触发（edge-triggered，ET）是「状态变化那一瞬间提醒一次」——事件只在监控对象发生变化时产生。锚点：水位灯（有水就一直亮）对涨水警铃（涨的那刻响一次）。

为什么这颗螺丝值得拧紧？看边缘触发漏报的形状：三段数据先后到达，警铃只在第一段落下的那一刻响。你若铃响时只读了一段就回去等，后两段永远不会再有铃——连接就死在「还有活、没人喊」上。所以 epoll(7) 给 ET 用户立了两条纪律（表中后两句）：一是必须配非阻塞文件描述符；二是配套动作——一口气读到写到一个字都进不去（报「暂时没有」）为止，才回去等下一次铃。nginx 走的就是这条 ET 路线；本课程的 v3 不走。如实声明两件事（登记差异清单）：本机 Windows 的 select 只有水平触发语义，LT/ET 对照全部出自 man7.org 的 epoll(7) 文档而非本机实测。Python 的 selectors 模块也不暴露 ET 开关，v3 就用 LT 把机制讲透——ET 是同一道题在 Linux 上的更快解法。

LT 对 v3 意味着什么？账上没冲完的连接登记成「等写」，只要内核还写得动，每圈就绪名单都会喊它——`_flush` 被喊一次冲一块，冲完注销。不用循环写到 EAGAIN，因为 LT 保证「只要条件在，提醒就在」。这也解释了第 3 章一个没细说的纪律：写兴趣只在有待发字节时登记——LT 模式下「可写」几乎是常态，一直挂着写兴趣等于让事件循环空转。

## 演练：v3 手术——把「一锤子回调」换成有记忆的连接

手术清单：`event_loop` 一行未改；`blocking_server` 与 `threaded_server` 原样不动（它们的历史形态就是教学素材）；动的是 `event_server`——连接从「一锤子回调」升级为带状态的对象。新模块两件：`http_parser`、`buffers`；新工具一件：`slow_client`。

监听套接字那边只改了一行：接受连接（accept）进来后，不再挂一个回调，而是发一本记账本。

```python
# src/fable/event_server.py · _on_accept_ready 的 on_accept
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

记账本本体是 `_Connection`：一条连接的全部记忆——解析器、发送缓冲，和「此刻在等什么」。

```python
# src/fable/event_server.py · _Connection 的读侧（__init__ 与 on_readable）
    def __init__(
        self,
        loop: event_loop.EventLoop,
        conn: socket.socket,
        handler: Callable[[Request], bytes],
    ) -> None:
        self._loop = loop
        self._conn = conn
        self._handler = handler
        self._parser = http_parser.HttpRequestParser()
        self._out = buffers.SendBuffer()
        self.state = "reading"  # reading（攒请求）→ responding（冲响应）

    def on_readable(self, _fileobj: object, _mask: int) -> None:
        """读就绪：把这批到货字节喂给解析器，按它的回话决定下一步。"""
        if self.state != "reading":
            return  # 已经在冲响应：这条连接此刻不该再被读事件喊到
        try:
            data = self._conn.recv(65536)
        except (BlockingIOError, InterruptedError):
            return  # 就绪名单偶发抢跑：暂时没读到就先回，下一圈再说
        except OSError:
            self._loop.close(self._conn)  # 对端重置连接：只关这一条，循环毫发无损
            return
        if not data:  # recv 读到空字节 = 对端已关闭
            self._loop.close(self._conn)
            return
        result = self._parser.feed(data)
        if result.need_more:
            return  # 没到齐就先攒着：这条连接留在读名单上等下一段
        if result.bad:
            response = build_response(400, "Bad Request", b"400 Bad Request\n")
        else:
            try:
                response = self._handler(result.request)
            except Exception:
                response = build_response(500, "Internal Server Error", b"500 Internal Server Error\n")
        self._start_response(response)
```

```python
# src/fable/event_server.py · _Connection 的写侧（_start_response / on_writable / _flush）
    def _start_response(self, response: bytes) -> None:
        """响应入账并切换兴趣：不再等读、改等写，先试着冲一轮。"""
        self.state = "responding"
        self._out.feed(response)
        self._loop.unregister(self._conn)  # 读名单除名：一问一答即关，不再收
        self._loop.register(self._conn, self.on_writable, selectors.EVENT_WRITE)
        self._flush()

    def on_writable(self, _fileobj: object, _mask: int) -> None:
        """写就绪：接着冲账上的字节（水平触发：只要还写得动，每圈都会喊到）。"""
        self._flush()

    def _flush(self) -> None:
        """冲一轮：写满就回（下次可写再冲），冲完才关。"""
        try:
            self._out.flush(self._conn.send)
        except (BlockingIOError, InterruptedError):
            return  # 内核发送缓冲满：差额记在账上，等下一次写就绪
        except OSError:
            self._loop.close(self._conn)  # 对端已断开：只关这一条，不算事故
            return
        if self._out.pending == 0:
            self._loop.close(self._conn)  # 冲完才关——v3 仍是一问一答即关
```

连接级的状态与转移，和实现一字对应：

| 状态 | 事件 | 动作 | 去向 |
|---|---|---|---|
| reading | 读就绪、读到字节 | 喂解析器：没到齐留在 reading；坏信算 400；完成算响应入账 | responding |
| reading | 读到空字节 / OSError | 对端已断 | 关闭 |
| responding | 写就绪 | 冲一轮账：冲完关闭；写满留在 responding 等下次 | responding / 关闭 |

一张图看全流：

```text
一段字节到货 ─recv→ 解析器.feed ──need_more──→ 攒着，留在读名单等下一段
                          │done / bad
                          ▼
                 handler 算响应 → SendBuffer 入账
                          │ 兴趣切换：READ → WRITE
                          ▼
        写就绪 ──flush──→ 实冲 n 字节、销 n 字节的账
           │                     │
   写满：账上留着，下次再冲      pending 归零 → 关闭
```

三处对照 v2 看清手术的落点。读侧：v2 把一次 `recv` 的结果直接塞给 parse_request，v3 把它喂给解析器，need_more 就安心回——「还没读完」从异常变成了正常回话。写侧：v2 一句 `sendall` 加吞异常，v3 入账、冲账、销账，pending 归零才关。兴趣切换：v2 只登记读（读完就关），v3 在响应算出时把连接从读名单挪到写名单——这条连接此刻唯一的悬念是「账什么时候冲平」，事件循环的注意力跟着悬念走。Reactor 模式的骨架没变：登记、等就绪、分发；变的是每个被分发的事件背后，多了一本翻到一半的账。

## 亲手验证

以下每条都请你自己跑。环境同前三章：本机 Python 3.10+，全程 127.0.0.1，不需要外网。用 git-bash 的读者留意：shell 会把 `/`、`/big` 这类开头是斜杠的参数改写成 Windows 路径，所以下面的命令都不带裸斜杠参数（`slow_client` 也做了兜底，`--path=big` 会自动当 `/big` 用）。

第一场，先猜后跑。v0 起在终端 1，终端 2 先写下预言——请求掰成 7 段（--frags 8 的实际切法）、每段隔 0.3 秒，v0 会等发完再答吗？回什么？然后跑：

```bash
cd companion/src
python -m fable.slow_client 127.0.0.1 8000 --frags 8 --delay 0.3
```

应看到 400 Bad Request，而且命令在第二段还没发出去时就带回了响应。工具每发一段前会偷看一眼连接：请求还没发完就有字节到货，本身就是服务器抢答的证据，它就地收下、不再喂剩下的段。换 `--frags 4` 再猜一次再跑：这次是 200——但服务器拿到的是半截请求行 `GET / HTT`，版本号解析成了 `HTT`。两副面孔，同一处伤口。

第二场，看 v3 结案。终端 1 换开 v3（`python -m fable.event_server`，应看到 `fable v3 (event loop + connection state machine) listening ...`）。终端 2 把方才两条命令原样再跑。两条都应看到 200 OK、body 21 bytes 完整——v3 把 7 段（--frags 4 时恰为 4 段）全部攒齐才解析应答。slow_client 也老实多了：最后一段发完之后，才等到回话。

第三场，大响应过微缩接收窗。先猜：接收窗压到 4 KiB、客户端收之前先愣 2 秒，3.8 MB 的 /big 会不会丢字节？跑：

```bash
python -m fable.slow_client 127.0.0.1 8000 --path=big --window 4096 --stall 2
```

应看到 `body: 3960000 bytes (Content-Length: 3960000) [完整]`。/big 攒正文那约 4 秒里，事件循环钉在 handler 上——第 3 章声明的单线程软肋，正好顺路再看一眼。本机实测同一场景的冲账节奏：256 KiB 的响应走 5 轮——4 轮 64 KiB 加最后一轮 43 字节（恰是一个响应头的长度）。/big 的约 3.8 MB 实测 61 轮、一次撞墙都没有（平台脾气见「部分写」一节的声明）。

第四场，测试台与指认破坏。验证物工程现有 56 条测试（全书累计；本章贡献 14 条）：

```bash
python -m unittest discover -s tests -t .
```

应看到 `Ran 56 tests` 与 `OK`（前三章 35 条 + 本章 14 条 + 后续章新增）。最后来一次指认好的小破坏：把 `_Connection._flush` 里那行 `if self._out.pending == 0:` 换成 `if True:`（一冲就关，不再等冲平）。先猜哪几条红，再跑核对：应看到恰好 1 条红——大响应完整送达那条（响应远大于一次能冲的量，第一轮冲完就关，客户端实收 64 KiB 出头）；碎片解析、假内核记账那些不红，它们守的是另外的账。旧 35 条不受影响。验完还原，重跑应全绿。

## 收束：两起事故的结案陈词

开篇那个手机用户的两起事故，现在你能从头讲到尾。第一起：他的请求分四段到，服务器的读侧没有记忆，第一段 `GET /` 就当完整报文硬解——回 400 算运气好，回个解析错乱的 200 更糟。v3 给每条连接配了解析状态机，请求行 → 头部 → 空行，攒不齐就报「还没读完」。第二起：大响应写进非阻塞 socket，write 只认实发字节数，v2 用 sendall 吞异常把差额静默丢了；v3 给发方向记账，冲多少销多少，pending 归零才关。收与发两本账挂在连接状态上，由就绪名单驱动——「等」依然集中，只是每条连接终于带着自己的进度活着。

v3 的清单：`http_parser`（增量解析状态机）、`buffers`（收发两本账）、`slow_client`（慢客户端工具）、`event_server` 演进（`serve` 接口与 v2 一字不差，全书 56 条测试全绿）。仍如实挂账的边界：一问一答即关（keep-alive 不做）、正文一字不读、行尾只认 CRLF——都在差异清单里。C10K 问题的账面上，v3 又抹掉一块风险溢价：不必像 v1 那样为每个连接付一条线程的栈内存与一次次上下文切换，单线程事件循环从「实验室网络里正确」变成「慢网与反压下也正确」。下一站把这条已经结实的事件循环，长成 master 带多个 worker 的多进程骨架。

自查三问（先自己答，再展开）：

<details>
<summary>1. 一条连接已进入 responding 状态，客户端此刻又发来一段字节（比如迟到的请求尾段），v3 会读到它吗？这个行为对哪条已声明的边界负责？</summary>

不会。`_start_response` 已把连接从读名单除名、登记成等写，读事件不会再喊到它；那段字节留在内核收缓冲里，直到连接关闭时一并丢弃。这是「一问一答即关」边界的直接推论——若将来做 keep-alive，响应冲平后要把读兴趣重新挂回去，并把余量字节喂回解析器。锚点：演练槽 `_start_response` 的除名与注销。
</details>

<details>
<summary>2. 把 `SendBuffer.flush` 的 chunk_size 从 65536 改成 4，大响应会出什么现象？正确性受不受影响？</summary>

现象：同样 256 KiB 要冲约 6.5 万轮才平，耗时大增、事件循环空转增多；正确性不受影响——每轮实冲多少销多少账，总量守恒，冲平才关的判据不变。这正是「记账」与「节奏」分离的好处：块大小只调节奏，不动账目。锚点：SendBuffer.flush 一节与假内核测试。
</details>

<details>
<summary>3. nginx 用边缘触发，为什么不怕「还有数据没读完、铃却不响」？它必须搭配的两条纪律是什么？</summary>

因为它不依赖铃提醒「还有活」：铃（状态变化）一来就一口气读到 EAGAIN（一个字节都进不去）才罢休，把队列彻底清空，所以下一次铃必然对应新到货。两条纪律：一是非阻塞文件描述符（epoll(7) 原话说 ET 用户 should use nonblocking file descriptors）。二是等到 read/write 返回 EAGAIN，才回去等下一个事件。LT（本课程 v3 的路子）则相反——条件还在就每圈都提醒，允许每轮只做有界的一点活。锚点：水平触发与边缘触发一节。
</details>
