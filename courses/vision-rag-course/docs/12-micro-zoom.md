---
title: "再拉近一点：微观放大层"
---

# 再拉近一点：微观放大层

监控录像查到第 32 秒附近，你肉眼明明看见他伸手按了一下控制台。去问视觉大模型（看得见照片的那位远程助手，第 1 章的老朋友）：「他第几秒按下了按钮？」深读的回答很平静：「画面中没有看到按键动作。」模型既没偷懒也没瞎说——宏观采样 0.5fps，帧间隔整整 2 秒；那个按键动作从头到尾 300 毫秒，正好落在两帧之间。抽出来的帧里确实一张都没有它，第 7 章立的拒答纪律在这里如实兑现：没看到就说没看到。

直觉的修法马上冒出来：把全片提到 12fps 重抽重索引。帧数从 31 涨到 732，成卡、精排、深读全部重来，帧数与账单同步涨 24 倍——为了看清一个 300 毫秒的动作，重读整段视频。这一章做的是另一件事：只在疑点上换显微镜。

## 病根：望远镜接不住三百毫秒

先把责任划清。深读说「没看到」是诚实，不是故障；真正的瓶颈在采样那一层。第 9 章按时长分档，61 秒的素材落在 0.5fps 档——这个选择当时就算过账：密度翻倍，帧数翻倍，宏观通读的成本直接跟着涨。3 秒的推搡必然压住至少一个采样时刻，宏观接得住；300 毫秒的按键约只有帧间隔的七分之一，落进哪两个采样时刻之间都可能整段错过。**没抽到的画面，谁也读不到**——换更强的模型、提推理档位、加输出预算，都救不了素材里根本没有的帧。

修法一的账先摆出来：

```text
纸笔演算：全片 12fps 的账（61 秒素材）
  宏观现状：61 × 0.5 = 30.5 → 31 帧（0, 2, 4, …, 60 秒）
  全片 12fps：61 × 12 = 732 帧——密度 24 倍，帧数同比例
  这 732 帧要重走成卡 → 精排 → 深读全流程：为一个动作，重读整段视频
```

账算不下去，因为钱花错了地方：你只想看清某一个三秒，却为其余的五十八秒也付了显微镜的钱。修法二是两级采样，也就是本章要建的微观层（micro layer）——宏观采样之外再加的一级：平时用望远镜扫全景，发现可疑的时间窗，只对那几秒换显微镜重看一遍。成本漏斗的三层（粗筛、精排、深读）都住在宏观那半边；微观层是漏斗之外的追加级，不重读全书，只重读疑点。

省下多少，同样纸笔可算：

```text
纸笔演算：峰值窗口 12fps 的账（同一段素材）
  峰值窗口 3 秒：3 × 12 = 36 个理想采样时刻
  素材真相帧每 0.5 秒一张 → 理想时刻贴最近真帧、去重后 6 帧
  微观层全部开销：1 张全图锚点 + 5 张放大帧（共 6 图），一次追加分析
  732 帧对 6 张图：差着两个数量级
```

为什么 36 个理想时刻去重后只剩 6 帧？素材的真相帧本身每 0.5 秒一张，理想时刻再密也只能贴到这些真帧上——第 9 章立的铁律「采样不造画面」。这是本章声明的简化：真实视频每秒有 24 到 30 张真帧，12fps 帧帧落在不同的画面上，微观序列会是满满的 36 帧；实验场里 6 帧已是素材密度的上限，两级采样的结构不受影响。

## 三件新零件：闸门、窗口、放大镜

微观层不凭空启动，三个判断各有一个零件。

第一件，触发。不是每个问题都值得拉近——「车间里有哪些设备」用宏观帧答得很好。闸门是词面判断：问题里出现动作词表中的任一个词（按下、按钮、瞬间、轨迹……）才算动作类问题。这是声明的简化：词表会漏（「手势的含义」不含触发词）也可能多（「动作片场景」命中「动作」）。命不中就维持宏观答案，命中错了不过多拉近一次，代价可控；词表是旋钮，按业务往里添。有一处刻意为之：词表不含「推搡」——推搡持续数秒，宏观密度接得住，第 11 章已经答得很好；微观层只留给宏观注定接不住的亚秒动作。

