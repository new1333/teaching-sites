---
title: 第 16 章 从地图回到地图：全书能力对账
---

# 从地图回到地图：全书能力对账

## 工具箱

本章不教新积木，只做全书对账。要用到的四块全部来自第 1 章，先把接口摆上桌。

- 所有权地图 — 判断改动该落在哪个 crate 的查表入口，正本是 architecture.md 的两栏合同（[第 1 章](./01-repo-map.md)）。
- crate 依赖方向 — 依赖只能由外向内：application 可依赖 core，core 不依赖 application、不沾渲染包（[第 1 章](./01-repo-map.md)）。
- ratchet 预算 — 超标旧文件的行数额度只减不增；动在册文件前先核对 architecture/file-budgets.txt（[第 1 章](./01-repo-map.md)）。
- SHA 钉版 — 关键依赖用完整 40 位 SHA 钉在自有 fork 基线上，禁 branch 与 tag（[第 1 章](./01-repo-map.md)）。

## 同一张表，第二次读

把 docs/architecture.md 再打开一次。第 1 章初见时，它是一张 19 行的陌生合同；现在每行左栏背后都住着一段你亲手走过的机制故事。nebula_terminal 那一行是转义序列落进网格的账本；nebula_split 那一行是一棵不含任何 UI 类型的树；ai_hook 那一行是五层流水线加一扇裁决门。

然后做一件第 1 章做不到的事。同事丢来三个需求：向下分屏想加一组顺手键位；能不能交换左右两个 pane；刚发布的某个 AI CLI 想接进来。每个需求都要当场回答三件事：落点在哪个 crate、禁区在哪一行合同、影响面铺到哪几个子系统。这三问就是本章的全部动作——对账，拿第 1 章的地图逐一核对十五章攒下的能力，看哪些行真正归你所有。

两个流行的错觉先放在明处。其一，「读完十五章等于会改任何模块」：下面的对账会给出相反的证据，讲不出机制故事的行，就是还没到手的能力。其二，「预算和钉版是维护者的事」：上面三个需求里有两个会直接撞在治理合同上——预算不是背景板，是改动成本的一部分。

## 十五段机制故事

对账表如下。每行三个锚：章（走读正文）、探针（锁定 clone 上可复跑的断言）、积木（这块特性向全书提供的能力单元）。**对账的单位是积木**——要核对的是接口口径还在不在、能不能被新改动直接调用，与你还记不记得那章的情节无关。

