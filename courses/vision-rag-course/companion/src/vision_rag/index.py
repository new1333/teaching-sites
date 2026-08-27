"""index.py —— 批量视觉索引：每页一张读书卡。

第 3 章交出的页图在这里成批送进模型，每页换回一张结构化卡片
PageCard（页型、标题、摘要、关键词、版面元素）。这堆卡片是检索
增强生成的「检索」半边的地基，也是成本漏斗一次性投入的产出。
三件事管到底：
1. 批量打标：标签先行、图随后、指令收尾，一次调用出整批卡片；
2. 拆批重试：输出被截断（finish='length'）或解析失败时对半拆批
   递归，拆到单页为止——重试治偶发故障，拆批治「装不下」；
3. 文字层兜底：顽固失败页不中断整本，退回文字层凑一张弱卡。
真实世界在这层外面还有磁盘缓存与断点续跑，实验场只留原理主干。
"""
from __future__ import annotations

from dataclasses import dataclass

from vision_rag.client import ChatError, img_block, parse_json_lenient

PAGE_TYPES = ("封面", "版权", "目录", "序言", "正文", "附录",
              "参考文献", "索引", "空白", "其他")  # 页型白名单
HAS_KEYS = ("figure", "table", "code", "formula")  # 版面元素四件套
OUTLINE_SKIP_TYPES = ("封面", "版权", "目录", "空白", "索引")  # 不进大纲的页型

INDEX_SYSTEM = """你是页面索引员。你会收到一批页面图，每张图前有一个文本标签标明物理页码（如 [第6页]）。
请对收到的每一页各写一条记录，合并为一个 JSON 对象输出，格式示例：
{"pages": [{"page": 6, "type": "正文", "headings": [{"level": 1, "text": "2 保养周期"}],
"summary": "60 字以内中文摘要，写本页的实质内容", "keywords": ["滤芯", "保养"],
"has": {"figure": false, "table": false, "code": false, "formula": false}}]}
字段规则：
- page 照抄图前标签里的页码；
- type 只能取：封面/版权/目录/序言/正文/附录/参考文献/索引/空白/其他；
- headings 收本页正文出现的标题（封面页、目录页留空数组），level 1 为最高级；
- keywords 给 3-6 个便于检索的词；has 标四类版面元素的有无。
收到几页写几条：一页不漏，一页不编。只输出 JSON。"""


@dataclass
class PageCard:
    """一页的读书卡：批量浅阅读的成果，后续检索的公共货币。"""

    page: int        # 物理页码——来自页图标签，不来自模型自报
    type: str        # 页型，只取 PAGE_TYPES 白名单里的值
    headings: list   # 本页标题 [{"level": 1, "text": "..."}]
    summary: str     # 数十字级的中文摘要
    keywords: list   # 检索关键词
    has: dict        # 版面元素 {"figure"/"table"/"code"/"formula": bool}


def normalize_card(rec, page: int) -> PageCard:
    """把模型吐出的一条原始记录规整成 PageCard：白名单、钳制、补空。

    模型输出当「不可信输入」对待：页型不在白名单归「其他」，标题缺
    正文或形状不对直接扔，级别钳进 1-6，has 只认四个键并归一为布尔。
    页码以参数为准——它来自送审页图的标签，不来自记录自带的 page。
    """
    src = rec if isinstance(rec, dict) else {}
    page_type = src.get("type")
    if page_type not in PAGE_TYPES:
        page_type = "其他"                      # 白名单外：一概降级，不猜
    headings = []
    for h in src.get("headings") or []:
        if not (isinstance(h, dict) and str(h.get("text", "")).strip()):
            continue                            # 没有正文的标题、不是字典的条目：扔
        try:
            level = max(1, min(6, int(h.get("level", 1))))
        except (TypeError, ValueError):
            level = 1
        headings.append({"level": level, "text": str(h["text"]).strip()[:120]})
    summary = str(src.get("summary", "")).strip()[:200]
    keywords = [str(k).strip()[:40] for k in src.get("keywords") or []
                if str(k).strip()][:8]
    raw_has = src.get("has") if isinstance(src.get("has"), dict) else {}
    has = {k: bool(raw_has.get(k, False)) for k in HAS_KEYS}
    return PageCard(page=page, type=page_type, headings=headings,
                    summary=summary, keywords=keywords, has=has)


def _batch_blocks(page_images: list) -> list[dict]:
    """拼一批请求块：每页标签在前、图随后，末尾补一条范围指令。"""
    blocks: list[dict] = []
    for img in page_images:
        blocks += img_block(img.bitmap, label=img.label)
    first, last = page_images[0].page_no, page_images[-1].page_no
    blocks.append({"type": "text",
                   "text": f"请输出第{first}页到第{last}页"
                           f"（共{len(page_images)}页）每一页的 JSON 记录。"})
    return blocks


