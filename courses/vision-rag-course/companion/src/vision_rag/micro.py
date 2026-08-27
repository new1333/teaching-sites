"""micro.py —— 微观放大层：可疑的时间窗，拉近了重看一遍。

第 9–11 章的漏斗是望远镜：按时长定密度、宏观通读一遍，答得出
「推搡在 [00:31]」——3 秒的事件宏观密度接得住。接不住的是亚秒级
动作：0.5fps 的帧间隔 2 秒，300 毫秒的按键正好落在两帧之间，
深读只能诚实地说「画面中没有看到」。这一章补第二级采样：
1. 触发：动作类问题（词表命中）或手动指定，才值得拉近重看；
2. 定窗：运动峰值帧 ±1.5 秒——第 10 章帧卡里的 motion 字段在这里兑现；
3. 重抽：窗口内按 12fps 高密度重采，首帧全图锚点、其余中心裁切；
4. 追加一次模型分析（effort=high），要点挂在 [MM:SS] 上。
两条声明过的简化：
1. 真相帧每 0.5 秒一张——12fps 的理想时刻全部贴到最近的真帧上，
   去重后窗口内每 0.5 秒一帧，已是素材密度的上限（采样不造画面）；
   真实视频每秒 24~30 张，12fps 帧帧落在不同的真帧上；
2. 「放大」即中心裁切本身：同样的分辨率只花在画面中央。真实工具
   裁切后还会放大回原尺寸（插值补像素）；字符网格不插值。
"""
from __future__ import annotations

from dataclasses import dataclass

from vision_rag.bitmap import Bitmap
from vision_rag.client import img_block
from vision_rag.pipeline import DEEP_MAX_TOKENS, TRUNCATION_NOTE
from vision_rag.video import Frame, FrameSource, extract_frames
from vision_rag.video_index import MOTIONS

MICRO_FPS = 12.0        # 微观重抽密度：亚秒动作的救命密度（真实工具同款量级）
MICRO_HALF = 1.5        # 峰值两侧各看多少秒：3 秒窗口，旋钮可调
MICRO_CROP_SIZE = (28, 8)  # 40×12 的帧裁成 28×8：主角行走行与道具列都留在框内

ACTION_WORDS = frozenset({
    "按下", "按钮", "点击", "敲", "抓", "拿起", "放下", "举起", "挥", "甩",
    "指了", "瞄准", "出手", "落点", "瞬间", "刹那", "快速", "动作", "细节", "轨迹",
})
# 词表刻意不含「推搡」一类持续数秒的事件——宏观密度接得住的，不劳微观层。

MICRO_SYSTEM = """你是视频微观动作分析助手。你会看到一个约三秒的时间窗口以 {fps:.0f}fps 高密度重抽的画面：第一张是全图锚点（先看清位置），其余是画面中心区域的放大帧，每帧前有 [t=Xs] 标签。
请专注分析窗口内的快速动作与细节：动作过程、先后顺序、位置变化。
要求：中文要点式，先给结论；每个论点后标 [MM:SS] 时刻，只能取你看过的帧标签附近；看不清的就明说看不清，不要编造。"""


def is_action_question(question: str) -> bool:
    """动作类问题的闸门：问题里出现动作词表里的任一词即触发。

    词面判断是声明的简化——「他的手部小动作」命中，「手势含义」不命中；
    词表是旋钮不是圣旨，按业务往里添。触发只决定「要不要拉近重看」，
    不影响宏观漏斗本身：没触发，答案照出。
    """
    return any(word in question for word in ACTION_WORDS)


def motion_peak_window(frame_cards: dict, half: float = MICRO_HALF) -> tuple[float, float]:
    """运动峰值窗口：运动强度最高的帧卡时刻 ±half，起点收口到 0。

    第 10 章在帧卡里埋的 motion 字段在这里兑现：峰值帧是「最值得拉近
    看的时刻」。多帧并列最高时取最早——先到的峰值不被后来者顶掉。
    上端不封口：片长不在帧卡里，duration 一端的收口由 extract_micro
    对着 source 完成（两处合起来才是「clamp 到 [0, duration]」）。
    """
    if not frame_cards:
        raise ValueError("frame_cards 不能为空：定位运动峰值至少要有一张帧卡")
    if half < 0:
        raise ValueError(f"half 不能为负，收到 {half}")
    peak_t: float | None = None
    peak_rank = -1
    for t in sorted(frame_cards):
        motion = frame_cards[t].motion
        rank = MOTIONS.index(motion) if motion in MOTIONS else 0  # 白名单外归最低
        if rank > peak_rank:
            peak_rank, peak_t = rank, t
    assert peak_t is not None                      # 非空字典必能选出峰值
    return (max(0.0, peak_t - half), peak_t + half)


