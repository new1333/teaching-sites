---
title: "帧卡片与段聚合：把几百帧收进抽屉"
---

# 帧卡片与段聚合：把几百帧收进抽屉

把上一章抽出的帧逐一送模型打成卡之后，索引里躺着的其实是：10 分钟的监控按 0.5fps 抽成 300 帧，每帧送视觉大模型（看得见照片的那位远程助手，第 1 章的老朋友）写成了一张卡。今天有人来问事：「推搡是什么时候开始的？」本地粗筛跑完，排前两名的是相邻的 [03:52] 和 [03:54] 两张卡——两张几乎一样的卡片：场景同一句，摘要差三个字，关键词五个里重了四个。模型照单全收，读到的就是两段重复描述，回答也把一句话说两遍。

更糟的是名额。精排只取前几名（top-k，第 6 章的老规矩：只取排分最高的前 k 名）。一次推搡前后十几帧全是近亲：它们在粗筛里得分几乎并列，成串占满候选名额，远处真正拍到起因的那几帧反而挤不进来。PDF 里第 12 页和第 13 页是两张不同的纸；视频里第 233 帧和第 234 帧，是同一个世界隔两秒拍下的两张照片。页码式的精确到了视频里，变成的是重复与噪音。

这一章治这个病，药方两味。其一，把检索的单位从帧升到段：几百张帧卡片按时长归堆，检索先命中段、再回到帧。其二，趁打标的机会在每张卡上多记一个字段——运动强度，也就是顺手记一笔「这格画面动得猛不猛」，低、中、高三档。它眼下还没人用，是给后面拉近细看的微观放大层预埋的钩子。

## 病根：相邻的帧是近亲

先弄清重复从哪来。第 5 章的粗筛按词打分：词在这张卡里出现越多、在整摞卡里越稀罕，分越高。这套规矩对 PDF 好使，因为页与页之间没有时间粘性——第 12 页讲退货、第 13 页讲质保，词面天然分开。视频相反：0.5fps 下相邻帧隔 2 秒，画面里九成的东西没动，两张卡的场景、关键词、摘要自然几乎相同。**重复不是偶发，是结构性的**：只要检索粒度停在帧，近亲就会成串出现。

拿名额算一遍就服气。设推搡前后有 12 帧近亲，张张都带「车间、主角、靠近」，粗筛给它们的分几乎并列；top-4 的四个名额花落同一画面的四张照片，真正拍到「谁先抬手」的那帧差半分，堵在门外。你问「什么时候开始的」，模型能看到的只有动作正酣的四格——起因那一格，它根本没收到。

出路不是换个打分公式。**重复要治在粒度上，不在打分上**：把时间轴切成一格一格的抽屉，一个抽屉 30 秒；抽屉里所有帧卡的摘要串成一段、关键词归成一堆、时刻列成清单——这堆帧卡就压成了一张段卡。这个归堆的动作叫段聚合——把零散的帧卡片按固定时长收进一个个「抽屉」（一个抽屉 30 秒），检索粒度从帧升到段。整理卡片柜就是这个样子：散落一桌的卡片按抽屉归档，找东西先抽出抽屉，再翻里面。

```text
时间轴（秒）   0         30        60    75(片尾)   90
               ├─ 抽屉 A ─┼─ 抽屉 B ─┼─ 抽屉 C ─┤
帧卡 t=0,10,29.5    →  A：start=0，  end=30
帧卡 t=30,45,59.9   →  B：start=30， end=60    整 30 秒归 B，不归 A
帧卡 t=60,74        →  C：start=60， end=90    end 越过片尾：标称边界
```

归属键一条式子：`int(t // seg)`。纸笔跟一遍：

```text
纸笔演算：归属键 int(t ÷ 30)
  29.5 ÷ 30 = 0.98…  → 0 → 抽屉 A
  30.0 ÷ 30 = 1      → 1 → 抽屉 B     边界整点归下一段
  59.9 ÷ 30 = 1.99…  → 1 → 抽屉 B
  60.0 ÷ 30 = 2      → 2 → 抽屉 C
75 秒素材恰为 3 段；10 分钟 300 帧 → 20 段
```

为什么是 30 秒？三笔账。其一，0.5fps 下 30 秒约 15 张帧卡，15 条摘要串成一段检索文档，长度与一页 PDF 的卡相当——第 5 章的打分机器不用改口径。其二，10 分钟 300 帧归成 20 段，问一次「推搡」，粗筛在 20 张段卡里挑，近亲们已经合进了同一个抽屉，名额不再成串被占。其三，段是本地免费的：帧卡是花模型调用买来的原材料，段聚合只是本地重新归堆——想把 30 秒改成 20 秒，重算一遍就是，一分钱不用再花。段太长检索变钝，太短又回到重复；30 是刻度，不是圣旨。

