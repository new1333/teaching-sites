"""第 10 章测试：帧卡片与段聚合——把几百帧收进抽屉。

对应大纲 milestone 的断言：
1. 75 秒素材按 30 秒聚合恰为 3 段且边界正确（整点边界归下一段）；
2. 段内含一张 motion='高' 的帧时该段 peak_motion=='高'——微观层要的钩子；
3. 复用第 4 章的对半拆批纪律：截断逐轮减半、漏帧只补漏、顽固帧拿兜底卡；
4. 回执时刻以送审标签为准：贴最近送审帧，编造的远时刻进不了卡。
全程零网络：截断与失败由剧本/替身回放。
"""
import re

import pytest

from vision_rag.bitmap import Bitmap
from vision_rag.client import ChatError, Client
from vision_rag.fake import fenced_json
from vision_rag.video import Frame, extract_frames, make_clip
from vision_rag.video_index import (
    FrameCard,
    aggregate_segments,
    build_frame_cards,
    normalize_frame_card,
)

EVENT = (31.0, 34.0)  # 合成素材里那次 3 秒快速动作的起止秒


def _still() -> Bitmap:
    """一张随手的小画面：4×2 网格。"""
    return Bitmap(["....", "...."])


def _frames(ts, scene="走廊", motion="低"):
    """造一组真相帧：时刻取 ts、画面共用一张小位图。"""
    return [Frame(t=t, bitmap=_still(), scene=scene, motion=motion) for t in ts]


def _rec(t, scene="走廊", summary="画面摘要", keywords=None,
         ocr="", event="无变化", motion="低"):
    """一条模型吐出的原始帧记录（还没规整）。"""
    return {"t": t, "scene": scene, "summary": summary,
            "keywords": keywords or ["走廊"], "ocr": ocr,
            "event": event, "motion": motion}


def _card(t, summary="画面摘要", keywords=None, motion="低"):
    """直接手搭一张规整好的 FrameCard（聚合测试用）。"""
    return FrameCard(t=t, scene="走廊", summary=summary,
                     keywords=keywords or ["走廊"], ocr="", event="",
                     motion=motion)


def _no_sleep_client(transport):
    """造一个不真睡的 Client：暂停函数收下秒数但不等待。"""
    return Client(transport, sleep=lambda _seconds: None)


def _requested_ts(request: dict) -> list[float]:
    """从请求里读出本次送审的时刻——只认恰好是 [t=Xs] 形状的文本块。"""
    ts = []
    for block in request["messages"][-1]["content"]:
        if block["type"] == "text":
            m = re.fullmatch(r"\[t=(\d+(?:\.\d+)?)s\]", block["text"].strip())
            if m:
                ts.append(float(m.group(1)))
    return ts


def _n_images(request: dict) -> int:
    """这次请求带了几张帧图——批大小的直接观测。"""
    return sum(1 for b in request["messages"][-1]["content"]
               if b["type"] == "image_url")


class _AnsweringTransport:
    """好引擎替身：按请求里的时刻标签逐帧回合法记录。

    多帧批漏掉 skip 里的帧（模拟漏帧），单帧补查则好好作答；
    fake 里的是凭空编造的远时刻，用来考时刻校验；
    echo_off 给自报时刻加一个小偏移，模拟「贴着标签略走样」；
    motion_for 指定某些时刻的回执运动强度（考峰值传播）。
    """

    def __init__(self, skip=(), fake=(), echo_off=0.0, motion_for=None):
        self.skip, self.fake, self.echo_off = set(skip), list(fake), echo_off
        self.motion_for = motion_for or {}
        self.requests: list[dict] = []

    def call(self, request: dict):
        self.requests.append(request)
        ts = _requested_ts(request)
        wanted = [t for t in ts if t not in self.skip] if len(ts) > 1 else ts
        recs = [_rec(t + self.echo_off, motion=self.motion_for.get(t, "低"))
                for t in wanted]
        recs += [_rec(t) for t in self.fake]
        return fenced_json({"frames": recs}), "stop"


class _TruncatingTransport:
    """坏引擎替身：多帧批永远回半截 JSON＋finish='length'，单帧批正常作答。"""

    def __init__(self):
        self.batch_sizes: list[int] = []

    def call(self, request: dict):
        n = _n_images(request)
        self.batch_sizes.append(n)
        if n > 1:
            return ('{"frames": [{"t": 0', "length")   # 墨水用尽的半截
        t = _requested_ts(request)[0]
        return fenced_json({"frames": [_rec(t)]}), "stop"


class _CursedFrameTransport:
    """顽固失败替身：批里含 cursed 帧就漏掉它；只剩它一帧时罢工。"""

    def __init__(self, cursed: float):
        self.cursed = cursed

    def call(self, request: dict):
        wanted = [t for t in _requested_ts(request) if t != self.cursed]
        if not wanted:
            raise ChatError(f"t={self.cursed}s 这一帧永远失败")
        return fenced_json({"frames": [_rec(t) for t in wanted]}), "stop"


