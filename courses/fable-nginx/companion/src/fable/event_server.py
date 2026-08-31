"""v3 事件驱动版 HTTP 服务器：每条连接是一个有记忆的状态机。

fable.event_server — python -m fable.event_server 起服务。骨架仍是第 3 章的
单线程事件循环（EventLoop 一行未改），换的是连接的伺候方式：v2 的连接回调
是「一锤子买卖」——读一次当读全、sendall 一次当发全，跨在这两头的简化
在第 4 章拆掉。v3 给每条连接发一本记账本（收方向的解析器 + 发方向的
缓冲 + 当前等读还是等写），读事件喂解析器、解析完成算响应进发送缓冲、
写事件继续冲缓冲、冲完才关——「进行到哪一步了」从此是显式状态。

与 v0 一脉相承的边界（差异清单见附录）：一问一答即关（keep-alive 不做）；
正文一字不读；坏请求行一律 400。
"""
import selectors
import socket
import sys
import threading
from typing import Callable

from fable import buffers, event_loop, http_parser
from fable.blocking_server import Request, build_response, demo_handler


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


class _Connection:
    """一条连接的全部记忆：解析器、发送缓冲，与「此刻在等什么」。

    状态×转移（与实现一字对应）：

    | 状态        | 事件         | 动作                                   | 去向            |
    |------------|--------------|----------------------------------------|-----------------|
    | reading    | 读就绪·读到字节 | 喂解析器：没到齐回 reading；坏信算 400；| responding      |
    |            |              | 完成算响应进发送缓冲                    |                 |
    | reading    | 读到空 / OSError | 对端已断                               | 关闭            |
    | responding | 写就绪       | 冲一轮缓冲：冲完关闭；写满回 responding | responding/关闭 |
    """

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


def main(argv: list[str]) -> int:
    host = argv[1] if len(argv) > 1 else "127.0.0.1"
    port = int(argv[2]) if len(argv) > 2 else 8000
    try:
        serve(host, port, demo_handler)
    except KeyboardInterrupt:
        print("\nfable v3 stopped.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