第二件，定窗。拉近看哪几秒？第 10 章埋的钩子在这里兑现：段卡上的 peak_motion 告诉你哪一段值得拉近，帧卡上的 motion 进一步告诉你哪一帧是运动峰值——定窗用更细的那一层，窗口取峰值帧的 ±1.5 秒。纸笔推一遍落位：

```text
纸笔演算：峰值窗口（宏观 0.5fps，帧在偶数秒）
  事件 (31, 34) 内被抽到的帧：只有 32.0 一张——它就是运动峰值帧
  窗口 = 32.0 ± 1.5 = (30.5, 33.5)；起点 30.5 ≥ 0，不用收口
  窗口内的真相帧：30.5、31.0、31.5、32.0、32.5、33.0——六帧全进微观序列
```

两处细节：多帧并列最高时取最早，先到的峰值不被后来者顶掉；收口分两半——起点小于 0 在定窗这步收，片尾一端留到重抽那步对着片长收（帧卡里没有片长，两边合起来才是完整的收口）。

第三件，放大。拉近之后模型怎么「看得更清」？靠中心裁切（center crop）——把画面正中的一块挖出来单独送模型。原理是一笔分辨率预算的账：模型读一张图，能花的分辨率是有数的。全图 40 列宽时，每列分到预算的 1/40；裁出正中 28 列再送，同样的预算花在 28 列上，每列分到 1/28——**同样的分辨率花在更小的画面上，这就是放大**。裁得越狠，放得越大：

```text
纸笔演算：裁多大，放多大
  通用账：边长裁到一半 → 细节 ×2；裁到四成 → 细节 ×2.5
  本素材：40 列裁 28 列、12 行裁 8 行 → 线性放大约 1.4 倍
  若裁 20×6（边长一半）：细节 ×2，但主角行走行（第 9 行）出框，故事断了
  选定 28×8：裁切框从 (6, 2) 起，盖住列 6–33、行 2–9
    道具列 33 全程在框里；主角 32 秒起冲进框内
```

真实工具同向更进一步：裁完中心约四成，再放大两倍、约回到原尺寸八成（插值补像素）。实验场的字符网格不插值，裁出的 28×8 本身就是放大后的样子——这两条简化都登记在附录差异清单。

只剩一个问题：一连串放大画面，每张只看得见中央一角，模型很快会失去位置感——动作发生在画面哪个位置？人在朝哪边冲？解法是锚点帧——微观序列开头放的那张全图：先看自己在哪，再看细节，像放大镜旁边钉一张全景小地图。落到序列形状上：

```text
微观帧序列的形状（首帧锚点，其余放大）

  [t=30.5s 全图锚点]  40×12 全图——交代位置：人在哪、道具在哪
  [t=31.0s 放大]      28×8 中心——主角还在框外（锚点已交代他的位置）
  [t=31.5s 放大]      28×8
  [t=32.0s 放大]      28×8 ← 峰值帧：主角冲进框内
  [t=32.5s 放大]      28×8
  [t=33.0s 放大]      28×8
  尾块文本：时间窗、重抽密度、用户问题
```

本素材的编排恰好把锚点的用处演了个明白：31.0 与 31.5 两张放大帧里看不到主角——冲刺从画面边缘起，人还在裁切框之外。没有锚点，模型对着两张「空画面」只能瞎猜；有锚点，位置感不断线。**锚点帧防的是「看清了细节、丢了整个画面」**。

## 实验场：Bitmap 的两个裁切方法与 micro.py

老规矩，测试先行：tests/test_micro_zoom.py 的 13 个测试先写好、先跑出红，再让零件长出来转绿。第 3 章在 Bitmap 里预留的生长点这章兑现——crop 挖任意子图，center_crop 挖正中。

