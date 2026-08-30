---
title: 反向代理：既当前台，又当传话员
---

# 反向代理：既当前台，又当传话员

第 5 章结账时留了话：给这台骨架装上 nginx 的当代主职。动手前先盘五章攒下的本事，用问题回忆：v0 那只阻塞服务器，为什么一次只能伺候一个连接？一连接一线程的三笔账（进程、栈内存、上下文切换），怎么把 C10K 问题请上台的？事件循环怎么用一张就绪名单，替掉满屋子干等的线程？select 与 epoll 两代 IO 多路复用差在哪？部分读、部分写的记账，怎么救回慢网上的 v3？第 5 章的 master-worker 架构，又怎么把一条循环复制成 N 台进程——顺手还带过 accept 惊群与优雅重载。这些问题你应当都答得上来，因为机器是你亲手造的。

但有件事它从头到尾没做过：自己回话。请求进来，handler 在自己进程里算出每一个字节。现实部署不长这样——跑业务的是 Python/Java 应用进程，nginx 挡在前面。为什么不让人直连应用？让浏览器直连试试就知道：应用挂了没人兜底，用户看见的就是一枚连接错误；上了两台应用没人分单，一台忙死一台闲死；静态文件再一挤占，应用宝贵的处理能力更不够用。三笔账都指向同一个形状：前面站一个不倒的前台，接客、传话、分单、兜底。你的服务器已经会伺候连接了，就差学会转身当客户端。这一章把「回头路」修通。

## 为什么不直连：前台的三笔账

把「直连试试就知道」展开成可核的账。第一笔，兜底。直连时应用一挂，浏览器拿到的是连接被拒——用户的屏幕上这是一枚报错，刷新也无济于事。挡在前面就不一样：前台还活着，它能把请求转给活着的另一台，全倒了也能自己回一句 502（Bad Gateway，网关错误——「我身后没人应门」，至少是一句体面的话，而不是一声忙音）。

第二笔，分单。两台应用怎么分工？让客户端自己挑，等于把运维问题发给每一个用户；让 DNS（把域名翻译成 IP 的那本电话簿）轮流指，切换粒度又太粗。前台来挑最自然——它看得见全部请求，正好把活匀开。

第三笔，能力分工。静态文件、压缩、缓存这类「不用惊动应用」的活，前台顺手就办了，应用腾出手专跑业务。这三笔账不需要新发明什么，需要的只是本章标题里的那个角色：反向代理（reverse proxy，替服务器出头的「总机」——对外一个门面，对内转手传话）。它把请求转给真实应用、把响应转回来，客户端看不到真服务器。现实里这些真实应用，站在反向代理的角度有个统称：上游（upstream，请求最终要去的那台服务器）。

## 方向说清楚：正向代理与反向代理

提到「代理」，你脑子里先冒出来的多半是翻墙工具。那个确实叫代理——正向代理（forward proxy，替客户端出头的中间人）。但它和反向代理的方向正好相反，混在一起，后面所有的部署图都会看拧。

两者的机械原理几乎一模一样：都是中间一台程序，一头当服务器收你的请求，另一头当客户端把请求发出去。差别只有一件事——它替谁出头。替客户端出头，服务器就看不到真客户端（公司出口代理、翻墙）；替服务器出头，客户端就看不到真服务器（nginx 挡在应用前）。一张表对齐：

| | 正向代理 | 反向代理 |
|---|---|---|
| 谁配置它 | 客户端（浏览器代理设置） | 服务器（机房部署） |
| 替谁出头 | 客户端 | 服务器 |
| 谁被隐身 | 服务器看不到真客户端 | 客户端看不到真上游 |
| 位置 | 客户端那一侧 | 服务器那一侧 |
| 典型用途 | 出口、翻墙、缓存 | 分单、兜底、TLS 终结（https 的加解密由前台代做）、静态文件 |

nginx 官方文档对它的主职只有一句话， ngx_http_proxy_module 的开篇：

| 出处 | 原话 |
|---|---|
| nginx.org · ngx_http_proxy_module | "The ngx_http_proxy_module module allows passing requests to another server." |

