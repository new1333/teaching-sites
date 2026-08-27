"""第 2 章测试：视觉模型客户端——重试、宽容解析与密钥纪律。

对应大纲 milestone 的三条断言：
1. 围栏 JSON 能救回（宽容解析）；
2. 第 3 次调用才成功时拿到结果，且前两次留有记录（指数退避重试）；
3. 无密钥环境抛出明确错误（密钥纪律）。
全程零网络：模型由 ScriptedTransport 按剧本回放，暂停走注入的假时钟。
"""
import base64

import pytest

from vision_rag.client import (
    ChatError,
    Client,
    img_block,
    load_api_key,
    parse_json_lenient,
)
from vision_rag.fake import ScriptedTransport, failing, fenced_json


class _FakePage:
    """鸭子类型的「图」：任何带 render() 的对象都能进 img_block。

    真正的 Bitmap 第 3 章才落地，这里用最小替身先验证结构。
    """

    def __init__(self, art="A B\nC D"):
        self.art = art

    def render(self):
        return self.art


def _client(script, **kw):
    """造一个不真睡的 Client：暂停函数收下秒数但不等待。"""
    transport = ScriptedTransport(script)
    client = Client(transport, sleep=lambda _seconds: None, **kw)
    return client, transport


def _q(text="第几页有表格"):
    return [{"type": "text", "text": text}]


# ---- 里程碑 1：围栏 JSON 能救回 ----

def test_fenced_json_is_salvaged():
    text = fenced_json({"page": 3, "type": "表格"})
    assert parse_json_lenient(text) == {"page": 3, "type": "表格"}


def test_lenient_parse_fixes_common_model_mistakes():
    with_prose = '好的，结果如下：\n```json\n{"ok": 1}\n```\n以上。'
    assert parse_json_lenient(with_prose) == {"ok": 1}
    trailing = '{"page": 3, "keywords": ["验收",],}'
    assert parse_json_lenient(trailing) == {"page": 3, "keywords": ["验收"]}
    py_none = '{"note": None}'
    assert parse_json_lenient(py_none) == {"note": None}


def test_unparseable_and_empty_raises_chat_error():
    with pytest.raises(ChatError):
        parse_json_lenient("这根本不是 JSON")
    with pytest.raises(ChatError):
        parse_json_lenient("")
    with pytest.raises(ChatError):
        parse_json_lenient(None)


# ---- 里程碑 2：连续失败按退避节奏重试后成功 ----

def test_retry_backoff_succeeds_on_third_call():
    client, transport = _client([failing(), failing(), ("修好了", "stop")])
    text, finish = client.chat(_q())
    assert (text, finish) == ("修好了", "stop")
    assert transport.calls == 3          # 前两次失败留有记录
    assert client.waited == [2.0, 4.0]   # 退避节奏：2 秒、4 秒


def test_retry_exhaustion_raises_chat_error():
    client, transport = _client([failing()] * 4)
    with pytest.raises(ChatError):
        client.chat(_q())
    assert transport.calls == 4
    assert client.waited == [2.0, 4.0, 8.0]  # 第 4 次调用前累计等了 14 秒


def test_empty_reply_is_retried():
    client, transport = _client([("", "length"), ("有了", "stop")])
    text, _finish = client.chat(_q())
    assert text == "有了"
    assert transport.calls == 2


# ---- 里程碑 3：无密钥环境抛出明确错误 ----

def test_missing_api_key_raises_clear_error():
    with pytest.raises(ChatError, match="GLM_API_KEY"):
        load_api_key({})
    assert load_api_key({"GLM_API_KEY": " sk-test "}) == "sk-test"


# ---- 图片内容块与请求形状 ----

def test_img_block_inlines_label_and_image():
    page = _FakePage("A B\nC D")
    blocks = img_block(page, label="[第3页]")
    assert blocks[0] == {"type": "text", "text": "[第3页]"}
    img = blocks[1]
    assert img["type"] == "image_url"
    prefix, _, b64 = img["image_url"]["url"].partition(",")
    assert prefix.startswith("data:") and "base64" in prefix
    # 折起来的纸条还能原样折回去：base64 解码 == 原图文本
    assert base64.b64decode(b64).decode("utf-8") == "A B\nC D"
    assert img_block(page) == [img]      # 不给标签就只有图


def test_request_shape_carries_system_effort_and_json_mode():
    client, transport = _client([("ok", "stop")])
    client.chat(img_block(_FakePage(), label="[第1页]"),
                system="你是索引员", effort="high", json_mode=True)
    request = transport.requests[0]
    assert request["messages"][0] == {"role": "system", "content": "你是索引员"}
    user = request["messages"][1]
    assert user["role"] == "user"
    assert [b["type"] for b in user["content"]] == ["text", "image_url"]
    assert request["reasoning_effort"] == "high"
    assert request["response_format"] == {"type": "json_object"}


def test_unknown_effort_is_rejected():
    client, _transport = _client([("ok", "stop")])
    with pytest.raises(ValueError):
        client.chat(_q(), effort="turbo")


def test_chat_json_returns_parsed_payload():
    client, transport = _client([(fenced_json({"best": 7}), "stop")])
    assert client.chat_json(_q("挑最相关的一页")) == {"best": 7}
    assert transport.requests[0]["response_format"] == {"type": "json_object"}


# ---- 假引擎本身的行为 ----

def test_scripted_transport_records_and_exhausts():
    transport = ScriptedTransport([("一", "stop")])
    assert transport.call({"n": 1}) == ("一", "stop")
    assert transport.requests == [{"n": 1}]
    assert transport.calls == 1
    with pytest.raises(ChatError):
        transport.call({"n": 2})


def test_scripted_transport_accepts_dict_items():
    transport = ScriptedTransport([{"text": "半截", "finish": "length"}])
    assert transport.call({}) == ("半截", "length")
