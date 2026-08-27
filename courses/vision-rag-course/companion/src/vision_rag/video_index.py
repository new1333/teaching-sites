"""video_index.py —— 帧卡片与段聚合：把几百帧收进抽屉。

第 9 章交出的帧序列在这里换回两样东西：
1. 帧卡片：每帧一张六字段结构化卡（场景/摘要/关键词/画面文字/事件/
   运动强度）——批量浅阅读的成果，视频检索的公共货币；
2. 段卡片：按 30 秒把帧卡归堆成段卡——检索粒度从帧升到段，
   相邻近亲帧的重复不再挤占检索名额。
成批纪律整章复用第 4 章的对半拆批：标签先行、图随后、截断拆批、
漏帧只补漏、顽固帧兜底——一条不落地平移到时间轴上。
"""
from __future__ import annotations

from dataclasses import dataclass
from itertools import pairwise

from vision_rag.client import ChatError, img_block, parse_json_lenient

MOTIONS = ("低", "中", "高")  # 运动强度白名单：三档足够微观层定位峰值

FRAME_INDEX_SYSTEM = """你是视频帧索引员。你会收到按时间顺序排列的一批帧图，每帧前有一个文本标签标明时刻（如 [t=12.0s]）。
请对收到的每一帧各写一条记录，合并为一个 JSON 对象输出，格式示例：
{"frames": [{"t": 12.0, "scene": "走廊", "summary": "60 字以内中文摘要：画面里有谁、在做什么、关键物体在哪", "keywords": ["走廊", "门", "主角"], "ocr": "画面中可见的文字，没有就写空字符串", "event": "相对前一帧发生了什么变化；首帧写画面整体内容", "motion": "低"}]}
字段规则：
- t 照抄图前标签里的时刻数字；
- scene 写场景或环境的短语（如「走廊」「车间」）；
- keywords 给 3-6 个便于检索的词（人物/物体/动作/场景）；
- ocr 收画面中可见的文字（字幕、招牌、标牌），没有写空字符串；
- event 写相对前一帧的变化或事件，首帧写画面整体内容；
- motion 只能取：低/中/高——画面动得猛不猛，高＝剧烈动作或快速运动。
收到几帧写几条：一帧不漏，一帧不编。只输出 JSON。"""


@dataclass
class FrameCard:
    """一帧的卡片：帧世界的读书卡，视频检索的公共货币。

    与 PageCard 同构同纪律：六字段、白名单、以送审标签为准。
    差别在字段本身——视频帧没有「版面元素」，多出来的是画面里的
    文字（ocr）、帧间变化（event）与运动强度（motion）。
    """

    t: float       # 时刻（秒）——来自送审标签，不来自模型自报
    scene: str     # 场景短语，如「走廊」
    summary: str   # 数十字级的画面摘要
    keywords: list # 检索关键词
    ocr: str       # 画面中可见的文字，没有为空字符串
    event: str     # 相对前一帧的变化；首帧写整体内容
    motion: str    # 运动强度，只取 MOTIONS 白名单里的值


@dataclass
class SegmentCard:
    """一段的卡片：30 秒一个抽屉，检索粒度从帧升到段。

    frame_ts 留着段内每帧的时刻清单——选中段后深读要回帧；
    peak_motion 是段内最高的运动等级，微观放大层靠它找最值得
    拉近看的时刻。
    """

    start: float       # 段起点（秒）
    end: float         # 段终点（秒）：标称边界，末段可能超出片尾
    frame_ts: list     # 段内帧卡的时刻清单，按时间升序
    summary: str       # 段内帧卡摘要串联（去重）
    keywords: list     # 段内关键词按出现次数排序
    peak_motion: str   # 段内最高运动等级


def _ts_label(t: float) -> str:
    """帧的送审标签：视频版的 [第N页]。"""
    return f"[t={t:.1f}s]"


def normalize_frame_card(rec, t: float) -> FrameCard:
    """把模型吐出的一条原始记录规整成 FrameCard：白名单、钳制、补空。

    模型输出当「不可信输入」对待：运动强度不在白名单归「低」，
    关键词去空、封顶 8 条，文本字段一律钳长。时刻以参数为准——
    它来自送审帧图的标签，不来自记录自带的 t。
    """
    src = rec if isinstance(rec, dict) else {}
    motion = src.get("motion")
    if motion not in MOTIONS:
        motion = "低"                           # 白名单外：一概归最低，不猜
    keywords = [str(k).strip()[:40] for k in src.get("keywords") or []
                if str(k).strip()][:8]
    return FrameCard(
        t=t,
        scene=str(src.get("scene", "")).strip()[:60],
        summary=str(src.get("summary", "")).strip()[:200],
        keywords=keywords,
        ocr=str(src.get("ocr", "")).strip()[:200],
        event=str(src.get("event", "")).strip()[:200],
        motion=motion,
    )


def _frame_blocks(frames: list) -> list[dict]:
    """拼一批请求块：每帧标签在前、图随后，末尾补一条范围指令。"""
    blocks: list[dict] = []
    for f in frames:
        blocks += img_block(f.bitmap, label=_ts_label(f.t))
    first, last = frames[0].t, frames[-1].t
    blocks.append({"type": "text",
                   "text": f"请输出 t={first:.1f}s 至 t={last:.1f}s"
                           f"（共{len(frames)}帧）每一帧的 JSON 记录。"})
    return blocks


