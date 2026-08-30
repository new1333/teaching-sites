---
title: 装进浏览器：从 jsdom 到真实页面
---

# 装进浏览器：从 jsdom 到真实页面

## 上章留下的问题

第 8 章拆掉了最后一颗雷：观察者上岗，新段落只翻新来的，译文生译文的循环在源头掐灭，66 个断言全绿。可这 66 个断言全部跑在 jsdom 里——一台没有字体、没有布局、事件循环节奏也不真实的假浏览器。引擎的每项能力都有测试背书，唯独「装进真浏览器还能干活」这件事，从头到尾没人验证过。

## 七个文件全绿，然后呢

`npm test` 一敲：七个测试文件、66 个断言，jsdom 全绿。停一秒，想想这个场面的另一面——这台引擎至今真浏览器未验证。jsdom 里没有字体与重排，没有真正的滚动，页面脚本也不会真的往树上挂节点。第 1 章你在同一个英文页面上做过两次翻译：点浏览器自带的「翻译此页」，原文消失；按双语工具的快捷键，译文逐段长出来。九章走完，你已经造出了「后者」的全部内核——但它还没见过一个真正的页面。

补上这一步，只差两样新东西。一个是 manifest（扩展的身份证兼配置清单——浏览器靠它认识你的扩展）。另一个是 content script（扩展注入到网页里运行的脚本，引擎在真浏览器里的落脚点）。这一章亲手加载扩展：把它装进 Chrome，回到真实英文页面，亲眼看自己写的引擎干活。顺手把全书那条主线问题收口。

## 扩展是什么：为什么必须是它

引擎的入场条件很苛刻：要在「任何别人写的页面」上常驻，要读写那棵 DOM 树，还不能跟页面自己的脚本打架。网页的 `<script>` 做不到第一件事——站点 A 的脚本进不了站点 B 的页面。能跨全部页面注入第三方代码的合法入口，浏览器只留了一个：扩展。扩展就是浏览器承认的「常驻第三方」，而承认是有条件的——身份与意图必须事先声明、白纸黑字，装的时候用户看得见，Chrome 按清单放行。这份清单就是 manifest；照着清单放进页面的那段代码，就是 content script。

锚点一句话：manifest 之于扩展，约等于 package.json 之于包——名字、版本、入口、作用范围，一页说清「这是谁、它想干什么」。

### content script 住在哪：隔离世界

content script 跑在网页里，但不跑在网页的 JavaScript 里。它住在一个「隔离世界」（isolated world，私有的执行环境）：同一棵 DOM 树两边共用，全局变量各过各的。Chrome 文档写得很直白：页面、每个扩展的 content script，互相看不见对方的执行环境。这层隔离是双向的保险——页面脚本污染不了引擎，引擎也覆盖不了页面任何变量。第 3 章立的「原文一个字不动」，在这里多出一层孪生纪律：**页面的 JS 环境也一个字不动**。

```text
content script 的隔离世界（isolated world）
  共用：同一棵 DOM 树——两边 querySelector 到的是同一批节点，
        引擎插的译文节点，页面脚本也数得着
  隔离：全局对象各一份——页面看不见 chrome，引擎看不见页面定义的变量
  结果：DOM 是共用舞台，脚本是各自的后台
```

这解释了一件你早就见过、却未必想过为什么的事：装了扩展的页面上，你自己的代码从没跟扩展的变量撞过名。也预告了本章验证槽的一个亲手实验——在页面控制台敲 `typeof chrome`，答案是 `"undefined"`：chrome 对象住在隔壁世界。（个别站点——部分 Google 系页面——会自己定义一个站点版的 window.chrome，那不是扩展的；实验换 MDN 这类页面做。）

### manifest：一张字段表读懂本壳

本壳的 manifest 一共 13 行，五个字段，逐个对账：

| 字段 | 本壳的值 | 它管什么 |
|---|---|---|
| manifest_version | 3 | 扩展的平台代际（MV3 是当前的清单格式版本） |
| name / version | Duo Shell 双语对照教学壳 / 0.1.0 | 扩展卡片上显示的名字与版本 |
| content_scripts.matches | http://*/* 与 https://*/* | 注入范围：哪些 URL 的页面才注入 |
| content_scripts.js | dist/content.js | 注入哪个文件——相对扩展根目录的路径 |
| content_scripts.run_at | document_idle | 何时注入：Chrome 文档保证这个时点 DOM 已完整 |
| `description` | 扩展描述，展示在扩展卡片与管理页上 |

