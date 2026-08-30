---
title: 一个 HTTP 服务器的最小闭环
---

# 一个 HTTP 服务器的最小闭环

你八成调过别人的接口：`requests.get(...)` 一行，对面的服务器就给你回话。可是把角色调过来——让你现在凭空写一个「curl 能访问的服务」，第一行代码写什么？很多熟练的业务开发者在这里卡住，因为浏览器和框架把中间那层全藏掉了。这一章我们就把这层亲手写出来。它很小，小到一次只能伺候一个客户端：下载大文件期间，第二个 curl 连上了，却只能干等，一个字节都拿不到。记住这个「干等」——它是全书的起点，后面六章都在回答同一个问题：怎么让服务器不等。

## 剥掉外壳，Web 服务器是一个循环

先说结论的样子。Web 服务器（web server）——接收 HTTP 请求、返回 HTTP 响应的常驻程序——剥掉日志、配置、集群这些外壳，剩下的骨架是一个循环：

```text
while True:
    等一个客户端连上来
    把它要的东西读进来
    算出/找出要回的内容
    写回去
    关掉这条连接
```

v0 把这个循环原样写穿，一步不减。它的每一行都是「站定等」：等连接、等数据、等写完——术语叫阻塞（blocking），意思是这一步不完成，程序就钉在原地，别的谁也别想插队。第二个 curl 的干等，不是 bug，就是这个「钉在原地」的必然结果：服务器还钉在第一个连接的某一步上。

要在门口「等客户端连上来」，得先过三道手续。

### 门口的三道手续：套接字、监听、接受连接

两个程序隔着网络互发字节，字节的收发缓冲、该重传谁、发到第几个了——这些账本都记在操作系统内核（kernel，操作系统的核心部分，替所有程序管硬件和网络）那里，用户程序碰不到。程序需要一个「把手」去使唤这本账：内核就给每条网络对话发一个套接字（socket）——操作系统发的门牌号，程序拿着它才能收发字节。反过来想：要是没有门牌号，内核收到字节时都不知道该倒进哪个程序的缓冲区，对话根本无从谈起。

同一台机器上可能同时开着很多服务器，怎么区分字节该给谁？靠端口（port）——同一台机器上的分机号，Web 服务常驻 80 或 443 这类号码，我们的 v0 用 8000。

有了套接字，前两道手续是对一个总机的模仿（这也是全书第一个常驻类比）：

- **监听**（listen）：在一个端口上守着等人来连——总机守着电话线，铃没响就等着；
- **接受连接**（accept）：把等在门口的呼入接进来，拿到一个崭新的、可以开始说话的套接字——总机把这路呼入接进来通话。

注意这里出现了两个套接字，分工不同：

```text
监听套接字（守在 8000 端口，只管收线，不管说话）
    │
    │ accept() 返回：一路呼入被接了进来
    ▼
连接套接字 conn ←────字节来往────→ 客户端的套接字
（真正读请求、写响应的是它）
```

监听套接字像总机号码，永不参与通话；accept 每接一路，就生出一个连接套接字专管这路对话。这个「一门两 socket」的结构，后面每一章都踩在它上面。

## HTTP 报文：一封能直接读的信

连接通了，客户端说什么、服务器回什么？这就是 HTTP 报文（HTTP message）——HTTP 说的话。它的结构像一封信：第一行写要什么，下面几行备注，空一行，之后是正文。规范 RFC 9112 把它定得很死：报文由一行一行的文本组成，每行以 CRLF（`\r\n`，回车加换行两个字符）结尾；空行（只剩 CRLF 的一行）是「头部结束、正文开始」的分界线。

请求这封信的第一行叫请求行（request line）——报文第一行：方法 + 路径 + 版本，三段用单个空格隔开。

```text
GET /hello.txt HTTP/1.1\r\n     ← 请求行：方法 GET、路径 /hello.txt、版本 HTTP/1.1
Host: 127.0.0.1:8000\r\n        ← 头部行：名字: 值
User-Agent: curl/8.0\r\n        ← 头部行
\r\n                            ← 空行：头部到此为止（这个请求没有正文）
```

响应是镜像的一封信。第一行换成状态行：版本 + 状态码 + 短语。状态码（status code）是三位数的结果代号：200 成功、404 没找到、500 服务器自己出错了。状态行之后是同样几行的头部、一个空行、正文。

