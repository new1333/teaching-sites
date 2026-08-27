"""video.py —— 把「视频」翻译成「带时间标签的帧序列」。

视觉模型没有播放器：它看视频，看的是一叠抽出来的静止图片。
这一章做三件本地的事，一分钱不花：
1. 定密度：按时长选采样档（越长的视频越经不起密采）；
2. 抽帧：按密度在真相帧上挑选，时刻标签取最近的真帧；
3. 找切点：相邻帧画面突变过线即报一次场景切换。
两条声明过的简化：
1. FrameSource 用字符位图当帧、每 0.5 秒一张真相帧——真实世界是
   mp4 文件加 ffmpeg 抽帧，原理同构（按 fps 挑帧、贴最近真帧时刻）；
2. 突变分是「格点变化占比」——真实工具在像素域算画面变化分，
   分数与阈值含义一致，公式不同。
"""
from __future__ import annotations

from bisect import bisect_left
from dataclasses import dataclass
from itertools import pairwise

from vision_rag.bitmap import Bitmap

# ---- 密度分档：时长越长，每秒帧数越低 ----
FPS_TIERS = ((60.0, 1.0), (600.0, 0.5), (1800.0, 0.25))  # (时长上限秒, fps)
FPS_LONG = 0.1  # 超过 1800 秒的长片：10 秒 1 帧

# ---- 合成素材的编排表 ----
CLIP_W, CLIP_H = 40, 12    # 帧画面：40×12 的字符网格
CLIP_DURATION = 61.0       # 总长 61 秒：刚好跨过 60 秒的分档线
CLIP_STEP = 0.5            # 真相帧每 0.5 秒一张（真实视频是每秒 24~30 张）
CLIP_EVENT = (31.0, 34.0)  # 3 秒快速动作：1fps 必抽到，0.1fps 必漏掉
_CLIP_SCENES = (
    # (场景名, 起始秒, 边框字符, 地面字符, 道具字符, 道具所在列)
    ("走廊", 0.0, "#", " ", "D", 4),
    ("车间", 25.0, "=", ".", "M", 33),
    ("院子", 45.0, "%", "~", "T", 35),
)


@dataclass
class Frame:
    """一帧画面加它的时刻标签：视频世界里的「页」。

    scene 与 motion 是素材自带的真相标注（真实视频只有像素，
    这两个字段得靠模型看图打标——下一章的事）。
    """

    t: float        # 时刻（秒）：这一帧在时间轴上的位置
    bitmap: Bitmap  # 画面本身：字符网格
    scene: str      # 场景名（真相标注）：画面发生在哪
    motion: str     # 运动强度（真相标注）：低 / 中 / 高


class FrameSource:
    """一段视频：总时长 + 全部真相帧（按 t 升序）。

    真实世界里它是 mp4 文件；实验场里它是一叠排好队的 Bitmap。
    抽帧只在这些真帧里挑选，不凭空造画面——这是「采样」二字的本义。
    """

    def __init__(self, duration: float, frames: list[Frame]):
        if duration <= 0:
            raise ValueError(f"duration 必须为正数，收到 {duration}")
        if not frames:
            raise ValueError("视频至少要有一帧")
        ts = [f.t for f in frames]
        if any(later <= earlier for earlier, later in pairwise(ts)):
            raise ValueError("真相帧必须按 t 升序排列，且时刻不重复")
        if ts[0] < 0 or ts[-1] >= duration:
            raise ValueError(
                f"帧时刻必须落在 [0, duration) 内：首帧 {ts[0]}，末帧 {ts[-1]}")
        self.duration = duration
        self.frames = list(frames)


def auto_fps(duration: float) -> float:
    """按时长选采样密度：≤60 秒 1fps；≤10 分钟 0.5；≤30 分钟 0.25；更长 0.1。

    越长的视频越经不起密采：600 秒 1fps 就是 600 帧、几百次模型调用。
    密度随时长降档，把宏观通读的帧数摁在分钟级素材一两百张、小时级几百张的量级——
    分界值是工程约定，不是物理定律。
    """
    if duration <= 0:
        raise ValueError(f"duration 必须为正数，收到 {duration}")
    for limit, fps in FPS_TIERS:
        if duration <= limit:
            return fps
    return FPS_LONG


