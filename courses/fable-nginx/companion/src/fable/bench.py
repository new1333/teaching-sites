"""压测探针：把「一连接一线程」的代价量化成可复核的结构化数字。

fable.bench — python -m fable.bench [N] [out.json]：
1) 把 v1 起在本进程，逐级挂「只连不发」的哑连接，量每级的线程数与内存；
2) 事件乒乓：量线程间一次交接（换人上场）的时延；
3) 接力环：量令牌在一圈线程里传递的吞吐，看线程变多时交接是否变贵。
输出 JSON（第二参数可落盘）。正文里的一切资源账数字以本探针输出为事实源：
内存口径是本进程工作集（RSS）与已提交内存，线程口径是 threading.active_count()。
"""
import ctypes
import json
import selectors
import socket
import statistics
import sys
import threading
import time
from pathlib import Path
from typing import Callable

from fable import event_server, threaded_server
from fable.blocking_server import Request, demo_handler


# ---------------------------------------------------------------- 资源测量口径
class _ProcessMemoryCounters(ctypes.Structure):
    """Windows psapi 的 GetProcessMemoryInfo 要的账本结构（字节按 SIZE_T）。"""

    _fields_ = [
        ("cb", ctypes.c_uint32),
        ("PageFaultCount", ctypes.c_uint32),
        ("PeakWorkingSetSize", ctypes.c_size_t),
        ("WorkingSetSize", ctypes.c_size_t),
        ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
        ("QuotaPagedPoolUsage", ctypes.c_size_t),
        ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
        ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
        ("PagefileUsage", ctypes.c_size_t),
        ("PeakPagefileUsage", ctypes.c_size_t),
    ]


def _windows_memory() -> tuple[int, int]:
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    psapi = ctypes.WinDLL("psapi", use_last_error=True)
    kernel32.GetCurrentProcess.restype = ctypes.c_void_p  # 64 位 HANDLE，不能让 ctypes 默认当 32 位 int 截断
    psapi.GetProcessMemoryInfo.argtypes = (
        ctypes.c_void_p,
        ctypes.POINTER(_ProcessMemoryCounters),
        ctypes.c_uint32,
    )
    psapi.GetProcessMemoryInfo.restype = ctypes.c_int
    pmc = _ProcessMemoryCounters()
    pmc.cb = ctypes.sizeof(pmc)
    ok = psapi.GetProcessMemoryInfo(kernel32.GetCurrentProcess(), ctypes.byref(pmc), pmc.cb)
    if not ok:
        raise ctypes.WinError(ctypes.get_last_error())
    return pmc.WorkingSetSize, pmc.PagefileUsage


def rss_bytes() -> int:
    """本进程此刻的常驻内存（工作集）字节数：真占着的物理内存页。"""
    if sys.platform == "win32":
        return _windows_memory()[0]
    with open("/proc/self/status", encoding="ascii") as f:  # Linux 回退口径
        for line in f:
            if line.startswith("VmRSS:"):
                return int(line.split()[1]) * 1024
    raise OSError(f"no RSS source on {sys.platform}")


def committed_bytes() -> int:
    """本进程此刻已提交的内存字节数：向内核要下了、承诺要占的量（Windows 的
    PagefileUsage 配额；Linux 近似取 VmData）。它与 RSS 是两笔账：提交了不等于
    真碰到、真占着物理页——「每线程预留多少栈」与「每线程实际吃掉多少」分开看。"""
    if sys.platform == "win32":
        return _windows_memory()[1]
    with open("/proc/self/status", encoding="ascii") as f:
        for line in f:
            if line.startswith("VmData:"):
                return int(line.split()[1]) * 1024
    raise OSError(f"no committed-memory source on {sys.platform}")


