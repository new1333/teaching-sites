"""自带名字的演示上游：一台会自报身份的 v3 服务器。

fable.upstream_demo — python -m fable.upstream_demo 127.0.0.1 9001 alpha
起一台上游。伺候能力一行未写：就是第 4 章那台 v3 事件服务器（event_server），
换的只有 handler——每台自带一个名字，响应正文里报上名，让「这条请求是谁
伺候的」肉眼可查。/big 给一段 256 KiB 的定长大正文，考代理转发的完整性。

上游是「跑业务的应用」的替身：现实部署里这里是 Python/Java 应用进程，
教学实验里它只要诚实——接请求、报名字、回定长响应——就够了。
"""
import argparse
import os
import socket
import sys
import threading
from typing import Callable

from fable import event_server
from fable.blocking_server import Request, build_response

BIG_BODY_BYTES = 256 * 1024  # /big 的定长大正文：256 KiB，考转发的完整性


def make_handler(name: str) -> Callable[[Request], bytes]:
    """造一台上游的 handler：报名字是它的全部个性，其余照 v3 规矩回话。"""

    def handler(request: Request) -> bytes:
        text = [("Content-Type", "text/plain; charset=utf-8")]
        if request.path == "/":
            return build_response(200, "OK", f"hello from {name}\n".encode("ascii"), text)
        if request.path == "/big":
            unit = f"{name} big body line 0123456789 abcdefghijklmnopqrstuvwxyz\n"
            body = (unit * (BIG_BODY_BYTES // len(unit) + 1))[:BIG_BODY_BYTES]
            return build_response(200, "OK", body.encode("ascii"), text)
        return build_response(
            200,
            "OK",
            f"hello from {name} at {request.path}\n".encode("latin-1"),
            text,
        )

    return handler


def serve(
    host: str,
    port: int,
    name: str,
    poll_interval: float = 1.0,
    stop_flag: threading.Event | None = None,
) -> None:
    """起一台上游：v3 伺服循环原样复用，banner 自报名字与 pid（方便指认/结束它）。"""
    print(
        f"fable upstream '{name}' (pid={os.getpid()}) listening on http://{host}:{port}/"
        f" ... Ctrl+C 停止",
        flush=True,
    )
    event_server.serve(host, port, make_handler(name), poll_interval, stop_flag)


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m fable.upstream_demo",
        description="演示上游：一台自带名字、响应里自报身份的 v3 服务器",
    )
    parser.add_argument("host", nargs="?", default=None)
    parser.add_argument("port", type=int, nargs="?", default=None)
    parser.add_argument("name", nargs="?", default=None, help="上游名字（响应正文里自报）")
    parser.add_argument("--host", dest="host_opt", default=None)
    parser.add_argument("--port", dest="port_opt", type=int, default=None)
    parser.add_argument("--name", dest="name_opt", default=None, help="同上，等号写法 --name=alpha 最稳")
    args = parser.parse_args(argv[1:])

    host = args.host_opt or args.host or "127.0.0.1"
    port = args.port_opt or args.port or 9001
    name = args.name_opt or args.name or f"upstream-{port}"
    try:
        serve(host, port, name)
    except KeyboardInterrupt:
        print(f"\nfable upstream '{name}' stopped.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
