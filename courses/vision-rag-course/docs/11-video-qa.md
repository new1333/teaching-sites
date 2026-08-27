---
title: "漏斗迁移：带时间戳的视频问答"
---

# 漏斗迁移：带时间戳的视频问答

监控录像出了事，你问视觉大模型（看得见照片的那位远程助手，第 1 章的老朋友）：两拨人起冲突是哪一段？它答得挺像样：「冲突发生在车间，双方先是言语争执，随后发生肢体推搡，大约在视频的中段。」中段。你从第 30 秒开始拖着进度条来回找，找到第 4 遍才在第 31 秒附近看见那个动作——期间反复跳过的开头结尾，比看完一遍还费时间。想转发给同事？你只能说「大概在一半靠后的地方，你自己找找」：说不出是第几秒，也切不出那一段。

病根不玄：这套问答是从 PDF 那边照搬来的。第 5、6、7 章的三层漏斗原样跑在段卡上，粗筛、精排、深读一寸没改——但 PDF 的回答里每个论点都挂着 [第N页]，翻书就能对表；视频的回答却只给了「中段」这个形容词。**视频侧的漏斗缺的不是筛法，是地址**。这一章补上它：让回答挂上时间戳——视频版的页码，第 1 分 23 秒写作 [01:23]；再把时刻翻译成可以交给播放器的切片范围。件件都是 PDF 主线已验收过的手艺，只是材质从纸换成了时间轴。

## 病根：说得出结论，报不出地址

先想清楚「页码」在 PDF 主线里干了什么。第 3 章立过一条规矩：引用精确，是因为标签与图像一次绑定、照抄不走样。检索增强生成（先翻书找到那段、再照着答）的「可核对」三个字，全押在出处上——答案说第 12 页，你就翻第 12 页。视频没有页，但它有比页更细的东西：时间轴。每一张抽出来的帧都自带时刻标签，第 9 章抽帧、第 10 章成卡时这个标签一路没丢。所以时间戳不是新发明，是帧标签换了一身给人读的衣服：`[t=83.0s]` 是机器间的写法，`[01:23]` 是纸面上的写法，同一条地址。

写法本身是纯算术，纸笔就能推：

```text
纸笔演算：秒数与时刻互相翻译
  83 ÷ 60 = 1 余 23        → 1 分 23 秒 → [01:23]
  3723 ÷ 3600 = 1 余 123；123 ÷ 60 = 2 余 3 → [1:02:03]（超一小时带钟点）
  反向：[00:31] → 0 × 60 + 31 = 31.0 秒——parse_ts 干的就是这个
  59.9 秒向下取整是 59 → [00:59]：时刻只报到秒，报不到小数
```

为什么只报到秒、不报到小数？因为报不起。第 9 章立过的诚实口径在这里兑现：抽帧时理想时刻贴的是最近真帧，帧标签天生带着不超过半个真相帧间隔的误差（本素材 ±0.25 秒）；回答里再写 [MM:SS]，取整又添 ±0.5 秒。两层误差摆在那里，写出 [00:31.247] 这种精度是装出来的精确。**时间戳是采样估计，不是实测时刻**——这句话不写在正文里就算了，写在输出里才算数：本章的 ask_video 每次回答的末尾都印着这条注记，读者拿着回答去对表时，误差范围就印在答案下面。

回收这一端与第 8 章的页码回收同一副脾气：网眼只认形状。`parse_ts` 的正则只捞带方括号的单个时刻，「31 秒」「第31秒」捞不着；区间写法 [00:31-00:34] 也捞不着——这是本章声明的简化：深读的岗位说明书只要求单时刻引用，区间端点的回收留给真实工具，登记进附录差异清单。模型若编了片外时刻（比如 [09:99]），回收只认形状不核对素材，对不上账的缺口交给下一步的 clip_ranges 收口——clamp（把越出 [0, 时长] 的端点拉回边界）：片外时刻在切片一步被跳过，缺口体现在时刻清单与切片清单的对不上账里。

## 漏斗搬家：三个零件换材质