「把请求递给另一台服务器」——机械上就这么多。前面五章的伺候功力都在，缺的只是「当客户端」这半边，这正是本章手术的位置。

## 负载均衡：分的是请求数，不是字节数

前面说前台「分单」，这里有个广为流传的误会值得当场拆掉。你可能以为负载均衡（load balancing，把请求分摊到多台上游的策略）均衡的是流量字节数——谁闲就多分几个下载过去，把带宽也摊平。听着合理，但它不是轮询（round-robin，按固定顺序一圈圈发牌：第 1 个请求给 A，第 2 个给 B，第 3 个又回到 A）做的事，也不是 nginx 默认做的事。

轮询分的是**请求的个数**。算一遍就清楚：两台上游，10 个顺序到达的请求按 1、2、3……发牌——A 拿 1、3、5、7、9，B 拿 2、4、6、8、10，5 比 5，与每个请求是 17 字节还是 256 KiB 无关。nginx 官方对默认策略的表述：

| 出处 | 原话 |
|---|---|
| nginx.org · ngx_http_upstream_module | "The ngx_http_upstream_module module is used to define groups of servers that can be referenced by the proxy_pass, fastcgi_pass, uwsgi_pass, scgi_pass, memcached_pass, and grpc_pass directives." |
| nginx.org · ngx_http_upstream_module | "By default, requests are distributed between the servers using a weighted round-robin balancing method." |

默认是「带权重的轮询」——每台机器一个权重，按权重比例发牌，没有配权重时权重相等，退化成纯轮询。我们实现纯轮询这一档；权重、最少连接这些高档货本课不实现，去向见章末挂账清单。为什么按请求数分就够了？因为 HTTP 的业务粒度本来就是请求——一次页面渲染、一次下单。字节均衡反而救不了「慢请求扎堆」：一条跑十秒的接口不管多大字节，占的都是一整段处理时间。按个数匀开，慢请求至少不会全压在同一台上游身上。

## 原理：转身当客户端——同一张就绪名单的两类套接字

现在到本章真正的新功课。前五章里你写过的每一只套接字（socket，操作系统给「一条网络对话」发的门牌号），都是「等别人来连」的那一头。流程三步：bind 之后监听（listen，在端口上守着等人来连），来了就接受连接（accept，把等在门口的连接接进来）。整台服务器的事件循环里，从来只有 server 一类角色。

反向代理要开客户端这半边：对下游它 accept，对上游它主动 connect。好消息是底座早就铺好了——**select/epoll 不在乎一只文件描述符是哪一头开的**。IO 多路复用的名单上只有「这只描述符能不能读/能不能写」，监听 socket、下游连接、上游连接一律凭号入座。所以「同一事件循环里 server 与 client 两类套接字并存」不需要任何新机制：把主动连出去的非阻塞 socket 也登记进同一条 EventLoop 的名单，就绪了照常喊回调。

主动连这条路上有一处新地形：非阻塞的 connect 不会等你连上才返回。connect_ex（connect 的非阻塞版：结果用错误码报、不抛异常）发出握手请求就立刻回来，报「正在进行」；连接真正落定，要等这只 socket 以「可写」的面目出现在就绪名单上。落定不等于成功——成败要再问一句 SO_ERROR（socket 上积欠的最近一次错误码）：为零才是连上了，非零就是失败。这个「写就绪 + 查 SO_ERROR」的问答，就是客户端半边的 accept。

还有一个 Windows 平台的实测坑，值得先记下（差异清单有账）：失败的连接不是立刻露头的。本机实测，向一个没人监听的回环端口发起 connect，select 对这只 socket 沉默约两秒；落定之后它才以写就绪现身，SO_ERROR 里躺着错误码。这两秒里你就静等——清单上没有它的消息。Linux 的 epoll 走的是另一套就绪语义，这里如实按本机行为写，不猜内核。

## 演练：v5 手术——上游小而诚实，代理两边下注

### 先造上游：一台会自报身份的 v3

