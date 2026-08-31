"""v5 反向代理：同一事件循环里，既当前台，又当传话员。

fable.proxy_server — python -m fable.proxy_server 127.0.0.1 8000 127.0.0.1:9001
127.0.0.1:9002 起代理。骨架仍是那条 EventLoop，这次往名单里挂了两类套接字：
下游监听 socket（对浏览器 curl 说，它是服务器）与上游连接 socket（对上游说，
它是客户端）。每条下游请求到达时按轮询挑一台上游、非阻塞地连过去、把请求
转发上去，上游的响应攒齐后回灌下游的发送缓冲——前台与传话员，同一循环。

故障摘除：连不上或中途断掉的上游，从名单里即时划掉、换下一台重发同一条
请求；划掉是持续的（不自愈，重启代理才回名单——真 nginx 有 max_fails /
fail_timeout 的恢复机制，差距见差异清单）。名单划空时代理自己回 502。

与 v3 一脉相承的边界（差异清单见附录）：一问一答即关；请求不带正文
（GET 类）；上游响应必须带 Content-Length（不支持 chunked）；整份响应
攒齐才转发（不流式）；上游连上却不回话时请求会一直等（无超时）。
"""
import argparse
import errno
import os
import re
import selectors
import socket
import sys
import threading
from typing import Callable

from fable import buffers, event_loop, http_parser
from fable.blocking_server import Request, build_response


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


def _on_accept(
    loop: event_loop.EventLoop,
    server: socket.socket,
    pool: "_UpstreamPool",
) -> Callable[[object, int], None]:
    """下游门口就绪的回调：接进来、设非阻塞、等它把请求说完。"""

    def on_accept(_fileobj: object, _mask: int) -> None:
        try:
            conn, _addr = server.accept()
        except OSError:
            return  # 偶发竞争（对端连上又立刻断开）：下一圈就绪名单还会报
        conn.setblocking(False)
        downstream = _Downstream(loop, pool, conn)
        loop.register(conn, downstream.on_readable)

    return on_accept


class _Downstream:
    """下游这头的一条连接：把请求攒齐交给上游池，等响应回来再冲出去。

    状态×转移（与实现一字对应）：

    | 状态       | 事件             | 动作                                   | 去向            |
    |-----------|------------------|----------------------------------------|-----------------|
    | reading   | 读就绪·读到字节  | 喂解析器：没到齐回 reading；坏信回 400；| relaying        |
    |           |                  | 完成则挑上游、发起非阻塞连接            |                 |
    | reading   | 读到空 / OSError | 对端已断                               | 关闭            |
    | relaying  | （上游池回话）   | 响应入账                               | responding      |
    | responding| 写就绪           | 冲一轮缓冲：冲完关闭；写满回 responding | responding/关闭 |
    """

    def __init__(
        self,
        loop: event_loop.EventLoop,
        pool: "_UpstreamPool",
        conn: socket.socket,
    ) -> None:
        self._loop = loop
        self._pool = pool
        self._conn = conn
        self._parser = http_parser.HttpRequestParser()
        self._out = buffers.SendBuffer()
        self.state = "reading"  # reading（攒请求）→ relaying（等上游）→ responding（冲响应）

    @property
    def closed(self) -> bool:
        """这条下游连接还在吗——上游回话时先看它，别对着空气冲账。"""
        return self.state == "closed"

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

    def relay(self, response: bytes) -> None:
        """上游池的回话（上游响应或代理自己的 502）：入账并切到发送。"""
        if self.closed:
            return  # 下游早走了：对端关了的连接不再冲账
        self.state = "responding"
        self._out.feed(response)
        self._loop.unregister(self._conn)  # 幂等注销：坏请求路径直通到这里时还挂在读名单上
        self._loop.register(self._conn, self.on_writable, selectors.EVENT_WRITE)
        self._flush()

    def on_writable(self, _fileobj: object, _mask: int) -> None:
        """写就绪：接着冲账上的字节（水平触发：还写得动就每圈都喊到）。"""
        self._flush()

    def _flush(self) -> None:
        """冲一轮：写满就回（下次可写再冲），冲完才关。"""
        try:
            self._out.flush(self._conn.send)
        except (BlockingIOError, InterruptedError):
            return
        except OSError:
            self._shutdown()
            return
        if self._out.pending == 0:
            self._shutdown()  # 冲完才关——v5 仍是一问一答即关

    def _shutdown(self) -> None:
        """关这条下游连接：注销、关闭、记为 closed（幂等）。"""
        self.state = "closed"
        self._loop.close(self._conn)


class _UpstreamPool:
    """上游名单 + 发牌器：轮询分单、失败摘除、摘空兜底 502。"""

    def __init__(self, loop: event_loop.EventLoop, candidates: list[tuple[str, int]]) -> None:
        self._loop = loop
        self._candidates = list(candidates)
        self._cursor = 0  # 轮询游标：每发一张牌走一格，一圈圈发回去

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


