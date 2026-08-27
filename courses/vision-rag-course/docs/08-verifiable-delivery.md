---
title: "把证据递到手上：引用回收与自包含预览"
---

# 把证据递到手上：引用回收与自包含预览

深读上线那天，第一次真的拿它交付。回答干净利落：「整机保修一年，易损耗材不在保修范围内，依据见第 12 页。」同事当场翻开 PDF 的第 12 页——内容对不上，那一页讲的是安装步骤。翻服务端日志才找到病根：建索引那晚脚本在第 8 页崩过一次，重启后没人管，索引只建了前一半。可模型照样作答，语气笃定得像读完了全书——没人告诉它「你只见过一半」，它也不会自己招。

更尴尬的是第二件事。同事说：「把证据发我一份，我要转给售后。」你翻遍输出，只有终端里滚过去的一段文字。要图没图，要页没页，最后只能口头说「模型是这么说的」。这句话在群里转了两手，就变成了「系统说整机保三年」。

两个病，病根不同。第一个是「覆盖面不明」：索引建了多少页，答案里只字不提，核对无从下手。第二个是「交付物缺证据」：答案是一段话，证据还锁在管线深处的页图里，用户拿不到手。这一章收口整条 PDF 主线，把前七章攒下的零件装成一台整机：ask 一趟跑完粗筛、精排、深读；页码引用从答案正文里捞回来；答案连同引用页图打进一个双击即开的 HTML 文件。索引没建全，答案自己声明；证据要核对，文件自己带。

## 一趟直达车：ask 收口三层漏斗

先把整车接起来。前三章各交了一个零件：第 5 章的 `score_pages` 免费圈候选，第 6 章的 `rerank_pages` 看图精选，第 7 章的 `deep_read` 读透作答。ask 做的只是穿针引线：按漏斗顺序把三个零件串起来，末尾再补一环——从答案里回收页码。

```python
# src/vision_rag/pipeline.py · ask
def ask(client, doc, question: str, top: int = 4, cands: int = 12,
        index: dict[int, PageCard] | None = None) -> Answer:
    """一次调用跑完三层漏斗：粗筛→精排→深读→引用回收，交付 Answer。

    doc 是 SynthDoc；index 可注入现成的 {页码: PageCard}——复用第 4 章
    攒下的卡片就跳过建卡那步调用；None 则现场整本成卡。索引只覆盖
    部分页时，答案末尾如实声明覆盖范围：没读过的页不许装作读过，
    覆盖面写进交付物，核对才有起点（本章痛点：索引建了一半，回答
    却指着全书说话）。
    """
    page_images = render_pages(doc)
    texts = [page.text for page in doc.pages]
    cards = (index if index is not None
             else build_page_cards(client, page_images, texts))
    ranked = score_pages(cards, texts, question)[:cands]    # 第一层：免费粗筛
    picked = rerank_pages(client, cards, page_images, ranked, top, question)
    answer = deep_read(client, cards, texts, page_images, picked, question)
    if len(cards) < len(texts):                             # 覆盖不全：说破
        answer += "\n\n" + INDEX_NOTE.format(covered=len(cards),
                                             total=len(texts))
    return Answer(answer=answer, cited=cited_pages(answer))
```

`index` 参数是给第二次提问准备的：建卡是整条管线里唯一的大开销（整本逐批过一遍模型），问十个问题不该建十次索引。第一问 `index=None` 现场成卡，之后的每一问把卡片字典传进来，建卡那步整个跳过。

算一笔调用账。手册 6 页、一批装下：`index=None` 时一次 ask 共 3 次模型调用——建卡 1 次（低档）＋精排 1 次（低档）＋深读 1 次（高档）；注入 index 后只剩 2 次。对照第 1 章的整本塞（每次提问都整本进上下文），检索增强生成的省钱结构到这里完全成形：重的活干一次，轻的活每问一次。

再看那三行 if——本章第一个病的药。索引只覆盖 3/6 页时，答案末尾会多出一段：

```text
（注：索引仅覆盖 3/6 页；未覆盖的页没有被读过，答案只基于已索引部分。）
```

**没读过的页，不许装作读过**。声明长在答案里，而不是日志里：答案被截图、转发、存档时，声明跟着一起走。开章那个「第 12 页对不上」的事故，有了这句话，同事第一眼就知道去查索引覆盖，而不是怀疑模型瞎编。

## 从答案里捞页码：正则表达式

答案回来了，页码埋在句子中间：「整机保修一年……[第5页]」。要把它变成程序能用的数据，靠人眼不行——得让机器按形状捞。这就是正则表达式（regular expression）：一张按格式捞文本的渔网，网眼写成「第＋数字＋页」，撒进一段文本，捞出来的就是所有页码引用。

