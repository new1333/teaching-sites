"""手打 HTTP 请求的小工具：自己当一回客户端，看纯文本报文一来一回。

用法（服务器先在另一个终端起着）：
    python -m fable.send_raw 127.0.0.1 8000 "GET / HTTP/1.1" "Host: fable"
每个参数一行，工具替你补上行尾的 CRLF 和结束头部的空行，
再把服务器的原始响应一字节不改地打到屏幕上。
"""
import socket
import sys


def send_raw(host: str, port: int, lines: list[str]) -> bytes:
    """把 lines 当请求行+头部逐行发出（自动补 CRLF 与空行），返回原始响应。

    按规定请求行该是纯 ASCII；你手打了别的字符它也照发（utf-8 编码出去），
    服务器怎么判罚，正好用来看报文语法是不是真的在被检查。
    """
    request = "\r\n".join(lines) + "\r\n\r\n"
    with socket.create_connection((host, port), timeout=5) as conn:
        conn.settimeout(5)
        conn.sendall(request.encode("utf-8"))
        chunks = []
        while True:
            chunk = conn.recv(65536)
            if not chunk:
                break
            chunks.append(chunk)
    return b"".join(chunks)


def main(argv: list[str]) -> int:
    if len(argv) < 4:
        print("用法: python -m fable.send_raw HOST PORT 请求行 [头部行 ...]")
        print('例:   python -m fable.send_raw 127.0.0.1 8000 "GET / HTTP/1.1" "Host: fable"')
        return 2
    response = send_raw(argv[1], int(argv[2]), argv[3:])
    sys.stdout.buffer.write(response)
    sys.stdout.buffer.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
