---
title: "一个靠得住的视觉模型客户端：重试、宽容解析与密钥纪律"
---

# 一个靠得住的视觉模型客户端：重试、宽容解析与密钥纪律

第 1 章末尾说过，全书要造的机器从地基开始。周一一早你动工了：给视觉大模型写第一个调用脚本——那位看得见照片的远程助手，得先有一条靠得住的电话线。

第一版脚本跑完，一天之内连出三次事。

第一次是密钥。你在文件开头写了一行 `KEY = "sk-a1b2c3..."`——调用云端模型要先出示 API 密钥（API key），一串能证明「调用者是你」的字符凭证，平台靠它认人、靠它记账。密钥跟着代码进了 git，同事把仓库推上 GitHub 的当晚，平台发来告警：密钥已泄漏，请立即更换。你连夜换钥、重发脚本，心里默念：这串字符从此只住环境变量——操作系统为每个进程准备的一格配置抽屉，程序启动时从里面取值，代码里只剩变量名，再没有密钥本身。

第二次是围栏。脚本跑通了，模型返回的 JSON 外面裹了一层东西：前后各多一行，先是三个反引号跟着 json，结尾又是三个反引号——像把礼物装进了包装盒。`json.loads` 只认裸 JSON，见到盒子直接抛异常，脚本当场崩在半路。

第三次是超时。跑到第 17 页，网络抖了一下，请求超时抛异常——没有重试，整轮弃跑。300 页的手册，你看着它崩了三次，每次都从第 1 页重来。

三次崩溃，三次修法，拼起来就是本章：密钥纪律、宽容解析、指数退避（每失败一次、下一次等得更久的重试节奏）。外加两块地基：图片怎么塞进一次请求、任务怎么挑思考档位。它们全部落进实验场的 client.py——往后每一章对模型的调用都踩在这块板上。

```python
# 原理示意（伪码）：第一版脚本——三颗雷当时就埋好了
KEY = "sk-a1b2c3..."                  # 雷一：密钥写死，随代码进仓库
text = call_model(KEY, question)      # 雷三埋在 call_model 里：一超时就抛异常
data = json.loads(text)               # 雷二：模型回的是围栏 JSON，这行必崩
```

## 第一颗雷：密钥住在环境里

先想清楚密钥为什么不能进代码。代码会去很多地方：git 历史永久保留每一次提交，同事 clone 一份就是全量拷贝，公开仓库更是全网可搜。**密钥写进代码，等于印在名片上分发**——泄漏不是意外，是时间问题。

改法是让密钥和代码分居：代码里只出现变量名，值由运行环境提供。设置一次即可：

```text
macOS / Linux（写进 ~/.bashrc 可一劳永逸）：
export GLM_API_KEY="sk-你的密钥"

Windows（PowerShell，设完重开终端生效）：
setx GLM_API_KEY "sk-你的密钥"
```

实验场里的读法只有十来行：

```python
# src/vision_rag/client.py · load_api_key
def load_api_key(environ: dict | None = None) -> str:
    """从环境变量读 API 密钥；environ 可注入，测试与真实环境共用一套逻辑。"""
    env = os.environ if environ is None else environ
    key = env.get(ENV_KEY, "").strip()
    if not key:
        raise ChatError(
            f"未找到 API 密钥：请先设置环境变量 {ENV_KEY}"
            f"（macOS/Linux：export {ENV_KEY}=sk-...；Windows：setx {ENV_KEY} \"sk-...\"）。"
            "密钥住在环境里，不写在代码里。"
        )
    return key
```

三处设计值得停一停。

其一，environ 参数可以注入。不写死「读全局环境」，而是「给我一个字典，我从里面读」——默认给真实环境，测试给一个空字典。于是「无密钥时抛明确错误」可以在测试里一遍遍验证，不用真去改系统设置。这个手法本章还会再见：暂停函数、传输引擎，全都走注入。

其二，错误要大声。缺密钥不属于「先跑着，回头再补」：没有密钥，第一次调用必挂。与其崩在第 40 页，不如启动第一行就报错退出，并把补救办法写进错误信息——上哪里设、怎么设，一眼看懂。

其三，strip() 顺手做。命令行里复制粘贴常带首尾空白，这里一并抹掉，省一次难查的怪错。

不进实验仓也能验证「环境变量是每台机器各是各」：

```python
# 用法示例：换台机器（或新开终端），打印结果就不同
import os
print(os.environ.get("GLM_API_KEY"))   # 没设过：None；设过：你的密钥
```

## 图片怎么进请求：折成纸条塞进信封