matches 的判法拿四个地址跟一遍就透：

```text
// companion · 按本壳 manifest 的 matches 逐个判
https://developer.chrome.com/docs/...  → 命中 https://*/*  → 注入
http://example.com/                   → 命中 http://*/*   → 注入
chrome://extensions/                  → scheme 不符       → 不注入（浏览器内部页本就禁注入）
file:///C:/demo.html                  → 没声明这个 scheme → 不注入
```

### 打包：十个模块，一个文件

manifest 的 js 收的是「文件清单」，没有「当模块加载」的开关——`import` 语句没人替你解析。所以上浏览器前要打包：esbuild 把 content.ts 连同它引入的十个 src/ 模块，打成一个自包含的经典脚本。产物落在 extension/dist/content.js，14.0 KB。`--format=iife` 的意思是一层立即执行的函数把整包私有变量裹住——不留全局名，跟隔离世界各自的后台正好一副脾气。类型检查不打折：tsconfig 的 include 一直含着 extension/，壳照样过 tsc。

## 演练：从红到 74 绿

靶子：8 个 it() 块。第 1 步照例先红，此刻 extension/ 目录还不存在：

```text
// companion · npm test 的真实输出（节选）
Error: Failed to resolve import "../extension/content" from "tests/browser-shell.test.ts". Does the file exist?
```

测试分两撮。第一撮盯 manifest——它就是个 JSON 文件，用 node:fs 直接读进来断言，浏览器要认的门槛测试先替你把一道：

```ts
// tests/browser-shell.test.ts · manifest 的关键字段
  it('content_scripts 指到打包产物：js 恰为 dist/content.js、matches 覆盖 http 与 https', () => {
    expect(manifest.content_scripts).toHaveLength(1)
    const cs = manifest.content_scripts[0]
    expect(cs.js).toEqual(['dist/content.js']) // 相对扩展根目录——esbuild 的产出位置
    expect(cs.matches).toContain('http://*/*') // 网页协议才注入：chrome:// 内部页、file:// 都不进
    expect(cs.matches).toContain('https://*/*')
  })
```

第二撮盯壳的行为。最值得停的一条是「import 不开火」——content.ts 的模块尾挂着「在扩展里就开机」的副作用，这条测试钉死它只在扩展环境发生。

```ts
// tests/browser-shell.test.ts · import 不开火
  it('import 不开火：本测试文件的全局 document 上一个译文也没有——自动上弦只在扩展环境发生', () => {
    // content.ts 的模块尾有「在扩展里就开机」的副作用；chrome.runtime.id 只在扩展上下文存在，
    // vitest/jsdom 里没有——import 它不该有任何译文悄悄上树
    expect(document.querySelectorAll(`[${OWN_ATTR}]`).length).toBe(0)
  })
```

其余六条各钉一角：run_at 钉住注入不早于文档可读（引擎上车时树是完整的）。开机即整页：14 块各得译文、每条以【译】开头、原文一字未动。行内 code 在译文里活回来——第 5 章的功力从壳里透出。新段落上树只翻新来的——第 8 章的观察者从壳里上岗。还有 disconnect 之后静默、MV3 必备字段齐全。

第 2 步实现。壳的全部家当就一个 44 行的文件：