实验要两台上游。现实里上游是 Python/Java 应用，教学实验里它只要诚实：接请求、报名字、回定长响应。新模块 `fable/upstream_demo.py` 的伺候能力一行未写——直接复用第 4 章的 event_server，换的只有 handler：

```python
# src/fable/upstream_demo.py · make_handler 内层的 handler
    def handler(request: Request) -> bytes:
        text = [("Content-Type", "text/plain; charset=utf-8")]
        if request.path == "/":
            return build_response(200, "OK", f"hello from {name}\n".encode("ascii"), text)
        if request.path == "/big":
            unit = f"{name} big body line 0123456789 abcdefghijklmnopqrstuvwxyz\n"
            body = (unit * (BIG_BODY_BYTES // len(unit) + 1))[:BIG_BODY_BYTES]
            return build_response(200, "OK", body.encode("ascii"), text)
        return build_response(
            200,
            "OK",
            f"hello from {name} at {request.path}\n".encode("latin-1"),
            text,
        )
```

名字进正文，curl 一次就知道是谁伺候的；/big 给一段 256 KiB 的定长大正文，专门考代理转发的完整性。

### 代理的下游半边：旧货重组

`fable/proxy_server.py` 的 serve 与 v3 的骨架一字不差，还是那条 EventLoop（Reactor 模式的骨架：登记、等就绪、分发），先挂下游监听 socket。

```python
# src/fable/proxy_server.py · serve
def serve(
    host: str,
    port: int,
    upstreams: list[tuple[str, int]],
    poll_interval: float = 1.0,
    stop_flag: threading.Event | None = None,
) -> None:
    """v5 服务循环：下游监听与上游连接挂在同一条事件循环上。"""
    loop = event_loop.EventLoop()
    pool = _UpstreamPool(loop, list(upstreams))
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind((host, port))
    server.listen(socket.SOMAXCONN)
    server.setblocking(False)
    loop.register(server, _on_accept(loop, server, pool))  # 下游这头：仍是一台服务器
    names = ", ".join(f"{h}:{p}" for h, p in upstreams)
    print(
        f"fable v5 (reverse proxy, pid={os.getpid()}) listening on http://{host}:{port}/"
        f" -> {names} ... Ctrl+C 停止",
        flush=True,
    )
    try:
        loop.run(poll_interval, stop_flag)
    finally:
        loop.close_all()  # 收摊：下游与上游的 socket 一起关，不留悬空连接
```

每条下游连接还是一本记账：第 4 章的解析器原样复用，收到的字节喂进去，攒齐一条完整请求（HTTP 报文的空行处判齐，请求行与头部都由它管）。新的只有「攒齐之后干什么」——不找 handler，找上游池。

```python
# src/fable/proxy_server.py · _Downstream.on_readable
    def on_readable(self, _fileobj: object, _mask: int) -> None:
        """读就绪：把这批到货字节喂给解析器，按它的回话决定下一步。"""
        if self.state != "reading":
            return
        try:
            data = self._conn.recv(65536)
        except (BlockingIOError, InterruptedError):
            return
        except OSError:
            self._shutdown()
            return
        if not data:
            self._shutdown()
            return
        result = self._parser.feed(data)
        if result.need_more:
            return
        if result.bad:
            self.relay(build_response(400, "Bad Request", b"400 Bad Request\n"))
            return
        self.state = "relaying"
        self._loop.unregister(self._conn)  # 请求已读全：这条连接先下读名单，专心等上游
        self._pool.dispatch(result.request, self)
```

状态 reading → relaying → responding，形状与 v3 的连接状态机同款，只是中间多了一站「等上游」。发方向的功课也原样复用：响应进发送缓冲区（buffer，攒没发完的字节的账本），写就绪接着冲，冲完才关——部分写的记账一条不少。

### 分单器：轮询发牌与摘除

上游池是本章第一件新零件，三件事：发牌、划名、兜底。