请求的正文不是一坨字符串，是一列「内容块」：文本块装字，图片块装图。可一次请求里怎么装得下一张图？答案是 base64——把任意字节翻写成纯文本字符的编码法，像把照片折成一条长纸条：看着是一串字母数字，按折痕折回去还是原来那张照片。图片以文本之身进请求，收信的一端照着折痕还原。

数据不长，你在任何一台机器上都能亲手折一次：

```python
# 用法示例：折一次，再折回去
import base64
strip = base64.b64encode("A B\nC D".encode("utf-8")).decode("ascii")
print(strip)                                      # QSBCCkMgRA==
print(base64.b64decode(strip).decode("utf-8"))    # A B 换行 C D，分毫不差
```

编码结果拼上 `data:` 前缀，就成了 data URL——「内容就写在本行里」的地址，格式是 `data:类型;base64,数据`。实验场把这套打包成一个函数：

```python
# src/vision_rag/client.py · img_block
def img_block(bitmap, label: str | None = None) -> list[dict]:
    """把一张位图变成 image_url 内容块（base64 内联），可带一个前置文本标签。

    声明的简化：真实引擎内联的是 JPEG/PNG 字节、前缀写 image/jpeg；
    实验场的「图」是 render() 出来的文本画，所以走 text/plain——
    请求结构与真实调用完全同形，第 3 章的 Bitmap 不用改一行就能流进来。
    """
    b64 = base64.b64encode(bitmap.render().encode("utf-8")).decode("ascii")
    blocks: list[dict] = []
    if label:
        blocks.append({"type": "text", "text": label})  # 标签与图同进一次请求
    blocks.append({"type": "image_url",
                   "image_url": {"url": f"data:text/plain;base64,{b64}"}})
    return blocks
```

两个要点。

标签排在图前面。label 不是装饰：第 3 章渲染页图时会写 `img_block(page, label="[第3页]")`，页码标签和图像装进同一次请求——将来模型答「第 3 页」，出处是它亲眼看到的标签，不是猜的。这正是第 1 章说的「页码绑定物理事实」的入口。

声明一处简化。真实引擎内联的是 JPEG 字节，前缀写 image/jpeg；实验场的图是文本画，走 text/plain。请求的形状与真实世界同形，载荷按实验场的情况声明——这类差异全书统一登记在附录差异清单，正文一处一声明。

## 岗位说明书与思考旋钮

内容块只回答「这次带了什么」，另有两样东西在每次调用里说清「你是谁、想多深、要什么格式」。

一样是系统提示词（system prompt）——开工前递给模型的一页岗位说明书：你是索引员、只输出 JSON、页码必须来自标签。它排在消息列表最前，先于任何用户内容生效。

另一样是推理强度（reasoning effort）——模型下笔前「想多深」的档位。第 1 章咱们叫它推理档位，正式名就是推理强度，同一只旋钮：low 档想得最浅，批量打标又快又省；high 与 max 逐级想得更深，深读分析才值得。旋钮只有三格，写错格位名直接报参数错误——宁可当场翻车，不带病运行。

还有个小开关 json_mode：在请求里声明「我要 JSON 格式的回复」。注意措辞——这是请求，不是保证。模型大概率照办，但装箱的老毛病不一定改，下一节专门治它；开关要开，解析也要宽容。

四样东西拼成一次请求的完整形状：

```text
一次 chat 调用拼出的请求

messages:
  [0] system   "你是索引员……"                ← 岗位说明书，排最前
  [1] user     [ 文本块 ][ 图片块 ][ 图片块 ]   ← blocks 原样进来
reasoning_effort: low | high | max             ← 思考旋钮（三格）
max_tokens: 16384                              ← 回复预算，宁大勿小
response_format: {"type": "json_object"}       ← 仅 json_mode 时出现
```

temperature 是采样随机度的旋钮，本课程一路用默认值 1.0，不碰它。拼装的代码在 `Client._request`，值得整段读一遍：

```python
# src/vision_rag/client.py · Client._request —— 拼请求
    def _request(self, blocks: list, system: str | None, effort: str,
                 json_mode: bool, max_tokens: int,
                 temperature: float) -> dict:
        if effort not in EFFORTS:
            raise ValueError(f"推理强度只认 {EFFORTS}，收到 {effort!r}")
        messages: list[dict] = []
        if system:
            messages.append({"role": "system", "content": system})  # 岗位说明书排最前
        messages.append({"role": "user", "content": blocks})        # 问题与图片随后
        request = {"messages": messages, "reasoning_effort": effort,
                   "max_tokens": max_tokens, "temperature": temperature}
        if json_mode:
            request["response_format"] = {"type": "json_object"}    # 请求 JSON 输出
        return request
```

