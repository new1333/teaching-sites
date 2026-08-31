"""v4 master-worker 骨架：一条监听 socket，master 管大局，N 台 worker 各带一条事件循环。

fable.worker_pool — python -m fable.worker_pool 起服务。第 4 章的 v3 是单进程
单线程：一条事件循环伺候所有连接。本章把它长成 nginx 的形状——master 建
监听 socket、派 worker、监控补位、优雅收摊；每台 worker 拿到同一只监听
socket 的一个副本（Windows 上 spawn 派生子进程时经句柄复制传递——本章
正文的最小实验实测过），各自挂上自己的事件循环接客：谁先看见门口有连接，
谁就 accept 走。master 从不伺候连接，它的账本里也没有「连接」这一栏。

worker 的伺候能力一行未重写：连接状态机直接借 event_server._Connection
（v3 的全部功课），accept 后那几步原样搬来，为的是在这里多记一笔「接进来」
的账。每台 worker 在账本目录（默认 fable-stats/）里自报身份（worker-{pid}.json），
响应头里也带一行 X-Fable-Worker——哪台伺候了你，curl -i 看得见。

优雅重载的最小模拟（Windows 无 POSIX 信号，与真 nginx 的 SIGHUP/SIGUSR2
有差距，差异清单见附录）：master 盯一个触发文件（默认 reload.txt），它一
出现就「拉新 worker 在前、排干老 worker 在后」——老 worker 注销监听、
不再接新客，把手头连接干完才退场。
"""
import dataclasses
import itertools
import json
import multiprocessing
import os
import socket
import sys
import threading
from pathlib import Path
from typing import Callable

from fable import event_loop, event_server
from fable.blocking_server import Request, build_response, demo_handler


# ---------------------------------------------------------------- worker 侧


def _worker_main(
    listening_sock: socket.socket,
    handler: Callable[[Request], bytes],
    stats_dir: str,
    drain_event: object,
    worker_id: int,
) -> None:
    """worker 进程入口：把 master 给的监听 socket 挂上自己的事件循环，开始接客。

    事件循环与连接状态机全是旧章的旧货；本函数新增的只有三件事——接客记账
    （accepted / served 写进账本文件），「排干退场」（drain_event 一亮，先
    注销监听 socket 不再接新客，已接进来的连接继续伺候，名单清空才退场），
    与看门狗（master 没了就自行退场，不留孤儿）。
    """
    pid = os.getpid()
    stats_path = Path(stats_dir) / f"worker-{pid}.json"
    state: dict = {"pid": pid, "accepted": 0, "served": 0, "draining": False}
    parent = multiprocessing.parent_process()  # 看门狗的表：master 死没死，问它
    _write_stats(stats_path, role="worker", **state)
    print(f"[worker {worker_id}] pid={pid} 上岗：继承监听 socket，单线程事件循环接客", flush=True)
    orphaned = False
    try:
        loop = event_loop.EventLoop()
        listening_sock.setblocking(False)
        loop.register(listening_sock, _on_accept(loop, listening_sock, handler, stats_path, state))
        while not (state["draining"] and loop.idle()):
            if parent is not None and not parent.is_alive():
                orphaned = True  # master 没了：不留孤儿 worker 僵着（真 nginx 同款纪律）
                break
            if not state["draining"] and drain_event.is_set():
                loop.close(listening_sock)  # 门口摘牌：新客请找别的 worker
                state["draining"] = True
                _write_stats(stats_path, role="worker", **state)
                print(f"[worker {worker_id}] pid={pid} 排干退场：不再接新客，干完手头的就走", flush=True)
                continue
            loop.step(timeout=0.5)
        loop.close_all()
    except KeyboardInterrupt:
        pass  # 控制台 Ctrl+C 广播到整组进程：worker 收到就当排干处理，不吐 traceback
    if orphaned:
        print(f"[worker {worker_id}] pid={pid} master 已不在，自行退场", flush=True)
    else:
        print(f"[worker {worker_id}] pid={pid} 手头连接已清空，退场", flush=True)


