---
title: "每页一张读书卡：批量打标与拆批重试"
---

# 每页一张读书卡：批量打标与拆批重试

周六凌晨两点，你的第一个整本索引任务死在第三批。这份合同有八十多页，前两批各 20 页顺利成卡。第三批送进视觉大模型（第 1 章那位看得见照片的远程助手），回执却写到第 14 页戛然而止：JSON 断在半路，解析器抛异常，整夜任务直接报错退出。你抄来的示例代码把 max_tokens 设成了 2048——输出按 token 计费，你想省着用。你没料到的是：同一批输入，模型的输出长度基本不变，重试十次，回回断在半路——大多停在第 14 页附近。

第二个坑在后面等着。合同第 57 页是张歪斜的扫描件，模型每次都读岔，重试耗尽后抛错。而你的脚本把任何异常都当致命错误：一页失败，整本作废。周日早上你去看产出，索引文件是空的。一夜请求费用照付，任何一页的卡片都没留下来。

三个故障其实是三件独立的事。截断——输出撞上长度上限、模型半路停笔——用对半拆批治：一批装不下就分成两批递归，直到装得下。单页顽固失败，用文字层兜底治：退回第 3 章抽出的文字层，给这页凑一张弱卡。至于「一页失败拖垮整本」，那不是故障，是策略本身错了——批量任务的第一条军规是不许中断。这一章实验场落地 index.py，build_page_cards 一次调用把整本文档变成一摞读书卡：每页一张，记页型、标题、摘要、关键词——像读书时随手做的摘录卡，只是由模型批量代写。

## 截断：笔被收走，不是模型偷懒

先弄清成因。max_tokens 是第 2 章见过的参数：这一次回答的输出额度上限。模型写进回执的一切都从这份额度里扣——不只是你要的 JSON 记录，还有它下笔前的思考草稿（在按输出计费的接口里，草稿通常也计入额度；具体口径随平台版本变化，这里只认这条方向性事实）。额度用完，模型半路停笔，结束原因标记为 length，而不是「写完了」的 stop。这个现象叫截断：内容没写完，笔被收走。

拿纸笔把你的事故复算一遍。一张读书卡大约值多少 token？按「一个汉字约折一个 token」的粗口径（本课程的声明口径，不是任何平台的实测价）：

```text
纸笔演算：一张读书卡的 token 账

  JSON 键名与标点            约 40
  60 字中文摘要              约 60
  关键词 3-6 个              约 20
  has 四项＋页码页型         约 20
  ────────────────────────────────
  一张卡                     约 140 token

max_tokens = 2048 时：2048 ÷ 140 ≈ 14.6
→ 第 14 张卡勉强写完，第 15 页起没有记录，JSON 括号还没闭合
```

账算清了，结论自己浮出来。20 页一批要约 2800 token 输出，2048 的瓶口装不下，断点恰好落在第 14 页附近。再想一层：为什么重试无用？重试救不了它：停笔点会漂，但批的答案装不下这件事不变。**截断是结构性故障——批的答案本来就装不下，与运气无关**。第 2 章的指数退避治的是偶发故障：网络抖一下、限流一回，问第二遍就好。药不对症，重试一百遍也是同一堵墙。

结构性故障要动结构。你也可以拧大墨水瓶——把 max_tokens 调高。但上限总有天花板，输出照 token 计费、长批反而烧钱，真实平台对单请求还有各自的约束。真正稳的解法是少问一点：一批装不下，就对半分两批，各自再试；还装不下，继续分。锚点就一句：一车货装不下就分两车、再不行分四车——总有一辆车装得下。这就是对半拆批。

## 对半拆批：拆批树与页数演算

对半拆批的纪律只有四句：多页批回执截断，整批作废；对半分成左右两子批；子批递归，用同样的规则再试；拆到单页为止。画成一棵树，截断时刻的形状一目了然：

```text
截断时刻的拆批树（一批 20 页，右路连续截断的示意）

20 页 ──截断──┐
├─ 左 10 页 → stop：10 张卡一次成
└─ 右 10 页 ──截断──┐
   ├─ 左 5 页 → stop：成卡
   └─ 右 5 页 ──截断──┐
      ├─ 2 页 → stop：成卡
      └─ 3 页 → stop：成卡
```

树上的账也可以纸笔复算：