# ---------------------------------------------------------------- 交接成本口径
def ping_pong_handoff_us(rounds: int = 2000) -> dict:
    """事件乒乓：主线程与工人线程各守一个 Event，一来一回记一轮（2 次交接）。

    每次交接 = 唤醒对方 + 自己让出——这是上下文切换成本里用户态可测的那部分
    （调度器换人 + 唤醒时延）。注意：Python 线程还共用一把 GIL 锁，交接时延
    里含 GIL 的取得与释放，量出来的数字是「本课程线上真实的换人成本」。
    """
    to_worker = threading.Event()
    to_main = threading.Event()
    laps_ns: list[int] = []

    def worker() -> None:
        for _ in range(rounds):
            to_worker.wait()
            to_worker.clear()
            to_main.set()

    t = threading.Thread(target=worker)
    t.start()
    for _ in range(rounds):
        start = time.perf_counter_ns()
        to_worker.set()
        to_main.wait()
        to_main.clear()
        laps_ns.append(time.perf_counter_ns() - start)
    t.join()
    per_handoff_us = [ns / 1000 / 2 for ns in laps_ns]  # 一轮 = 2 次交接
    return {
        "rounds": rounds,
        "handoffs": rounds * 2,
        "handoff_us_mean": round(statistics.mean(per_handoff_us), 2),
        "handoff_us_median": round(statistics.median(per_handoff_us), 2),
    }


def relay_tokens_per_sec(n_threads: int = 2, duration_s: float = 0.5) -> dict:
    """接力环：n 条线程围一圈传令牌，每传一次 = 一次交接；数每秒传过多少令牌。

    每条线程拿到令牌只做一丁点活就传给下家——活越少，时间越被交接吃掉。
    环越大、参与轮转的线程越多，若每秒令牌数随之下降，就是「大量线程轮转下
    吞吐下降」的可测身影（Windows 上没有标准库口径直接数切换次数，量现象）。
    """
    flags = [threading.Event() for _ in range(n_threads)]
    counts = [0] * n_threads
    stop = threading.Event()

    def runner(i: int) -> None:
        mine, nxt = flags[i], flags[(i + 1) % n_threads]
        while not stop.is_set():
            if not mine.wait(timeout=0.05):  # 超时醒来只为看一眼停不停
                continue
            mine.clear()
            counts[i] += 1
            nxt.set()

    threads = [threading.Thread(target=runner, args=(i,)) for i in range(n_threads)]
    for t in threads:
        t.start()
    flags[0].set()
    time.sleep(duration_s)
    stop.set()
    for t in threads:
        t.join(timeout=2.0)
    tokens = sum(counts)
    return {
        "ring_size": n_threads,
        "duration_s": duration_s,
        "tokens": tokens,
        "tokens_per_sec": round(tokens / duration_s, 1),
        "us_per_handoff": round(duration_s * 1e6 / tokens, 2) if tokens else None,
    }


# ---------------------------------------------------------------- v1 连接压力
def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def probe_threaded_server(
    levels: tuple[int, ...] = (0, 100, 300),
    burst: int = 24,
    handler: Callable[[Request], bytes] = demo_handler,
) -> dict:
    """把 v1 起在本进程，按 levels 逐级挂哑连接（只连不发），量每级的线程与内存。

    哑连接 = 现实世界里的「保活却闲置」连接：浏览器开着不动的标签页、挂着不
    说话的 App 长连接。在线程模型里它们每个都占着一条实打实的线程。
    """
    port = _free_port()
    threading.Thread(
        target=threaded_server.serve, args=("127.0.0.1", port, handler), daemon=True
    ).start()
    deadline = time.monotonic() + 5.0
    while time.monotonic() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                break  # 探活连接立即断开，v1 的伺候线程应很快自行退场
        except OSError:
            time.sleep(0.02)
    else:
        raise AssertionError("v1 did not start listening within 5s")
    time.sleep(0.2)  # 等探活连接的伺候线程退干净，基线才准

    baseline_threads = threading.active_count()
    idle: list[socket.socket] = []
    rows = []
    for level in levels:
        while len(idle) < level:
            idle.append(socket.create_connection(("127.0.0.1", port), timeout=10))
        target = baseline_threads + level
        end = time.monotonic() + 10.0
        while threading.active_count() < target and time.monotonic() < end:
            time.sleep(0.02)  # 轮询等 accept 线程们全部上岗，不裸 sleep 赌竞速
        time.sleep(0.1)  # 再稳一拍，让栈页被碰过、内存账记全
        rows.append(
            {
                "connections": level,
                "threads": threading.active_count(),
                "expected_threads": target,
                "rss_bytes": rss_bytes(),
                "committed_bytes": committed_bytes(),
            }
        )
    base = rows[0]
    for row in rows:  # 相对基线的增量与折算到「每连接」的单价
        n = row["connections"] - base["connections"]
        row["threads_delta"] = row["threads"] - base["threads"]
        row["rss_delta_bytes"] = row["rss_bytes"] - base["rss_bytes"]
        row["committed_delta_bytes"] = row["committed_bytes"] - base["committed_bytes"]
        row["rss_per_connection_bytes"] = row["rss_delta_bytes"] // n if n else None
        row["committed_per_connection_bytes"] = row["committed_delta_bytes"] // n if n else None

    burst_ok = [False] * burst  # 满载哑连接时，再挤进 burst 个并发真请求
    barrier = threading.Barrier(burst)

    def one(i: int) -> None:
        try:
            barrier.wait()
            with socket.create_connection(("127.0.0.1", port), timeout=10) as conn:
                conn.settimeout(10)
                conn.sendall(b"GET / HTTP/1.1\r\nHost: bench\r\n\r\n")
                burst_ok[i] = conn.recv(65536).startswith(b"HTTP/1.1 200 OK\r\n")
        except OSError:
            burst_ok[i] = False

    threads = [threading.Thread(target=one, args=(i,)) for i in range(burst)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=20)
    for conn in idle:
        conn.close()
    return {
        "levels": rows,
        "burst": {
            "while_holding": levels[-1],
            "concurrent_requests": burst,
            "ok": sum(burst_ok),
        },
    }