你大概有过「HTTP 底下是二进制」的印象——抓包工具里满屏十六进制，看起来不像人话。但那是工具的字节视图，不是协议本身：HTTP/1.1 的报文就是一行一行的纯文本，浏览器、curl、我们马上要写的服务器，说的是同一种「信」。它也不专属浏览器：任何会写 socket 的程序都能当客户端。待会儿的验证环节，你会亲手不带任何 HTTP 库、手打一行请求行，把这个说法证给自己看。

最后一件行李：Content-Length。TCP 连接里跑的是没有消息边界的字节流——一条一条字节排着队过来，本身不标「这封信到第几个字节算完」。所以响应头部里要有一行 `Content-Length: 4032000`，报明正文有几个字节。为什么非报不可？不报数，客户端只有两种可怜办法：要么等服务器砍断连接才敢认为「读完了」，可这样每条响应都得重连一次；要么在复用连接时把下一条响应的开头误读成本条的正文。报了数，收够 4032000 个字节就干脆收手，连接还能接着用。这个字段两边通用：请求带正文时（比如 POST 表单），同样靠它声明长度。

## v0：68 行的核心闭环

还剩一个心障：「自己写个 Web 服务器」听起来是高深的系统工程。公允地说，这个印象有来源——生产级服务器确实庞大。但庞大不在骨架：v0 的核心闭环——imports、一个 Request 数据类、四个函数（最后那个 `_try_send` 是五行兜底：对方已断开时 sendall 会抛错，作罢不算事故）——连空行带注释 68 行，掐掉空行 57 行。复杂度都在骨架之外的性能与功能上，那是后面几章的事。现在把它写出来，四步走。

### 第一步：先定回信的格式

写服务器前先想清楚「回信长什么样」，`build_response` 把上面那封信逐行拼出来：

```python
# src/fable/blocking_server.py · build_response
def build_response(
    status: int, reason: str, body: bytes, extra_headers: list[tuple[str, str]] = []
) -> bytes:
    """按报文语法组装响应：状态行 + 头部（含 Content-Length）+ 空行 + 正文。"""
    lines = [f"HTTP/1.1 {status} {reason}"]
    lines += [f"{name}: {value}" for name, value in extra_headers]
    lines.append(f"Content-Length: {len(body)}")
    head = "\r\n".join(lines) + "\r\n\r\n"
    return head.encode("latin-1") + body
```

状态行在前，头部随后，`Content-Length` 永远自动按 `len(body)` 报数——这就是「报文格式」的全部秘密：字符串按行拼好、加上结尾的空行、编码成字节。注意头部和正文之间是两个 CRLF：最后一个头部行自带一个，空行再补一个。

### 第二步：学会拆信

来信一侧，`Request` 是拆出来的结构，`parse_request` 负责拆：

```python
# src/fable/blocking_server.py · Request
@dataclasses.dataclass
class Request:
    """一条已解析的请求：方法、路径、版本、头部（正文 v0 先不管）。"""

    method: str
    path: str
    version: str
    headers: dict[str, str]
```

```python
# src/fable/blocking_server.py · parse_request
def parse_request(data: bytes) -> Request:
    """解析最小 HTTP 请求：一行请求行 + 若干行头部 + 一个空行。"""
    head, _, _body = data.partition(b"\r\n\r\n")
    lines = head.decode("latin-1").split("\r\n")
    parts = lines[0].split(" ")
    if len(parts) != 3 or not all(parts):  # 请求行 = 方法 SP 路径 SP 版本，SP 只能一个
        raise ValueError(f"malformed request line: {lines[0]!r}")
    headers = {}
    for line in lines[1:]:
        name, _, value = line.partition(":")
        headers[name.strip()] = value.strip()
    return Request(parts[0], parts[1], parts[2], headers)
```

第一刀切在第一个空行（`\r\n\r\n`）上，前半是头部，后半是正文——v0 把正文扔掉不管，只拆头部。然后是全函数唯一的「判罚」：请求行按空格切开必须恰好三段、每段非空。这正对着 RFC 9112 的规定——请求行就是方法、目标、版本三个被单个空格隔开的字段。差一点都算坏信：少写了版本号是两段，手滑打了双空格是四段，一律 `ValueError`，待会儿主循环会把它翻译成 400 响应。公允地说，规范同时容许接收方宽容——按任意空白切段解析也是合规行为，v0 选择较真，这是教学取舍，已登记差异清单。

### 第三步：主循环

骨架上场。盯住 `while True` 里的五步，它们与本节开头那个循环一一对应：

