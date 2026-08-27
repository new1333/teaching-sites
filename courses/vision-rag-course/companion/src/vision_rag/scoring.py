"""scoring.py —— 免费的第一道筛：本地 TF-IDF 粗筛。

第 4 章攒下的整摞读书卡在这里第一次派上用场：不发一次请求、不花
一分钱，在本地把「最可能相关的几页」圈出来交给下一层。三件套：
1. 分词：中文没有空格，问题得先切成两字一小块的碎片才好对暗号；
2. 停用词：扔掉「什么」「怎么」这类到处都有、指认不了任何页的词；
3. TF-IDF 打分：在这页出现得越多、在全书出现得越少的词越值钱；
   词频封顶 8，防「把关键词抄一百遍的最长页」霸榜。
真实世界这层常用向量检索（页面与问题各变成一串数字、按远近找）；
实验场用词面 TF-IDF——零依赖、可纸笔复算，漏斗里的位置等价。
"""
from __future__ import annotations

import math
import re

from vision_rag.index import PageCard

STOP_TERMS = frozenset({
    "什么", "怎么", "哪些", "如何", "为什么", "这个", "那个", "请问", "告诉",
    "一下", "资料", "文档", "书里", "书中", "里面", "文中", "介绍", "描述",
    "the", "a", "an", "of", "in", "is", "what", "how", "which", "and", "to",
})
TF_CAP = 8         # 词频封顶：超过 8 次按 8 次计
FIELD_WEIGHT = 3   # 卡片字段权重：标题/摘要/关键词各重复 3 次

_LATIN_RE = re.compile(r"[a-z0-9_.]{2,}")   # 英文数字串（可含点、下划线）
_HAN_RE = re.compile(r"[\u4e00-\u9fff]+")   # 连续中文段


def tokenize(text: str) -> set[str]:
    """把一段文本切成检索词：英文数字整段成词、中文相邻二字滑窗、去停用词。

    中文没有空格，「保养周期」四个字连成一串，没法直接跟问题对暗号——
    相邻两字一组滑过去（保养、养周、周期）。问题与页面不用对齐分词
    结果：词只是子串，页里数出现次数就行。滑窗会切出跨词边的碎片
    （养周），但问题与语料两边噪音对称，通常谁也匹配不到谁。
    英文与数字整段成词并统一小写：GLM-4.5v 切成 glm 与 4.5v。
    """
    terms: set[str] = set()
    lowered = (text or "").lower()
    terms.update(_LATIN_RE.findall(lowered))
    for run in _HAN_RE.findall(lowered):
        terms.update(run[i:i + 2] for i in range(len(run) - 1))
    return terms - STOP_TERMS


def page_document(card: PageCard, page_text: str) -> str:
    """把一张读书卡摊成一篇可检索的文档：卡片字段重复 3 次＋文字层 1 次。

    卡片是模型浅阅读的浓缩，比原文干净：标题、摘要、关键词各重复
    3 次——模型认为要紧的字眼，检索时按 3 倍计。文字层全文垫底 1 次：
    卡片没写到的字眼，原文还有一次被数到的机会。扫描页文字层为空，
    它在粗筛里的全部存在感都来自卡片。
    """
    parts: list[str] = []
    for h in card.headings:
        parts.extend([h["text"]] * FIELD_WEIGHT)
    parts.extend([card.summary] * FIELD_WEIGHT)
    parts.extend([str(k) for k in card.keywords] * FIELD_WEIGHT)
    parts.append(page_text or "")
    return "\n".join(parts)


def score_pages(cards: dict[int, PageCard], texts: list[str],
                question: str) -> list[int]:
    """本地粗筛：问题词 × 页面文档的 TF-IDF 打分，按总分降序返回页码。

    词的身价是 idf = log(1 + 页数 ÷ 含该词的页数)——只在 1 页出现的词
    身价最高，页页都有的词身价趋近 log 2。页面总分 = Σ idf × min(词频,
    8)：词频封顶防「最长的那页」霸榜。一个词都没命中的页不进榜；
    整个问题一个词都命中不了（或全是停用词）时，回退全部页序——
    粗筛交不出判断，就把判断原样交给下一层漏斗。
    """
    pages = sorted(cards)
    if not pages:
        return []
    if pages[-1] > len(texts):
        raise ValueError(f"texts 必须覆盖所有页：最大页码 {pages[-1]}，"
                         f"texts 只有 {len(texts)} 条")
    terms = tokenize(question)
    docs = {p: page_document(cards[p], texts[p - 1]) for p in pages}
    if not terms:
        return pages                                  # 问题全是停用词：回退页序
    n = len(pages)
    df = {t: sum(1 for d in docs.values() if t in d) for t in terms}
    scored = []
    for p in pages:
        doc = docs[p]
        s = 0.0
        for t in terms:
            tf = doc.count(t)
            if tf:
                idf = math.log(1 + n / df[t])         # 稀有 = 贵，常见 = 贱
                s += idf * min(tf, TF_CAP)            # 词频封顶：8 次封神
        scored.append((p, s))
    scored.sort(key=lambda ps: -ps[1])                # 稳定排序：同分按页序
    return [p for p, s in scored if s > 0] or pages   # 全不沾：回退页序