def run_probe(
    levels: tuple[int, ...] = (0, 100, 300),
    burst: int = 24,
    handoff_rounds: int = 2000,
    relay_sizes: tuple[int, ...] = (2, 32),
    relay_duration_s: float = 0.4,
    out: str | Path | None = None,
) -> dict:
    """跑齐三组探针，汇成一份报告；out 给了路径就把 JSON 落盘（数字落盘）。"""
    report = {
        "platform": sys.platform,
        "python": sys.version.split()[0],
        "thread_stack_size_setting": threading.stack_size(),  # 0 = 用解释器/系统默认
        "connections": probe_threaded_server(levels=levels, burst=burst),
        "ping_pong": ping_pong_handoff_us(rounds=handoff_rounds),
        "relay": [relay_tokens_per_sec(n, relay_duration_s) for n in relay_sizes],
    }
    if out is not None:
        Path(out).write_text(json.dumps(report, indent=2), encoding="utf-8")
    return report


# ---------------------------------------------------------------- v2 对照（第 3 章）
def probe_event_server(
    levels: tuple[int, ...] = (0, 100, 300),
    burst: int = 24,
    handler: Callable[[Request], bytes] = demo_handler,
) -> dict:
    """把 v2 起在本进程，按 levels 逐级挂哑连接，量每级的线程与内存。

    与 probe_threaded_server 同一套口径、同一套输出结构——两份报告可以逐行
    对照：线程版的 threads 随连接一比一涨，事件版应当全程平线。
    """
    port = _free_port()
    stop = threading.Event()
    threading.Thread(
        target=event_server.serve,
        args=("127.0.0.1", port, handler),
        kwargs={"stop_flag": stop},
        daemon=True,
    ).start()
    deadline = time.monotonic() + 5.0
    while time.monotonic() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                break  # 探活连接立即断开，事件循环会自己把它清理干净
        except OSError:
            time.sleep(0.02)
    else:
        raise AssertionError("v2 did not start listening within 5s")
    time.sleep(0.2)  # 等探活连接的事件走完，基线才准

    baseline_threads = threading.active_count()
    idle: list[socket.socket] = []
    rows = []
    for level in levels:
        while len(idle) < level:
            idle.append(socket.create_connection(("127.0.0.1", port), timeout=10))
        time.sleep(0.3)  # 稳一拍：accept 全部消化、selector 登记与内核簿记记全
        rows.append(
            {
                "connections": level,
                "threads": threading.active_count(),
                "expected_threads": baseline_threads,  # 事件循环版：连接再多名单也不涨
                "rss_bytes": rss_bytes(),
                "committed_bytes": committed_bytes(),
            }
        )
    base = rows[0]
    for row in rows:  # 与线程版同一套增量口径，逐行可对照
        n = row["connections"] - base["connections"]
        row["threads_delta"] = row["threads"] - base["threads"]
        row["rss_delta_bytes"] = row["rss_bytes"] - base["rss_bytes"]
        row["committed_delta_bytes"] = row["committed_bytes"] - base["committed_bytes"]
        row["rss_per_connection_bytes"] = row["rss_delta_bytes"] // n if n else None
        row["committed_per_connection_bytes"] = row["committed_delta_bytes"] // n if n else None

    burst_ok = [False] * burst  # 满载哑连接时，再挤进 burst 个并发真请求
    barrier = threading.Barrier(burst)

    def one(i: int) -> None:
        try:
            barrier.wait()
            with socket.create_connection(("127.0.0.1", port), timeout=10) as conn:
                conn.settimeout(10)
                conn.sendall(b"GET / HTTP/1.1\r\nHost: bench\r\n\r\n")
                burst_ok[i] = conn.recv(65536).startswith(b"HTTP/1.1 200 OK\r\n")
        except OSError:
            burst_ok[i] = False

    threads = [threading.Thread(target=one, args=(i,)) for i in range(burst)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=20)
    for conn in idle:
        conn.close()
    stop.set()  # 喊停事件循环，收摊
    return {
        "levels": rows,
        "burst": {
            "while_holding": levels[-1],
            "concurrent_requests": burst,
            "ok": sum(burst_ok),
        },
    }