```ts
// companion/extension/content.ts · 壳的全部（终态全文）
/**
 * 扩展壳（第 9 章）：content script 的全部家当——装配引擎、上弦开机。
 * 壳不写一行引擎逻辑：抽取、翻译、渲染、装配的功力全在前八章的 src/ 里；
 * 这里只做两件事——把引擎接到一棵文档树上（startShell），以及决定什么时候开机（autoStart）。
 * 公共面：startShell（测试与 demo 从这里进场）。
 */
import { createEngine } from '../src/engine'
import { observeDynamic } from '../src/observe'

/**
 * 壳的装配单：把整套引擎接到一棵文档树上，返回观察者的把手。
 * 五字段配了三个，一个都不传 translator——内置假翻译器顶上，离线零密钥：
 * preserveInline——译文里保住加粗、链接与行内代码（第 5 章）；
 * useCache——同样的话只翻一次；concurrency——同时在飞的请求至多 2（第 7 章）。
 * 开机整页与增量交给 observeDynamic（第 8 章）——无限滚动的页面也跟得上。
 */
export function startShell(doc: Document): { disconnect(): void } {
  const engine = createEngine({ preserveInline: true, useCache: true, concurrency: 2 })
  return observeDynamic(doc.body, engine)
}

/**
 * 扩展环境的指纹：chrome.runtime.id 只在扩展上下文里有值——content script 里它是扩展 ID
 * （Chrome 文档明说 runtime.id 是 content script 可直接访问的 API），Node 与 jsdom 里
 * chrome 干脆不存在。靠它把「自动上弦」限定在扩展里：测试与 demo import 这个文件，
 * 不会有人在旁边偷偷开机。
 */
declare const chrome: { runtime?: { id?: string } } | undefined

/** 自动上弦：文档还在加载就等 DOMContentLoaded，已经就绪就立刻开机。 */
function autoStart(): void {
  const boot = (): void => {
    startShell(document) // 把手不接——壳与页面同生共死，永不断开
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true })
  } else {
    boot()
  }
}

if (typeof chrome !== 'undefined' && chrome.runtime?.id !== undefined) {
  autoStart() // 只有跑在扩展里才开机——import 本身不触发
}
```

三处停一停。第一处，装配单：preserveInline、useCache、concurrency 三个选项，每一项都是前章交付的能力，壳一行引擎逻辑没写，只负责接上；translator 不传，内置假翻译器顶上——离线、零密钥、零账单。第二处，开机指纹：`chrome.runtime.id` 是 Chrome 文档明列的「content script 可直接访问」的 API，只在扩展上下文有值；Node 与 jsdom 里连 chrome 这个全局都不存在。指纹不在场就不开机，所以测试与 demo 随便 import 这个文件，谁都不会误触。第三处，readyState 分支：run_at 为 document_idle 时 Chrome 已保证 DOM 完整，这个分支是保险——哪天把 run_at 改早了，壳不用跟着改。

manifest 全文 13 行就是上节那张表的原样落地（extension/manifest.json，demo 第一幕原样打印）。工程侧补两行脚本：

```text
// companion · package.json 新增的两行
"demo:shell": "tsx demo/shell-demo.ts",
"build:ext": "esbuild extension/content.ts --bundle --format=iife --outfile=extension/dist/content.js"
```

第 3 步转绿：8 新加 66 旧，74 条全绿。`npm run build:ext` 出产物，demo 上柜（输出是真实的）：

```text
// companion · npm run demo:shell 的真实输出
=== 第一幕：manifest（extension/manifest.json 原文） ===
{
  "manifest_version": 3,
  "name": "Duo Shell 双语对照教学壳",
  "version": "0.1.0",
  "description": "把本书的双语对照引擎装进浏览器：离线假翻译器，零密钥演示逐段对照。",
  "content_scripts": [
    {
      "matches": ["http://*/*", "https://*/*"],
      "js": ["dist/content.js"],
      "run_at": "document_idle"
    }
  ]
}
装配说明：matches=http/https 网页才注入；js 指向打包产物 dist/content.js；
run_at=document_idle——Chrome 保证 DOM 齐了再上脚本（不用抢页面启动）。

=== 第二幕：打包产物（esbuild 把 src/ 与壳打成一个文件） ===
extension/dist/content.js 已就位：14.0 KB（npm run build:ext 产出）

=== 第三幕：壳在 jsdom 里开机（startShell → observeDynamic → 引擎） ===
译文节点：14 个 | 原文 outerHTML 逐字不变：true
一对双语（第 5 章的功力从壳里透出来——行内 code 不送翻、原样拼回）：
  <p>To try it, add one script tag to your page and call <code>mount()</code> on any element.</p>
  <p data-duo="1">【译】To try it, add one script tag to your page and call <code>mount()</code> on any element.</p>
滚动加载 +1 段：译文节点 14 → 15（第 8 章的观察者在岗）
disconnect 后再 +1 段：译文节点仍 15——把手干净

下一步（真浏览器）：chrome://extensions → 开发者模式 → 加载已解压的扩展程序 → 选 extension/ 目录
```

