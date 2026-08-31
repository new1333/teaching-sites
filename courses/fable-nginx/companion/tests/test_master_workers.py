"""第 5 章测试：v4 master-worker 骨架——多进程共享监听 socket，master 不伺候连接。

断言的是 milestone 的行为，不是实现细节：
- 起 1 个 master（本进程里的 run_master 线程）+ 2 个 spawn 出的 worker 子进程，
  共享同一个监听 socket；12 个并发请求全部正确应答；
- 分摊实证：两台 worker 各自的记账（served）都非零——活真的分掉了；
- master 不伺候：master 的账本里根本没有连接这一栏，且每条响应头里的
  X-Fable-Worker 都是 worker 的 pid，绝不出现 master 自己的 pid；
- 隔离实证：硬杀一台 worker，master 发觉并补位，之后的请求照常全部正确；
- 优雅轮换：正被 worker 攒着的半截请求，轮换开始后补上剩余半截照样得到
  完整应答——老 worker 停接新客、干完手头连接才退场；收摊同理等排干。

等待一律用「轮询 + 就绪判据」（进程派生慢，超时给宽），不用裸 sleep 赌竞速。
"""
import json
import os
import re
import shutil
import signal
import socket
import tempfile
import threading
import time
import unittest
from pathlib import Path

from fable import worker_pool


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class PoolHandle:
    """测试把手：端口、停机事件、master 线程、账本目录与轮换触发文件。"""

    def __init__(self, port, stop, thread, stats, reload_file):
        self.port = port
        self.stop = stop
        self.thread = thread
        self.stats = stats
        self.reload_file = reload_file
        self.stopped = False


def start_pool(workers: int = 2, reload: bool = False) -> PoolHandle:
    """把 v4 起在随机端口上：master 跑在本进程守护线程，worker 是真子进程。

    就绪判据是一次完整的请求-应答往返——spawn 派生慢，用「连得上」判就绪
    会赌到内核 backlog 头上，用「答得上」才稳。
    """
    stats = Path(tempfile.mkdtemp(prefix="fable-ch5-"))
    reload_file = stats / "reload" if reload else None
    port = free_port()
    stop = threading.Event()
    thread = threading.Thread(
        target=worker_pool.run_master,
        args=("127.0.0.1", port),
        kwargs={
            "workers": workers,
            "stats_dir": str(stats),
            "stop_event": stop,
            "reload_file": str(reload_file) if reload_file else None,
        },
        daemon=True,
    )
    thread.start()
    deadline = time.monotonic() + 30.0
    while time.monotonic() < deadline:
        try:
            head, _body, _wpid = http_get(port, b"/__ready", timeout=5.0)
            if head.startswith(b"HTTP/1.1"):
                break
        except OSError:
            pass
        time.sleep(0.05)
    else:
        raise AssertionError("v4 did not serve any request within 30s")
    return PoolHandle(port, stop, thread, stats, reload_file)


def stop_pool(pool: PoolHandle) -> bool:
    """喊停并等 master 线程退出；幂等。返回 True = 优雅收摊完成。"""
    if pool.stopped:
        return not pool.thread.is_alive()
    pool.stopped = True
    pool.stop.set()
    pool.thread.join(timeout=30)
    return not pool.thread.is_alive()


def http_get(port: int, path: bytes = b"/", timeout: float = 10.0):
    """一条完整的请求-应答往返：返回 (响应头, 正文, 应答头里自报的 worker pid)。"""
    with socket.create_connection(("127.0.0.1", port), timeout=timeout) as c:
        c.sendall(b"GET " + path + b" HTTP/1.1\r\nHost: fable-test\r\n\r\n")
        buf = b""
        while b"\r\n\r\n" not in buf:
            chunk = c.recv(65536)
            if not chunk:
                break
            buf += chunk
        head, _, body = buf.partition(b"\r\n\r\n")
        m = re.search(rb"Content-Length: (\d+)", head)
        length = int(m.group(1)) if m else 0
        while len(body) < length:
            chunk = c.recv(65536)
            if not chunk:
                break
            body += chunk
    m = re.search(rb"X-Fable-Worker: (\d+)", head)
    return head, body, (int(m.group(1)) if m else None)