def _snap_t(reported, sent: list[float]) -> float | None:
    """把回执自报的时刻贴到最近的送审帧上，贴不上就算编造。

    容差是批内相邻送审帧最大间隔的一半：自报 31.2 贴回 31.0 算
    手抖，自报 999 贴哪都够不着——整条记录扔掉。平手（与两帧等距）
    取先到的那帧，与抽帧的「时刻宁早不晚报」同一脾气。
    """
    try:
        value = float(reported)
    except (TypeError, ValueError):
        return None
    nearest = min(sent, key=lambda t: abs(t - value))
    gaps = [b - a for a, b in pairwise(sent)]
    tolerance = max(gaps) / 2 if gaps else float("inf")  # 单帧批：只有它可贴
    return nearest if abs(nearest - value) <= tolerance else None


def _extract_records(data, wanted: list[float]) -> dict[float, dict]:
    """从模型回执里捞原始记录：时刻必须贴得上送审帧，其余全扔。

    模型编造的时刻（回执里有、请求里没有）在这里被拦下——
    第 3 章立下的纪律在时间轴上的翻版：引用必须落在送审集合内。
    """
    raw = data.get("frames") if isinstance(data, dict) else data
    records: dict[float, dict] = {}
    for r in raw or []:
        if not isinstance(r, dict):
            continue
        t = _snap_t(r.get("t"), wanted)
        if t is not None:
            records[t] = r
    return records


def _split_batch(client, frames: list) -> dict[float, dict]:
    """对半拆批：左半批先问、右半批随后；单帧拆不动，交回空。"""
    if len(frames) <= 1:
        return {}
    mid = len(frames) // 2
    left = _index_batch(client, frames[:mid])
    right = _index_batch(client, frames[mid:])
    return {**left, **right}


def _index_batch(client, frames: list) -> dict[float, dict]:
    """把一批帧交给模型打标，返回 {时刻: 原始记录}。

    三种坏结局都走对半拆批：回执被截断（finish='length'）、回文解析
    失败、调用层重试耗尽。批拆到单帧就拆不动了——那一帧交出去兜底。
    """
    if not frames:
        return {}
    try:
        text, finish = client.chat(_frame_blocks(frames),
                                   system=FRAME_INDEX_SYSTEM, effort="low",
                                   json_mode=True)
        if finish == "length" and len(frames) > 1:
            return _split_batch(client, frames)    # 截断：整批减半重来
        data = parse_json_lenient(text)
    except ChatError:
        return _split_batch(client, frames)        # 解析失败/重试耗尽：拆
    wanted = [f.t for f in frames]
    records = _extract_records(data, wanted)
    missing = [f for f in frames if f.t not in records]
    if missing and len(missing) < len(frames):
        records.update(_index_batch(client, missing))   # 只是漏帧：只补漏的
    elif missing:
        return _split_batch(client, frames)        # 一条都没对上：整批拆
    return records


def _fallback_card(t: float) -> FrameCard:
    """兜底卡：模型读不了的帧，退回一张诚实的空卡。

    视频帧没有文字层可退（第 4 章页卡的退路），本地一无所有——
    弱卡不冒充好卡：摘要空着、运动归「低」。宁可整段索引带一张
    空卡，不让几百帧的工程中途断掉。
    """
    return normalize_frame_card({}, t)


def build_frame_cards(client, frames: list,
                      batch: int = 20) -> dict[float, FrameCard]:
    """整段成卡：按批打标，残帧兜底——任何一帧都不缺席。

    返回 {时刻: FrameCard}。截断与失败在批内递归消化（第 4 章
    build_page_cards 的纪律原样平移：拆到单帧仍拿不到卡的帧，
    交一张空兜底卡）。检索粒度还是帧——升到段是 aggregate_segments
    的事。
    """
    if batch <= 0:
        raise ValueError(f"batch 必须是正数，收到 {batch}")
    cards: dict[float, FrameCard] = {}
    for i in range(0, len(frames), batch):
        for t, rec in _index_batch(client, frames[i:i + batch]).items():
            cards[t] = normalize_frame_card(rec, t)
    for f in frames:
        if f.t not in cards:                      # 模型终究没给卡：兜底
            cards[f.t] = _fallback_card(f.t)
    return cards


def aggregate_segments(frame_cards: dict[float, FrameCard],
                       seg: float = 30.0) -> list[SegmentCard]:
    """帧卡归堆成段卡：一个抽屉 seg 秒，检索粒度从帧升到段。

    分组键是 int(t // seg)：整点边界归下一段（30.0 秒进 [30, 60)）。
    段摘要＝帧摘要按时刻串联去重；关键词按出现次数降序（同次数保持
    首见顺序）；peak_motion＝段内最高运动等级。end 是标称边界——末段
    可以超出片尾，裁剪时再收口。
    """
    if seg <= 0:
        raise ValueError(f"seg 必须为正数，收到 {seg}")
    groups: dict[int, list[FrameCard]] = {}
    for t in sorted(frame_cards):
        groups.setdefault(int(t // seg), []).append(frame_cards[t])
    out: list[SegmentCard] = []
    for key in sorted(groups):
        members = groups[key]
        start = key * seg
        summaries: list[str] = []
        freq: dict[str, int] = {}
        for c in members:
            if c.summary and c.summary not in summaries:
                summaries.append(c.summary)       # 相邻近亲常写同一条摘要：去重
            for k in c.keywords:
                freq[k] = freq.get(k, 0) + 1
        out.append(SegmentCard(
            start=start,
            end=start + seg,
            frame_ts=[c.t for c in members],
            summary="；".join(summaries)[:600],
            keywords=sorted(freq, key=lambda k: -freq[k])[:8],
            peak_motion=max((c.motion for c in members), key=MOTIONS.index),
        ))
    return out