```python
# src/fable/proxy_server.py · _UpstreamPool 的 dispatch / _pick / remove
    def dispatch(self, request: Request, downstream: _Downstream) -> None:
        """把一条下游请求发出去：挑一台上游、发起非阻塞连接。

        挑不到（名单被摘空）就由代理自己兜底回 502——前台不倒。
        """
        if downstream.closed:
            return
        addr = self._pick()
        if addr is None:
            downstream.relay(
                build_response(502, "Bad Gateway", b"502 Bad Gateway: no upstream available\n")
            )
            return
        _Upstream(self._loop, self, addr, request, downstream)

    def _pick(self) -> tuple[str, int] | None:
        """轮询发牌：第 1 张给名单头家，第 2 张给二家，第 3 张又回到头家。"""
        if not self._candidates:
            return None
        addr = self._candidates[self._cursor % len(self._candidates)]
        self._cursor += 1
        return addr

    def remove(self, addr: tuple[str, int]) -> None:
        """摘除一台上游：连接失败或中途断线时划掉，之后的牌不再发给它。"""
        if addr in self._candidates:
            host, port = addr
            print(f"[proxy] 上游 {host}:{port} 失联，从名单摘除", flush=True)
            self._candidates.remove(addr)
```

`_pick` 三行就是轮询的全部：游标走一格、发一张牌，取模绕回队首。摘除是即时的——连不上就划名，重发这条请求的牌自然落到下一台头上。注意摘除也是**持续的**：划掉之后不再自动放回，重启代理才回名单。这是教学取舍，真 nginx 有 max_fails / fail_timeout 一族的恢复节奏（短时间失败够数才摘、隔一段时间再放回来试）。

### 上游半边：connect、转发、攒响应

第二件新零件 `_Upstream`：一条朝上游去的客户端连接。它出生的那一刻，就是「两类套接字并存」落地的那一刻——这只主动连出去的 socket，登记进的是同一条 loop 的同一个名单。

```python
# src/fable/proxy_server.py · _Upstream.__init__
    def __init__(
        self,
        loop: event_loop.EventLoop,
        pool: _UpstreamPool,
        addr: tuple[str, int],
        request: Request,
        downstream: _Downstream,
    ) -> None:
        self._loop = loop
        self._pool = pool
        self._addr = addr
        self._request = request  # 原始请求留着：摘除重试时原样再发一次
        self._downstream = downstream
        self._out = buffers.SendBuffer()
        self._reader = _ResponseReader()
        self.state = "connecting"
        self._sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self._sock.setblocking(False)
        rc = self._sock.connect_ex(addr)  # 非阻塞连接：报「正在进行」就等写就绪
        if rc not in (0, *self._IN_PROGRESS):
            self._fail()  # 极少数错误当场就报：直接走摘除重试
            return
        if rc == 0:
            self._start_sending()  # 回环上连接可以当场成功：不必等就绪名单
            return
        self._loop.register(self._sock, self._on_connectable, selectors.EVENT_WRITE)
```

构造函数里那个 `loop` 就是从 serve 一路传下来的同一条事件循环——下游监听 socket 在它名单上，这只客户端 socket 也在。连接落定的回调，就是原理槽说的「写就绪 + 查 SO_ERROR」问答：

```python
# src/fable/proxy_server.py · _Upstream._on_connectable
    def _on_connectable(self, _fileobj: object, _mask: int) -> None:
        """连接落定（写就绪）：成败都查 SO_ERROR——Windows 上成败只在这里分晓。

        实测注脚：Windows 的 select 对「正在失败的连接」保持沉默（失败报在
        selectors 不盯的 exceptfds 名单上），要等内核落定后才以写就绪 +
        SO_ERROR 非零的面目出现——本机回环上从 connect 到落定约两秒。
        """
        if self.state != "connecting":
            return
        if self._sock.getsockopt(socket.SOL_SOCKET, socket.SO_ERROR) != 0:
            self._fail()
            return
        self._start_sending()
```

连上之后发请求。发出去的请求不是下游字节的原样搬运——解析器交出的是结构化的 Request，重新组装时报文原样，只有一行换血：Host 头部改成上游的名号。此刻我们是客户端，请求理应以「朝这台上游要东西」的面目发出。