迁移的总图一张表看完。成本漏斗的形状不变——免费粗筛圈候选、便宜精排挑重点、昂贵深读只留给最后几段——换的只是每一层的材质：

| PDF 主线（第 5–7 章） | 视频侧（本章） | 换了什么材质 |
| --- | --- | --- |
| score_pages 粗筛页文档 | score_segments 粗筛段文档 | 页码换成段下标，TF-IDF 公式原样平移 |
| rerank_pages 送页图 | rerank_segments 送代表帧 | 一页一图换成一段一张剧照 |
| deep_read 页图＋文字层 | 全帧深读 帧图＋画面文字 | 邻页展开换成选中段全帧 |
| cited_pages 回收 [第N页] | parse_ts 回收 [MM:SS] | 同一副正则脾气，网眼换了形状 |
| export_pages 导出页图 | clip_ranges 切片范围 | 翻书对表换成可播放区间 |

只有一处要重新设计：精排送什么图。PDF 精排一页送一张图，天然对齐；视频的一段是 15 张帧，全送就回到了第 10 章之前的浪费。答案是只送一张关键帧——也就是能代表一段内容的画面，本课程取段中间时刻最近的那张已抽帧（一段戏的剧照：一张图替整段说话）。为什么是中间？段头段尾各代表半张邻居段的脸，中点最不容易串味。为什么取「最近的已抽帧」而不是凭空画一张中间时刻的图？第 9 章立过铁律：采样不造画面——送审的必须是素材里本来就有的一帧。纸笔推一遍：

```text
纸笔演算：段 (30, 60) 的代表帧（0.5fps，帧在偶数秒）
  中间时刻 = (30 + 60) ÷ 2 = 45 秒
  候选帧：30, 32, 34, …, 58 → 离 45 最近的是 44
  代表帧 = [t=44.0s] 那张：15 帧压成 1 张进精排，账单同比例缩
```

深读这层也有一处方向性变化值得说破：PDF 深读给「页图＋文字层」两条通道，视频深读的对应物是「帧图＋画面文字（ocr）」——帧图管动作、位置与先后，ocr 管画面里印着的字。推理档位用 effort=high：这是视频侧第一处高档推理，对齐第 7 章 PDF 深读的档位。理由同款：帧序列要读出先后与因果，是最贵的最后一层，也是唯一值得花这份钱的地方。批量成卡与精排照旧 low——漏斗两头的老纪律不因搬家而变。

## 实验场：video_pipeline.py

老规矩，测试先行：tests/test_video_qa.py 的 14 个测试先写好、先跑出红，再让 video_pipeline.py 长出来转绿。新零件从最小的开始。时刻的两端各一个函数，中间夹一条注记常量：

```python
# src/vision_rag/video_pipeline.py · _mmss / fmt_ts
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
```

拆成两层是刻意的：`fmt_ts` 产带方括号的完整时刻（答案、OCR 汇总行用它），`_mmss` 产裸时间戳（拼 `[00:30-01:00]` 这种段标签时用——两个裸时间戳夹一个连字符，不套双重括号）。

```python
# src/vision_rag/video_pipeline.py · parse_ts
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
```

重头戏是切片范围。时刻是「一个点」，用户拿到手能用的是「一段窗口」：前后各补 5 秒——动作有起手有收尾，贴着那一秒切会把前因后果切掉；端点收口到 [0, duration]；相邻两段重叠或相接就并成一段——播放时不用中途换文件；最后截到 3 段，让给最早的时刻。四步语义，各配一段可以徒手复算的例子。