| 特性 | 章 | 机制故事 | 积木 | 探针 |
|---|---|---|---|---|
| workspace-governance | [第 1 章](./01-repo-map.md) | 九个 crate 的 workspace、19 行两栏所有权合同、可机器检查的依赖方向，外加行数与体积两份预算 | 所有权地图、crate 依赖方向、ratchet 预算、SHA 钉版、命名双轨 | `companion/scripts/probe-01-repo-map.mjs`（24 条） |
| vt-core | [第 2 章](./02-vt-grid.md) | 彩色输出、局部刷新与「乱码」是同一台状态机：vte 解析转义序列、网格单元格落库、damage 只记坏区，TermMode 位域含 DECSET 2031 私有扩展 | VT 转义序列、网格与单元格、TermMode 位域、damage 追踪 | `companion/scripts/probe-02-vt-grid.mjs`（25 条） |
| pty-bridge | [第 3 章](./03-pty-event-loop.md) | shell 输出的跨线程旅程：PTY 伪终端、事件循环分块搬运、FairMutex 保到达序；resize 后 ConPTY 对账用静默期吸收重放 | PTY 伪终端、ConPTY 对账、事件循环、FairMutex | `companion/scripts/probe-03-pty-event-loop.mjs`（27 条） |
| split-tree | [第 4 章](./04-split-tree.md) | 分屏内核是零依赖的纯数据布局树：切割次序合同保证不留 0 宽 pane，关闭是摘叶手术，树叶集合不变式是树与视图的对账判据 | 纯数据布局树、切割次序合同、树叶集合不变式 | `companion/scripts/probe-04-split-tree.mjs`（25 条） |
| gpui-shell | [第 5 章](./05-gpui-shell.md) | pane 生命周期三件套加 prepaint 回写（网格跟手、子进程松手落定），再加显式 shutdown 与 Drop 双保险 | GPUI Entity、prepaint 回写、pane 生命周期、资源清理合同 | `companion/scripts/probe-05-gpui-shell.mjs`（28 条） |
| ssh-session | [第 6 章](./06-ssh-session.md) | 同一套 Term 与渲染栈吃本地也吃远端：分叉在会话边界，一条 russh 连接多路复用，jump 路由解析成类型化计划，SshEventHost 是协议与宿主的接缝 | 传输层无关、russh 连接复用、jump 路由、SshEventHost | `companion/scripts/probe-06-ssh-session.mjs`（27 条） |
| sftp-engine | [第 7 章](./07-sftp-engine.md) | 下载慢的第一因是单在途 READ 上限（吞吐封顶在分块除以 RTT）；多句柄分段把在途叠到 64 个，进度与取消走 trait 接缝 | 单在途 READ 上限、多句柄分段、进度/取消接缝 | `companion/scripts/probe-07-sftp-engine.mjs`（29 条） |
| ai-hook-bridge | [第 8 章](./08-ai-hook-bridge.md) | 492 行 std-only 小进程做到隐形（panic 也退 0）、作用域化（环境变量哨兵）、有界（1 MiB 与 2 秒），信封经命名管道进宿主 | 命名管道桥、环境变量哨兵、隐形合同、有界转发 | `companion/scripts/probe-08-ai-hook-bridge.mjs`（19 条） |
| ai-lifecycle | [第 9 章](./09-ai-lifecycle.md) | 五层流水线 transport→payload→typed→ordering→lifecycle：方言锁死在解析层（六变体），GateVerdict 带原因裁决，能力档位表决定屏幕回退 | 类型化事件、门控排序、能力集分层 | `companion/scripts/probe-09-ai-lifecycle.mjs`（37 条） |
| screen-evidence | [第 10 章](./10-screen-evidence.md) | 无钩子 CLI 靠看屏幕推断：底部至多 24 行取样、区域规则圈地、负向证据排除反例、优先级裁决，证据不足时返回 None 不伪造 | 屏幕证据、区域规则、负向证据、规则优先级 | `companion/scripts/probe-10-screen-evidence.mjs`（30 条） |
| session-persistence | [第 11 章](./11-session-persistence.md) | 1Hz 快照跳过无变化帧、原子落盘；boot_attempts 三连败断路隔离现场；v4 schema 记整棵树，同格式兼作导出 | 快照节奏、恢复护栏、版本化 schema | `companion/scripts/probe-11-session-persistence.mjs`（24 条） |
| lua-config | [第 12 章](./12-lua-config.md) | vendored Lua 5.4 只执行本地文件；诊断作用域把 serde 的第一个错误换成一张清单；SerdeReplace 只替换出现的字段 | Lua 配置沙界、诊断作用域、SerdeReplace | `companion/scripts/probe-12-lua-config.mjs`（29 条） |
| native-math | [第 13 章](./13-native-math.md) | 五段管线 parse→validate→layout→compile→rasterize 不认识窗口；光学缩放 1.21 与下限 0.8 是写明理由的取舍；常量双路径共享 | 排版编译管线、光学缩放、共享常量合同 | `companion/scripts/probe-13-native-math.mjs`（23 条） |
| answer-reader | [第 14 章](./14-answer-reader.md) | 回答原文在信封解析处装进三态信封；阅读器复用 math 编译入口（同一入口、零份拷贝）；文档 tab 与渲染器无关 | 回答捕获、文档 tab 模型、管线复用结构 | `companion/scripts/probe-14-answer-reader.mjs`（20 条） |
| completion-engine | [第 15 章](./15-completion-engine.md) | 从 Nushell 抽出的零 UI crate：实现 Completer::fetch 即注入新源，三级匹配、Smart 排序按分数降序同分字典序 | Completer trait 接缝、模糊匹配排序 | `companion/scripts/probe-15-completion-engine.mjs`（31 条） |

十五个探针可以一键复跑：在 companion 目录执行 `node scripts/run-all.mjs`，末行打出 `run-all: 15/15 probes passed`，合计 398 条断言。本章是复盘章，不新增探针——它的验证物就是这十五个探针，加上三问本身。

### 治理账之一：ratchet 预算对齐

第 1 章收束处留了一行去向：ratchet 预算与 SHA 钉版要在终章与全部子系统对账。现在兑现，先对预算。

先对数。治理文档（architecture.md 与 project-constraints.md）写的是「采纳时十一个超标文件」；锁定 ref 上的 file-budgets.txt 实际剩 9 条 allowance，limit 2000。两个数字都真：采纳时 11 个，其中两条此后离开了名单，离开的方式预算表本身看不出来。引用时双口径并写，不替仓库圆成同一个数。