```python
# src/fable/proxy_server.py · _rebuild_request
def _rebuild_request(request: Request, addr: tuple[str, int]) -> bytes:
    """把下游的请求重发给上游：报文原样，只有 Host 换成上游的名号。

    此刻我们是客户端——请求应该以「朝这台上游要东西」的面目发出。
    真 nginx 还会加 X-Forwarded-For / X-Real-IP 一族头（把「客户端真 IP 是谁」一路带给上游的备注头；差异清单见附录）。
    """
    host, port = addr
    lines = [f"{request.method} {request.path} {request.version}"]
    for name, value in request.headers.items():
        if name.lower() == "host":
            continue
        lines.append(f"{name}: {value}")
    lines.append(f"Host: {host}:{port}")
    return ("\r\n".join(lines) + "\r\n\r\n").encode("latin-1")
```

发方向的冲账又是旧货：SendBuffer 记账，写满回、可写再冲，冲完把这只 socket 从写名单挪到读名单，开始收上游的响应。收这头是本章最后一件新零件——响应侧的攒齐判据。请求那头第 4 章攒过（空行判齐），响应这头反过来：头部以空行收尾，正文的长短写在 Content-Length 里，攒够那个数才算一份完整响应。

```python
# src/fable/proxy_server.py · _ResponseReader.feed
    def feed(self, chunk: bytes) -> bytes | None:
        """喂一段到货字节：没攒齐返回 None，攒齐交出完整响应（头 + 正文）。"""
        self._buf += chunk
        if self._need is None:
            head_end = self._buf.find(b"\r\n\r\n")
            if head_end < 0:
                return None  # 头部还没到齐
            head = bytes(self._buf[:head_end])
            m = re.search(rb"(?im)^Content-Length:\s*(\d+)", head)
            if not m:
                raise ValueError("upstream response without Content-Length")
            self._need = head_end + 4 + int(m.group(1))
        if len(self._buf) < self._need:
            return None
        return bytes(self._buf[: self._need])
```

状态机的思路一以贯之：字节流没有消息边界，每来一段推进一步，推不动就报「还没到齐」。它依赖 Content-Length，chunked（不写总长、正文分成一段段自带长度的编码）的响应不在支持之列（教学边界，差异清单见附录）。攒齐一份，就回灌下游的发送缓冲，由下游自己冲账、冲完自己关——读写两侧各管各的缓冲，水平触发（有账没冲完就每圈提醒）的世界里谁也不欠谁；若换成 nginx 选择的边缘触发（涨水那刻只提醒一次），还得记得一口气读到空为止，那是第 4 章的功课。

失败路径收口在 `_fail`：关掉这只 socket、把这台上游划出名单、同一条请求原样重发给下一台。一路摘到名单空了，dispatch 的 502 分支兜底——前台不倒。一张图看全 v5 一条请求的路径，与实现一字对应：

```text
# 拼版：v5 一条请求的完整路径（两类套接字，同一条事件循环）
  curl ──► 下游监听 socket（accept：对 curl 说，我是服务器）
             │
             ▼
        下游连接 socket ── 第 4 章解析器攒请求（空行判齐）
             │ 请求攒齐 → 上游池轮询发牌（A、B、A、B……）
             ▼
        上游连接 socket ── 非阻塞 connect（对上游说，我是客户端）
             │ 转发请求：报文原样，Host 换成上游名号
             ▼
        上游 alpha（9001）／ beta（9002）── 响应自带名字
             │ 响应字节回流：头 + Content-Length 正文
             ▼
        响应记账攒齐 ── 回灌下游发送缓冲
             │ 部分写记账：写满回、可写再冲、冲完才关
             ▼
        curl 收到 hello from alpha
```

顺带一句 v4 与 v5 的关系：master-worker 架构与反向代理是两个正交的维度。v5 单独成模块、单进程跑，是为了把「传话」讲干净；真 nginx 的 worker 里跑的伺候逻辑本身就是代理逻辑——把 worker_pool 里 handler 换成「朝上游转发」，骨架一个字不用改。分两章各自吃透，拼起来就是完整形状。

