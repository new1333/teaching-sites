"""第 1 章测试：v0 阻塞版 HTTP 服务器的最小闭环。

断言的是 milestone 的行为，不是实现细节：
- parse_request / build_response 按 HTTP/1.1 报文语法工作；
- serve 起在 loopback 随机端口上，curl 等价的裸 socket 客户端能拿到响应；
- 「一次只伺候一个连接」：第一个连接的大响应没传完，第二个连接必须干等；
- 连接级隔离：坏请求、handler 抛异常、连上就断，都只影响那一条连接。
"""
import socket
import threading
import time
import unittest
from pathlib import Path

from fable import blocking_server
from fable.blocking_server import Request, build_response, demo_handler, parse_request, serve
from fable.send_raw import send_raw

WWW_HELLO = (Path(blocking_server.__file__).parent / "www" / "hello.txt").read_bytes()


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def start_server(handler) -> int:
    """把 v0 起在守护线程的随机端口上，轮询等它开始监听，返回端口号。"""
    port = free_port()
    threading.Thread(
        target=serve, args=("127.0.0.1", port, handler), daemon=True
    ).start()
    deadline = time.monotonic() + 2.0
    while time.monotonic() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                return port  # 探活连接立即断开，服务器必须挺住
        except OSError:
            time.sleep(0.02)
    raise AssertionError("server did not start listening within 2s")


def http_get(port: int, path: str, timeout: float = 5.0) -> bytes:
    """裸 socket 客户端：发一条最小 GET，读回服务器给出的全部字节。"""
    request = f"GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n".encode()
    with socket.create_connection(("127.0.0.1", port), timeout=timeout) as conn:
        conn.settimeout(timeout)
        conn.sendall(request)
        chunks = []
        while True:
            chunk = conn.recv(65536)
            if not chunk:
                break
            chunks.append(chunk)
    return b"".join(chunks)


class ParseRequestTest(unittest.TestCase):
    def test_extracts_method_path_version_and_headers(self):
        raw = (
            b"GET /hello.txt HTTP/1.1\r\n"
            b"Host: 127.0.0.1:8000\r\n"
            b"User-Agent: curl/8.0\r\n"
            b"\r\n"
        )
        req = parse_request(raw)
        self.assertEqual(req.method, "GET")
        self.assertEqual(req.path, "/hello.txt")
        self.assertEqual(req.version, "HTTP/1.1")
        self.assertEqual(req.headers["Host"], "127.0.0.1:8000")
        self.assertEqual(req.headers["User-Agent"], "curl/8.0")

    def test_request_line_needs_exactly_two_spaces(self):
        for bad in (b"HELLO\r\n\r\n", b"GET /\r\n\r\n", b"GET  / HTTP/1.1\r\n\r\n", b"", b"\r\n\r\n"):
            with self.subTest(raw=bad):
                with self.assertRaises(ValueError):
                    parse_request(bad)


class BuildResponseTest(unittest.TestCase):
    def test_wire_format_is_rfc9112_shape(self):
        resp = build_response(
            200, "OK", b"hi", extra_headers=[("Content-Type", "text/plain")]
        )
        head, _, body = resp.partition(b"\r\n\r\n")
        lines = head.split(b"\r\n")
        self.assertEqual(lines[0], b"HTTP/1.1 200 OK")
        self.assertIn(b"Content-Type: text/plain", lines)
        self.assertIn(b"Content-Length: 2", lines)  # 正文 'hi' 正好 2 字节
        self.assertEqual(body, b"hi")

    def test_content_length_always_matches_body_bytes(self):
        for body in (b"", b"x", "中文两字".encode(), b"a" * 10000):
            with self.subTest(len(body)):
                resp = build_response(404, "Not Found", body)
                head = resp.partition(b"\r\n\r\n")[0].decode()
                declared = int(
                    next(l.split(": ")[1] for l in head.split("\r\n") if l.startswith("Content-Length"))
                )
                self.assertEqual(declared, len(body))
                self.assertTrue(resp.endswith(body))


