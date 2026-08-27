"""pipeline.py —— 漏斗全流程：视觉精排、深读，到 ask 收口的可核对交付。

第 5 章的粗筛只认字面，把候选圈到了十来页；精排层把候选页的图和
卡片摘要一起摆到视觉大模型眼前，让它按「内容是否真能回答问题」
精选 top-k。一次调用、effort=low——漏斗中间那道便宜的闸。
四件纪律管到底：
1. 只认候选：回执页码必须落在送审候选内——编造的页码一律丢弃
   （第 3 章立下的引用纪律，精排照章执行）；
2. 去重、≤k：重复页码只留一次，输出条数不超过 k；
3. 回退：调用层罢工（重试耗尽抛 ChatError）或模型一页未选时，
   静默退回粗筛排序的前 k——精排交不出判断，就把判断还给粗筛；
4. 空白页把关：粗筛不过滤空白页（第 5 章的约定），这层兑现——
   图上无墨的页，既不送审也不进结果。
深读是漏斗最后一层、也是最贵的一层：命中页 ±1 邻页展开，页图与
文字层同给（图管版式图表、文字层管精确措辞），effort=high 读透
证据，产出带 [第N页] 引用的回答；证据不足时拒答原样透传，回复
截断时如实注记。第 8 章在本文件收口全流程：ask 一次调用跑完
粗筛→精排→深读→引用回收；cited_pages 用正则把答案里的页码捞回来；
索引覆盖不全时，答案末尾如实声明覆盖范围。
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from vision_rag.client import ChatError, img_block
from vision_rag.document import render_pages
from vision_rag.index import PageCard, build_page_cards
from vision_rag.scoring import score_pages

RERANK_SYSTEM = """你是页面精选员。你会收到一批候选页：每页前有一条标签（页码、标题、摘要），标签后是这页的图片。
用户会提出一个问题，请挑出真正有助于回答它的页面，最多 {k} 页，按相关程度从高到低排列。
判断看内容与语义，不要只对字面——写「售后与退换」的页，同样可能回答「退货」的问题。
宁可少选，不要凑数；一个都不相关就返回空列表。
输出 JSON：{{"pages": [{{"page": 6, "reason": "10字以内理由"}}]}}，只输出 JSON。"""

DEEP_SYSTEM = """你是深度阅读助手。你会看到与用户问题相关的若干页面：每页先有一条页码标签（形如 [第6页]），标签后是页面图；请求末尾还有这些页的文字层。
阅读要求：
1. 图与文字层都要读，分工不同：表格、图表、版式、盖章以图为准；精确措辞、数字与名称以文字层为准；
2. 先给结论，再列要点；每个关键论点后标注来源页码，格式如 [第6页]——页码只能照抄你看到的标签，不要编造；
3. 若这些页面不足以回答问题，明确说明「资料中未见相关内容」、还缺什么，不要编造答案。
用中文作答。"""

DEEP_MAX_TOKENS = 24576   # 深读预算给足：高档推理下思考过程也占输出预算，饿着它答案会被自己的思考挤截断
TRUNCATION_NOTE = "\n\n（注：回答因长度限制被截断）"


def _cand_label(page: int, card: PageCard) -> str:
    """候选页的送审标签：页码打头，标题与摘要随后——页码引用的物理出处。"""
    label = f"[第{page}页]"
    if card.headings:
        label += " 标题：" + "；".join(h["text"] for h in card.headings)
    if card.summary:
        label += f" 摘要：{card.summary}"
    return label


def rerank_pages(client, cards: dict[int, PageCard], page_images: list,
                 candidates: list[int], k: int,
                 question: str) -> list[int]:
    """视觉精排：候选页图＋摘要交模型，按内容选出至多 k 页，返回页码列表。

    回执按「不可信输入」对待：只接受候选内的页码、去重、截到 k 条。
    空白页、没有卡片或页图的候选在入口即被拦下——进不了图，就参与
    不了「看图把关」。调用层罢工或模型一页未选时，静默回退粗筛排序
    的前 k：精排的失败模式是「没判断」，不是「崩」。
    """
    if k <= 0:
        raise ValueError(f"k 必须是正数，收到 {k}")
    images = {img.page_no: img for img in page_images}
    cand = [p for p in candidates
            if cards.get(p) is not None
            and cards[p].type != "空白"                     # 空白页这层把关
            and p in images]                                # 无图：进不了送审
    if not cand:
        return []
    blocks: list[dict] = []
    for p in cand:
        blocks += img_block(images[p].bitmap, _cand_label(p, cards[p]))
    blocks.append({"type": "text",
                   "text": f"用户问题：{question}\n"
                           f"请从上述 {len(cand)} 个候选页中选出最多 {k} 页，"
                           "按相关程度从高到低输出。"})
    try:
        data = client.chat_json(blocks, system=RERANK_SYSTEM.format(k=k),
                                effort="low")
    except ChatError:
        return cand[:k]                          # 罢工：静默退回粗筛排序
    picked: list[int] = []
    raw = data.get("pages") if isinstance(data, dict) else None
    for item in raw or []:
        try:
            p = int(item["page"])
        except (KeyError, TypeError, ValueError):
            continue                             # 形状不对、页码不是数：扔
        if p in cand and p not in picked:
            picked.append(p)                     # 只认候选、去重
    return picked[:k] or cand[:k]                # 一页未选：同样还给粗筛


def _expand_pages(cards: dict[int, PageCard], page_images: list,
                  pages: list[int]) -> list[int]:
    """邻页展开：每个命中页带上前后各一页，去重后按页码升序返回。

    展开的边界不是「加减一算出来就行」：只收有页图、有卡片、非空白的
    页——空白的邻页读不出任何东西，白占上下文；语料外的页码（第 0 页、
    末页的后一页）自然落在范围外。返回的页序恒为升序，与命中页的输入
    顺序无关——后面的文字层块按这个顺序拼，页与页的先后不漂移。
    """
    readable = {img.page_no for img in page_images
                if cards.get(img.page_no) is not None
                and cards[img.page_no].type != "空白"}
    expanded: set[int] = set()
    for p in pages:
        expanded.update(q for q in (p - 1, p, p + 1) if q in readable)
    return sorted(expanded)


def deep_read(client, cards: dict[int, PageCard], texts: list,
              page_images: list, pages: list[int], question: str) -> str:
    """漏斗第三层深读：命中页 ±1 展开，页图与文字层同给，高档推理作答。

    页图管版式与图表，文字层管精确措辞——两条通道进同一个请求；回答里
    的页码引用出自请求里的 [第N页] 标签（第 3 章立的物理出处）。证据
    不足时模型按岗位说明书回「资料中未见相关内容」，本函数原样透传——
    拒答是被设计出来的诚实，不是要修的错。回复被截断（finish='length'）
    时文末追加注记，把「答案不完整」说出来，不默默交给用户猜。
    """
    if not pages:
        raise ValueError(f"pages 为空：深读需要至少一个命中页，收到 {pages!r}")
    if len(texts) != len(page_images):
        raise ValueError(
            f"texts 与 page_images 必须按位等长：{len(texts)} 对 {len(page_images)}")
    read = _expand_pages(cards, page_images, pages)
    if not read:
        raise ValueError(f"邻页展开后没有可读的页：命中 {pages!r} 既无图也无卡")
    images = {img.page_no: img for img in page_images}
    text_of = {img.page_no: t for img, t in zip(page_images, texts)}
    blocks: list[dict] = []
    for p in read:
        blocks += img_block(images[p].bitmap, images[p].label)  # 标签在前图随后
    layers = [f"[第{p}页] {text_of[p].strip() or '（无文字层）'}" for p in read]
    blocks.append({"type": "text",
                   "text": "重点页文字层：\n" + "\n".join(layers)
                           + f"\n\n用户问题：{question}"})
    text, finish = client.chat(blocks, system=DEEP_SYSTEM, effort="high",
                               max_tokens=DEEP_MAX_TOKENS)
    if finish == "length":
        text += TRUNCATION_NOTE                      # 截断要说破，不能装完整
    return text


_PAGE_REF = re.compile(r"第(\d+)页")   # 页码引用的网眼：只认「第＋数字＋页」

INDEX_NOTE = ("（注：索引仅覆盖 {covered}/{total} 页；"
              "未覆盖的页没有被读过，答案只基于已索引部分。）")


@dataclass
class Answer:
    """ask 的交付物：回答正文＋从正文回收的引用页码。

    cited 不是模型另报的账本，是从 answer 里逐字捞回来的——答案说
    了什么页，交付物就认什么页，两处永远对得上。
    """

    answer: str
    cited: list[int]


def cited_pages(answer: str) -> list[int]:
    """从回答正文回收页码引用：形如「第12页」的全部捞出，升序去重。

    网眼是正则 第(\\d+)页——「第 3 版」「第三页」「12 页」都捞不着，
    只有「第＋数字＋页」这个形状才算页码引用。回收只认形状、不核对
    语料：模型若编了语料外的页码，对不上账的缺口留给交付层说破
    （report.py 的导出与预览都会为语料外页码抛 ValueError）。
    """
    return sorted({int(m) for m in _PAGE_REF.findall(answer or "")})


def ask(client, doc, question: str, top: int = 4, cands: int = 12,
        index: dict[int, PageCard] | None = None) -> Answer:
    """一次调用跑完三层漏斗：粗筛→精排→深读→引用回收，交付 Answer。

    doc 是 SynthDoc；index 可注入现成的 {页码: PageCard}——复用第 4 章
    攒下的卡片就跳过建卡那步调用；None 则现场整本成卡。索引只覆盖
    部分页时，答案末尾如实声明覆盖范围：没读过的页不许装作读过，
    覆盖面写进交付物，核对才有起点（本章痛点：索引建了一半，回答
    却指着全书说话）。
    """
    page_images = render_pages(doc)
    texts = [page.text for page in doc.pages]
    cards = (index if index is not None
             else build_page_cards(client, page_images, texts))
    ranked = score_pages(cards, texts, question)[:cands]    # 第一层：免费粗筛
    picked = rerank_pages(client, cards, page_images, ranked, top, question)
    answer = deep_read(client, cards, texts, page_images, picked, question)
    if len(cards) < len(texts):                             # 覆盖不全：说破
        answer += "\n\n" + INDEX_NOTE.format(covered=len(cards),
                                             total=len(texts))
    return Answer(answer=answer, cited=cited_pages(answer))