def probe_select_fd_limit(max_fds: int = 700) -> dict:
    """向 selectors.DefaultSelector 逐个注册真 socket，实测 select 报名单的硬上限。

    select 每次调用都要把「此刻要盯的全部描述符」装进一张编译期定死大小的
    名单（fd_set）递给内核，装不下就当场报错——这个探针就是把那声报错真实
    触到、原样带回来。epoll（Linux 的 DefaultSelector）是内核常驻登记，
    没有这张要来回递的名单，预期全部注册成功。
    """
    sel = selectors.DefaultSelector()
    socks: list[socket.socket] = []
    registered = 0
    error: str | None = None
    try:
        for _ in range(max_fds):
            s = socket.socket()
            socks.append(s)
            sel.register(s, selectors.EVENT_READ)
            registered += 1
            sel.select(0)  # 注册本身不触上限，装名单的是 select 调用本身
    except (ValueError, OSError) as e:
        error = f"{type(e).__name__}: {e}"
    finally:
        sel.close()
        for s in socks:
            s.close()
    return {
        "platform": sys.platform,
        "selector": type(sel).__name__,
        "max_tried": max_fds,
        "registered": registered,
        "error": error,
    }


def main(argv: list[str]) -> int:
    mode = argv[1] if len(argv) > 1 else ""
    if mode == "event":
        # python -m fable.bench event [N] [out.json] —— v2 事件循环版对照探针（第 3 章）
        n = int(argv[2]) if len(argv) > 2 else 300
        out = argv[3] if len(argv) > 3 else None
        levels = (0, max(1, n // 3), n) if n >= 3 else (0, n)
        report = {
            "platform": sys.platform,
            "python": sys.version.split()[0],
            "selector": selectors.DefaultSelector.__name__,
            "connections": probe_event_server(levels=levels),
        }
        if out is not None:
            Path(out).write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(json.dumps(report, indent=2), flush=True)
        if out:
            print(f"report written to {out}", flush=True)
        return 0
    if mode == "fdlimit":
        # python -m fable.bench fdlimit [max] —— select 描述符上限探针（第 3 章）
        max_fds = int(argv[2]) if len(argv) > 2 else 700
        print(json.dumps(probe_select_fd_limit(max_fds=max_fds), indent=2), flush=True)
        return 0
    # python -m fable.bench [N] [out.json] —— v1 线程版探针（第 2 章原样）
    n = int(argv[1]) if argv[1:] else 300
    out = argv[2] if len(argv) > 2 else None
    levels = (0, max(1, n // 3), n) if n >= 3 else (0, n)
    report = run_probe(levels=levels, out=out)
    print(json.dumps(report, indent=2), flush=True)
    if out:
        print(f"report written to {out}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
