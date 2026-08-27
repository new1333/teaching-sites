"""第 4 章测试：批量打标——截断拆批、文字层兜底与大纲去重。

对应大纲 milestone 的三条断言：
1. 截断剧本下 20 页全部拿到卡片，且子批大小逐轮减半（20 → 10 → 5 → 2 → 1）；
2. 永久失败页拿到 type='其他' 的文字层兜底卡，而非让整本索引中断；
3. 同一标题在相邻两页出现时，derive_outline 只留一条。
全程零网络：截断与失败都由剧本/自适应替身回放。
"""
import re

import pytest

from vision_rag.bitmap import Bitmap
from vision_rag.client import ChatError, Client
from vision_rag.document import Page, SynthDoc, render_pages
from vision_rag.fake import ScriptedTransport, fenced_json
from vision_rag.index import (
    PAGE_TYPES,
    PageCard,
    build_page_cards,
    derive_outline,
    normalize_card,
)


def _page_images(n: int, text_fmt="第 {} 页的文字层"):
    """造 n 页袖珍文档并渲染成带 [第N页] 标签的页图。"""
    pages = [Page(text_fmt.format(i), Bitmap([f"页{i} "] * 6)) for i in range(1, n + 1)]
    return render_pages(SynthDoc(pages)), [p.text for p in pages]


def _rec(page, type_="正文", headings=None, summary="本页摘要", keywords=None):
    """一张模型吐出的原始记录（还没规整）。"""
    return {"page": page, "type": type_, "headings": headings or [],
            "summary": summary, "keywords": keywords or ["保养"],
            "has": {"figure": False, "table": True, "code": False, "formula": False}}


def _no_sleep_client(transport):
    """造一个不真睡的 Client：暂停函数收下秒数但不等待。"""
    return Client(transport, sleep=lambda _seconds: None)


def _requested_pages(request: dict) -> list[int]:
    """从请求里读出本次送审的页码——只认恰好是 [第N页] 形状的文本块。"""
    pages = []
    for block in request["messages"][-1]["content"]:
        if block["type"] == "text":
            m = re.fullmatch(r"\[第(\d+)页\]", block["text"].strip())
            if m:
                pages.append(int(m.group(1)))
    return pages


def _n_images(request: dict) -> int:
    """这次请求带了几张页图——批大小的直接观测。"""
    return sum(1 for b in request["messages"][-1]["content"]
               if b["type"] == "image_url")


class _AnsweringTransport:
    """好引擎替身：按请求里的页码标签逐页回合法记录。

    多页批次漏掉 skip 里的页（模拟漏页），单页补查则好好作答；
    fake 里的是凭空编造的页码，用来考页码校验。
    """

    def __init__(self, skip=(), fake=()):
        self.skip, self.fake = set(skip), set(fake)
        self.requests: list[dict] = []

    def call(self, request: dict):
        self.requests.append(request)
        pages = _requested_pages(request)
        wanted = [p for p in pages if p not in self.skip] if len(pages) > 1 else pages
        recs = [_rec(p) for p in wanted] + [_rec(p) for p in self.fake]
        return fenced_json({"pages": recs}), "stop"


class _TruncatingTransport:
    """坏引擎替身：多页批次永远回半截 JSON＋finish='length'，单页批正常作答。"""

    def __init__(self):
        self.batch_sizes: list[int] = []

    def call(self, request: dict):
        n = _n_images(request)
        self.batch_sizes.append(n)
        if n > 1:
            return ('{"pages": [{"page": 1', "length")   # 墨水用尽的半截
        page = _requested_pages(request)[0]
        return fenced_json({"pages": [_rec(page)]}), "stop"


class _CursedPageTransport:
    """顽固失败替身：只要批次里含第 cursed 页，回执就漏掉它；只剩它一页时罢工。"""

    def __init__(self, cursed=3):
        self.cursed = cursed

    def call(self, request: dict):
        wanted = [p for p in _requested_pages(request) if p != self.cursed]
        if not wanted:
            raise ChatError(f"第 {self.cursed} 页永远失败")
        return fenced_json({"pages": [_rec(p) for p in wanted]}), "stop"


