"""视觉模型客户端：密钥纪律、图片内联、宽容解析与指数退避重试。

这一层是全书的供电线路——后面每一章对模型的全部调用都收口到 Client。
它自己不知道「真引擎」长什么样：网络细节住在可插拔的 transport 里，
测试里由 ScriptedTransport 按剧本回放，真实世界把它换成 HTTP 客户端即可
（怎么换、要改哪几处，第 13 章专门谈）。src 只用标准库。
"""
from __future__ import annotations

import base64
import json
import os
import re
import time
from typing import Protocol

ENV_KEY = "GLM_API_KEY"           # 密钥只住环境变量，绝不进代码
EFFORTS = ("low", "high", "max")  # 推理强度只有这三档

_FENCE = re.compile(r"`{3}(?:json)?\s*(.+?)\s*`{3}", re.DOTALL)
_NONE = re.compile(r"\bNone\b")
_TRAILING_COMMA = re.compile(r",\s*([\]}])")


class ChatError(RuntimeError):
    """调用层错误：密钥缺失、解析失败、重试耗尽，都归它。"""


class Transport(Protocol):
    """传输层协议：把一次请求送进「引擎」，带回 (回复文本, 结束原因)。

    按形状不按血统——任何有 call 方法的对象都算 Transport：
    测试里是 ScriptedTransport 剧本回放，真实世界里是 HTTP 客户端。
    """

    def call(self, request: dict) -> tuple[str, str]: ...


def load_api_key(environ: dict | None = None) -> str:
    """从环境变量读 API 密钥；environ 可注入，测试与真实环境共用一套逻辑。"""
    env = os.environ if environ is None else environ
    key = env.get(ENV_KEY, "").strip()
    if not key:
        raise ChatError(
            f"未找到 API 密钥：请先设置环境变量 {ENV_KEY}"
            f"（macOS/Linux：export {ENV_KEY}=sk-...；Windows：setx {ENV_KEY} \"sk-...\"）。"
            "密钥住在环境里，不写在代码里。"
        )
    return key


def img_block(bitmap, label: str | None = None) -> list[dict]:
    """把一张位图变成 image_url 内容块（base64 内联），可带一个前置文本标签。

    声明的简化：真实引擎内联的是 JPEG/PNG 字节、前缀写 image/jpeg；
    实验场的「图」是 render() 出来的文本画，所以走 text/plain——
    请求结构与真实调用完全同形，第 3 章的 Bitmap 不用改一行就能流进来。
    """
    b64 = base64.b64encode(bitmap.render().encode("utf-8")).decode("ascii")
    blocks: list[dict] = []
    if label:
        blocks.append({"type": "text", "text": label})  # 标签与图同进一次请求
    blocks.append({"type": "image_url",
                   "image_url": {"url": f"data:text/plain;base64,{b64}"}})
    return blocks


def parse_json_lenient(text: str | None) -> dict:
    """尽力把模型吐出的文本解析成 JSON：容忍围栏、前后闲话、尾逗号与 Python None。"""
    s = (text or "").strip()
    if not s:
        raise ChatError("没有可解析的内容")            # 空文本：没有抢救价值
    try:
        return json.loads(s)                           # 第一步：先当干净 JSON 试
    except json.JSONDecodeError:
        pass
    m = _FENCE.search(s)
    if m:
        s = m.group(1)                                 # 第二步：拆掉围栏，取盒中之物
    starts = [i for i in (s.find("{"), s.find("[")) if i != -1]
    if starts:                                         # 第三步：掐头去尾留括号段
        s = s[min(starts):]
        end = max(s.rfind("}"), s.rfind("]"))
        if end != -1:
            s = s[: end + 1]
    s = _NONE.sub("null", s)                           # 第四步 a：None 翻回 null
    s = _TRAILING_COMMA.sub(r"\1", s)                  # 第四步 b：抹掉尾逗号
    try:
        return json.loads(s)
    except json.JSONDecodeError as e:
        raise ChatError(f"解析失败：{e}；开头是 {s[:80]!r}") from e


class Client:
    """对模型的全部调用收口到这：拼请求、按指数退避重试、失败抛 ChatError。"""

    def __init__(self, transport: Transport, retries: int = 4,
                 base_delay: float = 2.0, sleep=time.sleep):
        self.transport = transport
        self.retries = retries
        self.base_delay = base_delay
        self.waited: list[float] = []  # 每次真实等待的秒数，观察退避节奏用
        self._sleep = sleep            # 暂停也走注入：测试塞假时钟，全程一秒不睡

    def chat(self, blocks: list, system: str | None = None,
             effort: str = "low", json_mode: bool = False,
             max_tokens: int = 16384,
             temperature: float = 1.0) -> tuple[str, str]:
        """发一轮对话，返回 (回复文本, 结束原因)；空回复与异常都按退避节奏重试。"""
        request = self._request(blocks, system, effort, json_mode,
                                max_tokens, temperature)
        delay, last = self.base_delay, None
        for attempt in range(1, self.retries + 1):
            try:
                text, finish = self.transport.call(request)
                if text and text.strip():
                    return text.strip(), finish
                last = ChatError(f"空回复：attempt={attempt}, finish={finish}")
            # 重试的本意就是「无论哪种失败都再试一次」：transport 抛的一切异常
            # （网络抖动、限流、超时、剧本里的罢工）都先记下，退避后来过。
            except Exception as exc:  # noqa: BLE001
                last = exc
            if attempt < self.retries:  # 还有名额才等；名额用完直接出去
                self._sleep(delay)
                self.waited.append(delay)
                delay *= 2              # 每失败一次，下一次等得更久
        raise ChatError(f"重试 {self.retries} 次仍失败，最后错误：{last}")

    def chat_json(self, blocks: list, **kw) -> dict:
        """要 JSON 的调用：打开 json_mode，回文交给宽容解析。"""
        text, _finish = self.chat(blocks, json_mode=True, **kw)
        return parse_json_lenient(text)

    def _request(self, blocks: list, system: str | None, effort: str,
                 json_mode: bool, max_tokens: int,
                 temperature: float) -> dict:
        if effort not in EFFORTS:
            raise ValueError(f"推理强度只认 {EFFORTS}，收到 {effort!r}")
        messages: list[dict] = []
        if system:
            messages.append({"role": "system", "content": system})  # 岗位说明书排最前
        messages.append({"role": "user", "content": blocks})        # 问题与图片随后
        request = {"messages": messages, "reasoning_effort": effort,
                   "max_tokens": max_tokens, "temperature": temperature}
        if json_mode:
            request["response_format"] = {"type": "json_object"}    # 请求 JSON 输出
        return request