```python
# src/fable/blocking_server.py · serve
def serve(host: str, port: int, handler: Callable[[Request], bytes]) -> None:
    """v0 阻塞服务循环：等连接 → 读请求 → 算响应 → 写回 → 关，一个接一个。"""
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind((host, port))
    server.listen(socket.SOMAXCONN)  # 排队等 accept 的连接，队列上限交给内核定
    print(f"fable v0 (blocking) listening on http://{host}:{port}/ ... Ctrl+C 停止", flush=True)
    while True:
        conn, _addr = server.accept()
        # ↑ 第 2 章的手术刀就落在这里：循环不动，accept 之后开一条线程去伺候
        try:
            request = parse_request(conn.recv(65536))
            conn.sendall(handler(request))
        except ValueError:
            _try_send(conn, build_response(400, "Bad Request", b"400 Bad Request\n"))
        except Exception:
            _try_send(conn, build_response(500, "Internal Server Error", b"500 Internal Server Error\n"))
        finally:
            conn.close()  # 连接级隔离：这条连接的死活，绝不拖死服务循环
```

开三行：建套接字、绑端口、进入监听——门口三道手续的前两道。之后循环永远转：`accept()` 阻塞等线（没客人的时候服务器就钉在这行）；接到一路，`conn.recv` 读它的请求字节（又阻塞：客人不开口就一直等）；`handler` 算出响应字节；`sendall` 写回（还是阻塞：没写完不撒手）；`finally` 关连接。**v0 一次只伺候一个连接的根源就在这五行**：全部串在一条执行流里，前一路的五步不走完，后一路的 `accept` 根本执行不到——它只能在内核的排队区里坐着。

两个 `except` 是本课程的铁律「连接级隔离」：坏信回 400，handler 崩了回 500，但无论哪条连接出什么事，`while True` 都必须活着转到下一圈。`listen` 那行的排队区（backlog）值得记一笔：没被 accept 的连接由内核先收着排队——所以第二个 curl「连上了」却不报错，握手是内核替我们完成的，只是应用层永远没轮到它。

### 第四步：接上应用，开机

`serve` 是通用的：怎么算响应，交给 handler。开机演示用的 `demo_handler` 十来行：`/` 打招呼，`/big` 给大文件，其余按 `www/` 目录里的静态文件找，找不到 404：

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

`/big` 背后的 `_big_body` 要交代一处对现实的简化：它生成约 3.8 MB 正文，并故意按块配速、拖出约 4 秒的「传输中」窗口。真实网络上的慢发生在写端——客户端收不动、内核发送缓冲写满、`sendall` 卡住。但 Windows 回环（127.0.0.1）的内核缓冲来者不拒，我们实测连 256 MB 都直接吞下，这种反压在本机复现不出来；于是让生成端配速 4 秒，把「服务器耗在连接 1 身上」的窗口撑到肉眼可见。现象同型：这 4 秒里，连接 2 一样只能干等。这是全书登记在案的第一处平台差异（差异清单见附录）。

## 亲手验证

以下每条都请你自己跑。机器要求：装了 Python 3.10+ 的本机即可，全程 127.0.0.1，不需要网络。

**开机。** 第一个终端：

```bash
cd companion/src
python -m fable.blocking_server
```

应看到一行 `fable v0 (blocking) listening on http://127.0.0.1:8000/ ... Ctrl+C 停止`——服务器已在 8000 端口守着。第二个终端（另开一个，别关服务器）：

```bash
curl http://127.0.0.1:8000/
curl http://127.0.0.1:8000/hello.txt
```

第一条应回 `Hello from fable v0!`；第二条回 `www/hello.txt` 的文件内容——你的服务器已经在发静态文件了。

**手打请求行，证伪「二进制」。** 课程自带 `send_raw` 工具，它不带任何 HTTP 库。你打一行，它发一行（自动补 CRLF 和空行）。服务器的原始响应会被一字节不改地打回来：

```bash
python -m fable.send_raw 127.0.0.1 8000 "GET / HTTP/1.1" "Host: fable"
```

应看到完整的回信：`HTTP/1.1 200 OK`、两行头部、空行、正文——人读得懂的文本，没有半个看不懂的字节。现在两处先猜后跑，跑之前先把你的预言写下来：

1. 把请求行写残，只发 `"GET /"`（少了版本段）——服务器会怎么回？
2. 把整行小写：`"get / http/1.1"`——又会怎么回？

<details>
<summary>猜完了再展开：答案与原因</summary>

1. `400 Bad Request`。请求行按空格切开只有两段，过不了「恰好三段」的结构判罚——格式坏了，服务器较真。
2. `200 OK`，正文照回 Hello。结构上它是三段，v0 只验格式、不验语义：方法名该不该大写、版本字符串合不合法，RFC 都有话说（方法名是大小写敏感的），v0 故意装糊涂。服务器对「格式」与「语义」的宽严是两件事，这里你两个都见过了。
</details>