def extract_frames(source: FrameSource, fps: float) -> list[Frame]:
    """按密度采样：理想时刻 k/fps，取离它最近的真帧，标签即该帧的 t。

    采样不造画面——理想时刻落在两个真帧之间时，贴的是最近真帧的
    时刻，误差不超过半个真相帧间隔；同一张真帧不会被采两次；理想时刻
    与两张真帧等距时取先到的那张（时刻宁早不晚报）。
    """
    if fps <= 0:
        raise ValueError(f"fps 必须为正数，收到 {fps}")
    ts = [f.t for f in source.frames]
    step = 1.0 / fps
    picked: list[Frame] = []
    used: set[int] = set()
    k = 0
    while k * step < source.duration - 1e-9:
        ideal = k * step
        i = min(bisect_left(ts, ideal), len(ts) - 1)
        if i > 0 and ideal - ts[i - 1] <= ts[i] - ideal:
            i -= 1                            # 平手算前者：取先到的真帧
        if i not in used:
            used.add(i)
            picked.append(source.frames[i])
        k += 1
    return picked


def _change_score(a: Bitmap, b: Bitmap) -> float:
    """相邻两帧的画面突变分：变化的格点占全部格点的比例（0 到 1）。

    画布尺寸都变了就记满分 1.0——整个画面都换了。
    """
    if (a.width, a.height) != (b.width, b.height):
        return 1.0
    diff = sum(1 for ra, rb in zip(a.rows, b.rows)
               for ca, cb in zip(ra, rb) if ca != cb)
    return diff / (a.width * a.height)


def detect_scene_cuts(frames: list[Frame], threshold: float = 0.3) -> list[float]:
    """本地场景切换检测：只看画面，不读 scene 标签。

    相邻采样帧的画面突变分过线（≥ threshold）即判一次切换，切点时刻
    报「新场景的第一个采样帧」——精度受采样密度限制。真实工具同一
    思路：给相邻帧算一个画面变化分、过一个阈值（如 ffmpeg 的 scene
    分数配 select 过滤），阈值是旋钮不是圣旨。
    """
    if not 0 < threshold <= 1:
        raise ValueError(f"threshold 必须落在 (0, 1] 内，收到 {threshold}")
    cuts: list[float] = []
    for prev, cur in pairwise(frames):
        if _change_score(prev.bitmap, cur.bitmap) >= threshold:
            cuts.append(cur.t)
    return cuts


def _clip_scene(t: float) -> tuple:
    """t 时刻的场面参数：场景名、边框、地面、道具、道具所在列。"""
    spec = _CLIP_SCENES[0]
    for candidate in _CLIP_SCENES:
        if t >= candidate[1]:
            spec = candidate
    return spec


def _person_at(t: float) -> tuple[str, int]:
    """主角的字符与列位置：平时每秒挪 1 格；事件那 3 秒每秒冲 6 格。"""
    start, end = CLIP_EVENT
    if start <= t < end:
        return "X", 1 + min(int((t - start) * 6), CLIP_W - 4)
    return "o", 1 + int(t) % (CLIP_W - 2)


def _draw_clip_frame(t: float) -> Bitmap:
    """画 t 时刻的一帧：边框压顶底、地面铺满、道具立柱、主角走近景。"""
    _, _, border, floor, prop, prop_col = _clip_scene(t)
    rows = [border * CLIP_W for _ in range(CLIP_H)]
    for y in range(1, CLIP_H - 1):
        row = floor * CLIP_W
        rows[y] = row[:prop_col] + prop + row[prop_col + 1:]
    char, col = _person_at(t)
    line = rows[CLIP_H - 3]                  # 主角走在近景那行
    rows[CLIP_H - 3] = line[:col] + char + line[col + 1:]
    return Bitmap(rows)


def make_clip() -> FrameSource:
    """课程自产示例视频：61 秒、三个场面、两次切换、一次 3 秒快速动作。

    事件窗口 (31, 34) 恰好躲开 0.1fps 的全部采样时刻（0/10/20/…秒），
    又必然含住 1fps 的三个整秒（31/32/33）——同一素材，密度定生死，
    漏检是每次重跑都复现的事实，不是随机抖动。
    """
    frames = []
    for i in range(int(CLIP_DURATION / CLIP_STEP)):
        t = i * CLIP_STEP
        motion = "高" if CLIP_EVENT[0] <= t < CLIP_EVENT[1] else "低"
        frames.append(Frame(t=t, bitmap=_draw_clip_frame(t),
                            scene=_clip_scene(t)[0], motion=motion))
    return FrameSource(duration=CLIP_DURATION, frames=frames)