```text
对半拆批的页数演算

拆 k 轮后，批大小至多 ⌈n / 2^k⌉：
  20 → 10 → 5 → 3 → 2 → 1，最多 5 轮，必到单页
输出需求同步减半：
  10 页 × 140 ≈ 1400 token ＜ 2048，一次装下
最坏调用次数（每层都截断、层层拆到底）：恰好 2n − 1 次
  n = 20 → 39 次调用，换 20 页全绿
```

三个数各说一件事。轮次上界来自指数衰减：每拆一轮批大小至少减半，所以拆到单页的轮数是对数级的——批再大也拆不了几轮。输出减半是疗效：10 页的子批只要约 1400 token，瓶口装得下，截断在第二层就止住。调用次数是代价：最坏 39 次调用看起来吓人，但它是有限次、且只在坏日子发生；对比「永远断在同一处」的死循环，这是拿有限的钱买确定的结果。成本上还有一条安慰：拆批不重发别人的页图——左子批只带左半批的图，图片 token 总量不变，多花的只是系统提示词与说明文字的重复。别忘了这整件事在成本漏斗里的位置：批量打标是一次性投入，产出的是一摞卡片，后面整个粗筛层靠它免费运转——检索增强生成「先翻书」的那半边，地基就是这批卡。

## 实验场：从一批图到一摞卡

现在看 index.py 怎么长出来。卡片本体是个数据类，六个字段全是第 1 章卡片索引设想的具体化：

```python
# src/vision_rag/index.py · PageCard
@dataclass
class PageCard:
    """一页的读书卡：批量浅阅读的成果，后续检索的公共货币。"""

    page: int        # 物理页码——来自页图标签，不来自模型自报
    type: str        # 页型，只取 PAGE_TYPES 白名单里的值
    headings: list   # 本页标题 [{"level": 1, "text": "..."}]
    summary: str     # 数十字级的中文摘要
    keywords: list   # 检索关键词
    has: dict        # 版面元素 {"figure"/"table"/"code"/"formula": bool}
```

请求的拼法延续第 3 章的纪律：标签在前、图随后，批末尾再补一条范围指令，把「该写几条」钉死在文本里。系统提示词（仓里的 INDEX_SYSTEM）同唱一个调：页码照抄标签、收到几页写几条、一页不漏一页不编。页型只取十条白名单——事先写死的合格值清单，名单外一概不收；十条即封面、版权、目录、序言、正文、附录、参考文献、索引、空白、其他。

```python
# src/vision_rag/index.py · _batch_blocks
def _batch_blocks(page_images: list) -> list[dict]:
    """拼一批请求块：每页标签在前、图随后，末尾补一条范围指令。"""
    blocks: list[dict] = []
    for img in page_images:
        blocks += img_block(img.bitmap, label=img.label)
    first, last = page_images[0].page_no, page_images[-1].page_no
    blocks.append({"type": "text",
                   "text": f"请输出第{first}页到第{last}页"
                           f"（共{len(page_images)}页）每一页的 JSON 记录。"})
    return blocks
```

主角是递归的 _index_batch。三种坏结局走同一个出口：回执截断、解析失败、调用层重试耗尽——统统对半拆批。唯一的好结局之外，还有一条小岔路：回执完整可信（finish 是 stop），只是漏了几页，那就只补查漏掉的那几页：

```python
# src/vision_rag/index.py · _index_batch
def _index_batch(client, page_images: list) -> dict[int, dict]:
    """把一批页图交给模型打标，返回 {页码: 原始记录}。

    三种坏结局都走对半拆批：回执被截断（finish='length'）、回文解析
    失败、调用层重试耗尽。批拆到单页就拆不动了——那一页交出去兜底。
    """
    if not page_images:
        return {}
    try:
        text, finish = client.chat(_batch_blocks(page_images),
                                   system=INDEX_SYSTEM, effort="low",
                                   json_mode=True)
        if finish == "length" and len(page_images) > 1:
            return _split_batch(client, page_images)    # 截断：整批减半重来
        data = parse_json_lenient(text)
    except ChatError:
        return _split_batch(client, page_images)        # 解析失败/重试耗尽：拆
    wanted = {img.page_no for img in page_images}
    records = _extract_records(data, wanted)
    missing = [img for img in page_images if img.page_no not in records]
    if missing and len(missing) < len(page_images):
        records.update(_index_batch(client, missing))   # 只是漏页：只补漏的
    elif missing:
        return _split_batch(client, page_images)        # 一条都没对上：整批拆
    return records
```

