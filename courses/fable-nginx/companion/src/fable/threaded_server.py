"""v1 线程版 HTTP 服务器：一连接一线程，accept 主循环从此不再被单条连接钉住。

fable.threaded_server — python -m fable.threaded_server 起服务。
HTTP 的解析与组装全部复用 v0（parse_request / build_response），
唯一的手术：accept 到一路连接，就派一条新线程去伺候它。
"""
import socket
import sys
import threading
from typing import Callable

from fable.blocking_server import Request, build_response, demo_handler, parse_request


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


def _try_send(conn: socket.socket, data: bytes) -> None:
    try:
        conn.sendall(data)
    except OSError:
        pass  # 对方已断开就作罢，这不算服务器的事故


def main(argv: list[str]) -> int:
    host = argv[1] if len(argv) > 1 else "127.0.0.1"
    port = int(argv[2] if len(argv) > 2 else 8000)
    try:
        serve(host, port, demo_handler)
    except KeyboardInterrupt:
        print("\nfable v1 stopped.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