```text
纸笔演算之一：补边——clip_ranges([32.0], 61.0, pad=5)
  32 - 5 = 27 → 起点 27（≥ 0，不用收口）
  32 + 5 = 37 → 终点 37（≤ 61，不用收口）→ (27.0, 37.0)
  换 [2.0]：起点 max(0, 2-5) = 0——左端收口到片头，不越界
纸笔演算之二：合并——clip_ranges([31.0, 33.0], 61.0)
  31 → (26.0, 36.0)；33 → (28.0, 38.0)
  28 ≤ 36：第二段起点落在第一段怀里 → 并成 (26.0, 38.0)
  相差 2 秒的两处引用，交付的是一段连续画面
纸笔演算之三：上限——clip_ranges([5, 20, 35, 50], 61.0, max_clips=3)
  补边后 (0,10) (15,25) (30,40) (45,55)：互不重叠，合并不动手
  截到 3 段，第 50 秒让位——最早的时刻先上桌
```

```python
# src/vision_rag/video_pipeline.py · clip_ranges
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
```

真实世界里这一步的下游是现成工具：给 ffmpeg 一条命令、一个起点一个时长，它切出可播放的 mp4 片段。参数语义以官方文档为准，本书不写死数值。实验场没有视频文件，切出的是「范围」本身：两个浮点数，交给谁切都行。

粗筛这层几乎是照抄第 5 章，连字段权重都复用同一个常量。段文档＝段摘要与关键词各重复 3 次（FIELD_WEIGHT，模型浅阅读的浓缩按 3 倍计）＋段内帧卡的摘要与画面文字垫底。

```python
# src/vision_rag/video_pipeline.py · segment_document
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
```

打分循环与 score_pages 逐行对得上（idf 乘封顶词频、同分按段序、无命中回退全部段），全文如下——真正的新判断在精排。

```python
# src/vision_rag/video_pipeline.py · score_segments
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
```

`rerank_segments` 送审的是代表帧，标签从页码换成了起止时刻；回执校验照第 6 章三闸：只认候选（编造的起始秒数一律丢弃）、去重、不超过 k；罢工或空选时静默退回粗筛排序：

```python
# src/vision_rag/video_pipeline.py · rerank_segments
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
```

深读给选中段的全部帧——第 10 章在段卡里留的 `frame_ts` 清单在这里兑现。岗位说明书里有两处新话：一是相邻帧间隔先报给模型（这是抽样帧、不是全部画面，别当连续视频脑补）；二是引用格式定为 [MM:SS]，且只能取看过的帧标签附近：

```python
# src/vision_rag/video_pipeline.py · VIDEO_DEEP_SYSTEM
VIDEO_DEEP_SYSTEM = """你是深度观看助手。你会看到与用户问题相关的视频帧序列：按时间顺序排列，每帧前有 [t=Xs] 标签，相邻帧间隔约 {interval:.1f} 秒（这是抽样帧，不是全部画面）。
请把帧序列当作一段连续视频来理解，分析画面中的人物、动作、物体、场景和可见文字。
回答要求：
1. 用中文，先给结论，再按时间或要点展开；
2. 每个关键论点后标注来源时刻，格式如 [00:31]（分:秒）——时刻只能取你看过的帧标签附近，不要编造没见过的画面；
3. 若帧内容不足以回答问题，明确说明「画面中未见相关内容」、还缺什么，不要脑补。"""
```

为什么请求里标签用 `[t=31.0s]`、回答里却要 [00:31]？两个格式服务两个读者：标签给模型，精确到 0.1 秒、与第 10 章送审标签同款，模型照着锚；[MM:SS] 给人和 parse_ts，秒级粒度是与采样误差匹配的诚实精度。岗位说明书把换算规矩写明，回收端的网眼就敢只认这一种形状。

```python
# src/vision_rag/video_pipeline.py · _deep_read_video
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
```

深读预算与截断注记直接复用第 7 章的家底（`DEEP_MAX_TOKENS` 与 `TRUNCATION_NOTE` 从 pipeline 导入）——同一个教学数值，不另立门户。最后是收口。`VideoAnswer` 与第 8 章 `Answer` 同一副对账脾气：时刻清单从答案正文逐字回收，切片范围由时刻清单补边合并而来，两处永远对得上。

```python
# src/vision_rag/video_pipeline.py · ask_video
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
```

注记里的 ± 数值不是拍脑袋：`_truth_half_interval` 现算真相帧的最小间隔、取一半——本素材 0.5 秒间隔就印 ±0.25 秒，换了素材自动跟着变。