```python
# src/vision_rag/bitmap.py · crop / center_crop
    def crop(self, x: int, y: int, w: int, h: int) -> Bitmap:
        """挖出一块子位图：左上角 (x, y)（先列后行），宽高 w×h。

        越界、非正尺寸即 ValueError——画面之外的格子无从谈起。挖出的
        格点与原图逐字符相同：裁切只做减法，不造新画面（与抽帧的
        「采样不造画面」同一脾气）。
        """
        if w <= 0 or h <= 0:
            raise ValueError(f"裁切尺寸必须为正，收到 {w}×{h}")
        if x < 0 or y < 0 or x + w > self.width or y + h > self.height:
            raise ValueError(f"裁切区域越界：({x}, {y}) 起的 {w}×{h} "
                             f"超出 {self.width}×{self.height}")
        return Bitmap([row[x:x + w] for row in self.rows[y:y + h]])

    def center_crop(self, w: int, h: int) -> Bitmap:
        """挖出正中的一块：先算左上角偏移，再走 crop 的老路。

        余量为奇时偏左上——(width - w) // 2 向下取整，纸笔可复算，
        不掷硬币。w 或 h 超过原图即 ValueError：放大不归 Bitmap 管，
        「放大看」是把小块单独送模型、让同样的分辨率只花在细节上。
        """
        if w > self.width or h > self.height:
            raise ValueError(f"中心裁切尺寸不能超过原图：{w}×{h} "
                             f"超出 {self.width}×{self.height}")
        return self.crop((self.width - w) // 2, (self.height - h) // 2, w, h)
```

micro.py 的家底从一个词表开始——三个常量分别是重抽密度、窗口半径、裁切尺寸，全是旋钮：

```python
# src/vision_rag/micro.py · 常量 / ACTION_WORDS / MICRO_SYSTEM / is_action_question
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
```

定窗的零件只有十几行，读点在平手与收口的分工：

```python
# src/vision_rag/micro.py · motion_peak_window
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
```

重抽是本章的核心。窗口帧先平移成相对时刻，再复用第 9 章的 extract_frames——最近真帧、不重复、平手取先的采样纪律一行不重写；采完平移回绝对时刻，标签不因换坐标系而失真：

```python
# src/vision_rag/micro.py · MicroFrame / extract_micro
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
```

最后收口成一次模型调用。窗口先过校验——形如 (起点, 终点)、起点不早于 0、起点早于终点；手动指定窗口的人走的也是这同一扇门。effort 用 high 对齐深读档位：这是第二次花大钱，只花在已被峰值指认的三秒上。

```python
# src/vision_rag/micro.py · _as_window / run_micro
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
```

有一处与真实工具的差别要说破：真实工具里微观层是尽力而为——追加分析失败只记一条日志，主答案照常交付；实验场让 ChatError（重试耗尽）如实抛出，要不要兜住由调用方决定。组合方式也就一句话：ask_video 的答案在前，闸门命中就追加 run_micro 的分析在后。

## 亲手开机：一行命令，看窗口里的六帧

在 companion 目录下粘贴这一行（模型由剧本扮演——零密钥、零费用、结果确定）：

```bash
python -c "import sys; sys.path.insert(0, 'src'); from vision_rag.client import Client; from vision_rag.fake import ScriptedTransport; from vision_rag.micro import extract_micro, is_action_question, motion_peak_window, run_micro; from vision_rag.video import extract_frames, make_clip; from vision_rag.video_index import FrameCard; clip = make_clip(); cards = {f.t: FrameCard(t=f.t, scene=f.scene, summary='', keywords=[], ocr='', event='', motion=f.motion) for f in extract_frames(clip, 0.5)}; q = '他第几秒按下了按钮'; print('动作问题？', is_action_question(q)); w = motion_peak_window(cards); print('峰值窗口：', w); print('微观帧：', [(m.t, m.cropped) for m in extract_micro(clip, 32.0)]); print(run_micro(Client(ScriptedTransport([('要点：[00:32] 主角冲进画面中央，逼近道具。', 'stop')]), sleep=lambda s: None), clip, w, q))"
```