## 运动强度：预埋的钩子

段卡把 15 帧压成一张，名额问题解决了，但压掉了一样东西：段里哪一刻最值得看。第 12 章的微观放大层要干的正是这件事——先望远镜扫全景，可疑处再换显微镜。靠什么定位「可疑处」？逐帧去问模型太贵，本地又算不出「猛不猛」这种语义。办法是让模型打标时顺手多写一个字段：这格画面是静坐还是打架。这个字段就是运动强度——帧卡片上记录的「画面动得猛不猛」三档等级（低 / 中 / 高）。

载体极轻：三档白名单进常量，模型给的值不在白名单就归「低」——宁低勿编。用法在聚合时兑现：段卡取段内最高档当 `peak_motion`。纸笔跟一遍：

```text
纸笔演算：段 B 的 peak_motion
  段内 15 张帧卡的 motion：低 低 … 高 … 低（只有 32 秒那张是「高」）
  max(低, 高, 低) = 高  →  段 B 的 peak_motion = 高
  微观层只问「哪段峰值高」，就锁定了这个抽屉，再回 frame_ts 找帧
```

**一张「高」就够**：段里 15 张卡只要有一张写了「高」，整个抽屉就顶到「高」——要找的正是那一格，宁可错标不可漏标。两句诚实的边界先立住：真实视频没有「真相运动等级」，这字段来自模型看图的主观三档分级，不是物理量（合成素材里第 9 章自带的真相标注，只给测试当裁判）；三档粗刻度是故意的——微观层要的是「哪里最值得拉近」，不是精确速度，粗刻度正好便宜。

## 实验场：video_index.py

老规矩，测试先行：tests/test_frame_segments.py 的 15 个测试先写好、先跑出红，再让 video_index.py 长出来转绿。

帧卡与第 4 章的页卡同构同纪律：结构化、白名单、以送审标签为准。差别只在字段——视频帧没有「版面元素」，多出来的是画面里的文字、帧间变化与运动强度。七格里六格是内容，剩下一格是时刻；时刻是键，来自标签，不劳模型自报：

```python
# src/vision_rag/video_index.py · FrameCard
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
```

批量纪律整章平移：标签先行、图随后、effort 用最省档、要 JSON；截断对半拆、漏帧只补漏、顽固帧兜底。这套打标是成本漏斗在视频侧的一次性投入——第 1 章的老账：先通读建索引，之后每次提问只花漏斗的小钱。核心递归与第 4 章的 `_index_batch` 逐行对得上，只是「页」换成了「帧」：

```python
# src/vision_rag/video_index.py · _index_batch
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
```

真正的新问题只有一个：页码是整数，时刻是浮点。模型回执自报的 `t` 可能手抖——31.0 抄成 31.2。纪律是贴最近送审帧：自报时刻与哪个送审标签最近就归谁，偏差超过批内相邻帧最大间隔的一半，就算编造，整条扔掉。送审标签本身一行就能写完（`f"[t={t:.1f}s]"`），真正的新逻辑在 `_snap_t`。第 3 章立下的「引用必须落在送审集合内」，在这里换成时间轴上的说法：

```python
# src/vision_rag/video_index.py · _snap_t
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
```

兜底那张卡得重新想。第 4 章顽固页可以退回文字层凑弱卡；视频帧没有文字层，本地一无所有——兜底卡就诚实空着。弱卡不冒充好卡，但任何一帧都不缺席。

```python
# src/vision_rag/video_index.py · _fallback_card
def _fallback_card(t: float) -> FrameCard:
    """兜底卡：模型读不了的帧，退回一张诚实的空卡。

    视频帧没有文字层可退（第 4 章页卡的退路），本地一无所有——
    弱卡不冒充好卡：摘要空着、运动归「低」。宁可整段索引带一张
    空卡，不让几百帧的工程中途断掉。
    """
    return normalize_frame_card({}, t)
```

最后是本章的主角。段卡长这样。

```python
# src/vision_rag/video_index.py · SegmentCard
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
```

归堆本人在 `aggregate_segments`。它按归属键分组，摘要按时刻串联、先去重（相邻近亲常写同一条摘要），关键词按出现次数降序，运动取段内最大。

```python
# src/vision_rag/video_index.py · aggregate_segments
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
```

末段的 `end` 可以越过片尾：75 秒素材的末段报到 90 秒。它是标称边界，真正切片时再收口。这一处与「段长 30 秒是工程约定」「运动三档是主观分级」一起，登记进附录差异清单。

## 验证：跑什么，看到什么

本章里程碑全部钉在 tests/test_frame_segments.py 里，15 个测试各验一事。