## 亲手验证

以下每条都请你自己跑。环境同前五章：本机 Python 3.10+，全程 127.0.0.1，不需要外网；命令都从 `companion/src` 目录制。

第一场，开机三件套。终端 1、2 各起一台上游，终端 3 起代理：

```bash
cd companion/src
python -m fable.upstream_demo 127.0.0.1 9001 alpha
```

```bash
python -m fable.upstream_demo 127.0.0.1 9002 beta
```

```bash
python -m fable.proxy_server 127.0.0.1 8000 127.0.0.1:9001 127.0.0.1:9002
```

三个 banner 各自报到：alpha、beta 报 pid 与端口，代理报它盯着的前台地址与身后的上游名单。此刻你机器上有三台进程、一个前台、两台上游。

第二场，先猜后跑：十次 curl 怎么分。先写下预言——连发 10 次 `curl -s http://127.0.0.1:8000/`，会看到什么顺序？是不是精确的 5 比 5？然后跑（Git Bash）：

```bash
for i in $(seq 1 10); do curl -s http://127.0.0.1:8000/; done
```

应看到 `hello from alpha` 与 `hello from beta` 严格交替——第 1 张给 alpha、第 2 张给 beta，一圈圈发牌，正好 5 比 5。如果中途穿插了别的请求（比如你又手动 curl 过一次），牌就往后顺延——游标只认张数不认人。分单这件事从此不再神秘：它就是取模。

第三场，杀一台上游，前台不皱眉。回到 alpha 那个终端按 Ctrl+C（或按 banner 里的 pid：`taskkill //F //PID 那个pid`，任务管理器右键结束任务等效）。先猜后跑：再 curl 十次，第一条要等多久？后九条呢？内容会是什么？然后跑。预期：第一条顿约两秒——那两秒里代理正被沉默的 connect 卡着，等失败落定（原理槽的实测注脚）；随后代理终端打出 `[proxy] 上游 127.0.0.1:9001 失联，从名单摘除`，十条全部 `hello from beta`，零报错。摘除发生在失败落定之后，所以只有第一条买单。

第四场，复活实验：摘除不自愈。在 alpha 的终端原样再起一次（名字换成 alpha-2 也行，端口还是 9001）：

```bash
python -m fable.upstream_demo 127.0.0.1 9001 alpha-2
```

上游明明活着，再 curl 十次——应看到依然全部 beta。摘除是持续的：名单划掉就不自动放回，重启代理才回名单。真 nginx 的 max_fails / fail_timeout 恢复节奏长什么样、值不值得学，终章差距地图对账。

第五场，大正文原样过桥。第三、四场把 9001 摘出过名单，先复位：把代理 Ctrl+C 停掉再重启，让名单回到满员；然后直连上游与经代理各取一次 /big，逐字节比对（Git Bash）：

```bash
curl -s http://127.0.0.1:9001/big > direct.bin
curl -s http://127.0.0.1:8000/big > via-proxy.bin
cmp direct.bin via-proxy.bin && echo 逐字节一致
wc -c direct.bin via-proxy.bin
```

应看到 `逐字节一致` 与两个同样的字节数（262144）。cmd 用户用 `fc /b direct.bin via-proxy.bin` 代替 cmp。256 KiB 的正文一段不丢、一字不改——转发的完整性不是「大概齐」，是逐字节。

第六场，全部阵亡的兜底。把 beta 也 Ctrl+C 掉（alpha 已摘除），再 `curl -si http://127.0.0.1:8000/`：应看到 `HTTP/1.1 502 Bad Gateway` 与正文 `502 Bad Gateway: no upstream available`——前台自己在回话，而不是把连接错误甩给用户。这一条同样要先等约两秒：beta 还在名单上，最后一次连接尝试要等失败落定、摘除之后，502 才出手。守这个行为的测试台（cwd = `companion`）：

```bash
python -m unittest discover -s tests -t .
```

