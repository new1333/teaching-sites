"""第 4 章测试：v3 连接状态机——部分读喂进增量解析器，部分写记进发送缓冲。

断言的是 milestone 的行为，不是实现细节：
- 解析器：请求掰成 5 段喂，前 4 段一律报「还没读完」，末段才交出 Request；
- 跨段切断：一帧里只有半截请求行、行尾 CRLF 被劈成 \\r|\\n，都要照样接得住；
- 收缓冲：没到齐就攒着（read_line 给 None），到齐才放行；定长放行只给要的数；
- 发缓冲：假字节流只收得下一部分时，差额记账留在缓冲，腾出空间再接着冲，直到冲完；
- v3 端到端：真实 slow_client 分段发请求拿到正确响应；微缩接收窗下大响应完整送达。
"""
import socket
import threading
import time
import unittest

from fable import buffers, event_server, http_parser, slow_client
from fable.blocking_server import Request, build_response, demo_handler


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def start_v3(handler) -> tuple[int, threading.Event]:
    """把 v3 起在本进程的守护线程 + 随机端口上，轮询等它开始监听。"""
    port = free_port()
    stop = threading.Event()
    threading.Thread(
        target=event_server.serve,
        args=("127.0.0.1", port, handler),
        kwargs={"stop_flag": stop},
        daemon=True,
    ).start()
    deadline = time.monotonic() + 2.0
    while time.monotonic() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                return port, stop
        except OSError:
            time.sleep(0.02)
    raise AssertionError("v3 did not start listening within 2s")


class TinyKernel:
    """假字节流（内存管道）：发送缓冲只有 capacity 大，满一次就学非阻塞 socket 报「暂时没有」。

    真内核的反压在 Windows 回环上复现不稳（第 1 章已实测 256 MB 也被吞），
    部分写的逻辑因此用一个容量记账严格透明的假内核来测——物理不复现，逻辑必须成立。
    """

    def __init__(self, capacity: int) -> None:
        self.capacity = capacity
        self.inflight = bytearray()  # 内核里压着的（对端还没读走）
        self.delivered = bytearray()  # 已送达对端的

    def send(self, data: bytes) -> int:
        room = self.capacity - len(self.inflight)
        if room <= 0:
            raise BlockingIOError  # 一点空位都没有：非阻塞 write 的「暂时没有」
        take = min(room, len(data))
        self.inflight += data[:take]
        return take

    def deliver(self, n: int) -> None:
        """对端读走 n 字节：内核腾出空间，发送侧才收得下新的。"""
        self.delivered += self.inflight[:n]
        del self.inflight[:n]


class HttpParserFragmentTest(unittest.TestCase):
    REQUEST = (
        b"GET /docs/index.html HTTP/1.1\r\n"
        b"Host: example.com\r\n"
        b"User-Agent: fable\r\n"
        b"\r\n"
    )

    def test_five_fragments_report_need_more_until_the_last(self):
        """5 段碎片：前 4 段喂完必须报「还没读完」，末段才交出完整 Request。"""
        frags = [
            b"GET /docs/i",
            b"ndex.html HTTP/1.1\r\nHo",
            b"st: example.com\r\nUser-Ag",
            b"ent: fable\r",
            b"\n\r\n",
        ]
        assert b"".join(frags) == self.REQUEST
        parser = http_parser.HttpRequestParser()
        for i, frag in enumerate(frags):
            result = parser.feed(frag)
            if i < len(frags) - 1:
                self.assertTrue(
                    result.need_more,
                    f"fragment {i + 1} must report need-more, got {result.state}",
                )
                self.assertIsNone(result.request)
        self.assertTrue(result.done)
        self.assertEqual(
            result.request,
            Request(
                "GET",
                "/docs/index.html",
                "HTTP/1.1",
                {"Host": "example.com", "User-Agent": "fable"},
            ),
        )

    def test_request_line_cut_in_half(self):
        """一帧里请求行只有半截：解析器不许硬解，攒到下一帧补齐再判。"""
        parser = http_parser.HttpRequestParser()
        self.assertTrue(parser.feed(b"GET /ind").need_more)
        result = parser.feed(b"ex.html HTTP/1.1\r\nHost: h\r\n\r\n")
        self.assertTrue(result.done)
        self.assertEqual(result.request.path, "/index.html")

    def test_line_terminator_split_across_feeds(self):
        """行尾 CRLF 被劈成上一帧末尾的 \\r 与下一帧开头的 \\n：不许把半截行放行。"""
        parser = http_parser.HttpRequestParser()
        self.assertTrue(parser.feed(b"GET / HTTP/1.1\r").need_more)
        result = parser.feed(b"\nHost: h\r\n\r\n")
        self.assertTrue(result.done)
        self.assertEqual(result.request.headers, {"Host": "h"})

    def test_whole_request_in_one_feed_is_done_immediately(self):
        """一口气全到（本机 curl 的常态）：一次 feed 直接判完——贪心推进不多等。"""
        parser = http_parser.HttpRequestParser()
        result = parser.feed(self.REQUEST)
        self.assertTrue(result.done)
        self.assertEqual(result.request.method, "GET")

    def test_malformed_request_line_is_bad_not_crash(self):
        """坏请求行报 bad 并带原因；bad 是定态，后续喂字节不再改判。"""
        parser = http_parser.HttpRequestParser()
        result = parser.feed(b"NOT-HTTP\r\n\r\n")
        self.assertTrue(result.bad)
        self.assertIn("malformed", (result.error or "").lower())
        again = parser.feed(b"more garbage")
        self.assertTrue(again.bad)

    def test_done_is_final_and_body_bytes_are_ignored(self):
        """已声明的边界：解析到空行即完成，正文一字不读（v0 一脉相承，见差异清单）。"""
        parser = http_parser.HttpRequestParser()
        self.assertTrue(parser.feed(self.REQUEST).done)
        result = parser.feed(b"field=value&more=1")  # 正文先到？v3 不管正文
        self.assertTrue(result.done)
        self.assertEqual(result.request.path, "/docs/index.html")