- **75 秒恰为 3 段、边界归下一段**——29.5 归第一段、30.0 归第二段、60.0 归第三段，末段 `end` 到 90（标称边界越过片尾）；
- **一张「高」封顶整段**——段内 15 张卡只有 32 秒那张 `motion='高'`，该段 `peak_motion` 即为「高」，`frame_ts` 里留着那张卡的时刻——微观层要的钩子就绪；
- **拆批纪律平移成立**——截断剧本下批大小 20 → 10 → 5 → 2 逐轮减半直到单帧；漏帧只补漏；编造的 `t=999.0s` 贴不上任何送审帧、进不了卡；顽固帧拿到空兜底卡，整段一帧不缺席。

亲手开机，在 companion 目录下跑两道门槛：

```text
python -m ruff check src tests conftest.py   →  All checks passed!
python -m pytest -q                          →  114 passed（含本章新增 15 个）
```

前九章的 99 个旧测试一行没动、照样全绿——公共 API 向后兼容的哨兵又添一岗。还想亲手把「抽帧 → 成卡 → 归堆」走一遍：

```python
# 用法示例：亲眼看清卡与段卡（companion 目录下，先设 PYTHONPATH=src）
from vision_rag.client import Client
from vision_rag.fake import ScriptedTransport, fenced_json
from vision_rag.video import extract_frames, make_clip
from vision_rag.video_index import aggregate_segments, build_frame_cards

def reply(ts):
    return fenced_json({"frames": [
        {"t": t, "scene": "车间", "summary": "主角在车间走动",
         "keywords": ["车间", "主角"], "ocr": "", "event": "继续走动",
         "motion": "高" if 31 <= t < 34 else "低"} for t in ts]})

clip = make_clip()
frames = extract_frames(clip, fps=0.5)          # 31 帧：t = 0, 2, …, 60
ts = [f.t for f in frames]
transport = ScriptedTransport([
    (reply(ts[:20]), "stop"),                    # 第一批 20 帧
    (reply(ts[20:]), "stop"),                    # 第二批 11 帧
])
cards = build_frame_cards(Client(transport, sleep=lambda s: None),
                          frames, batch=20)
print(len(cards), transport.calls)               # 31 2

segs = aggregate_segments(cards, seg=30)
print([(s.start, s.end, s.peak_motion) for s in segs])
# [(0, 30, '低'), (30, 60, '高'), (60, 90, '低')]
```

末行三个元组对照着看：31 张帧卡压成 3 张段卡；只有第二段被顶成「高」——32 秒那一格「打架」的卡在抽屉里当了家。第 9 章 0.1fps 会整个漏掉的那 3 秒，0.5fps 抓住了它，聚合之后它成了段卡上一个可检索的标记。开篇那位问「推搡什么时候开始」的人，此刻索引里等他的不再是 300 张近亲，而是 20 个抽屉。

## 收线：本章落成的东西

开篇的两味药至此入册。重复与噪音，病在检索粒度停在帧——近亲是时间轴的常态，段聚合把粒度升到段，名额问题连根拔掉；运动强度是打标时顺手埋下的钩子，聚合时顶成 `peak_motion`，微观放大层将来靠它找最值得拉近的抽屉。

```text
本章落成的东西，后面谁在用

  FrameCard          视频检索的公共货币：段卡由它归堆，深读回帧也靠它
  build_frame_cards  批量浅阅读的入口：对半拆批纪律在时间轴上的驻扎地
  SegmentCard        检索的新粒度：段粗筛与代表帧精排都以它为单位
  aggregate_segments 本地免费的重组：段长想改就改，不用再花模型调用
  peak_motion        微观放大层的入口钩子：哪段最值得拉近，先问它
  frame_ts           选中段回帧的地图：深读与高密度重抽都从这份清单出发
```

离开前自查四问：

- 75 秒素材按 30 秒聚合是几段？29.5 秒和 30.0 秒的帧卡各归哪段？为什么边界整点归下一段？
- 检索粒度停在「帧」时，为什么近亲会成串占满 top-k 名额？拿 top-4 亲手算一遍。
- 段聚合为什么是本地免费的一步？想把 30 秒改成 20 秒，要再花模型调用吗？
- 运动强度这个字段眼下给谁用？段内 15 张卡只有一张「高」时，`peak_motion` 是什么？

答得上来，视频侧的第二块板就铺完了。帧归了堆、钩子埋好，检索增强生成的视频半边只差最后一件事：把第 5、6、7 章的三层漏斗整个搬到时间段上，让回答带上 [MM:SS] 的时间戳——带时间戳的视频问答在第 11 章；用 `peak_motion` 拉近重看的微观放大在第 12 章。地图上的位置，到时各自展开。