max_tokens 为什么给到 16384 这么大：有的模型把思考过程也计入这份预算——预算抠门，正文还没开始就先花光，收到空回复。方向性的纪律就一条：宁大勿小，别在这省钱。

## 第二颗雷：礼物装在包装盒里

改完密钥，脚本跑起来了，然后崩在解析这一步。你让它输出 JSON，它也确实输出了——只不过外面套了层包装。这就是 JSON 围栏——模型把 JSON 装进 Markdown 代码块再交差的坏习惯，礼物外面套了个包装盒。json.loads 只认裸 JSON，碰到盒子纸屑一概报错。

为什么模型管不住自己？回想它的本职：聊天。它受的训练是「把回答排得好看」，代码块是它最爱的排版手段——哪怕你请求 JSON 输出，它也常常顺手装箱。上一节「请求不是保证」那句，在这里兑现。**既然管不住输出端，就在解析端兜底**。

兜底的招式是四步抢救，步步放宽：先当干净 JSON 直接解析；不行就拆围栏；再掐头去尾，从第一个花括号（或方括号）留到最末一个；最后修两类小伤——Python 的 None 翻回 null、抹掉末尾多写的逗号。步步针对的都是「模型常犯、机器好修」的毛病：

```python
# src/vision_rag/client.py · parse_json_lenient —— 四步抢救
def parse_json_lenient(text: str | None) -> dict:
    """尽力把模型吐出的文本解析成 JSON：容忍围栏、前后闲话、尾逗号与 Python None。"""
    s = (text or "").strip()
    if not s:
        raise ChatError("没有可解析的内容")            # 空文本：没有抢救价值
    try:
        return json.loads(s)                           # 第一步：先当干净 JSON 试
    except json.JSONDecodeError:
        pass
    m = _FENCE.search(s)
    if m:
        s = m.group(1)                                 # 第二步：拆掉围栏，取盒中之物
    starts = [i for i in (s.find("{"), s.find("[")) if i != -1]
    if starts:                                         # 第三步：掐头去尾留括号段
        s = s[min(starts):]
        end = max(s.rfind("}"), s.rfind("]"))
        if end != -1:
            s = s[: end + 1]
    s = _NONE.sub("null", s)                           # 第四步 a：None 翻回 null
    s = _TRAILING_COMMA.sub(r"\1", s)                  # 第四步 b：抹掉尾逗号
    try:
        return json.loads(s)
    except json.JSONDecodeError as e:
        raise ChatError(f"解析失败：{e}；开头是 {s[:80]!r}") from e
```

两处边界要守住。空白文本不做任何抢救——没有内容就是没有内容，硬解析只会把 bug 藏深。抢救也有底线：四步走完还解析不了，抛 ChatError，错误信息里带上开头 80 个字符——那是排查「模型到底回了什么」的第一现场。

## 第三颗雷：占线就挂断，还是等一等再打

第三次崩溃最冤：代码一行没错，网络抖了一下。超时、限流（请求太频繁、被平台暂时拒收）、服务端瞬断，这类故障统称瞬时故障——特点就是「过一会儿自己就好」。对它正确的姿势不是弃跑，是重试。

但重试有讲究。失败后隔多久再试？固定等 1 秒猛打不行：服务端正喘着，你按同样频率敲门，它刚要缓过来又倒下。正确的节奏叫指数退避（exponential backoff）——每失败一次，下一次的等待翻倍：电话占线，等 2 秒再打；还占线，等 4 秒；再占线，等 8 秒。越来越客气，给对面留出恢复的空当。

徒手算一遍（base_delay 取 2 秒，最多试 4 次）：

```text
退避演算：base_delay = 2 秒，retries = 4

第 1 次调用失败 → 等 2 秒 → 第 2 次调用
第 2 次调用失败 → 等 4 秒 → 第 3 次调用
第 3 次调用失败 → 等 8 秒 → 第 4 次调用（此前累计等待 2 + 4 + 8 = 14 秒）
第 4 次仍失败   → 不再等，抛 ChatError

等待序列 2、4、8：每项翻倍，这就是「指数」二字的全部含义
```

换成代码，整个重试循环不到 20 行：

