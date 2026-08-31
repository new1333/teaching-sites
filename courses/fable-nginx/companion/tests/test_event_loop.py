"""第 3 章测试：v2 单线程事件循环的并发正确性与资源形状。

断言的是 milestone 的行为，不是实现细节：
- 非阻塞语义：recv 无数据时立即以 BlockingIOError 报「暂时没有」，不卡住；
- 事件循环：登记谁就绪喊谁的回调（回调分发），注销后不再被盯；
- v2 单线程多连接：一条哑连接挂着不吐字，另一条连接的请求立即被伺候；
- 并发多请求全部正确响应；坏信 400、handler 崩 500，循环毫发无损；
- 单线程的机械证明：哑连接挂多少条，进程线程数纹丝不动；
- select 的描述符上限在 Windows 上真实触到（探针报错原文带回）；
- bench 对照探针：v2 挂哑连接，线程数全程平线、满载并发全对。
"""
import json
import selectors
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

from fable import bench, event_loop, event_server
from fable.blocking_server import Request, demo_handler


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def wait_until(predicate, timeout: float = 3.0, interval: float = 0.02) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(interval)
    return False


def start_v2(handler) -> tuple[int, threading.Event]:
    """把 v2 起在本进程的守护线程 + 随机端口上，轮询等它开始监听。

    返回 (port, stop)：测试收尾 set 一下 stop，事件循环下一圈醒来退场，
    并把它登记的全部 socket 关干净。
    """
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
    raise AssertionError("v2 did not start listening within 2s")


def http_get(port: int, path: str, timeout: float = 5.0) -> bytes:
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


class NonBlockingSemanticsTest(unittest.TestCase):
    def test_recv_without_data_raises_blocking_io_error_immediately(self):
        """非阻塞 recv 的核心语义：没数据就立刻回「暂时没有」，绝不在原地等。"""
        recv_end, send_end = socket.socketpair()
        recv_end.setblocking(False)
        start = time.perf_counter()
        with self.assertRaises(BlockingIOError) as ctx:
            recv_end.recv(65536)
        elapsed = time.perf_counter() - start
        self.assertLess(elapsed, 0.1)  # 立即返回：不是等到超时，是根本没等
        self.assertIsInstance(ctx.exception, OSError)  # BlockingIOError 是 OSError 家族

        send_end.sendall(b"now you have data")
        self.assertEqual(recv_end.recv(65536), b"now you have data")  # 到了照收
        recv_end.close()
        send_end.close()

    def test_default_recv_blocks_until_timeout(self):
        """对照组：换回阻塞模式（带超时），同一个 recv 就原地等满 0.5 秒才罢休。"""
        recv_end, send_end = socket.socketpair()
        recv_end.settimeout(0.5)
        start = time.perf_counter()
        with self.assertRaises(socket.timeout):
            recv_end.recv(65536)
        elapsed = time.perf_counter() - start
        self.assertGreaterEqual(elapsed, 0.45)  # 真等了：耗完超时才回来
        recv_end.close()
        send_end.close()


class EventLoopDispatchTest(unittest.TestCase):
    def test_ready_fileobj_gets_its_callback(self):
        """回调分发：谁就绪了，登记时留给它的回调就被喊到——Reactor 的最小机械证明。"""
        loop = event_loop.EventLoop()
        recv_end, send_end = socket.socketpair()
        called: list[object] = []
        loop.register(recv_end, lambda fileobj, mask: called.append(fileobj))
        self.assertEqual(loop.step(timeout=0.1), 0)  # 没数据：就绪名单空转一圈

        send_end.sendall(b"ping")
        self.assertEqual(loop.step(timeout=1.0), 1)
        self.assertEqual(called, [recv_end])  # 喊的是登记时留下的那个回调
        recv_end.close()
        send_end.close()

    def test_unregister_stops_watching(self):
        """注销之后不再被盯：数据到了也没有回调被喊。"""
        loop = event_loop.EventLoop()
        recv_end, send_end = socket.socketpair()
        called: list[object] = []
        loop.register(recv_end, lambda fileobj, mask: called.append(fileobj))
        loop.unregister(recv_end)
        send_end.sendall(b"ping")
        self.assertEqual(loop.step(timeout=0.2), 0)
        self.assertEqual(called, [])
        recv_end.close()
        send_end.close()


