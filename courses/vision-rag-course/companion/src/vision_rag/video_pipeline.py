"""video_pipeline.py —— 漏斗迁移：带时间戳的视频问答。

第 5、6、7 章在 PDF 上攒下的三层漏斗，这一章整个搬到时间段上：
段粗筛（免费）→ 段代表帧精排（便宜）→ 选中段全帧深读（昂贵）。
结构一寸没改，三个零件换了材质：
1. 「页」换成「段」：检索单位从页码换成 30 秒段卡（第 10 章攒的抽屉）；
2. 「页码引用」换成「时间戳」：回答里的出处从 [第N页] 换成 [MM:SS]
   ——视频版的页码，第 1 分 23 秒写作 [01:23]；
3. 「引用页图」换成「切片范围」：答案说得出第几秒，就切得出那一段
   ——前后各补 5 秒、合并重叠、最多 3 段，拿去给播放器或同事。
诚实口径沿用第 9 章：时间戳是采样估计——帧标签误差不超过半个真相
帧间隔，写成分秒再添 ±0.5 秒取整误差。这句声明印进每次回答的末尾。
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass
from itertools import pairwise

from vision_rag.client import ChatError, img_block
from vision_rag.pipeline import DEEP_MAX_TOKENS, TRUNCATION_NOTE
from vision_rag.scoring import FIELD_WEIGHT, TF_CAP, tokenize
from vision_rag.video import auto_fps, extract_frames
from vision_rag.video_index import (
    FrameCard,
    SegmentCard,
    aggregate_segments,
    build_frame_cards,
)

VIDEO_RERANK_SYSTEM = """你是视频问答的段筛选器。你会收到若干候选时间段（如 [00:30-01:00]）：每段前有一条标签（起止时刻与摘要），标签后是该段中间时刻的画面截图。
用户会提出一个问题，请挑出真正有助于回答它的时间段，最多 {k} 个，按相关程度从高到低排列。
判断看内容与语义，不要只对字面；宁可少选，不要凑数；一个都不相关就返回空列表。
输出 JSON：{{"segments": [{{"start": 30.0, "reason": "10字以内理由"}}]}}，start 为段起始秒数、照抄标签里的起始时刻，只输出 JSON。"""

VIDEO_DEEP_SYSTEM = """你是深度观看助手。你会看到与用户问题相关的视频帧序列：按时间顺序排列，每帧前有 [t=Xs] 标签，相邻帧间隔约 {interval:.1f} 秒（这是抽样帧，不是全部画面）。
请把帧序列当作一段连续视频来理解，分析画面中的人物、动作、物体、场景和可见文字。
回答要求：
1. 用中文，先给结论，再按时间或要点展开；
2. 每个关键论点后标注来源时刻，格式如 [00:31]（分:秒）——时刻只能取你看过的帧标签附近，不要编造没见过的画面；
3. 若帧内容不足以回答问题，明确说明「画面中未见相关内容」、还缺什么，不要脑补。"""

TS_NOTE = ("\n\n（注：回答中的 [MM:SS] 时刻是采样估计，不是精确时刻：帧标签误差"
           "不超过半个真相帧间隔（本素材 ±{half:.2f} 秒），写成分秒另有 "
           "±0.5 秒取整误差。）")

_TS_STAMP = re.compile(r"\[(\d{1,2}:\d{2}(?::\d{2})?)\]")   # 网眼：[M:SS]/[MM:SS]/[H:MM:SS]


def _mmss(sec: int) -> str:
    """裸时间戳（不带方括号）：MM:SS，超一小时 H:MM:SS。"""
    h, rem = divmod(sec, 3600)
    m, s = divmod(rem, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m:02d}:{s:02d}"


def fmt_ts(sec: float) -> str:
    """把秒数写成 [MM:SS] 时刻；超过一小时改用 [H:MM:SS]。向下取整到秒。

    时刻不为负：负数按 0 兜底（正常链路里 parse_ts 产不出负时刻，
    切片端点另有 clamp，这里只管把秒数写成读者认得的形状）。
    """
    return f"[{_mmss(max(0, int(sec)))}]"


def parse_ts(text: str) -> list[float]:
    """从回答正文回收时刻引用：形如 [MM:SS]/[M:SS]（也认 [H:MM:SS]），升序去重。

    网眼与第 8 章 cited_pages 同一副脾气：只认形状、不核对素材——
    「31 秒」「第31秒」「[00:31-00:34] 区间」都捞不着，只有带方括号的
    单个时刻算数（区间写法是声明的简化：深读的岗位说明书只要求单时刻）。
    模型若编了片外时刻，对不上账的缺口交给 clip_ranges 收口：片外时刻跳过，其余照切。
    """
    out: list[float] = []
    for stamp in _TS_STAMP.findall(text or ""):
        parts = [int(p) for p in stamp.split(":")]
        h, m, s = parts if len(parts) == 3 else (0, parts[0], parts[1])
        out.append(float(h * 3600 + m * 60 + s))
    return sorted(set(out))


def clip_ranges(timestamps, duration: float, pad: float = 5.0,
                max_clips: int = 3) -> list[tuple[float, float]]:
    """把时刻清单翻译成可切给的片段范围：(起点, 终点) 列表，按时间升序。

    四步语义一条流水线：每个时刻前后各补 pad 秒；端点 clamp 到
    [0, duration]；补边后仍整体落在片外的时刻跳过（没有可切的画面）；
    相邻两段重叠或相接就并成一段——播放时不用中途换文件；最后截到
    max_clips 段，让给最早的时刻（时刻升序，靠前的先上桌）。
    """
    if duration <= 0:
        raise ValueError(f"duration 必须为正数，收到 {duration}")
    if pad < 0:
        raise ValueError(f"pad 不能为负，收到 {pad}")
    if max_clips <= 0:
        raise ValueError(f"max_clips 必须是正数，收到 {max_clips}")
    spans: list[tuple[float, float]] = []
    for t in sorted(timestamps):
        a, b = max(0.0, t - pad), min(duration, t + pad)
        if a >= b:
            continue                        # 片外时刻：无从下刀
        if spans and a <= spans[-1][1]:
            spans[-1] = (spans[-1][0], max(spans[-1][1], b))  # 重叠/相接：并段
        else:
            spans.append((a, b))
    return spans[:max_clips]


def segment_document(seg_card: SegmentCard,
                     frame_cards: dict[float, FrameCard]) -> str:
    """把一张段卡摊成可检索文档：段摘要/关键词各重复 3 次＋段内帧卡垫底。

    与第 5 章 page_document 同一副骨架：卡片字段是模型浅阅读的浓缩，
    按 FIELD_WEIGHT 计 3 倍；帧卡的摘要与画面文字（ocr）全文垫底 1 次
    ——段卡没写到的字眼，帧卡还有一次被数到的机会。
    """
    parts: list[str] = [seg_card.summary] * FIELD_WEIGHT
    parts += [str(k) for k in seg_card.keywords] * FIELD_WEIGHT
    for t in seg_card.frame_ts:
        card = frame_cards.get(t)
        if card is None:
            continue
        if card.ocr:
            parts.append(card.ocr)
        parts.append(card.summary)
    return "\n".join(parts)


def score_segments(seg_cards: list, frame_cards: dict, question: str) -> list[int]:
    """段粗筛：问题词 × 段文档的 TF-IDF 打分，总分降序返回段下标。

    第 5 章 score_pages 的思路原样平移：idf = log(1 + 段数 ÷ 含词段数)
    乘 min(词频, 8)，稀有词压倒高频词、封顶防长段霸榜。一个词都没
    命中的段不进榜；整个问题全不沾（或全是停用词）时回退全部段序
    ——粗筛交不出判断，就把判断原样交给下一层。
    """
    if not seg_cards:
        return []
    terms = tokenize(question)
    docs = [segment_document(s, frame_cards) for s in seg_cards]
    if not terms:
        return list(range(len(seg_cards)))
    n = len(docs)
    df = {t: sum(1 for d in docs if t in d) for t in terms}
    scored = []
    for i, doc in enumerate(docs):
        s = 0.0
        for t in terms:
            tf = doc.count(t)
            if tf:
                s += math.log(1 + n / df[t]) * min(tf, TF_CAP)
        scored.append((i, s))
    scored.sort(key=lambda pair: -pair[1])   # 稳定排序：同分按段序（时间序）
    return [i for i, s in scored if s > 0] or list(range(len(seg_cards)))


def _rep_frame(frames: list, seg: SegmentCard):
    """段代表帧：离段中间时刻最近的那张已抽帧——一段戏的剧照。"""
    mid = (seg.start + seg.end) / 2
    return min(frames, key=lambda f: abs(f.t - mid))


def rerank_segments(client, seg_cards: list, frames: list, candidates: list[int],
                    k: int, question: str) -> list[int]:
    """段精排：候选段的代表帧＋摘要交模型，按内容选出至多 k 段，返回段下标。

    与第 6 章 rerank_pages 同一条纪律：回执只认候选（编造的起始秒数
    一律丢弃）、去重、≤k；调用层罢工或模型一段未选时，静默回退粗筛
    排序的前 k。差别只有一样——送审的不是页图，是段中间时刻最近的
    那张代表帧：一张图替一段说话，便宜依旧。
    """
    if k <= 0:
        raise ValueError(f"k 必须是正数，收到 {k}")
    cand = [i for i in candidates if 0 <= i < len(seg_cards)]
    if not cand:
        return []
    blocks: list[dict] = []
    for i in cand:
        seg = seg_cards[i]
        rep = _rep_frame(frames, seg)
        blocks += img_block(
            rep.bitmap,
            f"[{_mmss(int(seg.start))}-{_mmss(int(seg.end))}]"
            f" 摘要：{seg.summary[:150]}")
    blocks.append({"type": "text",
                   "text": f"用户问题：{question}\n"
                           f"请从上述 {len(cand)} 个候选段中选出最多 {k} 个，"
                           "按相关程度从高到低输出。"})
    try:
        data = client.chat_json(blocks, system=VIDEO_RERANK_SYSTEM.format(k=k),
                                effort="low")
    except ChatError:
        return cand[:k]                          # 罢工：静默退回粗筛排序
    by_start = {round(seg_cards[i].start, 2): i for i in cand}
    picked: list[int] = []
    raw = data.get("segments") if isinstance(data, dict) else None
    for item in raw or []:
        try:
            st = round(float(item["start"]), 2)
        except (KeyError, TypeError, ValueError):
            continue                             # 形状不对、起始不是数：扔
        i = by_start.get(st)
        if i is not None and i not in picked:
            picked.append(i)                     # 只认候选、去重
    return picked[:k] or cand[:k]                # 一段未选：同样还给粗筛


def _deep_read_video(client, frames: list, frame_cards: dict,
                     seg_cards: list, picked: list[int], question: str,
                     fps: float) -> str:
    """选中段全帧深读：段内每张帧图都进请求，OCR 汇总垫底，高档推理作答。

    PDF 深读给「页图＋文字层」两条通道；视频深读的对应物是「帧图＋
    画面文字（ocr）」——图管动作与版面，ocr 管画面里印着的字。effort
    用 high：这是视频侧第一处高档推理（对齐第 7 章 PDF 深读的档位），
    帧序列要读出先后与因果，饿着推理档会答得敷衍。截断照第 7 章
    注记，拒答原样透传。
    """
    if not picked:
        raise ValueError(f"picked 为空：视频深读需要至少一个选中段，收到 {picked!r}")
    frame_map = {f.t: f for f in frames}
    ts = sorted({t for i in picked for t in seg_cards[i].frame_ts})
    blocks: list[dict] = []
    for t in ts:
        blocks += img_block(frame_map[t].bitmap, f"[t={t:.1f}s]")  # 标签在前
    ocr_lines = [f"{fmt_ts(t)} {frame_cards[t].ocr}" for t in ts
                 if frame_cards.get(t) is not None and frame_cards[t].ocr]
    tail = ("可见文字汇总：\n" + "\n".join(ocr_lines)) if ocr_lines else (
        "（画面中无可见文字）")
    blocks.append({"type": "text", "text": tail + f"\n\n用户问题：{question}"})
    text, finish = client.chat(
        blocks, system=VIDEO_DEEP_SYSTEM.format(interval=1.0 / fps),
        effort="high", max_tokens=DEEP_MAX_TOKENS)
    if finish == "length":
        text += TRUNCATION_NOTE                      # 截断要说破，不能装完整
    return text


@dataclass
class VideoAnswer:
    """ask_video 的交付物：回答正文＋时刻清单＋切片范围。

    timestamps 是从 answer 里逐字回收的（parse_ts），clips 由时刻清单
    补边合并而来——答案说了哪个时刻，交付物就切哪一段，两处永远
    对得上，与第 8 章 Answer 的 cited 同一副对账脾气。
    """

    answer: str
    timestamps: list[float]
    clips: list


def _truth_half_interval(source) -> float:
    """真相帧最小间隔的一半：时间戳诚实注记要报的 ± 误差上界。"""
    gaps = [later.t - earlier.t for earlier, later in pairwise(source.frames)]
    return min(gaps) / 2 if gaps else 0.0


def ask_video(client, source, question: str, top: int = 3, cands: int = 10,
              index: dict | None = None) -> VideoAnswer:
    """一次调用跑完视频侧三层漏斗：段粗筛→代表帧精排→选中段全帧深读。

    source 是 FrameSource（第 9 章）；index 可注入现成的 {时刻: FrameCard}
    ——复用第 10 章攒下的帧卡就跳过成卡那步调用；None 则现场整段成卡。
    深读答案里的 [MM:SS] 时刻由 parse_ts 逐字回收，再交 clip_ranges
    补边合并成切片范围；末尾印上时间戳 ± 误差的诚实注记——采样估计
    不是精确时刻，说破才算可核对（第 9 章立的口径）。
    """
    fps = auto_fps(source.duration)
    frames = extract_frames(source, fps)
    frame_cards = (index if index is not None
                   else build_frame_cards(client, frames))
    seg_cards = aggregate_segments(frame_cards)
    ranked = score_segments(seg_cards, frame_cards, question)[:cands]
    picked = rerank_segments(client, seg_cards, frames, ranked, top, question)
    answer = _deep_read_video(client, frames, frame_cards, seg_cards, picked,
                              question, fps)
    stamps = parse_ts(answer)       # 先回收再加注记：注记里没有可回收的时刻
    clips = clip_ranges(stamps, source.duration)
    answer += TS_NOTE.format(half=_truth_half_interval(source))
    return VideoAnswer(answer=answer, timestamps=stamps, clips=clips)