# ---- 里程碑 1a：正常批一次成卡，请求里标签先行、指令收尾 ----

def test_normal_batch_makes_cards_in_one_call():
    images, texts = _page_images(3)
    transport = _AnsweringTransport()
    cards = build_page_cards(_no_sleep_client(transport), images, texts, batch=3)
    assert len(transport.requests) == 1          # 一批 3 页，一次调用成卡
    assert sorted(cards) == [1, 2, 3]
    assert all(isinstance(c, PageCard) for c in cards.values())
    user = transport.requests[0]["messages"][-1]["content"]
    kinds = [b["type"] for b in user]
    assert kinds == ["text", "image_url"] * 3 + ["text"]   # 每页：标签在前、图随后
    assert user[-1]["text"] == "请输出第1页到第3页（共3页）每一页的 JSON 记录。"
    assert transport.requests[0]["reasoning_effort"] == "low"   # 批量登记用最省档


def test_batch_param_chunks_the_pages():
    images, texts = _page_images(5)
    transport = _AnsweringTransport()
    build_page_cards(_no_sleep_client(transport), images, texts, batch=2)
    sizes = [_n_images(r) for r in transport.requests]
    assert sizes == [2, 2, 1]                    # 按批切：2+2+1
    again = _AnsweringTransport()
    assert sorted(build_page_cards(_no_sleep_client(again), images, texts, batch=2)) == [1, 2, 3, 4, 5]


def test_mismatched_texts_length_is_a_value_error():
    images, _texts = _page_images(3)
    with pytest.raises(ValueError):
        build_page_cards(_no_sleep_client(_AnsweringTransport()), images, ["只有一张"], batch=3)


# ---- 里程碑 1b：截断剧本下子批逐轮减半，20 页全部成卡 ----

def test_truncation_splits_halving_until_single_page():
    images, texts = _page_images(20)
    transport = _TruncatingTransport()
    cards = build_page_cards(_no_sleep_client(transport), images, texts)
    assert transport.batch_sizes[0] == 20         # 先整批上
    assert transport.batch_sizes[:4] == [20, 10, 5, 2]   # 逐轮对半
    assert transport.batch_sizes.count(1) == 20   # 拆到头：每页都单独问过一次
    assert all(1 < s <= 20 for s in transport.batch_sizes if s != 1)
    assert sorted(cards) == list(range(1, 21))    # 一页不少
    assert all(c.type in PAGE_TYPES for c in cards.values())


def test_parse_failure_also_splits_and_recovers():
    images, texts = _page_images(2)
    transport = ScriptedTransport([
        ("今天不想输出 JSON", "stop"),               # 完整回复但不是 JSON
        (fenced_json({"pages": [_rec(1)]}), "stop"),
        (fenced_json({"pages": [_rec(2)]}), "stop"),
    ])
    cards = build_page_cards(_no_sleep_client(transport), images, texts, batch=2)
    assert sorted(cards) == [1, 2]                 # 拆成两半后各自成卡
    assert cards[1].summary == "本页摘要"
    assert cards[2].keywords == ["保养"]


def test_missing_pages_recurse_only_on_the_missing():
    images, texts = _page_images(3)
    transport = _AnsweringTransport(skip=[2])      # 第一轮漏了第 2 页
    cards = build_page_cards(_no_sleep_client(transport), images, texts, batch=3)
    assert len(transport.requests) == 2            # 只补查漏页
    assert _requested_pages(transport.requests[1]) == [2]
    assert sorted(cards) == [1, 2, 3]
    assert cards[2].keywords == ["保养"]            # 补查的也是正经模型卡


def test_hallucinated_page_numbers_are_ignored():
    images, texts = _page_images(2)
    transport = _AnsweringTransport(fake=[99])     # 模型编造了不存在的第 99 页
    cards = build_page_cards(_no_sleep_client(transport), images, texts, batch=2)
    assert sorted(cards) == [1, 2]                 # 编造页码不进卡
    assert 99 not in cards


# ---- 里程碑 2：顽固失败页拿到文字层兜底卡，不中断整本 ----