两个设计判断值得停一下。其一，截断的回执为什么整批作废、不抢救前半？因为半截 JSON 解析器直接报错；就算 JSON 完整、只是缺页，你也分不清是「写不下」还是「偷懒漏写」——finish 标了 length 的多页回执，可信度归零，重来比猜测便宜。其二，漏页补查为什么只送漏的那几页？这时的回执是完整的，缺哪页说得清，整批重发才是浪费。拆批的重活只有四行：

```python
# src/vision_rag/index.py · _split_batch
def _split_batch(client, page_images: list) -> dict[int, dict]:
    """对半拆批：左半批先问、右半批随后；单页拆不动，交回空。"""
    if len(page_images) <= 1:
        return {}
    mid = len(page_images) // 2
    left = _index_batch(client, page_images[:mid])
    right = _index_batch(client, page_images[mid:])
    return {**left, **right}
```

模型的原始记录在进卡片之前，都要过一道规整。纪律来自一个立场：模型输出是不可信输入。页型不在十条白名单里，降级成「其他」；标题没有正文或形状不对，扔；级别钳进 1 到 6；has 只认四个键、一律归一成布尔。页码则以送审页图的标签为准，回执里自报的 page 不作数。_extract_records 里还有一道「页码必须在送审集合内」的拦截——模型编造一个没送过的页码，连进卡的资格都没有。

```python
# src/vision_rag/index.py · normalize_card
def normalize_card(rec, page: int) -> PageCard:
    """把模型吐出的一条原始记录规整成 PageCard：白名单、钳制、补空。

    模型输出当「不可信输入」对待：页型不在白名单归「其他」，标题缺
    正文或形状不对直接扔，级别钳进 1-6，has 只认四个键并归一为布尔。
    页码以参数为准——它来自送审页图的标签，不来自记录自带的 page。
    """
    src = rec if isinstance(rec, dict) else {}
    page_type = src.get("type")
    if page_type not in PAGE_TYPES:
        page_type = "其他"                      # 白名单外：一概降级，不猜
    headings = []
    for h in src.get("headings") or []:
        if not (isinstance(h, dict) and str(h.get("text", "")).strip()):
            continue                            # 没有正文的标题、不是字典的条目：扔
        try:
            level = max(1, min(6, int(h.get("level", 1))))
        except (TypeError, ValueError):
            level = 1
        headings.append({"level": level, "text": str(h["text"]).strip()[:120]})
    summary = str(src.get("summary", "")).strip()[:200]
    keywords = [str(k).strip()[:40] for k in src.get("keywords") or []
                if str(k).strip()][:8]
    raw_has = src.get("has") if isinstance(src.get("has"), dict) else {}
    has = {k: bool(raw_has.get(k, False)) for k in HAS_KEYS}
    return PageCard(page=page, type=page_type, headings=headings,
                    summary=summary, keywords=keywords, has=has)
```

总装在 build_page_cards：按批切块、逐批打标，最后统一兜底。兜底卡由 normalize_card 统一生产——它给什么字段，弱卡就是什么形状：

```python
# src/vision_rag/index.py · _fallback_card 与 build_page_cards
def _fallback_card(page: int, text: str) -> PageCard:
    """文字层兜底卡：模型读不了的页，退回本地有的东西凑一张弱卡。

    弱就弱在瞎：没有页型判断、没有关键词、标题未知，摘要只是文字层
    开头 150 字。扫描页文字层为空，摘要就诚实地空着——弱卡不冒充好卡。
    """
    return normalize_card({"type": "其他", "summary": text.strip()[:150]}, page)


def build_page_cards(client, page_images: list, texts: list,
                     batch: int = 20) -> dict[int, PageCard]:
    """整本成卡：按批打标，残页文字层兜底——任何一页都不缺席。

    返回 {页码: PageCard}。截断与失败在批内递归消化；拆到单页仍拿
    不到卡的页，用第 3 章的文字层凑一张弱卡（type='其他'）。宁可全书
    带一张弱卡，不让整本索引中途断掉。
    """
    if batch <= 0:
        raise ValueError(f"batch 必须是正数，收到 {batch}")
    if len(texts) != len(page_images):
        raise ValueError(
            f"texts 与 page_images 必须等长：{len(texts)} 对 {len(page_images)}")
    cards: dict[int, PageCard] = {}
    for i in range(0, len(page_images), batch):
        for page_no, rec in _index_batch(client, page_images[i:i + batch]).items():
            cards[page_no] = normalize_card(rec, page_no)
    for img, text in zip(page_images, texts):
        if img.page_no not in cards:                    # 模型终究没给卡：兜底
            cards[img.page_no] = _fallback_card(img.page_no, text)
    return cards
```