为什么不用已经会的字符串方法？`"第5页" in answer` 只能回答「在不在」，`answer.find(...)` 只能找一个固定串。可页码是变的——第 5 页、第 12 页、第 40 页，你不可能把每个数字都写一遍。正则解决的就是「格式固定、内容可变」的匹配：把变化的部分写成占位记号，不变的部分照写。

网眼拆开看，只有三个零件：

```text
第 (\d+) 页
│   │   │
│   │   └─ 字面「页」：紧接着必须有这个字
│   └───── \d+ ：一串数字（\d 是一个数字，+ 表示一个或多个）
（图里「第」与 (\d+) 之间的空格只是竖线对位需要——实际网眼里没有空格，照抄图里的空格会一条都捞不着）
└───────── 字面「第」：从这起算
（括号是捕获：捞出时只要括号里的那一截——数字本身）
```

跟着算一遍。拿这句话当输入：

```text
输入：整机保修一年 [第5页]；本手册是第 3 版，共 12 页。
逐段对位：
· [第5页]    →「第」对上，「5」是一串数字，「页」紧随：入网，捕获 5
· 第 3 版    →「第」后是空格不是数字；数字后是「版」不是「页」：不入网
· 12 页      → 数字贴着「页」，但前面没有「第」：不入网
· 整机保修一年 → 没有「第」：不入网
findall 结果：['5']
```

锚点收一句：渔网捞鱼不问品种，只问形状——「第 3 版」是鱼牌不是鱼。你可以现在就验证，把这两行粘进 python 交互环境：

```python
# 用法示例
import re
print(re.findall(r"第(\d+)页", "整机保修一年 [第5页]；本手册是第 3 版，共 12 页。"))
# → ['5']
```

捞的动作在实验场里就是 cited_pages，全貌如下：

```python
# src/vision_rag/pipeline.py · cited_pages 与 Answer
_PAGE_REF = re.compile(r"第(\d+)页")   # 页码引用的网眼：只认「第＋数字＋页」

INDEX_NOTE = ("（注：索引仅覆盖 {covered}/{total} 页；"
              "未覆盖的页没有被读过，答案只基于已索引部分。）")


@dataclass
class Answer:
    """ask 的交付物：回答正文＋从正文回收的引用页码。

    cited 不是模型另报的账本，是从 answer 里逐字捞回来的——答案说
    了什么页，交付物就认什么页，两处永远对得上。
    """

    answer: str
    cited: list[int]


def cited_pages(answer: str) -> list[int]:
    """从回答正文回收页码引用：形如「第12页」的全部捞出，升序去重。

    网眼是正则 第(\\d+)页——「第 3 版」「第三页」「12 页」都捞不着，
    只有「第＋数字＋页」这个形状才算页码引用。回收只认形状、不核对
    语料：模型若编了语料外的页码，对不上账的缺口留给交付层说破
    （report.py 的导出与预览都会为语料外页码抛 ValueError）。
    """
    return sorted({int(m) for m in _PAGE_REF.findall(answer or "")})
```

两处细节值得停一下。其一，`Answer.cited` 不是模型另报的字段——不问模型「你引用了哪些页」，直接从答案正文里捞。**答案说了什么页，账本就记什么页**，两处永远对得上；若另起账本，模型嘴上说第 5 页、账本里写第 4 页，你无从发现。其二，回收只认形状、不核对语料：捞上来的页码可能是模型编的（第 7 章见过的老毛病），对不上账的缺口不在这一层修，留给交付层当面报错——下一节就是。

## 把证据装进一个文件：自包含 HTML

页码有了，该把证据递到手上了。先看一个几乎人人都踩过的坑：你把 `preview.html` 和五张 `page-5.png` 一起打包发给同事，他只把 HTML 转给了客户——客户打开，图全裂。HTML 里写着 `<img src="page-5.png">`，这行字的意思是「去我这个文件旁边找那张图」；文件单飞，图没跟来，浏览器显示裂图标。聊天工具传文件、邮件过滤附件、网盘换目录，都会把「一群互相指认的文件」拆散。

解法是把整个交付做成自包含 HTML（self-contained HTML）：答案、引用、每一张证据图，全部装进一个文件——收件人不需要任何别的文件，双击就能看。像一封把所有照片都洗好贴进去的信，而不是一叠附件。

先看这个文件长什么样（结构对照着读，`<pre>` 原样呈现块里装的就是第 3 章那种字符网格页图）：

```text
preview.html（一个文件，全部家当都在里面）
├─ <head>
│    └─ <style> 样式规则逐条写在这里 —— 不是外链 .css 文件
├─ <body>
│    ├─ <h1> 设备维护手册
│    ├─ 问题：整机保修多久
│    ├─ <div class="answer"> 答案正文（含 [第5页] 字样，转义后纯文字）
│    └─ 引用页
│         └─ <h3>[第5页]</h3> ＋ <pre>第 5 页的字符网格</pre>
│              —— 画面直接嵌在文件里，不是 <img src="….png">
```