再把 9 条放回特性地图。nebula_terminal/src/term/mod.rs（额度 2713 行，当前 2579 行）是 vt-core 的心脏文件，第 2 章的网格状态机就住在这里。nebula_app/src/gpui_shell/workspace.rs（额度 4798 行，当前 3346 行）是 gpui-shell 的正身，第 11 章的壳侧接线是它的子模块。其余 7 条属于旧渲染区与旧壳：display 区五件、event.rs、window_context.rs。第 1 章把 display 与 renderer 划为「不得再成为新功能的来源」；window_context 是第 9 章里与 GPUI 壳共用一扇门的另一个壳。

对账的结论是方向性的。十五章讲的特性，没有一个靠往在册文件里堆行落地；模板是第 4 章——共享分屏规则从 window_context 巨石里抽成零依赖的 nebula_split，治理方向是搬出、不是膨胀。反过来说，凡是要动在册文件的改动，**预算合同先于代码评审**：普通 PR 不能新增或调高 allowance，文件缩小后旧额度作废，不许复用。探针守的是名单的形状（limit 与条数）；行数增量的执法在 PR 侧的 --base 检查，两层各管一段。

### 治理账之二：SHA 钉版对齐

钉版的结构先摆正。gpui_platform 住在 [workspace.dependencies]；gpui 与 gpui-component、gpui-component-assets 住在 [patch.crates-io]——以劫持 crates.io 解析的方式生效。四条 git 依赖全部指向 Kuddev fork、40 位 hex、无 branch 无 tag；gpui 与 gpui_platform 必须 URL 与 rev 双一致，防的是两套同名类型编不过。这些事实由 probe-01 的钉版段钉死，summary 行可随时复跑核对：

```text
# companion/scripts/probe-01-repo-map.mjs 运行输出（节选）
summary [repo-map] members(9)=nebula_app,nebula_terminal,nebula_config,nebula_config_derive,nebula-completions,nebula_hook,nebula_gpui,nebula_settings,nebula_split; gpui@zed rev=fc05d637cc7029d75de051fd7f52c1a0fb8fa6b4; gpui-component rev=fc5f5cf63dd80686dafacd2a6e37345bbd1dc7ba; budgets: limit 2000, 9 allowances
```

与子系统对齐，钉版画出两片世界。一片是渲染面：第 5、9、10、11、14 章里凡出现 Entity、prepaint 或 TextView 的代码，全部站在同一棵钉版树上。换 GPUI 基线等于在 fork 上开分支、迁补丁、四条 rev 一起更新——一次手术同时波及这些章的全部断言。另一片是零 UI 面：dependencies.toml 的 renderer_packages 七包名单由机器看守，core 层一行不沾。第 4 章的零依赖探针、第 7 章的引擎零 UI 符号、第 15 章的依赖面清点，都是这条机器合同的受益者。钉版因此不是运维细节，它是「哪些章共享同一棵事实树」的边界声明。

## 三个跨子系统改动

对账不能只停在表上。三个需求逐一走通「落点 → 禁区 → 影响面」，全部调用前面章建立的积木，不新教任何机制。

### 场景一：给向下分屏加一种新键位

现状是 ctrl+shift+s 触发向下分屏，团队想再加一组单手键位。

落点。键位绑定是命令与订阅的接线，地图把这一栏判给 nebula_app/src/gpui_shell。合同原文点名：GPUI views, UI state, commands and subscriptions。动作本身不用新写：分屏是树上一次 split_leaf，比例交给切割次序合同钳制。新 pane 的尺寸由 prepaint 回写走结构性分支插队落定（[第 5 章](./05-gpui-shell.md)）。若键位要做成用户可配置项，默认值与偏好合同落在 nebula_settings。用户侧接第 12 章的配置管道：写错字段名会进诊断作用域的清单，改值走 SerdeReplace 补丁（[第 12 章](./12-lua-config.md)）。

禁区。nebula_terminal 的右栏明写不得变成 GPUI 状态：终端核心是网格与 VT 处理，不该认识任何键位（[第 2 章](./02-vt-grid.md)）。nebula_split 也不收——它的 owns 是树、几何与导航规则，键位不在其中；往零依赖 crate 里塞输入语义，等于拆掉它可独立测试的前提（[第 4 章](./04-split-tree.md)）。

影响面。最大的一处来自 ratchet 预算：命令接线的家 workspace.rs 在册，额度 4798 行、只减不增——新键位要么挤进预算，要么顺手把命令块搬出巨石文件。会话面没有波及。v4 快照记的是启动身份、整棵树与焦点下标；键位不是会话状态，正如 broadcast 开关只活在内存（v4 快照结构见[第 11 章](./11-session-persistence.md)）、绝不写进快照（[第 5 章](./05-gpui-shell.md)）。

