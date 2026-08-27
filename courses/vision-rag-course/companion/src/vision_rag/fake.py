"""ScriptedTransport：按剧本回放「模型」的假传输层。

剧本是一张清单，每次 call 弹出一项：
- (text, finish) 元组——正常回一对返回值；
- {"text": ..., "finish": ...} 字典——同上，缺的字段取默认值；
- Exception 实例——这次调用就抛它（模拟超时、限流、罢工）。

每次请求都记进 .requests，供测试核对「模型到底看见了什么」。
全书零网络、零费用、全确定性：真引擎差异压在 transport 这一层，
换引擎就是换掉这个类，Client 一行不改。
"""
from __future__ import annotations

import json

from vision_rag.client import ChatError

_TICKS = "`" * 3  # 三个反引号：Markdown 围栏的原料


def fenced_json(payload) -> str:
    """把 JSON 装进三个反引号的围栏——模拟模型「爱用包装盒」的坏习惯。"""
    body = payload if isinstance(payload, str) else json.dumps(payload, ensure_ascii=False)
    return f"{_TICKS}json\n{body}\n{_TICKS}"


def failing(exc: Exception | None = None) -> Exception:
    """剧本项：这次调用抛异常（默认 ChatError('boom')）。"""
    return exc if exc is not None else ChatError("boom")


class ScriptedTransport:
    """回放剧本并记录请求的假引擎。"""

    def __init__(self, script: list):
        self.script = list(script)
        self.requests: list[dict] = []

    @property
    def calls(self) -> int:
        """已发生的调用次数。"""
        return len(self.requests)

    def call(self, request: dict) -> tuple[str, str]:
        self.requests.append(request)
        if not self.script:
            raise ChatError(f"剧本用完了（已回放 {self.calls} 次调用）")
        item = self.script.pop(0)
        if isinstance(item, Exception):
            raise item
        if isinstance(item, dict):
            return item.get("text", ""), item.get("finish", "stop")
        return item