```python
# src/vision_rag/client.py · Client.chat —— 重试循环的全貌
    def chat(self, blocks: list, system: str | None = None,
             effort: str = "low", json_mode: bool = False,
             max_tokens: int = 16384,
             temperature: float = 1.0) -> tuple[str, str]:
        """发一轮对话，返回 (回复文本, 结束原因)；空回复与异常都按退避节奏重试。"""
        request = self._request(blocks, system, effort, json_mode,
                                max_tokens, temperature)
        delay, last = self.base_delay, None
        for attempt in range(1, self.retries + 1):
            try:
                text, finish = self.transport.call(request)
                if text and text.strip():
                    return text.strip(), finish
                last = ChatError(f"空回复：attempt={attempt}, finish={finish}")
            # 重试的本意就是「无论哪种失败都再试一次」：transport 抛的一切异常
            # （网络抖动、限流、超时、剧本里的罢工）都先记下，退避后来过。
            except Exception as exc:  # noqa: BLE001
                last = exc
            if attempt < self.retries:  # 还有名额才等；名额用完直接出去
                self._sleep(delay)
                self.waited.append(delay)
                delay *= 2              # 每失败一次，下一次等得更久
        raise ChatError(f"重试 {self.retries} 次仍失败，最后错误：{last}")
```

四个细节值得指认。

空回复也算失败。上一节说过，思考预算花光时模型会交白卷——不抛异常，只回空字符串。所以判成功的条件是「有非空白文本」，空回复走同一条退避之路。

请求只拼一次。request 在循环外拼好，四次尝试发的是同一份——重试是重发，不是重造。

等待也走注入。self._sleep 默认是 time.sleep，测试里塞一个「收下秒数但不等待」的假时钟，全套测试跑完不到一秒；真机上换成真睡眠，一行不改。self.waited 顺手记下每次真实等待的秒数——退避节奏从此可断言、可观察。

重试有尽头。四次用完还失败，抛 ChatError 收场——**宁可明确地死，不让脚本神秘地活**。调用方拿到一个说清「试了几次、最后错在哪」的异常，而不是无声退出。

真实世界还有两味佐料：抖动（每次等待加一点随机量，免得大量客户端同步重试）和封顶（等待最多 30 秒，别真等两分钟）。实验场从简，纯正翻倍——这处简化同样登记在附录差异清单。

## 假引擎：剧本回放

三颗雷的修法，凭什么说「修好了」？真实网络抖不抖、模型今天围不围栏，没法预约排期。实验场的答案是：把模型本身也做成可插拔的——传输层只认一个约定：把请求送进「引擎」，带回一对 (回复文本, 结束原因)。结束原因常见两个值：stop 表示正常说完，length 表示写到上限被掐断。至于送进的是真引擎还是假引擎，Client 不知道，也不关心。

这个约定用 Python 的 Protocol（协议）写下来：按形状不按血统，任何长着 call 方法的对象都算数。

```python
# src/vision_rag/client.py · Transport —— 传输层协议
class Transport(Protocol):
    """传输层协议：把一次请求送进「引擎」，带回 (回复文本, 结束原因)。

    按形状不按血统——任何有 call 方法的对象都算 Transport：
    测试里是 ScriptedTransport 剧本回放，真实世界里是 HTTP 客户端。
    """

    def call(self, request: dict) -> tuple[str, str]: ...
```

假引擎叫 ScriptedTransport，核心只有一个 call 方法。

```python
# src/vision_rag/fake.py · ScriptedTransport.call
    def call(self, request: dict) -> tuple[str, str]:
        self.requests.append(request)
        if not self.script:
            raise ChatError(f"剧本用完了（已回放 {self.calls} 次调用）")
        item = self.script.pop(0)
        if isinstance(item, Exception):
            raise item
        if isinstance(item, dict):
            return item.get("text", ""), item.get("finish", "stop")
        return item
```

剧本是一张清单，每次调用弹一项：元组是正常回复，字典是可缺省字段的消息，Exception 是这次调用就抛错。两件事让它配得上「引擎」这个位置。每次请求原样记进 .requests——测试能核对「模型到底看见了什么」，第 4 章批量打标时这是主要证据。剧本弹空再调用会明确报错——测试写错剧本时当场翻车，不留悬案。

配套还有两个造剧本的小工具：fenced_json 专门复刻围栏毛病，failing 预约一次失败——网络抖动从此不靠运气：

```python
# src/vision_rag/fake.py · fenced_json 与 failing
_TICKS = "`" * 3  # 三个反引号：Markdown 围栏的原料


def fenced_json(payload) -> str:
    """把 JSON 装进三个反引号的围栏——模拟模型「爱用包装盒」的坏习惯。"""
    body = payload if isinstance(payload, str) else json.dumps(payload, ensure_ascii=False)
    return f"{_TICKS}json\n{body}\n{_TICKS}"


