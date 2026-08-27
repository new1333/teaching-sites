"""第 9 章测试：按时长定密度——视频宏观抽帧。

对应大纲 milestone 的断言：
1. 四档密度自动选择：auto_fps 在 60 / 600 / 1800 秒三个分界两侧各归其档；
2. 采样帧标签取最近真帧：理想时刻 k/fps 落在哪张真帧附近，标签就是那帧的 t；
3. 同一素材两个密度一对比：3 秒事件以 1fps 必被抽到、以 0.1fps 必被漏掉
   ——遗漏不是随机抖动，是可复现的事实；
4. 场景切换在合成素材的两个切点处被本地检出——检测只看画面，不读真相标签。
"""
from itertools import pairwise

import pytest

from vision_rag.bitmap import Bitmap
from vision_rag.video import (
    Frame,
    FrameSource,
    auto_fps,
    detect_scene_cuts,
    extract_frames,
    make_clip,
)

EVENT = (31.0, 34.0)  # 合成素材里那次 3 秒快速动作的起止秒


def _in_event(frames: list) -> list:
    return [f for f in frames if EVENT[0] <= f.t < EVENT[1]]


def _still() -> Bitmap:
    """一张随手的小画面：2×2 网格。"""
    return Bitmap(["..", ".."])


# ---- 四档密度：auto_fps 按时长选档 ----

def test_auto_fps_picks_tier_by_duration():
    assert auto_fps(30) == 1.0        # 短片：每秒 1 帧
    assert auto_fps(60) == 1.0        # 60 秒整还归第一档
    assert auto_fps(61) == 0.5        # 过线即降档
    assert auto_fps(600) == 0.5
    assert auto_fps(601) == 0.25
    assert auto_fps(1800) == 0.25
    assert auto_fps(1801) == 0.1      # 长片：10 秒 1 帧
    assert auto_fps(make_clip().duration) == 0.5  # 61 秒素材归第二档而非第一档


def test_auto_fps_rejects_nonpositive_duration():
    with pytest.raises(ValueError):
        auto_fps(0)
    with pytest.raises(ValueError):
        auto_fps(-3)


# ---- 合成素材：61 秒、三场面两次切换、一次 3 秒事件 ----

def test_make_clip_is_the_promised_material():
    clip = make_clip()
    assert clip.duration == 61.0
    ts = [f.t for f in clip.frames]
    assert ts[0] == 0.0 and ts[-1] == 60.5
    assert all(b > a for a, b in pairwise(ts))  # 真相帧按 t 升序
    switches = [cur.t for prev, cur in pairwise(clip.frames)
                if cur.scene != prev.scene]
    assert switches == [25.0, 45.0]                # 恰好两次场景切换
    highs = [f.t for f in clip.frames if f.motion == "高"]
    assert highs and all(EVENT[0] <= t < EVENT[1] for t in highs)
    assert all(f.motion == "低" for f in clip.frames
               if not EVENT[0] <= f.t < EVENT[1])  # 事件之外一概低强度


# ---- 抽帧：帧数随密度、标签取最近真帧 ----

def test_extract_frames_counts_follow_density():
    clip = make_clip()
    dense = extract_frames(clip, fps=1.0)    # 61 秒 × 每秒 1 帧
    mid = extract_frames(clip, fps=0.5)
    sparse = extract_frames(clip, fps=0.1)
    assert [f.t for f in dense] == [float(i) for i in range(61)]
    assert [f.t for f in mid] == [float(i) for i in range(0, 61, 2)]
    assert [f.t for f in sparse] == [0.0, 10.0, 20.0, 30.0, 40.0, 50.0, 60.0]


def test_extract_frames_label_is_nearest_truth_frame():
    # 手工小素材：真帧只有 0.2 / 1.7 / 3.1 秒三张
    bm = _still()
    src = FrameSource(duration=4.0, frames=[
        Frame(t=0.2, bitmap=bm, scene="a", motion="低"),
        Frame(t=1.7, bitmap=bm, scene="a", motion="低"),
        Frame(t=3.1, bitmap=bm, scene="a", motion="低"),
    ])
    picked = extract_frames(src, fps=0.5)    # 理想时刻 0 秒和 2 秒
    assert [f.t for f in picked] == [0.2, 1.7]  # 0 贴最近的 0.2；2 贴最近的 1.7


