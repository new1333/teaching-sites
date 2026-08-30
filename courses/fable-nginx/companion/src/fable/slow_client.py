"""慢客户端工具：把「手机网络上的用户」带上实验台。

fable.slow_client — 三种慢法，对应第 1/3 章立据的两起事故与它们的修复：
- 掰碎了发（--frags N --delay S）：一个请求拆 N 段、隔着延迟发——复现
  「第一段没读全就当完整请求硬解」的 400（v0/v2 的读残事故）；
- 微缩接收窗（--window BYTES）：连接前把 SO_RCVBUF 压小——逼出真实的
  写端反压（内核发送缓冲被填满，write 只写得出一部分）；
- 发完愣住（--stall S）：请求发完先不读，让服务端的响应堆在内核里没人收。

用法（服务器先在另一个终端起着）：
    python -m fable.slow_client 127.0.0.1 8000 / --frags 5 --delay 0.3
    python -m fable.slow_client 127.0.0.1 8000 /big --window 4096 --stall 3
回话打状态行与「实收正文 vs Content-Length」的对照——差一个字节都会点名。
"""
import argparse
import math
import re
import socket
import sys
import time


def split_request(request: bytes, frags: int) -> list[bytes]:
    """把一条请求按 frags 份均分——只管切，不管语义（那正是要考服务器的）。"""
    frags = max(1, frags)
    size = math.ceil(len(request) / frags)
    return [request[i : i + size] for i in range(0, len(request), size)]


def send_slow(
    host: str,
    port: int,
    path: str = "/",
    frags: int = 4,
    delay: float = 0.1,
    window: int | None = None,
    stall: float = 0.0,
    timeout: float = 30.0,
) -> bytes:
    """慢客户端本体：掰碎发请求、缩着接收窗收响应，返回服务器的原始响应。

    window 必须在 connect 之前设：接收窗是握手时 advertised 的，连上了再缩，
    内核未必买账。stall 是「发完请求先不读」的秒数——响应会先在两头的
    内核缓冲里堆积，堆不下就是写端反压现身的时刻。

    段与段之间还夹一个事故探测器：请求还没发完，连接上居然有字节到货
    （服务器抢答了）——就地收下、停止再发，把它提前回的话原样带回。
    """
    conn = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        if window is not None:
            conn.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, window)
        conn.settimeout(timeout)
        conn.connect((host, port))
        request = f"GET {path} HTTP/1.1\r\nHost: {host}\r\n\r\n".encode("latin-1")
        early_answer: bytes | None = None
        for i, piece in enumerate(split_request(request, frags)):
            if i:
                time.sleep(delay)
                early_answer = _peek(conn, timeout)
                if early_answer is not None:
                    break  # 请求还没发完它就回话了——这就是事故，不再喂它剩下的段
            try:
                conn.sendall(piece)
            except OSError:
                break  # 段还没发完对端就挂了（提前回话又关闭的受害现场）——去读它扔下了什么
        if early_answer is not None:
            return early_answer
        if stall:
            time.sleep(stall)
        chunks = []
        while True:
            try:
                chunk = conn.recv(65536)
            except OSError:
                break  # 读到一半连接被对端中止：已收到的先带回去
            if not chunk:
                break
            chunks.append(chunk)
        return b"".join(chunks)
    finally:
        conn.close()


def _peek(conn: socket.socket, timeout: float) -> bytes | None:
    """非阻塞地看一眼连接上有没有字节到货：有就带回，没有返回 None。"""
    conn.setblocking(False)
    try:
        return conn.recv(65536)
    except BlockingIOError:
        return None
    except OSError:
        return b""  # 对端已经挂断：当作「抢答了个空」交出去
    finally:
        conn.settimeout(timeout)  # 回到原先的超时模式


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m fable.slow_client",
        description="慢客户端：掰碎发请求 / 缩接收窗 / 发完愣住，专考服务器对部分读与部分写的功课",
    )
    parser.add_argument("host")
    parser.add_argument("port", type=int)
    parser.add_argument("path", nargs="?", default=None, help="请求路径（默认 /；建议用 --path=xxx 传，免得被 shell 改写）")
    parser.add_argument("--path", dest="path_opt", default=None, help="同上，等号写法 --path=/big 最稳")
    parser.add_argument("--frags", type=int, default=4, help="请求掰成几段发（默认 4）")
    parser.add_argument("--delay", type=float, default=0.2, help="段与段之间的间隔秒数（默认 0.2）")
    parser.add_argument("--window", type=int, default=None, help="接收窗 SO_RCVBUF 压到多少字节（默认不压）")
    parser.add_argument("--stall", type=float, default=0.0, help="请求发完后先不读响应的秒数（默认 0）")
    args = parser.parse_args(argv[1:])

    path = args.path_opt or args.path or "/"
    if not path.startswith("/"):  # --path=big 也照当 /big 用：躲开 shell 对开头斜杠的改写
        path = "/" + path
    response = send_slow(
        args.host,
        args.port,
        path=path,
        frags=args.frags,
        delay=args.delay,
        window=args.window,
        stall=args.stall,
    )
    if not response:
        print("（对端连一个字节都没回——请求还没发完它就挂断了）")
        return 0
    head, _, body = response.partition(b"\r\n\r\n")
    status_line = head.split(b"\r\n", 1)[0].decode("latin-1", "replace")
    print(status_line)
    match = re.search(rb"Content-Length: (\d+)", head)
    if not match:
        print(f"body: {len(body)} bytes (响应未标 Content-Length)")
    elif len(body) == int(match.group(1)):
        print(f"body: {len(body)} bytes (Content-Length: {match.group(1).decode()}) [完整]")
    else:
        print(
            f"body: {len(body)} bytes (Content-Length: {match.group(1).decode()}) "
            f"[截断：差 {int(match.group(1)) - len(body)} 字节]"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