def failing(exc: Exception | None = None) -> Exception:
    """剧本项：这次调用抛异常（默认 ChatError('boom')）。"""
    return exc if exc is not None else ChatError("boom")
```

于是全书所有测试零网络、零费用、全确定。换真引擎时，换的也只是这一层：真实 HTTP 客户端同样实现 call，Client 与全部上层管线一行不改——那三处移植改动点，第 13 章展开。

## 验证：跑什么，看到什么

本章的里程碑是三条断言，全部写成测试钉在 companion/tests/test_vision_client.py 里。

- **围栏能救回**——fenced_json 造一盒带围栏的 JSON，parse_json_lenient 拆出原样字典；
- **退避重试有节奏**——剧本前两项 failing()、第三项才成功：断言拿到结果、引擎记录恰好 3 次调用、waited 恰为 [2.0, 4.0]；
- **无密钥报明确的错**——空环境里 load_api_key 抛 ChatError，错误信息带变量名和补救办法。

亲手开机：在 companion 目录下跑两道门槛。想亲眼看一次「失败两次、第三次成功」，先把 src 挂上模块搜索路径——PYTHONPATH=src（conftest.py 为 pytest 做的就是这件事；Windows 命令行写 set PYTHONPATH=src）：

```text
python -m ruff check src tests conftest.py   →  All checks passed!
python -m pytest -q                          →  13 passed（本章新增 13 个）
```

```python
# 用法示例：一次看得见的「两败一成」
from vision_rag.client import Client
from vision_rag.fake import ScriptedTransport, failing

t = ScriptedTransport([failing(), failing(), ("第 3 页是表格", "stop")])
c = Client(t, sleep=lambda _s: None)     # 假时钟：不真等
print(c.chat([{"type": "text", "text": "第几页有表格"}]))
print(t.calls, c.waited)                 # 3 [2.0, 4.0]
```

第一行打印 ('第 3 页是表格', 'stop')——前两次失败没有白费，它们留下了记录。Client(...) 的构造参数也在这块板上：retries 与 base_delay 定退避节奏，sleep 注入等待函数（测试给假时钟，一行不等）——「一切外部依赖皆可注入」这句话的物理落点，就是这行构造器。

围栏抢救同样一眼可见——拆盒只消一行：

```python
# 用法示例：拆盒一眼可见
from vision_rag.client import parse_json_lenient
from vision_rag.fake import fenced_json
print(parse_json_lenient(fenced_json({"page": 3})))   # {'page': 3}
```

## 收线：靠得住的三个含义

回头看开头的三次崩溃：密钥泄漏，治成「值住在环境里、代码只剩名字」；围栏崩溃，治成「四步抢救、底线抛错」；超时弃跑，治成「翻倍等待、耗尽即死得明白」。所谓靠得住，不是不出错，而是每一类错都有明确的接待流程。这块地基浇好，第 1 章画的那张图——检索增强生成的两阶段与三层成本漏斗——才有地方一层层往上盖。顺带声明一处与真实世界的差异：真工具常给密钥留第二来源——写在家目录一个文件的首行，同样不进代码；实验场只认环境变量这一条路。

本章还立了全书的测试范式：一切外部依赖皆可注入——环境变量、暂停函数、传输引擎，全是参数。往后每一章的新功能，都按「先写测试看它红、再写实现让它绿」的节奏推进。

```text
本章落成的东西，后面谁在用

  load_api_key        密钥纪律：任何一章接真引擎，都先过它
  img_block           页图、帧图都从这里进请求，标签与图同车
  Client / chat_json  批量打标的主战调用；chat_json＝chat 开 json_mode
                      再过一遍宽容解析的几行组合；精排回退吃它的 ChatError；
                      深读把 effort 拧到 high
  ScriptedTransport   全书所有测试的「模型」：零网络、零费用、全确定
  effort 三格旋钮     PDF 与视频两条线，都按任务选档
```

离开前自查四问：

- 为什么密钥绝不能写进代码？环境变量解决了什么、没解决什么？
- 模型已开 json_mode，为什么还会解析失败？宽容解析的四步各治什么毛病？
- 退避为什么是翻倍而不是固定等待？retries 取 4 时，第 4 次调用前累计等了多少秒？
- ScriptedTransport 记录 .requests 有什么用？为什么说换引擎不用改 Client？

答得上来，这块地基就浇透了。下一章开始往上盖：把 PDF 的每一页变成带页码标签的图——标签与图像绑定的那一刻，引用的精确性才有物理来源。