终端打出四行：

```text
动作问题？ True
峰值窗口： (30.5, 33.5)
微观帧： [(30.5, False), (31.0, True), (31.5, True), (32.0, True), (32.5, True), (33.0, True)]
要点：[00:32] 主角冲进画面中央，逼近道具。
```

对照开篇那句「没有看到」：同一个问题，现在峰值窗口 (30.5, 33.5) 盖住了运动峰值帧 32.0；序列首帧是 40×12 的全图锚点，其余五帧是 28×8 的中心放大；追加的分析带着 [00:32] 的时刻回来。想手动指定窗口的人不必经过峰值——run_micro 的第三个参数直接传 (起点, 终点)，校验与重抽走的是同一扇门。

## 验证：测试与门槛

本章 13 个测试锁四件事：

- 裁切三条：中心裁切的落点与尺寸（6×3 挖 4×2，得正中两行）；奇数余量偏左上；越界、负起点、非正尺寸、超原图各有 ValueError；
- 触发与定窗四条：痛点原句「他第几秒按下了按钮」命中，「推搡发生在什么时候」与设备类问题不命中；窗口恰为 (30.5, 33.5) 且盖住峰值帧；等级取高、平手取最早、下限收口到 0；空表与负半径拒收；
- 重抽三条：序列时刻恰为窗口内六帧、首帧锚点 40×12、其余 28×8 且逐字符等于该帧正中切片；窗口两端收口、片外中心与零密度拒收；同一窗口宏观 1 帧对微观 6 帧；
- run_micro 三条：非动作问题经闸门后零调用（空剧本为证）；请求形状（锚点标签打头、放大标签随后、档位 high、问题收尾）；截断注记与窗口校验。

双硬门槛（在 companion 目录下）：

```text
python -m ruff check src tests conftest.py   →  All checks passed!
python -m pytest -q                          →  141 passed（含本章新增 13 个）
```

前十一章的 128 个旧测试一行没动、照样全绿——公共 API 向后兼容的哨兵又添一岗。

## 收线：本章落成的东西

```text
本章落成的东西，后面谁在用

  Bitmap.crop / center_crop        位图世界的裁切原语：挖子图、挖正中，越界即拒
  ACTION_WORDS / is_action_question  触发闸门：动作类问题才值得拉近
  motion_peak_window               motion 字段的兑现处：峰值帧 ±1.5 秒定窗
  MicroFrame / extract_micro       两级采样的第二级：首帧锚点、其余中心放大
  run_micro                        追加的那次分析：锚点＋放大帧交模型，档位 high
```

开篇那句「画面中没有看到」，现在的完整链路是：宏观漏斗照常答题，闸门发现这是个动作问题，峰值窗口指认三秒，12fps 重抽加中心放大，追加一次显微镜级的分析。视觉侧的检索增强生成到此齐装：出处是 [MM:SS]，证据是切片范围，看不清的地方还有一次拉近重看。视频篇（第三部，第 9–12 章）收束在这里。

离开前自查四问：

- 全片 12fps 与峰值窗口 12fps 各产出多少帧？差距是几个数量级，钱省在哪一步？
- 中心裁切为什么等于放大？裁 20×6 与 28×8 各放大约几倍，本素材为什么选后者？
- 锚点帧防的是什么？31.0 与 31.5 两张放大帧里为什么看不到主角？
- 「推搡发生在什么时候」为什么不触发微观层？词面触发是精确判断还是声明的简化？

答得上来，微观层就通了。全书的代码手艺到此收笔：下一步不再写新零件，而是换一台引擎重跑旧零件——移植差异与双引擎互验在第 13 章，把整套脚本变成 AI 助手会自动调用的 skill 在第 14 章。地图走到边了。
