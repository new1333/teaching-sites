"""第 6 章测试：视觉精排——模型看图把关、回执校验与静默回退。

对应大纲 milestone 的三段剧本：
1. 语义命中：8 个候选里，模型挑出 2 个语义相关但词面不同的页
   （问「退货」，选中写「售后与退换」的页）；
2. 非法页码被滤：编造页码、不在候选内的页码、重复页码一律丢弃，
   输出不超过 k；
3. 回退：transport 罢工（重试耗尽抛 ChatError）时静默回退本地前 k。
另有空白页把关（第 5 章留下的约定：粗筛不过滤空白，这层把关）与
参数纪律。全程零网络：模型由剧本回放。
"""
import re

import pytest

from vision_rag.bitmap import Bitmap
from vision_rag.client import Client
from vision_rag.document import PageImage
from vision_rag.fake import ScriptedTransport, failing, fenced_json
from vision_rag.index import normalize_card
from vision_rag.pipeline import rerank_pages

QUESTION = "退货政策怎么规定的"  # 答案页写的是「售后与退换」——词面对不上

DEFAULT_SUMMARIES = {
    1: "日常保养与清洁要点",
    2: "耗材更换周期说明",
    3: "售后与退换：七日内可办理，运费由商家承担",
    4: "安装与接线说明",
    5: "故障排查清单",
    6: "安全注意事项",
    7: "退换货办理流程与时效说明",
    8: "产品规格参数",
}


def _card(page, summary="", type_="正文", headings=None, keywords=None):
    """一张规整过的读书卡：字段从简，只留下测试关心的部分。"""
    return normalize_card({"type": type_, "summary": summary,
                           "headings": headings or [],
                           "keywords": keywords or []}, page)


def _corpus(summaries=None, n_images=10, blanks=()):
    """造一套迷你手册：cards 按摘要表，页图 1..n_images，blanks 里的页型为空白。"""
    summaries = summaries or DEFAULT_SUMMARIES
    cards = {p: _card(p, summary=s, type_="空白" if p in blanks else "正文")
             for p, s in summaries.items()}
    images = [PageImage(p, Bitmap([f"第{p}页·图"] * 3))
              for p in range(1, n_images + 1)]
    return cards, images


def _client(script) -> tuple[Client, ScriptedTransport]:
    """剧本 + 不真睡的 Client：重试节奏照走，一秒不等。"""
    transport = ScriptedTransport(script)
    return Client(transport, sleep=lambda _seconds: None), transport


def _sent_labels(request: dict) -> list[int]:
    """从请求文本块里读出送审的页码——只认 [第N页] 打头的标签。"""
    pages = []
    for block in request["messages"][-1]["content"]:
        if block["type"] == "text":
            m = re.match(r"\[第(\d+)页\]", block["text"])
            if m:
                pages.append(int(m.group(1)))
    return pages


# ---- 里程碑 1：语义命中——词面对不上，模型看图补盲区 ----

def test_model_picks_semantically_relevant_lexically_different_pages():
    """问「退货」，模型从 8 个候选里挑出写「售后与退换」的两页。"""
    cards, images = _corpus()
    client, transport = _client([(fenced_json({"pages": [
        {"page": 3, "reason": "售后退换政策"},
        {"page": 7, "reason": "退换流程"},
    ]}), "stop")])
    picked = rerank_pages(client, cards, images, list(range(1, 9)), 2, QUESTION)
    assert picked == [3, 7]                          # 按模型给的相关度序
    assert transport.calls == 1                      # 精排就是一次便宜调用


def test_request_carries_labels_images_and_question():
    """送审请求的形状：每页标签在前图随后，问题收尾，低档推理＋JSON 模式。"""
    cards, images = _corpus()
    client, transport = _client([(fenced_json({"pages": [{"page": 3, "reason": "r"}]}), "stop")])
    rerank_pages(client, cards, images, list(range(1, 9)), 2, QUESTION)
    request = transport.requests[0]
    blocks = request["messages"][-1]["content"]
    assert _sent_labels(request) == list(range(1, 9))       # 8 个候选全送
    assert sum(1 for b in blocks if b["type"] == "image_url") == 8
    label3 = blocks[4]["text"]                              # 第 3 页的标签块
    assert label3.startswith("[第3页]") and "售后与退换" in label3
    assert QUESTION in blocks[-1]["text"]                   # 问题收尾
    assert request["reasoning_effort"] == "low"             # 漏斗中间层：便宜档
    assert request["response_format"] == {"type": "json_object"}
    assert "页面精选员" in request["messages"][0]["content"]