**复现「第二个 curl 干等」。** 两种拍法，都试：

拍法一，读端阻塞（最诚实的一版，没有任何模拟）：一个客户端连上却一言不发，v0 就钉在 `recv` 上等它开口。

```bash
# 终端 2：连上服务器，30 秒内一个字都不说（s= 必须留着——不接住返回值，连接会被当场关掉）
python -c "import socket,time; s=socket.create_connection(('127.0.0.1',8000)); time.sleep(30)"
```

趁这 30 秒，终端 3 跑 `curl http://127.0.0.1:8000/`——它会一动不动地干等，直到哑巴客户端到点、被服务器关掉，你的 Hello 才一口气到账。

拍法二，大响应窗口：终端 2 跑 `curl http://127.0.0.1:8000/big -o big.txt`（约 4 秒），紧接着终端 3 跑 `curl http://127.0.0.1:8000/`——第二个 curl 要干等到第一笔传完（约 4 秒）才回话。这 4 秒里服务器钉在哪？钉在连接 1 的 `handler` 里一块块攒正文。真实世界里它更常钉在 `sendall` 上（客户端网速收不动），机制同一副骨架：循环一次只伺候一个。

**测试台与一处小破坏。** 验证物工程里躺着本章的 13 条测试（cwd = `companion`）：

```bash
python -m unittest discover -s tests -t .
```

应看到末尾两行 `Ran 56 tests` 与 `OK`（全书累计——你拿到的是终态工程，本章贡献 13 条，其余是后续章新增的）。其中 `test_second_connection_waits_while_first_is_silent` 守的就是你刚才看到的干等现象。最后来一次指认好的小破坏：把 `serve` 里 `except ValueError` 分支那行 `_try_send(...)` 换成 `pass`，先猜本章贡献的 13 条里哪两条会红，再跑测试核对——验完把那行放回去，重跑应全绿。

## 收束：那个「干等」现在有名字了

开篇你说不清「第一行代码写什么」，现在你有了 68 行的答案；更重要的是，你能亲口解释第二个 curl 为什么干等了。握手由内核代办，它排进了 accept 队列；服务器这条执行流却钉在第一个连接的某一步上。等它开口（recv）、替它算（handler）、帮它写（sendall）——三处都可能是钉子。**阻塞循环一次只伺候一个连接，干等是它的本性，不是故障。**

v0 也留下了两笔账。一笔写在明处：怎么让服务器不等？下一章给阻塞循环接上「一连接一线程」，并用压测当场算出这个解法的代价——1999 年的 C10K 问题就从那笔账里来。一笔藏在暗处：`conn.recv` 我们只调了一次、把读到的一切当完整请求——请求要是掰成几段到达，v0 会读残；这个隐患第 4 章会回来现场复现并修成正经的连接状态机。

自查三问（先自己答，再展开）：

<details>
<summary>1. 用 send_raw 发 "POST /hello.txt HTTP/1.1"（方法改成 POST），会看到什么？为什么？</summary>

200，正文照样是 hello.txt 的内容。`demo_handler` 只看路径、不看方法；方法是什么意思，是 handler 的自由裁量。v0 的 handler 把所有方法都当 GET 对待——这本身也是一种可以商榷的宽容。
</details>

<details>
<summary>2. 把 build_response 里 Content-Length 那行删掉，curl 还拿得到正文吗？亏在哪？</summary>

拿得到（v0 每条响应后都关连接，curl 等连接关闭就知足了），但客户端从此不知道「正文几个字节、何时算完」；想复用连接就无从下口，只能每条响应砍一次连接重连一次。报数是为了「收手」和「复用」，不是为了把字节送出去——送字节是 TCP 的事。
</details>

<details>
<summary>3. 不看代码，怎么用一个肉眼可见的现象，向自己证明干等的 curl「TCP 握手已完成、卡的是应用层」？</summary>

在拍法一的哑巴客户端窗口期，另开终端跑 `curl -v http://127.0.0.1:8000/`：`-v` 会立刻打出 `Connected to 127.0.0.1`——连接建立了，握手这一步内核已经办完；然后整屏安静，响应迟迟不来——卡的是应用层，`serve` 的执行流还没走到下一圈 `accept()`。「连上了却没服务」被这个实验拆成两段：一段归内核，一段归应用。分清这两段，后面看任何服务器的连接数都不再是一团浆糊。
</details>