def test_extract_frames_tie_prefers_earlier_and_no_repeat():
    bm = _still()
    src = FrameSource(duration=5.0, frames=[
        Frame(t=0.0, bitmap=bm, scene="a", motion="低"),
        Frame(t=2.0, bitmap=bm, scene="a", motion="低"),
        Frame(t=4.0, bitmap=bm, scene="a", motion="低"),
    ])
    picked = extract_frames(src, fps=1.0)    # 理想时刻 0..4 秒，逢平手取前者
    assert [f.t for f in picked] == [0.0, 2.0, 4.0]  # 同一张真帧不采两次


def test_extract_frames_rejects_nonpositive_fps():
    with pytest.raises(ValueError):
        extract_frames(make_clip(), fps=0.0)


# ---- 两个密度一对比：3 秒事件的抽到与漏掉都是可复现事实 ----

def test_three_second_event_caught_dense_missed_sparse():
    clip = make_clip()
    dense, sparse = extract_frames(clip, fps=1.0), extract_frames(clip, fps=0.1)
    caught = _in_event(dense)
    assert [f.t for f in caught] == [31.0, 32.0, 33.0]  # 1fps：3 秒窗口必有整秒落网
    assert all(f.motion == "高" for f in caught)
    assert _in_event(sparse) == []            # 0.1fps：事件整个落在两帧之间
    assert all(f.motion == "低" for f in sparse)  # 漏掉的运动一帧都没带回来


# ---- 场景切换：本地检出两个切点，只看画面 ----

def test_scene_cuts_found_at_both_switches():
    clip = make_clip()
    mid = extract_frames(clip, fps=auto_fps(clip.duration))  # 常规链路：0.5fps
    assert detect_scene_cuts(mid) == [26.0, 46.0]  # 报新场景首个采样帧，误差 ≤ 2 秒
    dense = extract_frames(clip, fps=1.0)
    assert detect_scene_cuts(dense) == [25.0, 45.0]  # 密度加倍，切点时刻精确到秒


def test_scene_cuts_read_pixels_not_labels():
    white = Bitmap(["  ", "  "])    # 全空白的 2×2 画面
    dark = Bitmap(["##", "##"])     # 全涂黑的 2×2 画面
    frames = [
        Frame(t=0.0, bitmap=white, scene="厨房", motion="低"),
        Frame(t=1.0, bitmap=white, scene="街道", motion="低"),  # 标签换了，画面没换
        Frame(t=2.0, bitmap=dark, scene="街道", motion="低"),   # 标签没换，画面换了
    ]
    assert detect_scene_cuts(frames) == [2.0]  # 检测只认画面突变，标签说了不算


def test_scene_cuts_threshold_is_the_knob():
    one = Bitmap(["ab", "cd"])
    quarter = Bitmap(["ab", "ce"])  # 4 格换 1 格 → 突变分 0.25
    half = Bitmap(["ab", "wx"])     # 4 格换 2 格 → 突变分 0.5
    frames = [
        Frame(t=0.0, bitmap=one, scene="a", motion="低"),
        Frame(t=1.0, bitmap=quarter, scene="a", motion="低"),
        Frame(t=2.0, bitmap=half, scene="a", motion="低"),
    ]
    assert detect_scene_cuts(frames) == [2.0]           # 默认 0.3：0.25 不过线、0.5 过线
    assert detect_scene_cuts(frames, threshold=0.6) == []  # 旋钮拧紧：0.5 也不再报
    with pytest.raises(ValueError):
        detect_scene_cuts(frames, threshold=0.0)
    with pytest.raises(ValueError):
        detect_scene_cuts(frames, threshold=1.5)


# ---- FrameSource 的入口纪律 ----

def test_frame_source_validates_truth():
    bm = _still()
    with pytest.raises(ValueError):
        FrameSource(duration=0.0, frames=[Frame(t=0.0, bitmap=bm, scene="a", motion="低")])
    with pytest.raises(ValueError):
        FrameSource(duration=1.0, frames=[])
    with pytest.raises(ValueError):  # 时刻必须升序
        FrameSource(duration=2.0, frames=[
            Frame(t=1.0, bitmap=bm, scene="a", motion="低"),
            Frame(t=0.5, bitmap=bm, scene="a", motion="低"),
        ])
    with pytest.raises(ValueError):  # 末帧必须落在时长之内
        FrameSource(duration=1.0, frames=[Frame(t=1.5, bitmap=bm, scene="a", motion="低")])