@dataclass
class MicroFrame:
    """微观序列里的一帧：画面＋时刻＋是否为中心裁切的放大帧。

    cropped=False 的只有首帧（全图锚点）——防止只看放大画面丢失
    位置感：先看自己在哪，再看细节。
    """

    t: float        # 时刻（秒）：来自窗口内真相帧的原生标签
    bitmap: Bitmap  # 画面：锚点为全图，其余为中心裁切的放大帧
    cropped: bool   # True＝中心裁切的放大帧；False＝全图锚点


def extract_micro(source: FrameSource, center: float,
                  fps: float = MICRO_FPS, half: float = MICRO_HALF) -> list[MicroFrame]:
    """窗口内高密度重抽：center ±half 先 clamp 到片长，再按 fps 采真相帧。

    首帧全图锚点 cropped=False，其余中心裁切 cropped=True——裁切尺寸
    MICRO_CROP_SIZE 是素材构图决定的旋钮：主角的行走行、事件道具的
    所在列都得留在框内。窗口内没有真相帧时返回空序列（无从放大）。
    """
    if fps <= 0:
        raise ValueError(f"fps 必须为正数，收到 {fps}")
    if half < 0:
        raise ValueError(f"half 不能为负，收到 {half}")
    if not 0 <= center < source.duration:
        raise ValueError(f"center 必须落在 [0, {source.duration}) 内，收到 {center}")
    a = max(0.0, center - half)
    b = min(source.duration, center + half)
    window = [f for f in source.frames if a <= f.t < b]
    if not window:
        return []
    # FrameSource 只认 [0, duration) 内的时刻：窗口帧平移成相对时刻送进去
    # （第 9 章的采样纪律——最近真帧、不重复、平手取先——原样复用），
    # 采完再平移回绝对时刻，标签不因换坐标系而失真。
    shifted = [Frame(t=f.t - a, bitmap=f.bitmap, scene=f.scene, motion=f.motion)
               for f in window]
    picked = extract_frames(FrameSource(duration=b - a, frames=shifted), fps)
    crop_w, crop_h = MICRO_CROP_SIZE
    out: list[MicroFrame] = []
    for i, f in enumerate(picked):
        anchor = i == 0                            # 首帧全图：位置感从这里来
        out.append(MicroFrame(
            t=f.t + a,
            bitmap=f.bitmap if anchor else f.bitmap.center_crop(crop_w, crop_h),
            cropped=not anchor,
        ))
    return out


def _as_window(window) -> tuple[float, float]:
    """校验调用方给的时间窗：形如 (起点, 终点)、起点不早于 0、起点早于终点。"""
    if not isinstance(window, (tuple, list)) or len(window) != 2:
        raise ValueError(f"window 必须是 (起点, 终点) 二元组，收到 {window!r}")
    a, b = window
    if not 0 <= a < b:
        raise ValueError(f"window 必须满足 0 ≤ 起点 < 终点，收到 ({a}, {b})")
    return float(a), float(b)


def run_micro(client, source: FrameSource, window, question: str) -> str:
    """微观层的一次完整追加：窗口内重抽，锚点＋放大帧序列交模型出要点分析。

    窗口来自 motion_peak_window（或手动指定）；effort=high 对齐深读
    档位——这是第二次花大钱，只花在已被峰值指认的三秒上。触发与否
    的闸门在调用方（is_action_question）：本函数只管「拉近了怎么看」。
    截断照第 7 章注记；调用层罢工（重试耗尽）如实抛 ChatError，
    是否容错由调用方决定。
    """
    a, b = _as_window(window)
    frames = extract_micro(source, (a + b) / 2, fps=MICRO_FPS, half=(b - a) / 2)
    if not frames:
        raise ValueError(f"窗口 ({a}, {b}) 内没有真相帧，无从放大")
    anchor, *zoomed = frames
    blocks: list[dict] = []
    blocks += img_block(anchor.bitmap, f"[t={anchor.t:.1f}s 全图锚点]")
    for m in zoomed:
        blocks += img_block(m.bitmap, f"[t={m.t:.1f}s 放大]")
    blocks.append({"type": "text",
                   "text": f"时间窗 {a:.1f}s-{b:.1f}s，{MICRO_FPS:.0f}fps 重抽，"
                           f"共 {len(frames)} 帧（首帧全图锚点，其余中心放大）。\n"
                           f"用户问题：{question}"})
    text, finish = client.chat(blocks, system=MICRO_SYSTEM.format(fps=MICRO_FPS),
                               effort="high", max_tokens=DEEP_MAX_TOKENS)
    if finish == "length":
        text += TRUNCATION_NOTE                      # 截断要说破，不能装完整
    return text