# ---- 里程碑 1a：正常批一次成卡，请求里标签先行、指令收尾 ----

def test_normal_batch_makes_cards_in_one_call():
    ts = [0.0, 2.0, 4.0]
    transport = _AnsweringTransport()
    cards = build_frame_cards(_no_sleep_client(transport), _frames(ts), batch=3)
    assert len(transport.requests) == 1            # 一批 3 帧，一次调用成卡
    assert sorted(cards) == ts
    assert all(isinstance(c, FrameCard) for c in cards.values())
    card = cards[2.0]
    assert (card.t, card.scene, card.summary, card.keywords) == (
        2.0, "走廊", "画面摘要", ["走廊"])
    assert (card.ocr, card.event, card.motion) == ("", "无变化", "低")
    user = transport.requests[0]["messages"][-1]["content"]
    kinds = [b["type"] for b in user]
    assert kinds == ["text", "image_url"] * 3 + ["text"]   # 每帧：标签在前、图随后
    assert user[0]["text"] == "[t=0.0s]" and user[4]["text"] == "[t=4.0s]"
    assert user[-1]["text"] == "请输出 t=0.0s 至 t=4.0s（共3帧）每一帧的 JSON 记录。"
    assert transport.requests[0]["reasoning_effort"] == "low"   # 批量打标用最省档
    assert transport.requests[0]["response_format"] == {"type": "json_object"}


def test_batch_param_chunks_the_frames():
    ts = [float(i) for i in range(5)]
    transport = _AnsweringTransport()
    cards = build_frame_cards(_no_sleep_client(transport), _frames(ts), batch=2)
    assert [_n_images(r) for r in transport.requests] == [2, 2, 1]  # 按批切：2+2+1
    assert sorted(cards) == ts


def test_batch_must_be_positive():
    with pytest.raises(ValueError):
        build_frame_cards(_no_sleep_client(_AnsweringTransport()),
                          _frames([0.0]), batch=0)


# ---- 里程碑 1b：复用对半拆批纪律——截断、漏帧、编造时刻 ----

def test_truncation_splits_halving_until_single_frame():
    ts = [float(i) for i in range(20)]
    transport = _TruncatingTransport()
    cards = build_frame_cards(_no_sleep_client(transport), _frames(ts))
    assert transport.batch_sizes[0] == 20         # 先整批上
    assert transport.batch_sizes[:4] == [20, 10, 5, 2]   # 逐轮对半
    assert transport.batch_sizes.count(1) == 20   # 拆到头：每帧都单独问过一次
    assert sorted(cards) == ts                    # 一帧不少


def test_missing_frames_recurse_only_on_the_missing():
    ts = [0.0, 2.0, 4.0]
    transport = _AnsweringTransport(skip=[2.0])   # 第一轮漏了 t=2.0s
    cards = build_frame_cards(_no_sleep_client(transport), _frames(ts), batch=3)
    assert len(transport.requests) == 2           # 只补查漏帧
    assert _requested_ts(transport.requests[1]) == [2.0]
    assert sorted(cards) == ts


def test_hallucinated_far_timestamp_is_dropped():
    ts = [0.0, 2.0, 4.0]
    transport = _AnsweringTransport(fake=[999.0])  # 模型编造了 t=999.0s
    cards = build_frame_cards(_no_sleep_client(transport), _frames(ts), batch=3)
    assert sorted(cards) == ts                     # 编造时刻不进卡
    assert 999.0 not in cards


def test_sloppy_echo_snaps_to_nearest_sent_frame():
    ts = [0.0, 2.0]
    transport = _AnsweringTransport(echo_off=0.2)  # 自报 0.2 / 2.2
    cards = build_frame_cards(_no_sleep_client(transport), _frames(ts), batch=2)
    assert sorted(cards) == ts                     # 各自贴回最近的送审帧


# ---- 里程碑 1c：顽固帧拿诚实的兜底卡，不中断整段 ----

def test_stubborn_frame_gets_honest_fallback_card():
    ts = [0.0, 2.0, 4.0]
    client = _no_sleep_client(_CursedFrameTransport(cursed=2.0))
    cards = build_frame_cards(client, _frames(ts), batch=3)
    assert sorted(cards) == ts                     # 没有异常，一帧不缺席
    assert cards[0.0].summary == "画面摘要"
    weak = cards[2.0]
    assert (weak.scene, weak.summary, weak.keywords) == ("", "", [])
    assert (weak.ocr, weak.event, weak.motion) == ("", "", "低")  # 弱卡不冒充好卡