class ServeLoopTest(unittest.TestCase):
    def test_hello_over_real_socket(self):
        port = start_server(demo_handler)
        resp = http_get(port, "/")
        self.assertTrue(resp.startswith(b"HTTP/1.1 200 OK\r\n"))
        self.assertIn(b"Hello", resp)

    def test_static_file_served_from_www(self):
        port = start_server(demo_handler)
        resp = http_get(port, "/hello.txt")
        self.assertTrue(resp.startswith(b"HTTP/1.1 200 OK\r\n"))
        self.assertTrue(resp.endswith(WWW_HELLO))

    def test_missing_file_is_404(self):
        port = start_server(demo_handler)
        resp = http_get(port, "/nope.txt")
        self.assertTrue(resp.startswith(b"HTTP/1.1 404 Not Found\r\n"))

    def test_second_connection_waits_while_first_is_silent(self):
        """钩子现象的机械版（读端）：第一个连接一言不发，第二个连接必须干等。

        Windows 回环的内核缓冲来者不拒，「客户端收不动 → sendall 卡住」这种
        写端反压在本机复现不了；读端等价现象百分之百确定：v0 的服务循环
        阻塞在 recv 上等 first 开口，second 的请求就没人接。
        """
        port = start_server(demo_handler)

        first = socket.create_connection(("127.0.0.1", port), timeout=5)  # 连上但一个字不发
        second = socket.create_connection(("127.0.0.1", port), timeout=5)
        second.sendall(b"GET / HTTP/1.1\r\nHost: b\r\n\r\n")
        second.settimeout(0.5)
        with self.assertRaises(socket.timeout):
            second.recv(65536)  # 干等：v0 还在等 first 开口

        first.sendall(b"GET / HTTP/1.1\r\nHost: a\r\n\r\n")  # first 终于开口
        first.settimeout(5)
        self.assertTrue(first.recv(65536).startswith(b"HTTP/1.1 200 OK\r\n"))
        second.settimeout(5)  # first 伺候完、连接关闭，second 才被轮到
        self.assertTrue(second.recv(65536).startswith(b"HTTP/1.1 200 OK\r\n"))
        first.close()
        second.close()

    def test_second_connection_waits_during_big_response(self):
        """钩子现象的机械版（写端窗口）：/big 的 4 秒生成窗口里，第二个连接干等。"""
        port = start_server(demo_handler)

        first = socket.create_connection(("127.0.0.1", port), timeout=10)
        first.sendall(b"GET /big HTTP/1.1\r\nHost: a\r\n\r\n")

        second = socket.create_connection(("127.0.0.1", port), timeout=5)
        second.sendall(b"GET / HTTP/1.1\r\nHost: b\r\n\r\n")
        second.settimeout(0.5)
        with self.assertRaises(socket.timeout):  # 窗口 4 秒 >> 0.5 秒，确定性成立
            second.recv(65536)

        drained = b""
        first.settimeout(10)
        while True:
            chunk = first.recv(1 << 20)
            if not chunk:
                break
            drained += chunk
        self.assertTrue(drained.startswith(b"HTTP/1.1 200 OK\r\n"))
        self.assertGreater(len(drained), 3_000_000)  # 确实是个大响应

        second.settimeout(10)  # first 传完、连接关闭后，second 才被轮到
        self.assertTrue(second.recv(65536).startswith(b"HTTP/1.1 200 OK\r\n"))
        first.close()
        second.close()

    def test_bad_request_gets_400_and_server_survives(self):
        port = start_server(demo_handler)
        with socket.create_connection(("127.0.0.1", port), timeout=5) as conn:
            conn.sendall(b"NOT-HTTP\r\n\r\n")
            self.assertTrue(conn.recv(65536).startswith(b"HTTP/1.1 400 Bad Request\r\n"))
        self.assertTrue(http_get(port, "/").startswith(b"HTTP/1.1 200 OK\r\n"))

    def test_handler_crash_gets_500_and_server_survives(self):
        def exploding_handler(request: Request) -> bytes:
            raise RuntimeError("boom")

        port = start_server(exploding_handler)
        with socket.create_connection(("127.0.0.1", port), timeout=5) as conn:
            conn.sendall(b"GET / HTTP/1.1\r\nHost: x\r\n\r\n")
            self.assertTrue(conn.recv(65536).startswith(b"HTTP/1.1 500 Internal Server Error\r\n"))
        with socket.create_connection(("127.0.0.1", port), timeout=5) as conn:  # 服务器还活着
            conn.sendall(b"GET / HTTP/1.1\r\nHost: x\r\n\r\n")
            self.assertTrue(conn.recv(65536).startswith(b"HTTP/1.1 500 Internal Server Error\r\n"))


class SendRawToolTest(unittest.TestCase):
    def test_hand_typed_request_line_gets_a_response(self):
        port = start_server(demo_handler)
        resp = send_raw("127.0.0.1", port, ["GET / HTTP/1.1", "Host: fable"])
        self.assertTrue(resp.startswith(b"HTTP/1.1 200 OK\r\n"))

    def test_hand_typed_garbage_gets_400(self):
        port = start_server(demo_handler)
        resp = send_raw("127.0.0.1", port, ["瞎打的请求行"])
        self.assertTrue(resp.startswith(b"HTTP/1.1 400 Bad Request\r\n"))


if __name__ == "__main__":
    unittest.main()