判据：改完跑 `node scripts/probe-05-gpui-shell.mjs`，28 条不该有红的——键位不碰三件套、回写与清理链；预算面的增量交给 PR 侧检查，探针只守名单形状。

### 场景二：加「交换两个 pane」

需求：把焦点 pane 与右邻互换位置，几何不动、身份对调。

落点。交换是树的结构操作，第一落点 nebula_split：对调两个叶子的归属。新操作与 split_leaf、remove_leaf、dock_at_leaf 同住一个 crate，产物仍是纯数据布局树（[第 4 章](./04-split-tree.md)）。第二落点 gpui_shell：命令接线、焦点裁定与三件套同步——panes 与 tree 两本账必须一起动，**树叶集合不变式就是验收口径**（[第 5 章](./05-gpui-shell.md)）。

禁区。nebula_split 不得引入任何 UI 类型：交换是几何操作，不需要认识视图。也不许把新行为写进旧壳 window_context/split.rs 那份冻结实现之外另起炉灶——它是记录在案的既有裁定（[第 4 章](./04-split-tree.md)）。

影响面有三处。其一，冻结同步义务：锁定 commit 的现状是「改规则时两处同步，直到 P3 接入完成」，新行为要同时落进 nebula_split 与冻结旧壳。其二，resize 语义：交换改变两个 pane 的几何归属，属于结构性变化，走 prepaint 回写的插队分支而不是 150ms 去抖（[第 5 章](./05-gpui-shell.md)）。其三，会话快照。树叶集合没变、树形没变，v4 的 layout 字段重新生成即可反映新排列，不需要动 schema。若某天新行为要往树里加数据，版本化 schema 的两条正道等着它：追加可选字段走缺省，改结构才升 v5（[第 11 章](./11-session-persistence.md)）。

判据：树侧跑 `node scripts/probe-04-split-tree.mjs`——若新操作破坏了切割或摘叶的合同，常量与次序断言先红；壳侧跑 probe-05，三件套与 shutdown 计数不该变。

### 场景三：接入一个新 AI CLI

需求：刚发布的 CLI「foo」想获得徽标状态与完成通知。

落点是一条链，按事件流向排。入口在 nebula_hook：给 foo 一个 source 名、决定载荷走 stdin 还是末位参数。挂载点是 payload_on_stdin 的 match 臂加一条（[第 8 章](./08-ai-hook-bridge.md)）。解析与归一在 nebula_app/src/ai_hook：protocol.rs 加一条方言分支，产出仍是六个变体的类型化事件；capabilities_for 加一档，如实记下 foo 报不了什么（[第 9 章](./09-ai-lifecycle.md)）。安装侧同样归 ai_hook 的 owns——安装策略是这行合同的一部分。foo 若没有钩子能力，回退层是 agent_detection 的一份 TOML 规则。判据同一套：区域规则选窗口、负向证据排除反例、规则优先级排裁决顺序；证据不足时宁可不写规则（[第 10 章](./10-screen-evidence.md)）。

禁区有三条。JSON 解析不许进 nebula_hook。它是 std-only 的零依赖合同，冷启动预算毫秒级，注释原话 Pebrel parses——JSON 工作全部在宿主侧（[第 8 章](./08-ai-hook-bridge.md)）。屏幕关键词规则不许进 ai_hook 层，ai_agents 的屏幕观察也不得越权改写钩子结果。两张地图行各管一边（[第 9 章](./09-ai-lifecycle.md)、[第 10 章](./10-screen-evidence.md)）。不许为 foo 在某个 UI 壳里单养一台状态机：两个壳共用同一台 AgentActivity，这本身写在禁区里。

影响面。路由按信封里的 pane 号严格进行，pane 已关闭即丢弃——pane id 终生不复用是这条路的前提（[第 5 章](./05-gpui-shell.md)）。门控排序按 source 加会话加 pane 加进程身份记流，foo 是新流键、从零记账。串台要设防：若别家 hook runner 也读 foo 的全局配置，FOREIGN_HOOK_RUNNERS 的教训在前（[第 8 章](./08-ai-hook-bridge.md)）。远端 pane 走 OSC 旁路，载荷上限收紧到 64 KiB。UI 面应当零改动——foo 的事件进的是同一个类型化事件与同一台状态机，两个壳的徽标自动一致。

判据可自查：若接入 foo 需要在 UI 代码里 grep 得到 foo 字符串，说明方言漏进了下游——**分支只许住在解析层**，这是第 9 章立下的合同。

## 验证：把对账跑给自己看

四步，每步先落笔再动手。