「自包含」不能靠嘴说，得能机械验证。本章测试逐个搜查的外链痕迹共七种：`href=`（外链样式或跳转）、`src=`（外链图片或脚本）、`<img`（图片标签）、`@import` 与 `url(`（CSS 里的外链写法）、`http:` 与 `https:`（任何网络地址）。一个都不许出现——读者也可以亲手搜（grep——按内容搜文本的命令行工具；Windows 自带的等价命令是 findstr）：`grep -c "src=" out/preview.html` 应输出 0；或者不装任何工具，用 Python 数一遍：`python -c "print(open('out/preview.html',encoding='utf-8').read().count('src='))"`。

两个交付函数，先看导出：

```python
# src/vision_rag/report.py · export_pages
def export_pages(page_images: list, pages: list[int], out_dir) -> list[Path]:
    """把选中的页图逐页落盘：一个页码一个文件，标签写首行，返回路径列表。

    声明的简化：真实世界导出的是 PNG 页图；实验场的页图是字符网格，
    落盘即 .txt——形态不同，纪律相同：页码与画面一起交付。语料外的
    页码交不出证据，抛 ValueError 说破、不悄悄跳过——交付物与答案
    对不上账，比缺一个文件更糟。
    """
    images = _images_by_page(page_images)
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    paths: list[Path] = []
    for p in pages:
        if p not in images:
            raise ValueError(
                f"第{p}页不在页图里：可导出的页码为 {sorted(images)}")
        path = out / f"page-{p}.txt"
        path.write_text(f"{images[p].label}\n{images[p].bitmap.render()}\n",
                        encoding="utf-8")
        paths.append(path)
    return paths
```

注意那个 ValueError 的用意：上一节说过，回收上来的页码可能是编的。导出时对不上账（语料里没有那一页），当场报错说破——悄悄跳过的话，交付物里少一页，用户只会以为那一页「恰好不重要」。

再看合成预览：

```python
# src/vision_rag/report.py · html_preview
def html_preview(doc_name: str, question: str, answer: str,
                 page_images: list, pages: list[int], out_dir) -> Path:
    """答案＋引用页图合成一个自包含 HTML 文件，返回它的路径。

    问题、答案、每页「标签＋画面」都住在这一个文件里：样式内联、页图
    内嵌，全文件零外部引用——收件人双击就能核对，不需要原书，也不需
    要任何别的文件。答案与画面都经 html.escape 转义：答案里的尖括号
    只是文字，不许在预览里变成活的标签。语料外的页码抛 ValueError：
    交不出的证据不能悄悄抹掉，对账的缺口要当场合上。
    """
    images = _images_by_page(page_images)
    parts = [("<!DOCTYPE html>\n<html lang=\"zh\">\n<head>\n"
              '<meta charset="utf-8">\n'),
             f"<title>{html.escape(doc_name)} · 问答预览</title>\n",
             _PREVIEW_STYLE, "\n</head>\n<body>\n",
             f"<h1>{html.escape(doc_name)}</h1>\n",
             f'<div class="q">问题：{html.escape(question)}</div>\n',
             f'<div class="answer">{html.escape(answer)}</div>\n',
             "<h2>引用页</h2>\n"]
    for p in pages:
        if p not in images:
            raise ValueError(
                f"第{p}页不在页图里：可嵌入的页码为 {sorted(images)}")
        parts.append("<section>\n"
                     f"<h3>{images[p].label}</h3>\n"
                     f"<pre>{html.escape(images[p].bitmap.render())}</pre>\n"
                     "</section>\n")
    parts.append("</body>\n</html>\n")
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    path = out / "preview.html"
    path.write_text("".join(parts), encoding="utf-8")
    return path
```

三处实现选择，各有来历。

`html.escape` 是安全带。答案是一段自由文本，哪天模型写出「见 `<script>` 标签的说明」，不转义的话这段会被浏览器当成活的 HTML 标签执行——答案里的每个尖括号都必须只是文字。测试里专门有一条：把 `<script>` 塞进答案，断言文件里只有 `&lt;script&gt;`。

页图内嵌的形态是一处声明的简化。真实工具把 PNG 的字节用 base64 折成文本、以 `<img src="data:image/png;base64,...">` 的形式写进文件——src 指向的不是外部文件，是内嵌的数据（第 2 章让图片进模型请求用的同一招）；实验场的页图本来就是字符网格，连折都不用折，直接进 `<pre>`。形态不同，纪律相同：画面在文件里，不在文件外。`<pre>` 是 HTML 里「原样呈现」的标签，空格换行都保留，网格才不会散架。

