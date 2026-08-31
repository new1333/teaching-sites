"""收/发两个方向的缓冲区：半读半写世界里连接的记账本。

fable.buffers — 字节流没有消息边界，一帧一帧到货、一勺一勺出去都是常态：
- RecvBuffer（收方向）：没到齐的字节先攒着，攒够一条完整行 / 一段定长再放行；
- SendBuffer（发方向）：写不下去的先攒着，可写时冲多少记多少，冲完才算完。
"""
from typing import Callable

CRLF = b"\r\n"


class RecvBuffer:
    """收方向缓冲：字节先攒着，「到齐」才放行。

    到齐的判据两种，对应 HTTP 报文的两类读法：
    - 按行（read_line）：攒到行尾 CRLF 才放行一整行（不含 CRLF）——请求行与头部；
    - 按定长（read_upto）：要几个放几个，多的继续攒——正文按 Content-Length 读的生长点。
    """

    def __init__(self) -> None:
        self._buf = bytearray()

    def feed(self, data: bytes) -> None:
        """到货一批就先攒下：攒本身不做任何判断，判据在读取时查。"""
        self._buf += data

    def read_line(self) -> bytes | None:
        """放行一条完整行（不含行尾 CRLF）；行没攒齐返回 None（还没读完）。"""
        i = self._buf.find(CRLF)
        if i < 0:
            return None
        line = bytes(self._buf[:i])
        del self._buf[: i + len(CRLF)]
        return line

    def read_upto(self, n: int) -> bytes:
        """定长放行：交出至多 n 字节，剩下的继续攒着等下次。"""
        take = bytes(self._buf[:n])
        del self._buf[:n]
        return take

    def __len__(self) -> int:
        return len(self._buf)


class SendBuffer:
    """发方向缓冲：待发字节记在账上，写多少销多少账。

    非阻塞 write 的契约是「能写几个写几个、返回实发数」，一个空位都没有时
    报「暂时没有」——差额不能丢，留在账上等下次可写接着冲。pending 归零，
    这条响应才算发完（冲完才关）。
    """

    def __init__(self) -> None:
        self._pending = bytearray()

    def feed(self, data: bytes) -> None:
        """有待发字节先入账：入账不发出，发出只发生在 flush。"""
        self._pending += data

    @property
    def pending(self) -> int:
        """账上还欠着多少字节没发出去——它是「响应发完了没有」的唯一判据。"""
        return len(self._pending)

    def flush(self, write: Callable[[bytes], int], chunk_size: int = 65536) -> int:
        """冲一轮：把账上开头的一段递给 write（一次只递一块），返回本轮实冲字节数。

        write 得是非阻塞写（如 conn.send）：能收多少收多少、返回实收字节数，
        一个空位都没有时抛 BlockingIOError——那不是事故，是「下次可写再冲」
        的信号，差额原封不动留在账上。
        """
        if not self._pending:
            return 0
        sent = write(bytes(self._pending[:chunk_size]))
        if sent:
            del self._pending[:sent]
        return sent