三处抬眼。第一幕把浏览器认扩展的凭据原文念了一遍——测试断言的每个字段都在眼前。第二幕的 14.0 KB 就是 Chrome 将要注入的全部：十个模块加壳，一个文件。第三幕是 jsdom 预演：14 个译文、原文逐字不变，那对双语里行内 code 原样活着，新段落上树即得译文，断开把手干净。「真浏览器」三个字，依然是下面这一节要你亲手做的事。

## 验证：亲手装进 Chrome

每一步都写明操作与应看到什么，照着对。第 1 步起，所有命令都在 companion/ 目录下跑。

1. 打包：`npm run build:ext`。
   应看到：终端输出一行 `extension\dist\content.js  14.0kb`——extension/dist/ 目录下出现 content.js。
2. 打开扩展管理页：新标签页地址栏输入 `chrome://extensions`，回车。
   应看到：扩展管理页，页面上可能空着，也可能列着你已装的扩展。
3. 打开开发者模式：点亮页面右上角的 Developer mode 开关。
   应看到：页面上方出现三个按钮——Load unpacked、Pack extension、Update。
4. 加载：点 Load unpacked（加载已解压的扩展程序），在弹出的文件选择框里选中 companion/extension 目录。选的是 extension/ 这一层，不是它里面的 dist/。
   应看到：列表多出一张卡片：名字 Duo Shell 双语对照教学壳、版本 0.1.0、开关已启用；卡片上没有红色的 Errors 按钮。若有 Errors，点开多半写着 Could not load JavaScript … for content script 一类字样——回去补第 1 步，再点卡片上的刷新图标。
5. 见证：打开任一内容多些的英文页面（MDN 或 developer.chrome.com 的文档页都好），等一两秒。
   应看到：每段英文下方多出一行以【译】开头的文字；代码块、导航没有译文；原文一字未动，链接照常能点。往下滚动，页面新加载的内容译文跟着长出来——第 8 章的观察者在真实页面上岗。译文内容为什么是原文本身？假翻译器只贴前缀：零密钥、零网络。位置、结构、节奏是真的，译文内容是占位的——接真翻译服务只是换 translator 插头，账记在书末差异清单。
6. 隔离世界亲测：在第 5 步的页面按 F12 打开 DevTools，Console 面板里跑两行：
   ```js
   // 用法示例——控制台上下文保持默认的 top（页面的世界）
   typeof chrome                                   // "undefined"
   document.querySelectorAll('[data-duo]').length  // 非零数字
   ```
   两行合起来读：页面世界看不见扩展的 chrome 对象——变量隔离。但它数得出引擎插的译文节点——DOM 共用。
7. 先猜，再试：把 content.ts 里 concurrency 后面的 2 改成 1，重跑 `npm run build:ext`。先猜：已经开着的那个英文页面会自己变吗？猜完再看。
   应看到：纹丝不动。content script 在页面加载那一刻注入，产物更新不会热替换。Chrome 文档的重载表写得明白：content scripts 改动＝扩展重载＋页面刷新。去 chrome://extensions 点卡片上的刷新图标，再刷新页面，改动才生效。
8. 指认好的小破坏：把 manifest.json 里的 `"dist/content.js"` 改成 `"dist/nope.js"`，保存后到 chrome://extensions 点卡片刷新。
   应看到：卡片上出现红色 Errors 按钮，点开写着 Could not load JavaScript 'dist/nope.js' for content script.——manifest 指到不存在的文件，Chrome 如实报错。改回原样、重载，恢复如初。
9. 双门槛：`npm run typecheck && npm test`。
   应看到：两条命令零报错，74 个测试全绿（第 2 章 9、第 3 章 7、第 4 章 8、第 5 章 13、第 6 章 10、第 7 章 10、第 8 章 9、本章 8）。

第 1 章结尾那句预告，到这里兑现：「等第 9 章把扩展装进浏览器，你可以回到今天这个英文页面——只不过那个翻译按钮，换成你自己写的。」现在就回去看看。

## 小结：主线问题，全书作答

开篇的缺口补上了：jsdom 全绿之后，你亲手加载扩展——在真实的英文页面上，看着自己写的引擎逐段插出译文。全书开卷那句主线问题——「原文纹丝不动的页面上，译文是怎么逐段长出来的——还跟得上无限滚动？」——现在一句一句答完：

