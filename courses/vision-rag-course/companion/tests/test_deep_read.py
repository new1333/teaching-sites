"""第 7 章测试：深读——邻页展开、图与文字层同给、高档推理与诚实回答。

对应大纲 milestone 的四件事：
1. 邻页展开：命中 {40} 自动展开为 {39, 40, 41}，去重且页序稳定，
   首尾页向内收拢（第 1 页只带第 2 页，末页只带前一页）；
2. 请求形状：每个展开页「标签在前图随后」，末尾一块文字层文本块——
   页图管版式图表，文字层管精确措辞；
3. 高档推理：effort='high'，且预算给足（高于客户端默认档）；
   回答是散文不是 JSON；
4. 诚实回答：剧本返回「资料中未见相关内容」时原样透传；
   回复被截断（finish='length'）时文末追加截断注记。
另有参数纪律与扫描页标记。全程零网络：模型由剧本回放。
"""
import re

import pytest

from vision_rag.bitmap import Bitmap
from vision_rag.client import Client
from vision_rag.document import PageImage
from vision_rag.fake import ScriptedTransport
from vision_rag.index import normalize_card
from vision_rag.pipeline import deep_read

QUESTION = "全年耗材成本的趋势如何"

DEFAULT_MAX_TOKENS = 16384  # Client 默认预算：深读必须比它更足


def _card(page, summary="", type_="正文"):
    """一张规整过的读书卡：字段从简，只留下测试关心的部分。"""
    return normalize_card({"type": type_, "summary": summary,
                           "headings": [], "keywords": []}, page)


def _corpus(n_pages=45, blanks=(), scanned_texts=()):
    """造一套迷你手册：cards／texts／page_images 三件按页码 1..n 对齐。

    blanks 里的页型为空白；scanned_texts 里的页文字层为空（扫描页）。
    """
    cards = {p: _card(p, summary=f"第{p}页摘要",
                      type_="空白" if p in blanks else "正文")
             for p in range(1, n_pages + 1)}
    texts = ["" if p in scanned_texts else f"第{p}页的文字层内容"
             for p in range(1, n_pages + 1)]
    images = [PageImage(p, Bitmap([f"第{p}页·图"] * 3))
              for p in range(1, n_pages + 1)]
    return cards, texts, images


def _client(script) -> tuple[Client, ScriptedTransport]:
    """剧本 + 不真睡的 Client：重试节奏照走，一秒不等。"""
    transport = ScriptedTransport(script)
    return Client(transport, sleep=lambda _seconds: None), transport


def _sent_labels(request: dict) -> list[int]:
    """从请求文本块里读出送读的页码——只认 [第N页] 打头的标签。"""
    pages = []
    for block in request["messages"][-1]["content"]:
        if block["type"] == "text":
            m = re.match(r"\[第(\d+)页\]", block["text"])
            if m:
                pages.append(int(m.group(1)))
    return pages


def _final_text_block(request: dict) -> str:
    """请求里最后一块文本——深读的文字层与问题住这里。"""
    blocks = request["messages"][-1]["content"]
    return blocks[-1]["text"]


def _run(pages, script, corpus=None, question=QUESTION):
    """拼好参数跑一次 deep_read，返回 (回答, transport)。"""
    cards, texts, images = corpus or _corpus()
    client, transport = _client(script)
    answer = deep_read(client, cards, texts, images, pages, question)
    return answer, transport


ANSWER = ("全年耗材成本逐季上升，主要受滤芯更换频次影响 [第40页]；"
          "皮带开支保持平稳 [第41页]。")


# ---- 里程碑 1：邻页展开——命中页带上前后各一页，页序稳定 ----

def test_hit_page_expands_to_neighbors():
    """精排选中 {40}：送读的页集合恰为 {39, 40, 41}——表格断在页缝时才读得全。"""
    _, transport = _run([40], [(ANSWER, "stop")])
    assert _sent_labels(transport.requests[0]) == [39, 40, 41]


def test_expansion_dedupes_and_sorts_regardless_of_input_order():
    """命中页乱序、重复：展开结果去重且页码升序——页序稳定。"""
    _, transport = _run([41, 39, 39], [(ANSWER, "stop")])
    assert _sent_labels(transport.requests[0]) == [38, 39, 40, 41, 42]