批大小默认 20 不是魔法数：批越大，请求次数越少、系统提示词摊得越薄，但撞截断的概率越高；批越小越稳，请求却越多。20 是两头之间的工程折中，真实平台对单请求的图片张数也各有上限，方向都是「别一口吞」。

最后是副产品。每张卡的 headings 里躺着本页标题，全书大纲就是把这堆标题按页码串起来，同文本跨页去重——「保养周期」在第 30 页末尾和第 31 页开头各出现一次，大纲只留第一次：

```python
# src/vision_rag/index.py · derive_outline
def derive_outline(cards: dict[int, PageCard]) -> list[dict]:
    """从卡片派生全书大纲：按页码升序收标题，同文本跨页去重。

    封面、版权、目录、空白、索引页不进大纲——目录页里的标题是别人家
    标题的抄本，收进来每个章节都会在大纲里出现两次。
    """
    outline, seen = [], set()
    for page_no in sorted(cards):
        card = cards[page_no]
        if card.type in OUTLINE_SKIP_TYPES:
            continue
        for h in card.headings:
            if h["text"] in seen:
                continue                # 同一标题跨页延续：只记首次出现的那页
            seen.add(h["text"])
            outline.append({"level": h["level"], "text": h["text"],
                            "page": page_no})
    return outline
```

## 兜底不是失败

回到第 57 页。拆批拆到它单枪匹马，重试也耗尽了——然后呢？直觉说抛错，让程序员看见。批处理的世界里这个直觉是错的。**兜底不是失败，是分级交付**：高档手段（视觉模型精读）失灵，退回低档手段（本地白拿的文字层）保命，功能不断。

弱卡弱在哪，得说透。它只有 type='其他' 和文字层开头 150 字的摘要：没有页型判断、没有关键词、没有标题。检索时它只能靠文字层的字面命中，排分通常靠后——弱，但存在。而扫描页连文字层都是空的，兜底摘要就诚实地空着：这张卡保留的全部价值，是「第 57 页存在」这个事实和页码的连续。弱卡不冒充好卡，这本身就是诚实的交付。

为什么值得？算两笔账。产出账：一夜跑批在第 97% 处抛错，产出归零；带 3 张弱卡收工，97% 可用，弱页可以事后定向补。经济账：全部重跑等于全部再付一遍钱，兜底版只补付坏页。**宁可全书带一张弱卡，不让整本中断**——这不是妥协，是批处理任务对「整本可用」这个产品目标的忠诚。

边界也要说清：兜底是止损，不是治疗。生产系统会给兜底页记一笔账，事后再换档重跑或人工补录；实验场把这笔账记在卡片上——type='其他' 本身就是记号，谁读到都知道这页没经过模型精读。

## 验证：跑什么，看到什么

本章的里程碑全部写成测试，钉在 tests/test_batch_page_cards.py 里。三组断言各验一事：

- **截断拆批逐轮减半**——坏引擎替身对多页批次永远回半截回执加 length。测试数它实际收到的批大小：首批 20，随后 10、5、2，最终每页都单独送审过一次。20 页全部成卡；
- **顽固失败页拿到兜底卡**——第 3 页怎么问都罢工的替身下，整本照样收齐：第 3 页的卡 type 为「其他」、摘要恰是文字层、四个 has 全假，且单页重试确实退避过（waited 记录 2、4、8 秒节奏）；扫描页兜底摘要为空字符串；
- **大纲跨页去重**——同一标题出现在相邻两页，大纲只留第一页那条；封面与目录页的标题不进大纲。

亲手开机，在 companion 目录下跑两道门槛：