def _on_accept(
    loop: event_loop.EventLoop,
    listening_sock: socket.socket,
    handler: Callable[[Request], bytes],
    stats_path: Path,
    state: dict,
) -> Callable[[object, int], None]:
    """门口就绪的回调：接进来、记一笔账、发一本 v3 的连接记账本。

    与 event_server._on_accept_ready 里的三步一字不差，多的只是记一笔
    「接进来」的账——排干测试靠它确认「这条连接已经挂在哪台 worker 的
    事件循环上」。
    """

    def on_accept(_fileobj: object, _mask: int) -> None:
        try:
            conn, _addr = listening_sock.accept()
        except OSError:
            return  # 偶发竞争（对端连上又立刻断开）：下一圈就绪名单还会报
        state["accepted"] += 1
        _write_stats(stats_path, role="worker", **state)
        conn.setblocking(False)
        connection = event_server._Connection(loop, conn, _counting(handler, stats_path, state))
        loop.register(conn, connection.on_readable)

    return on_accept


def _counting(
    handler: Callable[[Request], bytes],
    stats_path: Path,
    state: dict,
) -> Callable[[Request], bytes]:
    """给 handler 包一层账房：伺候完一条就在账本上记一笔，并自报家门。

    /status 是新增的自省路由（哪台 worker、接了几条、伺候了几条）；其余
    请求交原 handler，伺候完记账、在响应头里插一行 X-Fable-Worker。
    """

    def counted(request: Request) -> bytes:
        if request.path == "/status":
            body = (
                f"role=worker pid={state['pid']} accepted={state['accepted']} "
                f"served={state['served']} draining={state['draining']}\n"
            )
            return _with_worker_id(
                build_response(200, "OK", body.encode("ascii"), [("Content-Type", "text/plain; charset=utf-8")])
            )
        response = handler(request)
        state["served"] += 1
        _write_stats(stats_path, role="worker", **state)
        return _with_worker_id(response)

    return counted


def _with_worker_id(response: bytes) -> bytes:
    """在状态行后插一行 X-Fable-Worker：哪台 worker 伺候了你，curl -i 看得见。"""
    if b"\r\n" not in response:
        return response  # 不是本课程 handler 的回话格式：原样放行
    line_end = response.index(b"\r\n") + 2
    return response[:line_end] + f"X-Fable-Worker: {os.getpid()}\r\n".encode("ascii") + response[line_end:]


# ---------------------------------------------------------------- master 侧


@dataclasses.dataclass
class _WorkerProc:
    """master 名下的一名员工：进程对象、喊它排干的事件、工号。"""

    proc: multiprocessing.Process
    drain: object
    worker_id: int

    @property
    def pid(self) -> int:
        return self.proc.pid