def test_boundary_pages_clamp_inward():
    """第 1 页只带出 {1, 2}，末页（第 45 页）只带出 {44, 45}——没有第 0 页。"""
    _, transport = _run([1], [(ANSWER, "stop")])
    assert _sent_labels(transport.requests[0]) == [1, 2]
    _, transport = _run([45], [(ANSWER, "stop")])
    assert _sent_labels(transport.requests[0]) == [44, 45]


def test_blank_neighbor_page_is_not_expanded():
    """空白的邻页不带进来：图上无墨、卡片空白，读了也是白占上下文。"""
    cards, texts, images = _corpus(blanks=(39,))
    _, transport = _run([40], [(ANSWER, "stop")], corpus=(cards, texts, images))
    assert _sent_labels(transport.requests[0]) == [40, 41]


# ---- 里程碑 2：请求形状——页图块与文字层文本块同给 ----

def test_request_carries_labels_images_and_text_layer():
    """每个展开页「标签在前图随后」；末块文本含每页文字层与问题。"""
    _, transport = _run([40], [(ANSWER, "stop")])
    request = transport.requests[0]
    blocks = request["messages"][-1]["content"]
    assert sum(1 for b in blocks if b["type"] == "image_url") == 3   # 3 页图
    assert blocks[0]["text"] == "[第39页]"        # 标签在前……
    assert blocks[1]["type"] == "image_url"       # ……图随后
    final = _final_text_block(request)
    assert "第39页的文字层内容" in final
    assert "第40页的文字层内容" in final
    assert "第41页的文字层内容" in final
    assert QUESTION in final                      # 问题收尾


def test_scanned_page_is_honestly_marked_in_text_layer():
    """扫描页文字层为空：文本块里如实标注「（无文字层）」，不冒充有字。"""
    cards, texts, images = _corpus(n_pages=3, scanned_texts=(2,))
    _, transport = _run([2], [(ANSWER, "stop")], corpus=(cards, texts, images))
    final = _final_text_block(transport.requests[0])
    assert "[第2页] （无文字层）" in final


# ---- 里程碑 3：高档推理——effort=high、预算给足、回答是散文 ----

def test_effort_is_high_with_generous_budget_and_no_json_mode():
    """深读是漏斗最贵一层：reasoning_effort=high，预算高于默认档，不开 JSON 模式。"""
    _, transport = _run([40], [(ANSWER, "stop")])
    request = transport.requests[0]
    assert request["reasoning_effort"] == "high"
    assert request["max_tokens"] > DEFAULT_MAX_TOKENS
    assert "response_format" not in request       # 回答是散文，不是 JSON
    assert "深度阅读" in request["messages"][0]["content"]


# ---- 里程碑 4：诚实回答——拒答透传与截断注记 ----

def test_refusal_text_passes_through_verbatim():
    """证据不足时剧本回「资料中未见相关内容」：原样透传，一个字不动。"""
    refusal = "资料中未见相关内容：手册里没有关于预算表的记载。"
    answer, _ = _run([40], [(refusal, "stop")])
    assert answer == refusal


def test_length_finish_appends_truncation_note():
    """回复被截断（finish='length'）：正文保留，文末追加截断注记。"""
    answer, _ = _run([40], [("全年耗材成本逐季上升 [第40页]", "length")])
    assert answer.startswith("全年耗材成本逐季上升 [第40页]")
    assert "截断" in answer


# ---- 参数纪律 ----

def test_empty_pages_is_a_value_error():
    cards, texts, images = _corpus()
    client, transport = _client([])
    with pytest.raises(ValueError):
        deep_read(client, cards, texts, images, [], QUESTION)
    assert transport.calls == 0                   # 参数错：一次调用都不发


def test_pages_beyond_corpus_expand_to_nothing():
    """命中的页在语料之外：展开后无页可读，同样是 ValueError。"""
    cards, texts, images = _corpus()
    client, transport = _client([])
    with pytest.raises(ValueError):
        deep_read(client, cards, texts, images, [50], QUESTION)
    assert transport.calls == 0


def test_texts_images_length_mismatch_is_a_value_error():
    """texts 与 page_images 按位对齐（第 4 章的约定）：不等长直接报错。"""
    cards, texts, images = _corpus(n_pages=3)
    client, _ = _client([])
    with pytest.raises(ValueError):
        deep_read(client, cards, texts[:2], images, [2], QUESTION)