def test_normalize_frame_card_whitelist_and_clamps():
    card = normalize_frame_card(
        {"scene": "  走廊 " + "长" * 80, "summary": "  摘要  ",
         "keywords": ["a", "", " b ", *["词"] * 10],
         "ocr": "出口", "event": "有人进门", "motion": "剧烈"},
        t=6.0,
    )
    assert card.t == 6.0                           # 时刻以送审标签为准，不信自报
    assert card.scene == "走廊 " + "长" * 57       # 钳到 60 字
    assert card.summary == "摘要"
    assert card.keywords == ["a", "b"] + ["词"] * 6  # 去空、封顶 8 条
    assert card.motion == "低"                     # 白名单外归「低」
    empty = normalize_frame_card("模型撒泼了", t=9.0)
    assert (empty.scene, empty.summary, empty.keywords) == ("", "", [])
    assert (empty.ocr, empty.event, empty.motion) == ("", "", "低")


# ---- 里程碑 2：75 秒素材按 30 秒聚合恰为 3 段且边界正确 ----

def test_75s_material_is_exactly_three_segments():
    ts = [0.0, 10.0, 29.5, 30.0, 45.0, 59.9, 60.0, 74.0]  # 75 秒素材的帧
    segs = aggregate_segments({t: _card(t) for t in ts}, seg=30.0)
    assert len(segs) == 3
    assert [(s.start, s.end) for s in segs] == [
        (0.0, 30.0), (30.0, 60.0), (60.0, 90.0)]
    assert segs[0].frame_ts == [0.0, 10.0, 29.5]   # 边界前的最后一帧归第一段
    assert segs[1].frame_ts == [30.0, 45.0, 59.9]  # 整 30 秒归第二段，不归第一段
    assert segs[2].frame_ts == [60.0, 74.0]


def test_peak_motion_is_the_segment_max():
    cards = {
        0.0: _card(0.0, motion="低"), 2.0: _card(2.0, motion="中"),
        30.0: _card(30.0, motion="低"), 32.0: _card(32.0, motion="高"),
        34.0: _card(34.0, motion="中"), 60.0: _card(60.0, motion="低"),
    }
    segs = aggregate_segments(cards, seg=30.0)
    assert [s.peak_motion for s in segs] == ["中", "高", "低"]  # 一张「高」即封顶


def test_segment_summary_concatenates_and_dedupes():
    cards = {
        0.0: _card(0.0, summary="主角进门"),
        2.0: _card(2.0, summary="主角进门"),   # 相邻帧写了同一条摘要
        4.0: _card(4.0, summary="走向道具"),
        30.0: _card(30.0, summary=""),
    }
    segs = aggregate_segments(cards, seg=30.0)
    assert segs[0].summary == "主角进门；走向道具"  # 按时刻串联、重复只留一次
    assert segs[1].summary == ""                    # 全空就诚实为空


def test_segment_keywords_rank_by_frequency_and_cap():
    cards = {
        0.0: _card(0.0, keywords=["走廊", "门"]),
        2.0: _card(2.0, keywords=["走廊", "灯"]),
        4.0: _card(4.0, keywords=["走廊", "门"]),
        6.0: _card(6.0, keywords=[f"词{i}" for i in range(10)]),
    }
    seg = aggregate_segments(cards, seg=30.0)[0]
    assert seg.keywords[:3] == ["走廊", "门", "灯"]  # 高频在前；同频保持首见顺序
    assert len(seg.keywords) == 8                    # 封顶 8 条


def test_aggregate_rejects_nonpositive_seg():
    with pytest.raises(ValueError):
        aggregate_segments({0.0: _card(0.0)}, seg=0)
    assert aggregate_segments({}) == []              # 空卡集：没有段，不报错


# ---- 端到端：合成片抽帧 → 成卡 → 聚合，微观层的钩子就绪 ----

def test_clip_frame_cards_then_segments_end_to_end():
    clip = make_clip()
    sampled = extract_frames(clip, fps=0.5)          # 常规链路：31 帧，t=0,2,…,60
    ts = [f.t for f in sampled]
    transport = _AnsweringTransport(
        motion_for={t: "高" for t in ts if EVENT[0] <= t < EVENT[1]})
    cards = build_frame_cards(_no_sleep_client(transport), sampled, batch=20)
    assert len(transport.requests) == 2              # 31 帧：20+11 两批
    assert sorted(cards) == ts                       # 一帧不缺席
    segs = aggregate_segments(cards, seg=30.0)
    assert [(s.start, s.end) for s in segs] == [
        (0.0, 30.0), (30.0, 60.0), (60.0, 90.0)]
    assert 32.0 in segs[1].frame_ts                  # 「高」帧落进第二段
    assert segs[1].peak_motion == "高"               # 微观层要的钩子：峰值可查
    assert segs[0].peak_motion == "低" and segs[2].peak_motion == "低"