```text
python -m ruff check src tests conftest.py   →  All checks passed!
python -m pytest -q                          →  38 passed（含本章新增 13 个）
```

第 2、3 章的 25 个旧测试一行没动、照样全绿。还想亲眼看拆批，跑这段用法示例：

```python
# 用法示例：亲手看一次「截断 → 对半拆批」（companion 目录下，先设 PYTHONPATH=src）
from vision_rag.bitmap import Bitmap
from vision_rag.client import Client
from vision_rag.document import Page, SynthDoc, render_pages
from vision_rag.fake import ScriptedTransport, fenced_json
from vision_rag.index import build_page_cards

def rec(*pages):
    return fenced_json({"pages": [{"page": p, "type": "正文",
        "summary": f"第 {p} 页摘要", "keywords": ["样例"]} for p in pages]})

pages = [Page(f"第 {i} 页文字层", Bitmap([f"页{i}"] * 6)) for i in range(1, 5)]
images, texts = render_pages(SynthDoc(pages)), [p.text for p in pages]

transport = ScriptedTransport([
    ('{"pages": [{"page": 1', "length"),   # 整批 4 页：半截回执
    (rec(1, 2), "stop"),                   # 拆出的左半批
    (rec(3, 4), "stop"),                   # 拆出的右半批
])
cards = build_page_cards(Client(transport, sleep=lambda s: None),
                         images, texts, batch=4)
print(sorted(cards))             # [1, 2, 3, 4]：一页不少
print(transport.calls)           # 3：一父两子，正好三次调用
```

三台机器（重试、拆批、兜底）各管一段、接力不打架。布景不动，换一份更狠的剧本就能全程看完。

```python
# 用法示例：重试耗尽 → 拆批 → 单页兜底，一次看完接力（接上一块的布景）
from vision_rag.fake import failing

transport = ScriptedTransport([
    failing(), failing(), failing(), failing(),   # 整批 4 页：4 连败，重试耗尽
    (rec(1, 2), "stop"),                          # 拆出的左半批：一次成卡
    ('{"pages": [{"page": 3', "length"),          # 右半批截断：再拆
    (rec(3), "stop"),                             # 第 3 页成卡
    failing(), failing(), failing(), failing(),   # 第 4 页单页也耗尽：兜底
])
cards = build_page_cards(Client(transport, sleep=lambda s: None),
                         images, texts, batch=4)
print(sorted(cards), transport.calls)              # [1, 2, 3, 4] 11
print([cards[p].type for p in sorted(cards)])      # ['正文', '正文', '正文', '其他']
print(repr(cards[4].summary))                      # '第 4 页文字层'
```

11 次调用里两段退避（waited 恰为 [2, 4, 8] × 2），第 4 页最后拿到的是文字层兜底卡：页型落到「其他」，摘要只剩文字层开头——三台机器谁也没抢谁的活。

## 收线：不许中断的整本

回头看开头的三宗罪。截断是结构性故障，药方是对半拆批：整批作废、左右递归、拆到单页，最坏 2n − 1 次调用换确定的全绿。单页顽固失败是局部故障，药方是文字层兜底：弱卡占位，整本不中断。「一页失败整本报错退出」是策略故障，药方是把「任何一页都不缺席」写进函数的返回契约。

```text
本章落成的东西，后面谁在用

  PageCard          检索层的公共货币：粗筛、精排、深读都读它
  build_page_cards  PDF 主线的批量索引入口：截断拆批、失败兜底都在里面
  derive_outline    全书大纲：标题跨页去重，翻书的地图
  对半拆批纪律      通用的批处理模式：第 10 章视频帧卡直接复用
  文字层兜底        「任何一页都不缺席」的保底策略
```

离开前自查四问：

- 截断和偶发失败差在哪？为什么指数退避治不了截断、对半拆批治不了限流？
- 一批 20 页、每张卡约 140 token、max_tokens 2048，断点会落在第几页附近？拆一轮后单批输出需求是多少？
- 拆到单页仍失败的那一页，最后拿到的卡长什么样？扫描页的兜底卡摘要为什么是空的？
- 回执完整但漏了两页，和回执截断，处理策略为什么不同？

答得上来，一摞读书卡就真攥在手里了。下一章拿起这摞卡干正事：不花一分钱，在本地把最相关的几页先筛出来。