def _extract_records(data, wanted: set[int]) -> dict[int, dict]:
    """从模型回执里捞原始记录：页码必须在送审集合内，其余全扔。

    模型编造的页码（回执里有、请求里没有）在这里被拦下——
    第 3 章立下的纪律：引用页码必须落在送审集合内。
    """
    raw = data.get("pages") if isinstance(data, dict) else data
    records: dict[int, dict] = {}
    for r in raw or []:
        if not isinstance(r, dict):
            continue
        try:
            page_no = int(r["page"])
        except (KeyError, TypeError, ValueError):
            continue
        if page_no in wanted:
            records[page_no] = r
    return records


def _split_batch(client, page_images: list) -> dict[int, dict]:
    """对半拆批：左半批先问、右半批随后；单页拆不动，交回空。"""
    if len(page_images) <= 1:
        return {}
    mid = len(page_images) // 2
    left = _index_batch(client, page_images[:mid])
    right = _index_batch(client, page_images[mid:])
    return {**left, **right}


def _index_batch(client, page_images: list) -> dict[int, dict]:
    """把一批页图交给模型打标，返回 {页码: 原始记录}。

    三种坏结局都走对半拆批：回执被截断（finish='length'）、回文解析
    失败、调用层重试耗尽。批拆到单页就拆不动了——那一页交出去兜底。
    """
    if not page_images:
        return {}
    try:
        text, finish = client.chat(_batch_blocks(page_images),
                                   system=INDEX_SYSTEM, effort="low",
                                   json_mode=True)
        if finish == "length" and len(page_images) > 1:
            return _split_batch(client, page_images)    # 截断：整批减半重来
        data = parse_json_lenient(text)
    except ChatError:
        return _split_batch(client, page_images)        # 解析失败/重试耗尽：拆
    wanted = {img.page_no for img in page_images}
    records = _extract_records(data, wanted)
    missing = [img for img in page_images if img.page_no not in records]
    if missing and len(missing) < len(page_images):
        records.update(_index_batch(client, missing))   # 只是漏页：只补漏的
    elif missing:
        return _split_batch(client, page_images)        # 一条都没对上：整批拆
    return records


def _fallback_card(page: int, text: str) -> PageCard:
    """文字层兜底卡：模型读不了的页，退回本地有的东西凑一张弱卡。

    弱就弱在瞎：没有页型判断、没有关键词、标题未知，摘要只是文字层
    开头 150 字。扫描页文字层为空，摘要就诚实地空着——弱卡不冒充好卡。
    """
    return normalize_card({"type": "其他", "summary": text.strip()[:150]}, page)


def build_page_cards(client, page_images: list, texts: list,
                     batch: int = 20) -> dict[int, PageCard]:
    """整本成卡：按批打标，残页文字层兜底——任何一页都不缺席。

    返回 {页码: PageCard}。截断与失败在批内递归消化；拆到单页仍拿
    不到卡的页，用第 3 章的文字层凑一张弱卡（type='其他'）。宁可全书
    带一张弱卡，不让整本索引中途断掉。
    """
    if batch <= 0:
        raise ValueError(f"batch 必须是正数，收到 {batch}")
    if len(texts) != len(page_images):
        raise ValueError(
            f"texts 与 page_images 必须等长：{len(texts)} 对 {len(page_images)}")
    cards: dict[int, PageCard] = {}
    for i in range(0, len(page_images), batch):
        for page_no, rec in _index_batch(client, page_images[i:i + batch]).items():
            cards[page_no] = normalize_card(rec, page_no)
    for img, text in zip(page_images, texts):
        if img.page_no not in cards:                    # 模型终究没给卡：兜底
            cards[img.page_no] = _fallback_card(img.page_no, text)
    return cards


def derive_outline(cards: dict[int, PageCard]) -> list[dict]:
    """从卡片派生全书大纲：按页码升序收标题，同文本跨页去重。

    封面、版权、目录、空白、索引页不进大纲——目录页里的标题是别人家
    标题的抄本，收进来每个章节都会在大纲里出现两次。
    """
    outline, seen = [], set()
    for page_no in sorted(cards):
        card = cards[page_no]
        if card.type in OUTLINE_SKIP_TYPES:
            continue
        for h in card.headings:
            if h["text"] in seen:
                continue                # 同一标题跨页延续：只记首次出现的那页
            seen.add(h["text"])
            outline.append({"level": h["level"], "text": h["text"],
                            "page": page_no})
    return outline
