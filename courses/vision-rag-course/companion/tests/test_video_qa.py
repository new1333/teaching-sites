"""第 11 章测试：漏斗迁移——带时间戳的视频问答。

对应大纲 milestone 的断言：
1. fmt_ts/parse_ts：秒数与 [MM:SS] 时刻互相翻译，回收升序去重、只认方括号形状；
2. clip_ranges 语义：前后补 pad 秒、clamp 到 [0, duration]、重叠合并、最多 max_clips 段；
3. score_segments：复用 TF-IDF 打分思路，稀有词压倒高频词，无命中回退全部段；
4. rerank_segments：代表帧取段中间时刻最近帧、回执只认候选、罢工/空选回退本地排序；
5. ask_video 端到端：段粗筛→代表帧精排→选中段全帧深读（视频侧第一处 effort=high），
   时刻回收与切片范围对账、拒答原样透传、时间戳 ± 误差的诚实注记印在答案末尾。
全程零网络：三面替身按请求形状作答。
"""
import base64
import re

import pytest

from vision_rag.bitmap import Bitmap
from vision_rag.client import Client
from vision_rag.fake import ScriptedTransport, failing, fenced_json
from vision_rag.video import Frame, extract_frames, make_clip
from vision_rag.video_index import FrameCard, SegmentCard
from vision_rag.video_pipeline import (
    ask_video,
    clip_ranges,
    fmt_ts,
    parse_ts,
    rerank_segments,
    score_segments,
)

EVENT = (31.0, 34.0)  # 合成素材里那次 3 秒快速动作的起止秒
DEEP_REPLY = ("推搡发生在车间：[00:31] 主角开始加速冲向道具，"
              "[00:33] 冲撞最猛，随后放缓。")


def _no_sleep_client(transport):
    """造一个不真睡的 Client：暂停函数收下秒数但不等待。"""
    return Client(transport, sleep=lambda _seconds: None)


def _seg(start, end, summary, keywords):
    """手搭一张段卡：聚合细节是第 10 章的事，这里只要可检索的形状。"""
    return SegmentCard(start=start, end=end, frame_ts=[],
                       summary=summary, keywords=keywords, peak_motion="低")


def _tagged_frames(ts):
    """画面里印着自己时刻的帧：解码后一眼认出送审的是哪一帧。"""
    return [Frame(t=t, bitmap=Bitmap([f"frame@{t}"]),
                  scene="车间", motion="低") for t in ts]


def _clip_cards(ts):
    """整段预搭的帧卡索引（ask_video 注入用），事件窗内带「推搡」。"""
    cards = {}
    for t in ts:
        inside = EVENT[0] <= t < EVENT[1]
        cards[t] = FrameCard(
            t=t, scene="车间",
            summary="主角快速冲撞，发生推搡" if inside else "主角缓慢走动",
            keywords=["车间", "主角"] + (["推搡"] if inside else []),
            ocr="车间标语：慢行" if inside else "",
            event="冲撞" if inside else "继续走动",
            motion="高" if inside else "低")
    return cards


_LABEL = re.compile(r"\[t=(\d+(?:\.\d+)?)s\]")


def _sent_ts(request: dict) -> list[float]:
    """读出请求里全部 [t=Xs] 标签的时刻——模型这次看到了哪些帧。"""
    return [float(m) for b in request["messages"][-1]["content"]
            if b["type"] == "text" for m in _LABEL.findall(b["text"])]


def _label_image_pairs(request: dict) -> list[tuple[str, str]]:
    """把请求拆成 (标签, 解码画面) 对——核对送审画面与标签的对应关系。"""
    pairs: list[tuple[str, str]] = []
    pending = None
    for block in request["messages"][-1]["content"]:
        if block["type"] == "text" and block["text"].startswith("["):
            pending = block["text"]
        elif block["type"] == "image_url" and pending is not None:
            b64 = block["image_url"]["url"].split(",", 1)[1]
            pairs.append((pending, base64.b64decode(b64).decode("utf-8")))
            pending = None
    return pairs