def test_stubborn_page_gets_text_layer_fallback_card():
    images, texts = _page_images(3)
    client = _no_sleep_client(_CursedPageTransport())
    cards = build_page_cards(client, images, texts, batch=3)
    assert sorted(cards) == [1, 2, 3]              # 没有异常，整本齐
    assert cards[1].type == "正文" and cards[2].type == "正文"
    weak = cards[3]
    assert weak.type == "其他"                      # 兜底卡的白名单页型
    assert weak.summary == "第 3 页的文字层"          # 摘要来自文字层
    assert weak.headings == [] and weak.keywords == []
    assert weak.has == {"figure": False, "table": False, "code": False, "formula": False}
    assert client.waited == [2.0, 4.0, 8.0]        # 单页重试确实退避过三轮


def test_scanned_fallback_card_keeps_empty_summary():
    images, texts = _page_images(2, text_fmt="   ")  # 两页都没有文字层
    weak = build_page_cards(_no_sleep_client(_CursedPageTransport(cursed=2)),
                            images, texts, batch=2)[2]
    assert weak.type == "其他" and weak.summary == ""   # 扫描页兜底：摘要诚实为空


# ---- 里程碑 3：normalize_card 的白名单与钳制；大纲跨页去重 ----

def test_normalize_card_enforces_whitelist_and_clamps():
    card = normalize_card(
        {"type": "神秘页", "headings": [
            {"level": 9, "text": "  第 9 级标题 "},      # 级别钳到 6
            {"level": 0, "text": "零级"},                # 级别抬到 1
            {"level": 1},                                 # 没有正文，扔掉
            "不是字典的标题",                              # 形状不对，扔掉
        ],
         "summary": "  摘要  ", "keywords": ["a", "", " b ", *["词"] * 10],
         "has": {"figure": 1, "unexpected": True}, "page": 999},
        page=7,
    )
    assert isinstance(card, PageCard)
    assert card.page == 7                          # 页码以送审标签为准，不信记录自带
    assert card.type == "其他"                      # 白名单外归「其他」
    assert card.headings == [{"level": 6, "text": "第 9 级标题"},
                             {"level": 1, "text": "零级"}]
    assert card.summary == "摘要"
    assert card.keywords == ["a", "b"] + ["词"] * 6  # 去空、去空格、封顶 8 条
    assert card.has == {"figure": True, "table": False,
                        "code": False, "formula": False}  # 只认四键、归一为布尔


def test_normalize_card_survives_non_dict_input():
    card = normalize_card("模型撒泼了", page=4)
    assert (card.type, card.headings, card.summary, card.keywords) == ("其他", [], "", [])
    assert card.has == {"figure": False, "table": False, "code": False, "formula": False}


def test_derive_outline_dedups_heading_text_across_pages():
    cards = {
        1: normalize_card({"type": "封面", "headings": [{"level": 1, "text": "封面题字"}]}, 1),
        2: normalize_card({"type": "目录", "headings": [{"level": 1, "text": "目录里也有标题"}]}, 2),
        3: normalize_card({"type": "正文", "headings": [
            {"level": 1, "text": "保养周期"}, {"level": 2, "text": "滤芯"}]}, 3),
        4: normalize_card({"type": "正文", "headings": [
            {"level": 1, "text": "保养周期"}, {"level": 2, "text": "皮带"}]}, 4),
    }
    outline = derive_outline(cards)
    assert outline == [
        {"level": 1, "text": "保养周期", "page": 3},   # 相邻两页同名标题只留第一条
        {"level": 2, "text": "滤芯", "page": 3},
        {"level": 2, "text": "皮带", "page": 4},
    ]
    assert all(o["page"] not in (1, 2) for o in outline)  # 封面、目录页不进大纲


def test_end_to_end_truncation_then_outline():
    images, texts = _page_images(6)
    transport = _TruncatingTransport()
    cards = build_page_cards(_no_sleep_client(transport), images, texts, batch=6)
    assert transport.batch_sizes[:3] == [6, 3, 1]
    assert sorted(cards) == list(range(1, 7))
    assert derive_outline(cards) == []              # 替身卡不带标题，大纲为空但不报错