第一步，先猜后跑。在 companion 目录执行 `node scripts/run-all.mjs` 之前，写下三个离散值：探针通过数（整数）、合计断言数（整数）、probe-01 summary 行里 budgets 段的 allowance 条数（整数）。答案：15/15、398、9——合计数由各探针 PASS 行的分数自行累加，runner 不单列总数行。任何一项对不上，说明锁定 clone 与课程版本脱节，先解决再往下。

第二步，抽行复述。从对账表挑两行：自选一行，再加第 7 行（SFTP）。合上书，各讲一遍机制故事。判据不是背诵原文，是三个追问能答上：下载慢的第一因是什么？上传方向为什么不需要多句柄？进度条为什么不在引擎里？讲不出的那行，就是你与「会改这个模块」之间的距离。

第三步，定向破坏（纸面）。三处指认，每处先预言哪个探针红、哪些不红，再对答案：

- 把 nebula_split 的 CLOSE_MARGIN 从 0.06 改成 0.10。probe-04 的常量断言红——它守的是「引用与锁定源码逐字一致」的事实合同；probe-01 不红——它守 workspace 治理面，两个探针互不越界。
- 把 architecture/file-budgets.txt 的 limit 2000 改成 3000。probe-01 的预算断言红（它断言 limit 恰为 2000、9 条 allowance 全部大于 2000）；分屏与壳的探针全体不红——预算是治理面，不是行为面。
- 把 [patch.crates-io] 里 gpui 的 rev 换成 branch 引用。probe-01 的钉版断言两条红（fork 指向、无 branch 无 tag）；真实编译后果是两套同名类型回来，正是第 1 章注释警告过的事故。

第四步，解释结果。红与不红合起来读：每条断言守一份独立合同，探针矩阵就是十五章断言的回归网——你在纸面改的每一处，恰好只有守它的那几条变红。这就是对账的机械化形态。

## 收束

全书的开卷之问在这里收口：「一个 GPU 加速终端如何同时成为 SSH 工作区与 AI CLI 会话的家？」答案由积木拼成。所有权地图与依赖方向把九个 crate 钉成单向流动的层；终端本体（字节到网格、damage 只记坏区）加上传输层无关，让同一套栈既吃本地 PTY 也吃 SSH channel；壳（Entity、prepaint 回写、pane 生命周期）把多个会话组装进一棵可持久化的树；AI 宿主线（命名管道桥、类型化事件、门控排序、屏幕证据回退）挂在 pane 生命周期上，不惊动渲染；ratchet 预算与 SHA 钉版保证这一切在长跑里不腐化。SSH 工作区与 AI 会话不需要两套房子——它们是同一张网格、同一棵树、同一扇门的两种租客。

回到开篇的三个需求。你现在拥有的不是三个答案，是一台可复算的对账机器：任何改动先过地图判落点，再读右栏划禁区，最后沿积木链铺影响面。两个错觉也都有了着落——对账表里讲不出机制故事的行，就是你的真实边界；而三问里有两问撞进治理合同，预算与钉版从来都是改动者的事。本书的事实全部锚定在锁定 ref 上，探针在任何人手里都可复跑；地图之外的世界，交给这张表教给你的读法去应对。想把屏幕证据的判据用一个真实 CLI 演练一遍，练习在附录等你。

### 自查

1. 一个 PR 想在 nebula_terminal 里直接处理「ctrl+alt+向下」并在 Term 里开分屏。它踩了哪两份合同？正确的落点链是什么？
2. 治理文档写 Eleven、预算表剩 9 条。接手一个要改在册文件的 PR 时，你按哪个数做决定？引用时怎么写才算诚实？
3. 接新 CLI 时，解析代码为什么不许进 nebula_hook？该落在哪一层、哪两处各加什么？

<details><summary>参考答案</summary>

1. 踩所有权地图——nebula_terminal 行的 must not become 写着不得变成产品面板或 GPUI 状态；也踩 crate 依赖方向——core 不做命令与订阅的接线。正确链：键位与命令在 gpui_shell，动作复用 nebula_split 的树操作，尺寸经 prepaint 回写落定。（回查场景一。）
2. 按预算表现行的 9 条做决定——那是锁定 ref 上的合同现状；引用时写「采纳时 11 个、当前预算表 9 条」，两个口径都真，不圆成同一个数。（回查治理账之一。）
3. nebula_hook 是 std-only 的零依赖合同，冷启动预算毫秒级，注释明说 Pebrel parses；解析落在 nebula_app/src/ai_hook 一层——protocol.rs 加方言分支，event.rs 的 capabilities_for 加一档。（回查场景三。）

</details>
