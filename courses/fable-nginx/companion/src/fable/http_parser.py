"""增量 HTTP 请求解析状态机：喂字节块，吐「还没读完 / 完成 / 坏信」。

fable.http_parser — v0 的 parse_request 一次吃整条报文，前提是「一次 recv
读到的就是全部」。字节流没这个前提：请求掰成几段到货是常态。这个解析器把
「解析到哪一步了」写成显式状态，每 feed 一段就贪心往前推一步，推不动就报
「还没读完」——报文没到齐时绝不硬解。

已声明的边界（与 v0 一脉相承，差异清单见附录）：读到头部的结束空行即判
「完成」，正文（body）一字不读——本课程的 handler 都只看请求行与头部，
带正文的请求照常得到响应，正文字节被忽略。
"""
import dataclasses

from fable import buffers
from fable.blocking_server import Request

NEED_MORE = "need_more"  # 还没读完：先攒着，等下一段
DONE = "done"            # 完成：一条完整请求已可交出
BAD = "bad"              # 坏信：请求行不合语法，该回 400

REQUEST_LINE = "request_line"  # 正在攒第一条完整行：方法 SP 路径 SP 版本
HEADERS = "headers"            # 正在攒头部行，直到空行
COMPLETE = "done"              # 定态：完成或坏信之后不再改判


@dataclasses.dataclass
class ParseResult:
    """feed 一次的回话：到了哪一步（state），到了的话货在哪（request / error）。"""

    state: str
    request: Request | None = None
    error: str | None = None

    @property
    def need_more(self) -> bool:
        return self.state == NEED_MORE

    @property
    def done(self) -> bool:
        return self.state == DONE

    @property
    def bad(self) -> bool:
        return self.state == BAD


class HttpRequestParser:
    """每条连接配一个的解析状态机：请求行 → 头部 →（空行）→ 完成。

    状态与转移（与实现一字对应）：

    | 当前状态     | 读到什么        | 转移                          |
    |-------------|-----------------|-------------------------------|
    | request_line| 一行且合语法    | → headers（记下方法/路径/版本）|
    | request_line| 一行但语法不对  | → bad（回 400 的判据）         |
    | headers     | 一行非空        | 留在 headers（记一个头部）     |
    | headers     | 空行            | → done（交出 Request）         |
    | 任一状态    | 行没攒齐        | 停在原状态，报 need_more       |

    同一次 feed 里攒下的字节够推几步就推几步（贪心推进）；done 与 bad 是
    定态——解析器一问一答，之后这条连接的正文字节不再入账。
    """

    def __init__(self) -> None:
        self._recv = buffers.RecvBuffer()
        self.state = REQUEST_LINE
        self._method = ""
        self._path = ""
        self._version = ""
        self._headers: dict[str, str] = {}
        self._request: Request | None = None
        self._error: str | None = None

    def feed(self, data: bytes) -> ParseResult:
        """喂一段到货字节，返回此刻的解析进度；调用方只认回话，不碰内部。"""
        self._recv.feed(data)
        return self._advance()

    def _advance(self) -> ParseResult:
        """贪心推进：只要攒够了下一条完整行就往前走，推不动了才回话。"""
        while True:
            if self.state == REQUEST_LINE:
                line = self._recv.read_line()
                if line is None:
                    return self._need_more()
                parts = line.decode("latin-1").split(" ")
                if len(parts) != 3 or not all(parts):  # 方法 SP 路径 SP 版本，SP 只能一个
                    return self._bad(f"malformed request line: {line!r}")
                self._method, self._path, self._version = parts
                self.state = HEADERS
            elif self.state == HEADERS:
                line = self._recv.read_line()
                if line is None:
                    return self._need_more()
                if not line:  # 空行 = 头部结束 = 一条完整请求
                    self.state = COMPLETE
                    self._request = Request(self._method, self._path, self._version, self._headers)
                    return ParseResult(DONE, request=self._request)
                name, _, value = line.decode("latin-1").partition(":")
                self._headers[name.strip()] = value.strip()
            else:  # done / bad 是定态：重复 feed 不改判，回话保持一致
                if self._request is not None:
                    return ParseResult(DONE, request=self._request)
                return ParseResult(BAD, error=self._error)

    def _need_more(self) -> ParseResult:
        return ParseResult(NEED_MORE)

    def _bad(self, why: str) -> ParseResult:
        self.state = COMPLETE
        self._error = why
        return ParseResult(BAD, error=why)