def run_master(
    host: str,
    port: int,
    handler: Callable[[Request], bytes] | None = None,
    workers: int = 2,
    stats_dir: str | None = None,
    stop_event: threading.Event | None = None,
    reload_file: str | None = None,
    poll_interval: float = 0.5,
) -> None:
    """master 主循环：建监听 socket → 派 N 台 worker → 监控补位/优雅轮换 → 排干收摊。

    master 全程不 accept：监听 socket 只用来「复印」给每台 worker。worker 数
    配 CPU 核数是 nginx worker_processes auto 的路子（os.cpu_count()）；本模块
    默认 2 台，是为了进程列表里一眼看得清。
    """
    handler = handler or demo_handler
    stop = stop_event or threading.Event()
    stats = Path(stats_dir or "fable-stats")
    stats.mkdir(parents=True, exist_ok=True)
    reload_path = Path(reload_file) if reload_file else None
    ctx = multiprocessing.get_context("spawn")  # Windows 上唯一选项；Unix 上显式统一
    ids = itertools.count(1)

    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind((host, port))
    server.listen(socket.SOMAXCONN)
    slots = [_spawn(ctx, server, handler, stats, next(ids)) for _ in range(workers)]
    retired: list[_WorkerProc] = []
    retired_done: list[int] = []
    _write_stats(stats / "master.json", role="master", pid=os.getpid(), workers=[w.pid for w in slots], retired=[])
    hint = f"；优雅轮换：新建文件 {reload_path}" if reload_path is not None else ""
    print(
        f"fable v4 (master pid={os.getpid()} + {workers} workers) listening on http://{host}:{port}/"
        f" ... Ctrl+C 停止{hint}",
        flush=True,
    )
    try:
        while not stop.is_set():
            changed = False
            for i, w in enumerate(slots):  # ① 监控：意外退场的，立刻补一个
                if not w.proc.is_alive():
                    w.proc.join()  # 收尸
                    print(f"[master] worker {w.pid} 意外退场（exitcode={w.proc.exitcode}），补一个", flush=True)
                    slots[i] = _spawn(ctx, server, handler, stats, next(ids))
                    changed = True
            still: list[_WorkerProc] = []
            for w in retired:  # ② 排干收尾：确认走干净了的，记入 retired 名册
                if w.proc.is_alive():
                    still.append(w)
                else:
                    w.proc.join()
                    retired_done.append(w.pid)
                    print(f"[master] worker {w.pid} 已排干退场", flush=True)
                    changed = True
            retired = still
            if reload_path is not None and reload_path.exists():  # ③ 优雅轮换指令
                reload_path.unlink(missing_ok=True)
                old = slots.pop(0)
                new = _spawn(ctx, server, handler, stats, next(ids))  # 拉新在前
                old.drain.set()  # 排干在后：任何时刻门口都有人接客
                retired.append(old)
                slots.append(new)
                print(
                    f"[master] 优雅轮换：新 worker {new.pid} 上岗，老 worker {old.pid} 停接新客、干完手头再退",
                    flush=True,
                )
                changed = True
            if changed:
                _write_stats(
                    stats / "master.json",
                    role="master",
                    pid=os.getpid(),
                    workers=[w.pid for w in slots],
                    retired=retired_done,
                )
            stop.wait(poll_interval)
    finally:
        for w in slots:  # 优雅收摊：全员喊排干（干完手头连接再退），限时等待
            w.drain.set()
        for w in slots + retired:
            w.proc.join(timeout=8.0)
        for w in slots + retired:
            if w.proc.is_alive():
                w.proc.terminate()  # 排干超时才硬停：教学实现的兜底
                print(f"[master] worker {w.pid} 排干超时，硬停", flush=True)
        server.close()
        _write_stats(stats / "master.json", role="master", pid=os.getpid(), workers=[], retired=retired_done)


def _spawn(
    ctx: multiprocessing.context.BaseContext,
    server: socket.socket,
    handler: Callable[[Request], bytes],
    stats: Path,
    worker_id: int,
) -> _WorkerProc:
    """派一台 worker：监听 socket 经 Process 参数传过去（spawn 负责句柄复制）。"""
    drain = ctx.Event()
    proc = ctx.Process(
        target=_worker_main,
        args=(server, handler, str(stats), drain, worker_id),
        daemon=True,  # 兜底：master 正常退出时收割 worker；硬杀场景靠看门狗
    )
    proc.start()
    return _WorkerProc(proc, drain, worker_id)


def _write_stats(path: Path, **payload: object) -> None:
    """把一台进程的自报身份写进账本：谁、接了几条、伺候了几条、是否在排干。"""
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def main(argv: list[str]) -> int:
    host = argv[1] if len(argv) > 1 else "127.0.0.1"
    port = int(argv[2] if len(argv) > 2 else 8000)
    workers = int(argv[3] if len(argv) > 3 else 2)
    reload_file = argv[4] if len(argv) > 4 else "reload.txt"
    try:
        run_master(host, port, workers=workers, reload_file=reload_file)
    except KeyboardInterrupt:
        print("\nfable v4 stopped.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