- 原文为什么纹丝不动？第 3 章的兄弟节点插入：译文是原文正后方的新节点，原文子树零接触；本章的隔离世界再加一层——页面的 JS 环境也零接触。
- 译文怎么「逐段」长出来？第 2 章的可译块按文档顺序排队；第 7 章的批量接口把句子装袋、并发上限压住节奏，译文回来一段插一段；标记属性与幂等兜底，重复不叠。
- 代码与导航为什么幸免？第 2 章的跳过规则整枝剪掉 code、nav、footer——那是第 1 章钩子里「代码被翻译得面目全非」的反面。
- 无限滚动跟得上吗？第 8 章的 MutationObserver 盯住子树，新块只翻新来的；两道摘法把自己插的译文摘出去，译文生译文的雪崩在源头掐灭。
- 钱呢？去重加内容寻址缓存：同样的话只翻一次；并发上限防着限流。

九章攒下的能力阶梯，从底往上数一遍：

| 章 | 你已经能 |
|---|---|
| 01 | 讲清整页替换与双语对照的本质差异：字符串替换 vs 在 DOM 树上做增量 |
| 02 | 树遍历抽出可译块——直接文本的账本、跳过规则四族、长度门槛 |
| 03 | 兄弟节点插入＋标记属性＋幂等：原文一个字不动 |
| 04 | 依赖注入：引擎不认识任何翻译服务；假翻译器让全链路离线可测 |
| 05 | 占位标记保内联格式——strong/a/code 在译文里活回来（内联切分的取舍也过过手） |
| 06 | 链接密度与文字密度的启发式认正文区，边界如实登记 |
| 07 | 去重、内容寻址缓存、批量打包、并发上限——翻译的经济学 |
| 08 | MutationObserver 增量翻译，自触发循环两道摘法拆掉 |
| 09 | manifest＋content script 薄壳，把以上全部装进真浏览器 |

家底盘点：src/ 十个模块约 854 行、壳 44 行，1000 余行测试托底——全部离线可跑。与真实产品的差距不藏在心里，记在书末差异清单附录：壳无开关，上页即跑、每个 http/https 页面都注入；mainContentOnly 的闸装了没拉（壳走全页翻，侧栏标签也会进账）；译文是裸 p，没有浅色字号这些样式注入；假翻译器只贴前缀，接真 API 的密钥、计费、流式都在清单里。这份清单，就是你的下一站路线图。

### 自查三问

先自己答，再展开对照。

::: details 1. 预测：把 manifest 里的 matches 改成只剩 `"https://*/*"`，重载扩展后打开一个 http:// 开头的页面——会发生什么？
一个译文也没有：content script 根本没注入。注入范围由 manifest 声明、Chrome 按清单放行——引擎代码一行没变，行为却变了。声明式配置的权力与分寸都在这。回查「manifest：一张字段表读懂本壳」与 matches 的匹配演算。
:::

::: details 2. 设计取舍：真实的翻译工具有工具栏开关、快捷键、按站点配置——壳为什么一个都不做，上页即跑？
那些属于扩展的另一半世界（action、popup、service worker、消息通道），与引擎原理无关；薄壳把「引擎如何在真页面落地」这一件事做透。要加开关，引擎与壳都不用改：加一个 background 发消息，壳改听 chrome.runtime.onMessage 再决定开机与否。这条差距已登记差异清单。回查「演练」的三处停一停。
:::

::: details 3. 动手：把 startShell 里的 `useCache: true,` 删掉、`concurrency: 2` 删掉，先猜 npm test 红几条，再跑。
0 条红——壳测试钉的全是 DOM 结果（节点数、位置、文本、原文不变），档位是「请求怎么飞」的经济账，不改变渲染结果；账单类断言住在第 7 章的测试里（计数器数单）。这正是壳测试与引擎测试的分工：壳管「装上去对不对」，引擎管「账算得省不省」。改回去恢复 74 绿。回查「演练」的测试分两撮。
:::

### 接下来去哪

正文九章到此收官。三个附录各司其职：

| 附录 | 拿它做什么 |
|---|---|
| 术语表 | 全书概念的一句话人话版，速查 |
| 节点分类速查表 | 自己写跳过规则、扩块级清单时翻 |
| 与真实产品的差异清单 | 你的下一站路线图 |
