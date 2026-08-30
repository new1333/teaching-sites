"""第 6 章测试：v5 反向代理——既当前台，又当传话员。

断言的是 milestone 的行为，不是实现细节：
- 两台上游（fable.upstream_demo，各自带名字）+ 代理：10 个请求经代理轮询分单，
  两台各拿 5 条（顺序无关、计数精确）；
- 杀（停）掉一台上游后：后续请求全落幸存者、零报错——连接失败即时摘除并
  重试下一台；摘除是持续的：原端口上复活一台新名字的上游，请求也不再回去；
- 上游响应体经代理原样到达：直接访问上游与经代理访问，原始响应字节逐字节
  一致（含 Content-Length 与正文长度）；
- 全部上游阵亡：代理自己回 502 Bad Gateway——前台不倒、不缠死下游。

等待一律用「轮询 + 就绪判据」；就绪探测用「连得上」（空连接），不用「答得上」
——空连接不消耗轮询名额，分单计数才数得精确。
"""
import collections
import re
import socket
import threading
import time
import unittest

from fable import proxy_server, upstream_demo


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def wait_listening(port: int, timeout: float = 15.0) -> None:
    """轮询等监听 socket 出现：能建立 TCP 连接（随即关闭）就算就绪。

    空连接会被服务器 accept 后立刻读到 EOF 关掉，不产生任何请求——轮询
    名额因此分毫不差。
    """
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=2.0):
                return
        except OSError:
            time.sleep(0.05)
    raise AssertionError(f"port {port} did not accept connections within {timeout}s")


class UpstreamHandle:
    """一台上游的把手：名字、端口、停机事件、伺候线程。"""

    def __init__(self, name, port, stop, thread):
        self.name = name
        self.port = port
        self.stop = stop
        self.thread = thread
        self.stopped = False


def start_upstream(name: str, port: int | None = None) -> UpstreamHandle:
    """把一台自带名字的演示上游起在随机端口上（守护线程跑 v3 伺服循环）。"""
    port = port or free_port()
    stop = threading.Event()
    thread = threading.Thread(
        target=upstream_demo.serve,
        args=("127.0.0.1", port, name),
        kwargs={"stop_flag": stop},
        daemon=True,
    )
    thread.start()
    wait_listening(port)
    return UpstreamHandle(name, port, stop, thread)


def stop_upstream(up: UpstreamHandle) -> bool:
    """停一台上游（等它把监听 socket 关干净）；幂等。返回 True = 已退场。"""
    if up.stopped:
        return not up.thread.is_alive()
    up.stopped = True
    up.stop.set()
    up.thread.join(timeout=15)
    return not up.thread.is_alive()


class ProxyHandle:
    """代理的把手：端口、停机事件、伺候线程。"""

    def __init__(self, port, stop, thread):
        self.port = port
        self.stop = stop
        self.thread = thread
        self.stopped = False


def start_proxy(upstreams: list[tuple[str, int]]) -> ProxyHandle:
    """把 v5 代理起在随机端口上，上游名单按参数给定。"""
    port = free_port()
    stop = threading.Event()
    thread = threading.Thread(
        target=proxy_server.serve,
        args=("127.0.0.1", port, upstreams),
        kwargs={"stop_flag": stop},
        daemon=True,
    )
    thread.start()
    wait_listening(port)
    return ProxyHandle(port, stop, thread)


def stop_proxy(proxy: ProxyHandle) -> bool:
    if proxy.stopped:
        return not proxy.thread.is_alive()
    proxy.stopped = True
    proxy.stop.set()
    proxy.thread.join(timeout=15)
    return not proxy.thread.is_alive()


def http_get(port: int, path: bytes = b"/", timeout: float = 20.0) -> bytes:
    """一条完整的请求-应答往返，返回原始响应字节（头 + 正文，一字不改）。"""
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
    return head + b"\r\n\r\n" + body


def status_of(raw: bytes) -> int:
    """从原始响应里取状态码（HTTP/1.1 200 OK → 200）。"""
    line = raw.split(b"\r\n", 1)[0]
    return int(line.split(b" ")[1])


def served_by(raw: bytes) -> str:
    """从正文里读出是哪台上游伺候的（upstream_demo 的响应自带名字）。"""
    m = re.search(rb"hello from ([A-Za-z0-9_.-]+)", raw)
    return m.group(1).decode("ascii") if m else ""