## 亲手开机：一行命令，问出第几秒

零件就位，开机。在 companion 目录下粘贴这一行，对合成片段问「推搡发生在什么时候」（模型由剧本扮演——零密钥、零费用、结果确定；真引擎怎么接，第 13 章专门谈）：

```bash
python -c "import sys; sys.path.insert(0, 'src'); from vision_rag.client import Client; from vision_rag.fake import ScriptedTransport, fenced_json; from vision_rag.video import extract_frames, make_clip; from vision_rag.video_pipeline import ask_video, fmt_ts; ts = [f.t for f in extract_frames(make_clip(), 0.5)]; rec = lambda t: {'t': t, 'scene': '车间', 'summary': '主角快速冲撞，发生推搡' if 31 <= t < 34 else '主角缓慢走动', 'keywords': ['车间', '主角', '推搡'] if 31 <= t < 34 else ['车间', '主角'], 'ocr': '车间标语：慢行' if 31 <= t < 34 else '', 'event': '冲撞' if 31 <= t < 34 else '继续走动', 'motion': '高' if 31 <= t < 34 else '低'}; t = ScriptedTransport([(fenced_json({'frames': [rec(x) for x in ts[:20]]}), 'stop'), (fenced_json({'frames': [rec(x) for x in ts[20:]]}), 'stop'), (fenced_json({'segments': [{'start': 30.0, 'reason': '推搡'}]}), 'stop'), ('推搡发生在车间：[00:31] 主角开始加速冲向道具，[00:33] 冲撞最猛，随后放缓。', 'stop')]); a = ask_video(Client(t), make_clip(), '推搡发生在什么时候'); print(a.answer); print('时刻：', [fmt_ts(x) for x in a.timestamps]); print('切片：', a.clips)"
```

终端打出四行：

```text
推搡发生在车间：[00:31] 主角开始加速冲向道具，[00:33] 冲撞最猛，随后放缓。

（注：回答中的 [MM:SS] 时刻是采样估计，不是精确时刻：帧标签误差不超过半个真相帧间隔（本素材 ±0.25 秒），写成分秒另有 ±0.5 秒取整误差。）
时刻： ['[00:31]', '[00:33]']
切片： [(26.0, 38.0)]
```

对照开篇那个「中段」：现在是 [00:31] 起手、[00:33] 最猛，回收出 31.0 与 33.0 两个时刻；两个时刻补边后重叠，并成一段 (26.0, 38.0)——12 秒的窗口，拿去播放器里定位，或交给 ffmpeg 切成片段转发。剧本四幕对应漏斗四跳：两批成卡、段精排选中 30 秒开头的段、深读作答。答案末尾那行注记就是本章的诚实声明本体：误差范围与答案同屏，不藏在文档里。

想把回收的时刻落回画面，一步就够——离该时刻最近的已抽帧，就是那一处引用的关键帧：

```python
# 用法示例：把回收的时刻落到关键帧（companion 目录下，先设 PYTHONPATH=src）
from vision_rag.client import Client
from vision_rag.fake import ScriptedTransport, fenced_json
from vision_rag.video import extract_frames, make_clip
from vision_rag.video_pipeline import ask_video

clip = make_clip()
frames = extract_frames(clip, 0.5)                 # ask_video 内部抽的也是这一批
ts = [f.t for f in frames]
rec = lambda t: {'t': t, 'scene': '车间', 'summary': '主角快速冲撞，发生推搡' if 31 <= t < 34 else '主角缓慢走动',
                 'keywords': ['推搡'] if 31 <= t < 34 else ['车间'], 'ocr': '', 'event': '', 'motion': '高' if 31 <= t < 34 else '低'}
script = ScriptedTransport([
    (fenced_json({'frames': [rec(x) for x in ts[:20]]}), 'stop'),
    (fenced_json({'frames': [rec(x) for x in ts[20:]]}), 'stop'),
    (fenced_json({'segments': [{'start': 30.0, 'reason': '推搡'}]}), 'stop'),
    ('推搡发生在 [00:31] 到 [00:33] 之间。', 'stop')])
a = ask_video(Client(script), clip, '推搡发生在什么时候')
for x in a.timestamps:                             # 31.0 与 33.0
    key = min(frames, key=lambda f: abs(f.t - x))  # 离该时刻最近的已抽帧
    print(f'{x} 秒 → 关键帧 [t={key.t:.1f}s]')
# 31.0 秒 → 关键帧 [t=30.0s]
# 33.0 秒 → 关键帧 [t=32.0s]
```