class _VideoBrain:
    """三面替身：认得出帧索引、段精排、深读三种请求，各自作答。

    帧索引幕按请求里的时刻逐帧回记录（事件窗内带推搡与高运动）；
    精排幕永远选中 30 秒开头的段；深读幕回 deep_reply 原文。
    """

    def __init__(self, deep_reply: str):
        self.deep_reply = deep_reply
        self.requests: list[dict] = []

    def call(self, request: dict):
        self.requests.append(request)
        system = request["messages"][0]["content"]
        if "帧索引员" in system:
            recs = []
            for t in _sent_ts(request):
                inside = EVENT[0] <= t < EVENT[1]
                recs.append({
                    "t": t, "scene": "车间",
                    "summary": ("主角快速冲撞，发生推搡" if inside
                                else "主角缓慢走动"),
                    "keywords": ["车间", "主角"] + (["推搡"] if inside else []),
                    "ocr": "车间标语：慢行" if inside else "",
                    "event": "冲撞" if inside else "继续走动",
                    "motion": "高" if inside else "低"})
            return fenced_json({"frames": recs}), "stop"
        if "段筛选器" in system:
            return fenced_json(
                {"segments": [{"start": 30.0, "reason": "推搡"}]}), "stop"
        return self.deep_reply, "stop"


# ---- 里程碑 1a：秒数与 [MM:SS] 互相翻译 ----

def test_fmt_ts_formats():
    assert fmt_ts(0) == "[00:00]"
    assert fmt_ts(31.0) == "[00:31]"
    assert fmt_ts(59.9) == "[00:59]"            # 向下取整：59.9 秒还是 59 秒
    assert fmt_ts(83) == "[01:23]"
    assert fmt_ts(600) == "[10:00]"
    assert fmt_ts(3723) == "[1:02:03]"          # 超一小时：H:MM:SS
    assert fmt_ts(-3) == "[00:00]"              # 时刻不为负：负数按 0 兜底


def test_parse_ts_recovers_sorted_and_deduped():
    text = "推搡在 [00:31] 开始，[0:33] 最猛；另见 [00:31] 重复。"
    assert parse_ts(text) == [31.0, 33.0]       # 升序、去重，[M:SS] 也认
    assert parse_ts("[1:02:03]") == [3723.0]
    assert parse_ts("") == [] and parse_ts("没有时刻的回答") == []


def test_parse_ts_ignores_ranges_and_loose_forms():
    assert parse_ts("区间 [00:31-00:34]、裸写 31 秒、第 31 秒都不入网") == []


# ---- 里程碑 1b：clip_ranges 的补边 / 合并 / 上限 ----

def test_clip_ranges_pads_and_clamps():
    assert clip_ranges([32.0], 61.0) == [(27.0, 37.0)]    # 前后各补 5 秒
    assert clip_ranges([2.0], 61.0) == [(0.0, 7.0)]      # 左端收口到 0
    assert clip_ranges([59.0], 61.0) == [(54.0, 61.0)]   # 右端收口到片尾


def test_clip_ranges_merges_overlap_keeps_disjoint():
    assert clip_ranges([10.0, 12.0], 61.0) == [(5.0, 17.0)]    # 重叠并成一段
    assert clip_ranges([10.0, 20.0], 61.0) == [(5.0, 25.0)]    # 相接也并
    assert clip_ranges([10.0, 40.0], 61.0) == [(5.0, 15.0), (35.0, 45.0)]


def test_clip_ranges_caps_and_skips_outside():
    assert clip_ranges([5.0, 20.0, 35.0, 50.0], 61.0) == [
        (0.0, 10.0), (15.0, 25.0), (30.0, 40.0)]        # 上限 3：第 4 段让位
    assert clip_ranges([-10.0, 100.0], 61.0) == []      # 片外时刻：无从下刀
    with pytest.raises(ValueError):
        clip_ranges([10.0], 0)


# ---- 里程碑 2：段粗筛与代表帧精排 ----

def test_score_segments_rare_word_wins():
    segs = [
        _seg(0.0, 30.0, "全员都在过审批流程", ["审批", "流程"]),
        _seg(30.0, 60.0, "桌面特写：预算表摊开", ["预算表", "桌面"]),
        _seg(60.0, 90.0, "例会又回到审批话题", ["审批", "例会"]),
    ]
    cards = {t: FrameCard(t=t, scene="", summary="", keywords=[],
                          ocr="", event="", motion="低")
             for t in (0.0, 30.0, 60.0)}
    ranked = score_segments(segs, cards, "预算表摊开在哪一段")
    assert ranked[0] == 1                            # 稀有词压倒高频词


def test_score_segments_falls_back_when_no_hit():
    segs = [_seg(0.0, 30.0, "走廊", ["走廊"]),
            _seg(30.0, 60.0, "车间", ["车间"])]
    cards = {}
    assert score_segments(segs, cards, "量子纠缠") == [0, 1]   # 全不沾：回退全部段