文件名固定为 preview.html，也是一处简化：真实工具常按文档名加问题摘要在文件名里区分多次问答，实验场一次跑一个文件，固定名最省心。

## 亲手开机：一行命令，双击核对

零件全部就位，开机。在 companion 目录下粘贴这一行（就是本章开头那个场景的完整重演，模型由剧本扮演——零密钥、零费用、结果确定；真引擎怎么接，第 13 章专门谈）：

```bash
python -c "import sys; sys.path.insert(0, 'src'); from vision_rag.client import Client; from vision_rag.document import make_handbook, render_pages; from vision_rag.fake import ScriptedTransport, fenced_json; from vision_rag.pipeline import ask; from vision_rag.report import export_pages, html_preview; doc = make_handbook(); cards = fenced_json({'pages': [{'page': 1, 'type': '封面'}, {'page': 2, 'type': '目录'}, {'page': 3, 'type': '正文'}, {'page': 4, 'type': '正文'}, {'page': 5, 'type': '其他', 'summary': '保修条款：整机保修一年'}, {'page': 6, 'type': '空白'}]}); t = ScriptedTransport([(cards, 'stop'), (fenced_json({'pages': [{'page': 5}]}), 'stop'), ('整机保修一年；易损耗材不在保修范围内 [第5页]。', 'stop')]); a = ask(Client(t), doc, '整机保修多久'); print(a.answer); print('引用页：', a.cited); print(export_pages(render_pages(doc), a.cited, 'out')); print(html_preview('设备维护手册', '整机保修多久', a.answer, render_pages(doc), a.cited, 'out'))"
```

终端打出四行（先落页图文件、再落预览）：

```text
整机保修一年；易损耗材不在保修范围内 [第5页]。
引用页： [5]
[WindowsPath('out/page-5.txt')]
out\preview.html
```

剧本三幕对应漏斗三跳：整本成卡（围栏 JSON 回执，第 2 章的宽容解析照常兜着）、精选第 5 页、深读作答。ask 跑完，引用回收交出 `[5]`，预览落进 `out/preview.html`。

到资源管理器里双击这个文件，浏览器会给你看三样东西，从上到下：手册名「设备维护手册」与那行问题；灰底的答案块，正文里就写着 [第5页]；再往下是「引用页」区——第 5 页的字符网格整页铺开，能看到「整机保修一年」和「（盖章处）」的字样。**答案说得出页码，交付物就交得出画面**，两样同屏，这就是「可核对」。想验自包含，把文件单独拷到桌面再开一次——图不裂；再跑一句 `grep -c "src=" out/preview.html`，输出 0。

## 测试与门槛

本章 13 个测试锁四件事：

- cited_pages 三条：乱序重复回收成升序去重；「第 3 版」「第三页」「12 页」不入网；空答案与拒答回收为空列表；
- ask 三条：三幕剧本按序吃进（建卡→精选→深读，深读幕断言 effort=high、前两幕走 JSON 模式）；答案与回收页码对上；index 注入跳过建卡，索引覆盖 3/6 时答案带声明注记、未索引页进不了深读；
- export_pages 两条：落盘文件首行是页码标签、目录不存在自动建；语料外页码抛 ValueError；
- html_preview 五条：零外部引用；预览页图标签与回收页码逐个对上（端到端对账）；尖括号被转义；拒答时文件照常生成只是没有页图区；外加一条同屏断言——答案与引用页在同一个文件里可见。

双硬门槛（在 companion 目录下）：

```text
python -m ruff check src tests conftest.py   →  All checks passed!
python -m pytest -q                          →  87 passed（含本章新增 13 个）
```

## 收线：PDF 主线到此闭合

八站走完，回头看整条链：渲染出带页码标签的页图，整本成卡建索引；提问时本地粗筛免费圈候选，精排看图精选，深读带邻页读透；页码从答案里捞回，答案连同证据装进一个自包含文件。三层成本漏斗各司其职，每一层都有回退、有校验、有诚实声明——这套结构不是视觉大模型的专利，它就是检索增强生成的骨架。

读完这一章，你应该能答上这几问：

- 一次 ask（注入 index）共几次模型调用？各在漏斗哪一层、什么档位？
- 「第 3 版」里的 3 为什么不会被当成页码引用捞出来？
- 自包含 HTML 的「自包含」怎么用一条 grep 验证？
- 索引只覆盖一半页时，答案末尾会多出什么？为什么声明要长在答案里而不是日志里？

下一站换媒体：视频没有页码，但有时刻。同样的漏斗要迁移到「帧与段」上跑——回收页码的正则换个网眼就能回收 [MM:SS] 时间戳（第 11 章），「答案带证据、单文件可核对」的交付纪律也会在视频问答里原样重生（第 11 章）。