class _Upstream:
    """一条朝上游去的客户端连接：连上 → 发请求 → 收响应 → 回灌下游。

    对下游说我们是服务器，对上游说我们是客户端——同一条事件循环里，
    这只 socket 与下游监听 socket 共用一个就绪名单。

    | 状态        | 事件         | 动作                                       | 去向            |
    |------------|--------------|--------------------------------------------|-----------------|
    | connecting | 写就绪       | 查 SO_ERROR：非零即摘除重试；为零开始发请求 | sending         |
    | sending    | 写就绪       | 冲请求：冲完改等读                          | receiving       |
    | receiving  | 读就绪       | 收响应：攒齐交下游；断线摘除重试             | 关闭            |
    | 任一状态   | 连接/读写失败 | 摘除这台上游，同一条请求换下一台重发          | 关闭→relaying   |
    """

    _IN_PROGRESS = (errno.EWOULDBLOCK, errno.EINPROGRESS)  # 非阻塞 connect 的「正在进行」

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

    def _start_sending(self) -> None:
        """连上了：请求入账（Host 改成上游的名号——现在我们是客户端），改等写。"""
        self.state = "sending"
        self._out.feed(_rebuild_request(self._request, self._addr))
        self._loop.unregister(self._sock)  # 连接期盯的是「连上没有」，发送期改盯「能不能写」
        self._loop.register(self._sock, self._on_writable, selectors.EVENT_WRITE)
        self._flush_request()

    def _on_writable(self, _fileobj: object, _mask: int) -> None:
        """写就绪：接着冲请求，冲完把这只 socket 从写名单挪到读名单。"""
        if self.state == "sending":
            self._flush_request()

    def _flush_request(self) -> None:
        """冲一轮请求：写满就回，冲完改等读（上游的响应要从这头收）。"""
        try:
            self._out.flush(self._sock.send)
        except (BlockingIOError, InterruptedError):
            return
        except OSError:
            self._fail()
            return
        if self._out.pending == 0:
            self.state = "receiving"
            self._loop.unregister(self._sock)
            self._loop.register(self._sock, self._on_readable, selectors.EVENT_READ)

    def _on_readable(self, _fileobj: object, _mask: int) -> None:
        """读就绪：收上游的响应，攒齐一份完整的才交下游。"""
        if self.state != "receiving":
            return
        try:
            data = self._sock.recv(65536)
        except (BlockingIOError, InterruptedError):
            return
        except OSError:
            self._fail()
            return
        if not data:  # 响应没攒齐连接就断了：上游中途阵亡
            self._fail()
            return
        try:
            response = self._reader.feed(data)
        except ValueError:  # 没有 Content-Length 的响应没法判「攒齐」
            self._fail()
            return
        if response is not None:
            self._close_sock()
            self._downstream.relay(response)  # 回灌下游发送缓冲，接着由下游自己冲

    def _fail(self) -> None:
        """这条路走不通：关掉、摘除这台上游、同一条请求换下一台重发。"""
        if self.state == "failed":
            return  # 幂等：一条连接只算一次失败
        self.state = "failed"
        self._close_sock()
        self._pool.remove(self._addr)
        self._pool.dispatch(self._request, self._downstream)

    def _close_sock(self) -> None:
        self._loop.close(self._sock)


class _ResponseReader:
    """收方向攒上游响应：头部到齐读 Content-Length，正文按它攒齐。"""

    def __init__(self) -> None:
        self._buf = bytearray()
        self._need: int | None = None  # 攒到第几个字节算一份完整响应

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


def _parse_upstream(text: str) -> tuple[str, int]:
    """把 127.0.0.1:9001 这样的参数拆成 (host, port)。"""
    host, _, port = text.rpartition(":")
    if not host or not port.isdigit():
        raise SystemExit(f"上游参数应为 host:port 形式，拿到的是 {text!r}")
    return host, int(port)


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m fable.proxy_server",
        description="v5 反向代理：轮询分单、故障摘除，上游用 python -m fable.upstream_demo 起",
    )
    parser.add_argument("host", nargs="?", default=None)
    parser.add_argument("port", type=int, nargs="?", default=None)
    parser.add_argument("upstreams", nargs="*", default=None, help="上游列表，host:port 形式")
    parser.add_argument("--host", dest="host_opt", default=None)
    parser.add_argument("--port", dest="port_opt", type=int, default=None)
    parser.add_argument(
        "--upstream",
        dest="upstream_opts",
        action="append",
        default=None,
        metavar="HOST:PORT",
        help="等号写法 --upstream=127.0.0.1:9001 最稳，可重复",
    )
    args = parser.parse_args(argv[1:])

    host = args.host_opt or args.host or "127.0.0.1"
    port = args.port_opt or args.port or 8000
    raw = args.upstream_opts or args.upstreams or ["127.0.0.1:9001", "127.0.0.1:9002"]
    try:
        upstreams = [_parse_upstream(item) for item in raw]
    except SystemExit as e:
        print(e, file=sys.stderr)
        return 2
    try:
        serve(host, port, upstreams)
    except KeyboardInterrupt:
        print("\nfable v5 stopped.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
