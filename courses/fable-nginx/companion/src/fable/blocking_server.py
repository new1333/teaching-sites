"""v0 阻塞版 HTTP 服务器：一次只伺候一个连接的最小闭环。

fable.blocking_server — python -m fable.blocking_server 起服务，
curl http://127.0.0.1:8000/ 拿到响应。核心闭环 68 行（含空行，掐掉空行 57 行）。
"""
import dataclasses
import socket
import sys
import time
from pathlib import Path
from typing import Callable


@dataclasses.dataclass
class Request:
    """一条已解析的请求：方法、路径、版本、头部（正文 v0 先不管）。"""

    method: str
    path: str
    version: str
    headers: dict[str, str]


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


def build_response(
    status: int, reason: str, body: bytes, extra_headers: list[tuple[str, str]] = []
) -> bytes:
    """按报文语法组装响应：状态行 + 头部（含 Content-Length）+ 空行 + 正文。"""
    lines = [f"HTTP/1.1 {status} {reason}"]
    lines += [f"{name}: {value}" for name, value in extra_headers]
    lines.append(f"Content-Length: {len(body)}")
    head = "\r\n".join(lines) + "\r\n\r\n"
    return head.encode("latin-1") + body


def serve(host: str, port: int, handler: Callable[[Request], bytes]) -> None:
    """v0 阻塞服务循环：等连接 → 读请求 → 算响应 → 写回 → 关，一个接一个。"""
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind((host, port))
    server.listen(socket.SOMAXCONN)  # 排队等 accept 的连接，队列上限交给内核定
    print(f"fable v0 (blocking) listening on http://{host}:{port}/ ... Ctrl+C 停止", flush=True)
    while True:
        conn, _addr = server.accept()
        try:
            request = parse_request(conn.recv(65536))
            conn.sendall(handler(request))
        except ValueError:
            _try_send(conn, build_response(400, "Bad Request", b"400 Bad Request\n"))
        except Exception:
            _try_send(conn, build_response(500, "Internal Server Error", b"500 Internal Server Error\n"))
        finally:
            conn.close()  # 连接级隔离：这条连接的死活，绝不拖死服务循环


def _try_send(conn: socket.socket, data: bytes) -> None:
    try:
        conn.sendall(data)
    except OSError:
        pass  # 对方已断开就作罢，这不算服务器的事故


# ---------------------------------------------------------------- demo 应用
WWW_ROOT = Path(__file__).parent / "www"
CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".css": "text/css; charset=utf-8",
}


def _big_body(chunks: int = 80, per_chunk: float = 0.05) -> bytes:
    """构造约 3.8 MB 的大响应，并按块配速拖出约 4 秒的「传输中」窗口。

    真实网络上的慢在写端：客户端收不动、内核发送缓冲写满、sendall 卡住。
    Windows 回环的内核缓冲来者不拒（实测 256 MB 也直接吞），这种反压在
    本机复现不了——退而求其次让生成端配速，现象同型：v0 耗在连接 1
    身上的那几秒里，连接 2 只能干等。
    """
    unit = "fable v0 big response line 0123456789 abcdefghijklmnop\n"
    parts = []
    for _ in range(chunks):
        parts.append(unit * 900)  # 每块约 48 KB
        time.sleep(per_chunk)
    return "".join(parts).encode("ascii")


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


def main(argv: list[str]) -> int:
    host = argv[1] if len(argv) > 1 else "127.0.0.1"
    port = int(argv[2] if len(argv) > 2 else 8000)
    try:
        serve(host, port, demo_handler)
    except KeyboardInterrupt:
        print("\nfable v0 stopped.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