# ---- 里程碑 2：回执校验——只认候选、去重、不超过 k ----

def test_fabricated_noncandidate_duplicate_pages_are_dropped():
    """回执里混着编造页码 99、非候选页 9、重复的 3、非法值 None：全被滤掉。"""
    cards, images = _corpus()
    client, _ = _client([(fenced_json({"pages": [
        {"page": 99, "reason": "编造"}, {"page": 3, "reason": "a"},
        {"page": 3, "reason": "重复"}, {"page": 9, "reason": "不在候选"},
        {"page": 5, "reason": "b"}, {"page": None, "reason": "非法"},
    ]}), "stop")])
    picked = rerank_pages(client, cards, images, list(range(1, 9)), 3, QUESTION)
    assert picked == [3, 5]                          # 编造/非候选/重复全消失


def test_result_is_capped_at_k_in_model_order():
    """模型给了 4 页、k=2：只留前 2，且按模型的相关度序。"""
    cards, images = _corpus()
    client, _ = _client([(fenced_json({"pages": [
        {"page": 4, "reason": "a"}, {"page": 2, "reason": "b"},
        {"page": 6, "reason": "c"}, {"page": 8, "reason": "d"},
    ]}), "stop")])
    assert rerank_pages(client, cards, images, list(range(1, 9)), 2,
                        QUESTION) == [4, 2]


# ---- 里程碑 3：回退——罢工与空选都退回粗筛的前 k ----

def test_transport_strike_falls_back_to_local_top_k_silently():
    """剧本连续罢工到重试耗尽：不抛错，返回值恰为本地排序前 k。"""
    cards, images = _corpus()
    candidates = [5, 3, 8, 1, 7, 2, 6, 4]             # 假想粗筛给出的顺序
    client, transport = _client([failing() for _ in range(4)])
    picked = rerank_pages(client, cards, images, candidates, 4, QUESTION)
    assert picked == [5, 3, 8, 1]                    # 恰为本地前 k
    assert transport.calls == 4                      # 4 次重试全部烧完才认输


def test_empty_picks_fall_back_to_local_top_k():
    """模型一页未选：精排交不出判断，把判断还给粗筛排序。"""
    cards, images = _corpus()
    client, _ = _client([(fenced_json({"pages": []}), "stop")])
    picked = rerank_pages(client, cards, images, [2, 6, 4], 2, QUESTION)
    assert picked == [2, 6]                          # 不是空列表


# ---- 空白页把关（第 5 章的约定在这层兑现）----

def test_blank_pages_never_sent_never_returned():
    """空白候选页根本不进送审名单；模型硬选它也拿不回来。"""
    cards, images = _corpus(summaries={2: "保养要点", 4: "空白一页", 6: "规格参数"},
                           blanks=(4,))
    client, transport = _client([(fenced_json({"pages": [
        {"page": 4, "reason": "硬选空白"}, {"page": 2, "reason": "相关"},
    ]}), "stop")])
    picked = rerank_pages(client, cards, images, [2, 4, 6], 2, QUESTION)
    assert picked == [2]                             # 空白页被拦下
    assert _sent_labels(transport.requests[0]) == [2, 6]   # 送审名单里本就没有它


def test_all_blank_candidates_return_empty_without_calling():
    """候选全是空白页：无从精选，不发请求，返回空列表。"""
    cards, images = _corpus(summaries={1: "空白"}, blanks=(1,))
    client, transport = _client([])
    assert rerank_pages(client, cards, images, [1], 2, QUESTION) == []
    assert transport.calls == 0


def test_candidates_without_page_images_are_skipped():
    """没有页图的候选进不了「看图把关」，被跳过——回退时也不占名额。"""
    cards, images = _corpus(summaries={1: "保养", 2: "耗材", 3: "规格"})
    client, _ = _client([failing() for _ in range(4)])
    picked = rerank_pages(client, cards, images[:2], [1, 2, 3], 2, QUESTION)
    assert picked == [1, 2]                          # 第 3 页无图，全程缺席


# ---- 参数纪律 ----

def test_non_positive_k_is_a_value_error():
    cards, images = _corpus()
    client, _ = _client([])
    with pytest.raises(ValueError):
        rerank_pages(client, cards, images, [1, 2], 0, QUESTION)
    with pytest.raises(ValueError):
        rerank_pages(client, cards, images, [1, 2], -1, QUESTION)


def test_empty_candidates_return_empty():
    cards, images = _corpus()
    client, transport = _client([])
    assert rerank_pages(client, cards, images, [], 3, QUESTION) == []
    assert transport.calls == 0
