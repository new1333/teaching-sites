"""第 2 章测试：v1 一连接一线程的并发正确性与压测探针。

断言的是 milestone 的行为，不是实现细节：
- v1 并发正确性：多个客户端同时请求全部正确响应（v0 的干等消失）；
- 第一个连接一言不发时，第二个连接立刻被伺候（第 1 章钩子的解药）；
- 一连接一线程：哑连接数涨，进程内线程数同步涨；连接关，线程退；
- 连接级隔离在多线程下依然成立（坏信 400、handler 崩 500，服务器都活着）；
- bench 探针可跑通：输出结构化数字（线程数 / 内存 / 交接时延 / 接力吞吐），可落盘。
"""
import json
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

from fable import bench, threaded_server
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


def start_v1(handler) -> int:
    """把 v1 起在本进程的守护线程 + 随机端口上，轮询等它开始监听，返回端口号。"""
    port = free_port()
    threading.Thread(
        target=threaded_server.serve, args=("127.0.0.1", port, handler), daemon=True
    ).start()
    deadline = time.monotonic() + 2.0
    while time.monotonic() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                return port  # 探活连接立即断开，v1 的伺候线程必须自己退场
        except OSError:
            time.sleep(0.02)
    raise AssertionError("v1 did not start listening within 2s")


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


class ThreadedServeTest(unittest.TestCase):
    def test_hello_over_real_socket(self):
        port = start_v1(demo_handler)
        resp = http_get(port, "/")
        self.assertTrue(resp.startswith(b"HTTP/1.1 200 OK\r\n"))
        self.assertIn(b"Hello", resp)

    def test_second_connection_answered_while_first_is_silent(self):
        """第 1 章钩子的解药：第一个连接一言不发（会钉死 v0），第二个连接立刻拿到响应。"""
        port = start_v1(demo_handler)
        first = socket.create_connection(("127.0.0.1", port), timeout=5)  # 连上但一个字不发
        second = socket.create_connection(("127.0.0.1", port), timeout=5)
        second.sendall(b"GET / HTTP/1.1\r\nHost: b\r\n\r\n")
        second.settimeout(5)
        self.assertTrue(second.recv(65536).startswith(b"HTTP/1.1 200 OK\r\n"))  # 不再干等
        first.close()
        second.close()

    def test_concurrent_requests_all_answered(self):
        """24 个客户端隔着栅栏同时发请求，v1 必须全部正确响应、一个不落。"""
        port = start_v1(demo_handler)
        n = 24
        barrier = threading.Barrier(n)
        results: list[bool] = []
        lock = threading.Lock()

        def one():
            barrier.wait()  # 尽量同一瞬间发车
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

    def test_thread_per_connection_grows_and_shrinks(self):
        """一连接一线程的机械证明：哑连接挂上去线程数同步涨，全关掉线程退回基线。"""
        port = start_v1(demo_handler)
        time.sleep(0.3)  # 让探活/断开连接的伺候线程退场，计数先落再量基线
        # 基线是相对的：同一进程里前案测试的 accept 循环线程还活着（它们永不退出），
        # 所以只量「这条连接带来的增量」，不碰绝对值。
        baseline = threading.active_count()

        idle = [socket.create_connection(("127.0.0.1", port), timeout=5) for _ in range(20)]
        self.assertTrue(
            wait_until(lambda: threading.active_count() >= baseline + 20, timeout=5.0),
            f"threads did not grow: {threading.active_count()} < {baseline + 20}",
        )

        for conn in idle:
            conn.close()
        self.assertTrue(
            wait_until(lambda: threading.active_count() <= baseline + 2, timeout=5.0),
            f"threads did not shrink: {threading.active_count()} > {baseline + 2}",
        )

    def test_bad_request_gets_400_and_server_survives(self):
        port = start_v1(demo_handler)
        with socket.create_connection(("127.0.0.1", port), timeout=5) as conn:
            conn.sendall(b"NOT-HTTP\r\n\r\n")
            self.assertTrue(conn.recv(65536).startswith(b"HTTP/1.1 400 Bad Request\r\n"))
        self.assertTrue(http_get(port, "/").startswith(b"HTTP/1.1 200 OK\r\n"))

    def test_handler_crash_gets_500_and_server_survives(self):
        def exploding_handler(request: Request) -> bytes:
            raise RuntimeError("boom")

        port = start_v1(exploding_handler)
        for _ in range(2):  # 崩过一次之后服务器必须还活着
            with socket.create_connection(("127.0.0.1", port), timeout=5) as conn:
                conn.sendall(b"GET / HTTP/1.1\r\nHost: x\r\n\r\n")
                self.assertTrue(
                    conn.recv(65536).startswith(b"HTTP/1.1 500 Internal Server Error\r\n")
                )


class BenchProbeTest(unittest.TestCase):
    def test_cli_probe_reports_exact_thread_accounting(self):
        """python -m fable.bench 12 在全新进程里跑：12 个哑连接 = 恰好 +12 条线程，数字落盘。

        新进程里没有别的线程捣乱，线程账可以做到精确相等——这正是读者亲手开机
        时的口径；并发突发也必须全部正确响应。
        """
        src_dir = Path(bench.__file__).resolve().parent.parent
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "bench-report.json"
            proc = subprocess.run(
                [sys.executable, "-m", "fable.bench", "12", str(out)],
                cwd=src_dir, capture_output=True, text=True, timeout=120,
            )
            self.assertEqual(proc.returncode, 0, proc.stderr)
            report = json.loads(out.read_text(encoding="utf-8"))
            rows = report["connections"]["levels"]
            self.assertEqual([r["connections"] for r in rows], [0, 4, 12])
            self.assertEqual(rows[2]["threads_delta"], 12)
            self.assertEqual(rows[2]["expected_threads"], rows[2]["threads"])
            for row in rows:
                self.assertGreater(row["rss_bytes"], 0)
                self.assertGreater(row["committed_bytes"], 0)
            burst = report["connections"]["burst"]
            self.assertEqual(burst["while_holding"], 12)
            self.assertEqual(burst["ok"], burst["concurrent_requests"])
            self.assertGreater(report["ping_pong"]["handoff_us_mean"], 0)
            self.assertEqual(len(report["relay"]), 2)

    def test_ping_pong_reports_handoff_cost(self):
        stats = bench.ping_pong_handoff_us(rounds=100)
        self.assertEqual(stats["handoffs"], 200)
        self.assertGreater(stats["handoff_us_mean"], 0.1)
        self.assertLess(stats["handoff_us_mean"], 5000)

    def test_relay_reports_throughput(self):
        stats = bench.relay_tokens_per_sec(n_threads=2, duration_s=0.1)
        self.assertEqual(stats["ring_size"], 2)
        self.assertGreater(stats["tokens_per_sec"], 0)

    def test_report_written_to_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "bench-report.json"
            report = bench.run_probe(
                levels=(0, 4), burst=2, handoff_rounds=20,
                relay_sizes=(2,), relay_duration_s=0.05, out=out,
            )
            self.assertTrue(out.is_file())
            on_disk = json.loads(out.read_text(encoding="utf-8"))
            self.assertEqual(on_disk, report)  # 落盘的数字与返回的一致


if __name__ == "__main__":
    unittest.main()