两行输出各有一个小讲究：31 与前后两帧（30、32）等距，落给先到的那张；33 同理落在 32。与抽帧的「时刻宁早不晚报」同一脾气——平手不掷硬币，永远取先到的帧。关键帧离所引时刻不超过半个采样间隔，够肉眼核对「就是这一下」。

## 验证：测试与门槛

本章 14 个测试锁五件事：

- 时刻互译三条：fmt_ts 的取整、超一小时格式、负数兜底；parse_ts 升序去重、[M:SS] 与 [H:MM:SS] 也认；区间与裸写不入网；
- 切片语义三条：补边与两端收口；重叠合并、相接也并、不相交保段；上限 3 段截尾、片外时刻跳过、非正 duration 抛 ValueError；
- 粗筛两条：稀有词（预算表）压倒高频词（审批）、全不沾回退全部段；
- 精排三条：语义命中＋编造起始秒丢弃＋非数扔掉＋k=0 拒收；代表帧解码对账（中点 15→14、45→44、75→60）；罢工与空选都退回粗筛排序；
- ask_video 三条：端到端对账（时刻 31/33、切片 (26,38)、诚实注记带 ±0.25）、四跳档位（low low low high）、拒答透传且无时刻无切片；index 注入跳过成卡。

双硬门槛（在 companion 目录下）：

```text
python -m ruff check src tests conftest.py   →  All checks passed!
python -m pytest -q                          →  128 passed（含本章新增 14 个）
```

前十章的 114 个旧测试一行没动、照样全绿——公共 API 向后兼容的哨兵又添一岗。

## 收线：本章落成的东西

```text
本章落成的东西，后面谁在用

  fmt_ts / parse_ts    视频版的页码读写两端：答案挂 [MM:SS]，回收也认 [MM:SS]
  clip_ranges          交付层的翻译官：时刻变可播放窗口（补边、合并、限量）
  score_segments       视频粗筛驻扎地：TF-IDF 平移到段文档，免费圈候选
  rerank_segments      代表帧精排：一张剧照替一段说话，三闸校验照旧
  ask_video / VideoAnswer  视频侧 ask：四跳一趟跑完，答案、时刻、切片同交付
  TS_NOTE              诚实声明的输出面：± 误差印在每份答案末尾
```

开篇那位拖进度条的人，现在拿到的是：[00:31] 起手、[00:33] 最猛、(26.0, 38.0) 一段可切的窗口，转发时附一句「误差半秒上下」。PDF 主线第 8 章立下的「回答必须可核对」，在视频侧以同一副形状兑现——出处从纸页换成了时间轴，对表的还是同一门手艺。

离开前自查四问：

- 为什么时刻只报到秒、不写小数？两层误差各是多少，分别从哪一步来？
- 段 (30, 60) 的代表帧怎么选出来的？为什么取「最近的已抽帧」而不是画一张新图？
- clip_ranges([31.0, 33.0], 61.0) 手算一遍：补边后各是哪两段？为什么并成一段？
- 精排回执里的起始秒 12.5 会遇到什么？罢工时返回什么、按什么顺序？

答得上来，视频侧的问答主线就通了。还剩最后一个放大镜的问题：宏观 0.5fps 的帧间隔 2 秒，「按下按钮」这种 300 毫秒的动作还是落在两帧之间——用 peak_motion 拉近重看的微观放大层，在第 12 章。地图上的位置，到时展开。