应看到 `Ran 56 tests` 与 `OK`（52 条旧测试未动，新增 4 条：轮询 5/5、杀一台全落幸存者且摘除不自愈、大正文逐字节一致、全阵亡回 502）。杀一台那条值得读一遍测试代码：它先把 alpha 停干净、验完十次全 beta，又在原端口复活一台 alpha-revived——「摘除持续」不是嘴上说的，是断言出来的。

## 收束：前台的答案

开篇那三笔账，现在你有一台亲手写的答案。为什么不让浏览器直连？挂了没人兜底——现在失联上游被即时摘除，全倒了还有 502 体面收场；两台没人分单——现在 10 个请求精确 5 比 5，分单就是一个取模游标；静态文件挤占应用——前台与上游的分工已经就位（静态伺候 v0 就会，留给把它们拼起来的日子）。「挡在前面」四个字，从部署图上的一个框，变成了你读过每一行的三段代码：下游解析、上游池发牌、客户端连接三件套。

v5 的清单：`proxy_server`（下游半边 + 上游池 + 上游半边 + 响应记账）、`upstream_demo`（自报身份的演示上游，伺服循环复用 v3）、4 条新测试共 56 条全绿。读者已能：起两台上游加一个代理、亲眼看 A/B 交替、杀一台上游后零报错继续服务、验证大正文逐字节过桥。仍如实挂账的（差异清单）：每请求一条新上游连接，无 keep-alive 连接池；整份响应攒齐才转发，不流式；请求不带正文（POST 的 body 不转发）；上游响应必须带 Content-Length；无上游超时——上游连上不回话，请求会一直挂着；无 X-Forwarded-For 一族头；摘除不自愈；Windows 上连接失败要等约两秒才以写就绪露头。真 nginx upstream 的高级策略——带权重的轮询、最少连接（least_conn）、健康检查——欠终章差距地图一张交代。下一章就是终章：把你写的这台和真 nginx 逐项对账，全书收口。

自查三问（先自己答，再展开）：

<details>
<summary>1. 摘除如果做成「自愈」——比如 30 秒后自动把失联上游放回名单——会发生什么？代价和好处各在哪？</summary>

好处：复活的上游自动回归，不用重启代理，运维省事。代价：每 30 秒就有一批真实用户的请求拿去试探那台上游——它要是真活了还好，要是「连得上但不回话」的半死状态，试探本身就变成周期性事故；上游频繁抖动时，名单进进出出，分单也跟着抖。真 nginx 的折中是 max_fails / fail_timeout：窗口内失败够数才摘，摘够一段时间再放回，用节奏换安全。我们的实现选择最保守的一档：摘了不放，重启才回。锚点：演练槽 `_UpstreamPool.remove` 与第四场复活实验。
</details>

<details>
<summary>2. 预测一下：下游请求到达、代理刚 connect 出去，这一瞬间下游连接挂在这条事件循环的什么位置？为什么它这时不会被读事件喊到？</summary>

挂在名单之外——请求读全时 `_Downstream.on_readable` 亲手把它从读名单注销了（state 切到 relaying）。不注销的话，水平触发下客户端后续字节（或对端关闭的 EOF）会反复喊这条连接的读回调，而它已经没有请求可攒。一问一答的模型里，等上游的那段时间下游就是「专心等待」，谁的名单都不进；响应攒齐才重新登记进写名单。锚点：演练槽 `_Downstream.on_readable` 的注销行与 `relay` 的重新登记。
</details>

<details>
<summary>3. 下游发来一条 POST，正文带 1 KiB 数据，我们的代理会怎么处理？curl 会看到什么？</summary>

解析器读到头部的结束空行就交卷——正文一字不读（第 4 章立的边界），Request 里没有正文的影子。转发出去的是一条没有正文的 POST，Host 已换、正文已丢；upstream_demo 不看方法，照样回 200，curl 看到的是「成功」。也就是说：GET 之外的方法在报文层面能过，正文是真切丢的。真代理必须按请求头里的 Content-Length 把正文搬过去，我们没做——边界在模块 docstring 里声明过，账在差异清单。锚点：演练槽 `_rebuild_request` 与 http_parser 的边界注释。
</details>