class RecvBufferTest(unittest.TestCase):
    def test_line_not_complete_returns_none_until_separator_arrives(self):
        """「读到没到齐就攒着」：行没攒齐 read_line 一律 None，齐了才连本带利放行。"""
        buf = buffers.RecvBuffer()
        buf.feed(b"GET /index.html HT")
        self.assertIsNone(buf.read_line())
        buf.feed(b"TP/1.1\r\nHost")
        self.assertEqual(buf.read_line(), b"GET /index.html HTTP/1.1")
        self.assertIsNone(buf.read_line())  # Host 行还没等到行尾
        self.assertEqual(len(buf), 4)  # 攒着的恰好是 b"Host"

    def test_empty_line_comes_back_as_empty_bytes(self):
        """空行也是一条完整的行：放行 b""（头部结束的判据），不是 None。"""
        buf = buffers.RecvBuffer()
        buf.feed(b"\r\n\r\n")
        self.assertEqual(buf.read_line(), b"")
        self.assertEqual(buf.read_line(), b"")
        self.assertIsNone(buf.read_line())

    def test_read_upto_releases_fixed_length_only(self):
        """定长放行（正文按 Content-Length 读的生长点）：要几个给几个，多的继续攒。"""
        buf = buffers.RecvBuffer()
        buf.feed(b"0123456789")
        self.assertEqual(buf.read_upto(4), b"0123")
        self.assertEqual(len(buf), 6)
        self.assertEqual(buf.read_upto(100), b"456789")
        self.assertEqual(len(buf), 0)


class SendBufferTest(unittest.TestCase):
    def test_partial_write_stays_pending_until_kernel_drains(self):
        """「写不下去先攒着、下次可写再冲」：30 字节的假内核对 100 字节只收 30，
        对端每读走一批就再冲一批，直到 100 字节一个不少地送达。"""
        out = buffers.SendBuffer()
        out.feed(b"x" * 100)
        kernel = TinyKernel(capacity=30)
        self.assertEqual(out.flush(kernel.send), 30)
        self.assertEqual(out.pending, 70)
        kernel.deliver(10)  # 对端读走 10 字节，内核腾出 10 字节空间
        self.assertEqual(out.flush(kernel.send), 10)
        self.assertEqual(out.pending, 60)
        rounds = 2
        while out.pending:
            kernel.deliver(len(kernel.inflight))  # 对端把内核里的全读走
            out.flush(kernel.send)
            rounds += 1
            self.assertLess(rounds, 20)  # 防呆：不许原地空转
        kernel.deliver(len(kernel.inflight))  # 最后一轮冲进内核的，对端随后读走
        self.assertEqual(bytes(kernel.delivered), b"x" * 100)  # 一个字节都没丢

    def test_flush_passes_at_most_chunk_size_per_write(self):
        """一次 write 只递一块（chunk_size）：内核再大也不许一口气全灌。"""
        out = buffers.SendBuffer()
        out.feed(b"y" * 100)
        kernel = TinyKernel(capacity=10**9)
        self.assertEqual(out.flush(kernel.send, chunk_size=16), 16)
        self.assertEqual(out.pending, 84)

    def test_full_kernel_raises_and_ledger_intact(self):
        """内核一个空位都没有：write 报 BlockingIOError，差额原封不动留在账上。"""
        out = buffers.SendBuffer()
        kernel = TinyKernel(capacity=5)
        out.feed(b"z" * 5)
        self.assertEqual(out.flush(kernel.send), 5)
        out.feed(b"z" * 10)
        with self.assertRaises(BlockingIOError):
            out.flush(kernel.send)
        self.assertEqual(out.pending, 10)


class EventServerStateMachineTest(unittest.TestCase):
    def test_fragmented_request_gets_correct_response(self):
        """端到端：真实 slow_client 把请求掰成 5 段、隔着延迟发，v3 必须答 200 Hello
        ——同样的玩法钉死过 v0/v2（第一段没读全就硬解，回 400）。"""
        port, stop = start_v3(demo_handler)
        try:
            resp = slow_client.send_slow("127.0.0.1", port, "/", frags=5, delay=0.05)
            self.assertTrue(resp.startswith(b"HTTP/1.1 200 OK\r\n"), resp[:64])
            self.assertIn(b"Hello", resp)
        finally:
            stop.set()

    def test_big_response_survives_tiny_receive_window(self):
        """端到端：客户端接收窗缩到 8 KiB、收之前先愣 0.3 秒——256 KiB 的响应
        在内核缓冲塞不下时必须记账重冲，最终一个字节不少地送达。"""
        body = b"A" * 262144

        def big_handler(request: Request) -> bytes:
            return build_response(200, "OK", body)

        port, stop = start_v3(big_handler)
        try:
            resp = slow_client.send_slow(
                "127.0.0.1", port, "/big", frags=1, delay=0.0, window=8192, stall=0.3
            )
            head, _, received = resp.partition(b"\r\n\r\n")
            self.assertTrue(head.startswith(b"HTTP/1.1 200 OK\r\n"))
            self.assertIn(b"Content-Length: 262144", head)
            self.assertEqual(len(received), 262144)  # 冲完才关：收满才算完
        finally:
            stop.set()


if __name__ == "__main__":
    unittest.main()