class ReverseProxyTest(unittest.TestCase):
    def setUp(self):
        ups = []
        proxs = []

        def cleanup():
            for p in proxs:
                stop_proxy(p)
            for u in ups:
                stop_upstream(u)

        self.keep_upstream = lambda u: (ups.append(u) or u)
        self.keep_proxy = lambda p: (proxs.append(p) or p)
        self.addCleanup(cleanup)

    def test_ten_requests_split_five_five_by_round_robin(self):
        """两台上游 + 代理：10 个请求全部 200，轮询分单两台各 5 条
        （顺序无关、计数精确），每条都真实来自某台上游。"""
        alpha = self.keep_upstream(start_upstream("alpha"))
        beta = self.keep_upstream(start_upstream("beta"))
        proxy = self.keep_proxy(start_proxy([("127.0.0.1", alpha.port), ("127.0.0.1", beta.port)]))

        names = []
        for _ in range(10):
            raw = http_get(proxy.port)
            self.assertEqual(status_of(raw), 200, raw[:64])
            self.assertIn(b"Content-Length:", raw)
            names.append(served_by(raw))

        counts = collections.Counter(names)
        self.assertEqual(
            dict(counts),
            {"alpha": 5, "beta": 5},
            f"10 个请求应轮询分摊 5/5，实际 {dict(counts)}",
        )

    def test_dead_upstream_removed_and_all_traffic_falls_to_survivor(self):
        """杀一台上游：后续请求全落幸存者、零报错；摘除持续——原端口上
        复活一台新名字的上游，请求也不再回去（不自愈，差异清单如实登记）。"""
        alpha = self.keep_upstream(start_upstream("alpha"))
        beta = self.keep_upstream(start_upstream("beta"))
        proxy = self.keep_proxy(start_proxy([("127.0.0.1", alpha.port), ("127.0.0.1", beta.port)]))

        for _ in range(2):  # 热身：两台都真实接过活
            raw = http_get(proxy.port)
            self.assertEqual(status_of(raw), 200)

        self.assertTrue(stop_upstream(alpha), "上游 alpha 应在喊停后干净退场")

        for _ in range(10):  # 第一条会等连接失败落定再摘除重试，之后条条直飞 beta
            raw = http_get(proxy.port)
            self.assertEqual(status_of(raw), 200, raw[:64])
            self.assertEqual(served_by(raw), "beta", f"请求应全落 beta：{raw[:80]!r}")

        alpha2 = self.keep_upstream(start_upstream("alpha-revived", port=alpha.port))
        for _ in range(4):  # 复活了也不回去：摘除是持续的，直到代理重启
            raw = http_get(proxy.port)
            self.assertEqual(served_by(raw), "beta", "摘除后不应自愈回到原端口")

    def test_upstream_body_passes_through_verbatim(self):
        """上游响应经代理原样到达：同一请求直连上游与经代理各取一次，
        原始响应字节逐字节一致（大正文 256 KiB，Content-Length 与实收一致）。"""
        alpha = self.keep_upstream(start_upstream("alpha"))
        proxy = self.keep_proxy(start_proxy([("127.0.0.1", alpha.port)]))

        direct = http_get(alpha.port, b"/big")
        via_proxy = http_get(proxy.port, b"/big")

        self.assertEqual(status_of(direct), 200)
        self.assertEqual(direct, via_proxy, "经代理的响应应与直连上游逐字节一致")
        m = re.search(rb"Content-Length: (\d+)", direct)
        self.assertIsNotNone(m)
        body = direct.partition(b"\r\n\r\n")[2]
        self.assertEqual(int(m.group(1)), len(body), "Content-Length 应与正文实长一致")
        self.assertGreater(len(body), 200_000, "大正文才考得出转发的完整性")

    def test_all_upstreams_dead_answers_502(self):
        """全部上游阵亡：代理不倒，自己回 502 Bad Gateway——前台兜底。"""
        alpha = self.keep_upstream(start_upstream("alpha"))
        proxy = self.keep_proxy(start_proxy([("127.0.0.1", alpha.port)]))

        self.assertEqual(status_of(http_get(proxy.port)), 200)
        self.assertTrue(stop_upstream(alpha))

        raw = http_get(proxy.port)
        self.assertEqual(status_of(raw), 502, raw[:64])
        self.assertIn(b"Bad Gateway", raw)


if __name__ == "__main__":
    unittest.main()