class EventServerTest(unittest.TestCase):
    def test_hello_over_real_socket(self):
        port, stop = start_v2(demo_handler)
        try:
            resp = http_get(port, "/")
            self.assertTrue(resp.startswith(b"HTTP/1.1 200 OK\r\n"))
            self.assertIn(b"Hello", resp)
        finally:
            stop.set()

    def test_silent_connection_does_not_block_active_one(self):
        """v2 的解药：一条哑连接挂着不吐字（钉死过 v0），另一条连接立即拿到响应。"""
        port, stop = start_v2(demo_handler)
        try:
            silent = socket.create_connection(("127.0.0.1", port), timeout=5)  # 连上但一个字不发
            active = socket.create_connection(("127.0.0.1", port), timeout=5)
            active.sendall(b"GET / HTTP/1.1\r\nHost: b\r\n\r\n")
            active.settimeout(5)
            self.assertTrue(active.recv(65536).startswith(b"HTTP/1.1 200 OK\r\n"))
            silent.close()
            active.close()
        finally:
            stop.set()

    def test_concurrent_requests_all_answered(self):
        """24 个客户端隔着栅栏同时发请求，单线程事件循环必须全部正确响应、一个不落。"""
        port, stop = start_v2(demo_handler)
        try:
            n = 24
            barrier = threading.Barrier(n)
            results: list[bool] = []
            lock = threading.Lock()

            def one():
                barrier.wait()
                try:
                    resp = http_get(port, "/")
                    ok = resp.startswith(b"HTTP/1.1 200 OK\r\n") and b"Hello" in resp
                except OSError:
                    ok = False
                with lock:
                    results.append(ok)

            threads = [threading.Thread(target=one) for _ in range(n)]
            for t in threads:
                t.start()
            for t in threads:
                t.join(timeout=10)
            self.assertEqual(len(results), n)
            self.assertTrue(all(results), f"failed requests: {results.count(False)}/{n}")
        finally:
            stop.set()

    def test_thread_count_flat_under_idle_connections(self):
        """单线程的机械证明：哑连接挂 40 条、稳一拍，进程线程数与基线分毫不差。

        基线是相对的：同进程里先前测试留下的 accept 线程还活着，所以量的是
        「这 40 条连接带来的线程增量」——事件循环版应当恰好为零。
        """
        port, stop = start_v2(demo_handler)
        try:
            baseline = threading.active_count()
            idle = [socket.create_connection(("127.0.0.1", port), timeout=5) for _ in range(40)]
            time.sleep(0.5)  # 稳一拍：若有谁偷偷起线程，这时也该到岗了
            self.assertEqual(
                threading.active_count(),
                baseline,
                "event loop must not spawn per-connection threads",
            )
            for conn in idle:
                conn.close()
            time.sleep(0.2)
            self.assertEqual(threading.active_count(), baseline)
        finally:
            stop.set()

    def test_bad_request_gets_400_and_server_survives(self):
        port, stop = start_v2(demo_handler)
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=5) as conn:
                conn.sendall(b"NOT-HTTP\r\n\r\n")
                self.assertTrue(conn.recv(65536).startswith(b"HTTP/1.1 400 Bad Request\r\n"))
            self.assertTrue(http_get(port, "/").startswith(b"HTTP/1.1 200 OK\r\n"))
        finally:
            stop.set()

    def test_handler_crash_gets_500_and_server_survives(self):
        def exploding_handler(request: Request) -> bytes:
            raise RuntimeError("boom")

        port, stop = start_v2(exploding_handler)
        try:
            for _ in range(2):  # 崩过一次之后循环必须还活着
                with socket.create_connection(("127.0.0.1", port), timeout=5) as conn:
                    conn.sendall(b"GET / HTTP/1.1\r\nHost: x\r\n\r\n")
                    self.assertTrue(
                        conn.recv(65536).startswith(b"HTTP/1.1 500 Internal Server Error\r\n")
                    )
        finally:
            stop.set()


class SelectFdLimitProbeTest(unittest.TestCase):
    def test_probe_touches_real_select_limit_on_windows(self):
        """Windows 上 select 的报名单装不下就当场报错——探针要把那声报错真实触到。"""
        report = bench.probe_select_fd_limit(max_fds=700)
        self.assertEqual(report["platform"], sys.platform)
        self.assertIn(report["selector"], {"SelectSelector", "EpollSelector", "PollSelector", "DevpollSelector", "KqueueSelector"})
        if sys.platform == "win32":
            self.assertIsNotNone(report["error"], "select must hit its fd limit on Windows")
            self.assertIn("select", report["error"])
            self.assertLess(report["registered"], 700)
        else:
            # epoll 系内核常驻登记，没有「报名单装不下」这种硬上限
            self.assertIsNone(report["error"])
            self.assertEqual(report["registered"], 700)


class BenchEventProbeTest(unittest.TestCase):
    def test_cli_event_probe_reports_flat_threads(self):
        """python -m fable.bench event 12 在全新进程里跑：连接 0→4→12，线程数全程平线。"""
        src_dir = Path(bench.__file__).resolve().parent.parent
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "bench-event.json"
            proc = subprocess.run(
                [sys.executable, "-m", "fable.bench", "event", "12", str(out)],
                cwd=src_dir, capture_output=True, text=True, timeout=180,
            )
            self.assertEqual(proc.returncode, 0, proc.stderr)
            report = json.loads(out.read_text(encoding="utf-8"))
            rows = report["connections"]["levels"]
            self.assertEqual([r["connections"] for r in rows], [0, 4, 12])
            for row in rows:
                self.assertEqual(row["threads_delta"], 0)  # 单线程：连接涨，线程纹丝不动
                self.assertGreater(row["rss_bytes"], 0)
            burst = report["connections"]["burst"]
            self.assertEqual(burst["while_holding"], 12)
            self.assertEqual(burst["ok"], burst["concurrent_requests"])
            self.assertTrue(report["selector"])


if __name__ == "__main__":
    unittest.main()