def test_rerank_segments_semantic_pick_validates_and_caps():
    segs = [
        _seg(0.0, 30.0, "主角缓慢走动", ["车间"]),
        _seg(30.0, 60.0, "推搡发生，冲撞猛烈", ["推搡"]),
        _seg(60.0, 90.0, "主角离场", ["院子"]),
    ]
    frames = _tagged_frames([0.0, 30.0, 60.0])
    reply = fenced_json({"segments": [
        {"start": 30.0, "reason": "推搡"},
        {"start": 12.5, "reason": "编造"},
        {"start": 30.0, "reason": "重复"},
        {"start": "坏了", "reason": "非数"}]})
    transport = ScriptedTransport([(reply, "stop")])
    picked = rerank_segments(_no_sleep_client(transport), segs, frames,
                             [0, 1, 2], k=2, question="推搡发生在哪一段")
    assert picked == [1]                      # 只认候选、去重、非数扔掉
    with pytest.raises(ValueError):
        rerank_segments(_no_sleep_client(transport), segs, frames,
                        [0], k=0, question="x")


def test_rerank_representative_frame_is_midpoint_nearest():
    segs = [_seg(0.0, 30.0, "A", []), _seg(30.0, 60.0, "B", []),
            _seg(60.0, 90.0, "C", [])]
    frames = _tagged_frames([0.0, 14.0, 30.0, 44.0, 60.0])
    transport = ScriptedTransport([(fenced_json({"segments": []}), "stop")])
    rerank_segments(_no_sleep_client(transport), segs, frames,
                    [0, 1, 2], k=2, question="画面里有什么")
    pairs = _label_image_pairs(transport.requests[0])
    assert [label.split("]")[0] + "]" for label, _ in pairs] == [
        "[00:00-00:30]", "[00:30-01:00]", "[01:00-01:30]"]
    assert [image for _, image in pairs] == [
        "frame@14.0", "frame@44.0", "frame@60.0"]   # 段中时刻最近帧：15→14、45→44、75→60


def test_rerank_segments_falls_back_on_strike_or_empty_pick():
    segs = [_seg(0.0, 30.0, "走廊", []), _seg(30.0, 60.0, "车间", []),
            _seg(60.0, 90.0, "院子", [])]
    frames = _tagged_frames([0.0, 30.0, 60.0])
    struck = ScriptedTransport([failing()])
    assert rerank_segments(_no_sleep_client(struck), segs, frames,
                           [2, 0, 1], k=2, question="q") == [2, 0]  # 罢工：退回粗筛排序
    empty = ScriptedTransport([(fenced_json({"segments": []}), "stop")])
    assert rerank_segments(_no_sleep_client(empty), segs, frames,
                           [0, 1, 2], k=2, question="q") == [0, 1]  # 空选：同样退回


# ---- 里程碑 3：ask_video 端到端 ----

def test_ask_video_end_to_end():
    brain = _VideoBrain(DEEP_REPLY)
    result = ask_video(_no_sleep_client(brain), make_clip(), "推搡发生在什么时候")
    assert result.timestamps == [31.0, 33.0]          # 从答案正文逐字回收
    assert result.clips == [(26.0, 38.0)]             # (26,36)+(28,38) 合并成一段
    assert "[00:31]" in result.answer
    assert "半个真相帧间隔" in result.answer and "±0.25" in result.answer  # 诚实注记
    efforts = [r["reasoning_effort"] for r in brain.requests]
    assert efforts == ["low", "low", "low", "high"]   # 两批成卡＋精排＋深读
    deep = brain.requests[-1]
    user = deep["messages"][-1]["content"]
    assert sum(1 for b in user if b["type"] == "image_url") == 15  # 选中段全帧
    assert user[0]["text"] == "[t=30.0s]"             # 段内首帧打头
    assert "[00:32] 车间标语：慢行" in user[-1]["text"]          # OCR 汇总垫底
    assert user[-1]["text"].endswith("用户问题：推搡发生在什么时候")


def test_ask_video_refusal_passes_through():
    brain = _VideoBrain("画面中未见相关内容：抽样帧里没有出现与问题相关的画面。")
    result = ask_video(_no_sleep_client(brain), make_clip(), "视频里出现了 UFO 吗")
    assert "画面中未见相关内容" in result.answer
    assert result.timestamps == [] and result.clips == []   # 无时刻即无切片


def test_ask_video_with_preset_index_skips_card_building():
    ts = [f.t for f in extract_frames(make_clip(), 0.5)]
    brain = _VideoBrain(DEEP_REPLY)
    result = ask_video(_no_sleep_client(brain), make_clip(),
                       "推搡发生在什么时候", index=_clip_cards(ts))
    assert len(brain.requests) == 2                   # 只剩精排＋深读两跳
    assert "帧索引员" not in brain.requests[0]["messages"][0]["content"]
    assert result.timestamps == [31.0, 33.0]