def read_stats(stats_dir: Path):
    """读账本目录：返回 (master 账本, {worker pid: 账本})。半写状态的文件跳过重读。"""
    master = None
    workers = {}
    for p in Path(stats_dir).glob("*.json"):
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue  # 正在写：下一轮轮询会读到完整的
        if data.get("role") == "master":
            master = data
        elif data.get("role") == "worker":
            workers[data["pid"]] = data
    return master, workers


def poll_until(predicate, timeout: float, what: str) -> None:
    """轮询等一个条件成立：就绪判据明确、超时给足，不赌竞速。"""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.05)
    raise AssertionError(f"timed out waiting for: {what}")


class MasterWorkersPoolTest(unittest.TestCase):
    def setUp(self):
        pool_holder = {}

        def cleanup():
            stop_pool(pool_holder["pool"]) if pool_holder else None
            shutil.rmtree(pool_holder["pool"].stats, ignore_errors=True) if pool_holder else None

        self.register = lambda pool: pool_holder.setdefault("pool", pool)
        self.addCleanup(cleanup)

    def test_concurrent_requests_shared_by_both_workers_master_serves_nothing(self):
        """1 master + 2 worker：12 个并发请求全部正确；两台 worker 记账都非零
        （分摊实证）；master 账本没有连接这一栏、应答头里只有 worker 的 pid
        （master 不伺候实证）；停机等 worker 排干才收摊。"""
        pool = self.register(start_pool(workers=2))
        master_pid = os.getpid()  # master 就是本进程里的 run_master 线程

        poll_until(
            lambda: (lambda m, ws: m and len(m.get("workers", [])) == 2 and len(ws) == 2)(
                *read_stats(pool.stats)
            ),
            20,
            "两台 worker 都上岗记账",
        )

        results = []
        lock = threading.Lock()

        def one_request():
            item = http_get(pool.port, b"/")
            with lock:
                results.append(item)

        waves = []
        for _wave in range(3):  # 3 波 × 4 条：波内真并发，波间给内核一点分发的余地
            wave = [threading.Thread(target=one_request) for _ in range(4)]
            for t in wave:
                t.start()
            for t in wave:
                t.join(timeout=15)
            waves.extend(wave)
        self.assertTrue(all(not t.is_alive() for t in waves))
        self.assertEqual(len(results), 12)

        for head, body, wpid in results:
            self.assertTrue(head.startswith(b"HTTP/1.1 200 OK\r\n"), head[:64])
            self.assertIn(b"Hello", body)
            self.assertIsNotNone(wpid, "响应头里必须自报是哪台 worker 伺候的")

        master_stats, worker_stats = read_stats(pool.stats)
        self.assertIsNotNone(master_stats)
        self.assertEqual(master_stats["pid"], master_pid)
        self.assertNotIn("accepted", master_stats)  # master 的账本没有「连接」这一栏
        self.assertNotIn("served", master_stats)
        self.assertEqual(len(worker_stats), 2)
        counts = sorted(w["served"] for w in worker_stats.values())
        self.assertGreaterEqual(counts[0], 1)  # 分摊实证：一台都没闲着
        self.assertGreaterEqual(sum(counts), 13)  # 12 条 + 就绪探针 1 条
        for _head, _body, wpid in results:
            self.assertIn(wpid, worker_stats)  # 应答的 pid 全在 worker 名册里
            self.assertNotEqual(wpid, master_pid)  # master 从不亲自伺候

        self.assertTrue(stop_pool(pool), "master 线程应在喊停后自行退出")
        master_stats, _ = read_stats(pool.stats)
        self.assertEqual(master_stats.get("workers"), [], "收摊前 worker 应已全部退场")

    def test_killed_worker_is_replaced_and_service_continues(self):
        """隔离实证：硬杀一台 worker，master 发觉并补位；后续请求照常全部正确。"""
        pool = self.register(start_pool(workers=2))
        poll_until(
            lambda: (lambda m, ws: m and len(m.get("workers", [])) == 2 and len(ws) == 2)(
                *read_stats(pool.stats)
            ),
            20,
            "两台 worker 都上岗记账",
        )
        _m, worker_stats = read_stats(pool.stats)
        victim, survivor = sorted(worker_stats)

        os.kill(victim, signal.SIGTERM)  # Windows 上这就是 TerminateProcess 硬杀

        poll_until(
            lambda: (lambda m: m and victim not in m["workers"] and len(m["workers"]) == 2)(
                read_stats(pool.stats)[0]
            ),
            20,
            "master 发觉 worker 死亡并补位",
        )
        master_stats, _ = read_stats(pool.stats)
        self.assertIn(survivor, master_stats["workers"])  # 幸存者不受牵连
        newbie = [p for p in master_stats["workers"] if p != survivor]
        self.assertEqual(len(newbie), 1)
        self.assertNotIn(newbie[0], [victim, survivor])  # 补上来的是新进程

        for _ in range(8):
            head, body, _wpid = http_get(pool.port, b"/")
            self.assertTrue(head.startswith(b"HTTP/1.1 200 OK\r\n"), head[:64])
            self.assertIn(b"Hello", body)

    def test_graceful_rotation_finishes_inflight_connection(self):
        """优雅轮换：半截请求正攥在老 worker 手里，轮换开始后补上剩余半截，
        照样得到完整应答；老 worker 干完手头连接、确认退场，新 worker 接班。"""
        pool = self.register(start_pool(workers=1, reload=True))
        poll_until(
            lambda: (lambda m, ws: m and m.get("workers") and len(ws) == 1)(*read_stats(pool.stats)),
            20,
            "单 worker 上岗记账",
        )
        master_stats, _ = read_stats(pool.stats)
        w1 = master_stats["workers"][0]

        for _ in range(2):  # 热身：先让老 worker 记上几笔完整账
            http_get(pool.port, b"/")
        poll_until(
            lambda: read_stats(pool.stats)[1].get(w1, {}).get("served", 0) >= 3,
            10,
            "热身请求入账（就绪 1 + 热身 2）",
        )

        _, worker_stats = read_stats(pool.stats)
        accepted_before = worker_stats[w1]["accepted"]  # 先存快照再连：accept 几乎瞬间入账

        half = socket.create_connection(("127.0.0.1", pool.port), timeout=10)
        self.addCleanup(half.close)
        half.sendall(b"GET / HTTP/1.1\r\n")  # 半截请求：没有 Host、没有空行

        poll_until(
            lambda: read_stats(pool.stats)[1].get(w1, {}).get("accepted", 0) > accepted_before,
            5,
            "半截连接已被老 worker 接进自己的事件循环",
        )

        Path(pool.reload_file).write_text("", encoding="utf-8")  # 触发优雅轮换

        poll_until(
            lambda: (
                lambda m, ws: m
                and len(m.get("workers", [])) == 1
                and w1 not in m["workers"]
                and ws.get(w1, {}).get("draining")
            )(*read_stats(pool.stats)),
            30,
            "新 worker 上岗、老 worker 进入排干",
        )

        half.sendall(b"Host: fable-test\r\n\r\n")  # 补上剩余半截
        buf = b""
        while b"\r\n\r\n" not in buf:
            chunk = half.recv(65536)
            if not chunk:
                break
            buf += chunk
        head, _, body = buf.partition(b"\r\n\r\n")
        self.assertTrue(head.startswith(b"HTTP/1.1 200 OK\r\n"), head[:64])
        m = re.search(rb"Content-Length: (\d+)", head)
        need = int(m.group(1)) if m else 0
        while len(body) < need:
            chunk = half.recv(65536)
            if not chunk:
                break
            body += chunk
        self.assertIn(b"Hello", body)  # 正在排干的老 worker 把手头连接伺候完了
        half.close()

        poll_until(
            lambda: w1 in (read_stats(pool.stats)[0] or {}).get("retired", []),
            15,
            "老 worker 干完手头连接、确认退场",
        )
        for _ in range(2):  # 新 worker 接班照常服务
            head, body, wpid = http_get(pool.port, b"/")
            self.assertTrue(head.startswith(b"HTTP/1.1 200 OK\r\n"), head[:64])
            self.assertNotEqual(wpid, w1)


if __name__ == "__main__":
    unittest.main()
