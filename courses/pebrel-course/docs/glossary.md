# 术语表

全书 52 块积木的接口面。定义列只给一句话，建立面的完整展开在各自首教章。

| 术语 | 英文 | 一句话定义 |
|---|---|---|
| 所有权地图 | ownership map | docs/architecture.md 用 owns / must not become 两栏合同固定每块代码的职责与禁区，保证 composition → capabilities → domain 的依赖方向不被腐蚀 |
| crate 依赖方向 |  | workspace 规定 domain crate（terminal/split/config）不依赖 UI 与平台能力，capability 聚合在 nebula_app，方向只能由外向内 |
| ratchet 预算 |  | 对 11 个超大旧文件施加的只减不增体积约束，防止遗留路径在重构中再膨胀 |
| SHA 钉版 |  | GPUI 等关键依赖用完整 commit SHA 固定在自有 fork 基线上，禁用 main 分支与通配版本，避免两套 gpui 类型并存 |
| 命名双轨 |  | 项目由 Nebula 改名 Pebrel 后，crate 名仍为 nebula_*、环境变量 PEBREL_*/NEBULA_* 并存，以兼容旧配置与旧安装 |
| VT 转义序列 | VT escape sequence | shell 输出中以 ESC（0x1b）开头的控制序列（CSI/OSC 等），由 vte 解析器切分成结构化调用，驱动网格状态变化 |
| 网格与单元格 | grid & cell | Term 用行存储组织屏幕状态，每个单元格持有字符、样式与换行标志；滚动区、光标与尺寸变化都作用在网格上 |
| TermMode 位域 |  | 用位标志集合表示终端模式（如换行模式、光标可见性），DECSET/DECRST 序列置位或清位，含 2031 主题订阅这类私有扩展 |
| damage 追踪 |  | 网格记录自上次渲染以来变化的最小区域，渲染侧只重绘损坏部分而非全屏 |
| PTY 伪终端 | pseudo-terminal | 内核提供的一对主从设备，让 shell 以为自己在跟真实终端对话，实际对端是终端模拟器进程 |
| ConPTY 对账 |  | Windows ConPTY 在 resize 后会重放内容并对齐光标，event_loop 用 ALIGN_DELAY 静默期吸收重放序列，避免用户看到闪烁错位 |
| 事件循环 | event loop | nebula_terminal 的 I/O 线程主循环：polling 等就绪、分块读字节、喂给 Term、发 UI 通知，READ_BUFFER_SIZE 控制每次读取上限 |
| FairMutex |  | sync.rs 实现的公平互斥锁，按到达顺序授予锁，避免 UI 线程在 PTY 高压输出下饿死 |
| 纯数据布局树 |  | nebula_split 用纯数据 + 纯函数表达分屏切割，不引用任何 UI 框架类型，因此可独立测试 |
| 切割次序合同 |  | split 切割的执行次序被固定为合同：先 floor 取整、再双向钳到至少一个单元格宽，第二段吃余数；提交比例另经 RATIO_CLAMP 硬钳带（CLOSE_MARGIN 属关闭手势阈值），保证任何比例下不留 0 宽 pane |
| 树叶集合不变式 |  | 『pane id 集合 == 树叶集合』的等式，是树与视图层对接的验收口径，破坏即出现幽灵 pane 或丢 pane |
| GPUI Entity |  | Zed GPUI 框架的响应式对象模型：实体持状态、Context 提供订阅与更新入口，渲染由框架调度 |
| prepaint 回写 |  | 终端元素在渲染 prepaint 阶段把最终像素尺寸换算成行列并回写 PTY，形成 resize 的 burst + settle 合同 |
| pane 生命周期 |  | workspace 用 panes + SplitTree + focused 三件套管理 pane；关闭由 tree.remove_leaf 裁定，显式 shutdown 后 Drop 兜底清理 |
| 资源清理合同 |  | GPUI 侧约定显式 shutdown 先行、Drop 兜底的双保险结构，避免依赖 Drop 时机这种不可控因素 |
| 传输层无关 |  | 同一套 Term/渲染/键盘栈既吃本地 ConPTY/PTY 也吃 SSH channel，输入缩放关闭消息协议统一，传输层被抽象在会话边界之外 |
| russh 连接复用 |  | 一个 russh 客户端连接上多路复用多个 channel（终端、SFTP、agent），直连与 jump 路由在连接建立前解析 |
| jump 路由 |  | ssh_session/route.rs 把 user@host 经由跳板机到达目标的路径解析为逐段连接计划 |
| SshEventHost |  | 把 russh 异步事件桥接到宿主 UI 事件的回调抽象，让一条业务路径同时服务两个 UI 壳 |
| 单在途 READ 上限 |  | SFTP 协议单个句柄同时只有一个在途 READ 请求，顺序读吞吐被分块大小/RTT 封顶 |
| 多句柄分段 |  | 对同一远端文件开多个句柄，每句柄负责一段连续区间的并行下载策略，绕开单句柄在途上限 |
| 进度/取消接缝 |  | TransferObserver trait 把进度与取消从传输引擎中解耦出来，UI 侧只依赖回调不依赖引擎类型 |
| 命名管道桥 |  | 独立小进程 nebula-hook 被 Claude/Codex 等 CLI 的钩子机制调用，把原始载荷经命名管道转发给宿主进程 |
| 环境变量哨兵 |  | 宿主用 PEBREL_NOTIFY_PIPE 等环境变量向钩子进程指明管道地址；变量只在 Nebula/Pebrel 内存在，天然限定作用域 |
| 隐形合同 |  | 钩子进程的约束：任何路径含 panic 必须退出码 0，绝不能让宿主 CLI 因钩子失败而中断用户任务 |
| 有界转发 |  | 钩子桥对载荷 1MB 上限、2s 转发超时的边界约束，防止异常载荷拖垮管道 |
| 类型化事件 |  | 把异构 CLI 的原始载荷归一为 Rust 类型系统里的有界事件枚举，UI 只消费类型不解析文本 |
| 门控排序 | GateVerdict | ordering 层对事件批次做时序裁定，不合规批次被拒绝并携带原因，保证 pane 生命周期状态机收到有序输入 |
| 能力集分层 |  | 分层原则：钩子优先提供结构化事件，屏幕证据只作为缺失能力的回退层，UI 绝不用扫描终端文本重新解释已有钩子 |
| 屏幕证据 | screen evidence | 从终端网格提取结构化观察（底部 N 非空行、最后分隔线之后区域），按 TOML 规则推断 AI CLI 的 idle/working/blocked 状态 |
| 区域规则 |  | TOML 规则按屏幕区域限定匹配范围，避免全屏误匹配（提示符只出现在底部区域） |
| 负向证据 |  | 用 not 条件排除假阳性：『看见提示符 ≠ 空闲』，因为回合中输入框同样可见，需要组合反向条件才可信 |
| 规则优先级 |  | 多条规则命中时按优先级裁决（如 blocked 压过 idle），注释中保留规则演化史 |
| 快照节奏 |  | 会话以 1Hz 持续快照且跳过无变化帧，崩溃后恢复到一秒内的状态 |
| 恢复护栏 |  | boot_attempts 三连败即放弃恢复、回退新会话，打破『恢复→崩溃→再恢复』的循环 |
| 版本化 schema |  | 会话文件带版本号（当前 v4），记录整棵分屏树与每 tab 启动身份，同一格式兼作工作区导出文件跨机器移植 |
| Lua 配置沙界 |  | vendored Lua 5.4 只执行本地受信配置文件，require 'pebrel'（旧 'nebula' 同表兼容），不执行网络来源代码 |
| 诊断作用域 |  | nebula_config 用 thread-local 作用域捕获 unknown/deprecated/invalid 字段诊断，serde 反序列化全程可回溯到具体字段 |
| SerdeReplace |  | 只替换配置中出现的字段、保留其余默认值的局部热更新机制，配合 TOML/Lua 双格式 |
| 排版编译管线 |  | parse → validate → layout → compile → rasterize 的 TeX 公式处理流水线，与窗口系统/OpenGL 无关（IR + 缓存 + 位图） |
| 光学缩放 |  | Latin Modern 字体按 1.21 系数做光学尺寸缩放、最小上下标 0.8 倍，是刻意偏离 KaTeX 的排版取舍 |
| 共享常量合同 |  | 最小可读字号等常量在两条渲染路径（覆盖层/阅读器）间共享，保证判定一致：字号不足时统一回退源码文本 |
| 回答捕获 |  | 从 AI CLI 会话中捕获完整回答并存为可打开文档的行为，是『终端即 AI 工作台』的入口 |
| 文档 tab 模型 |  | text_document 维护无 WebView 的原生文档页（Markdown/公式/源码/本地图片），与终端 tab 并列 |
| 管线复用结构 |  | 回答阅读器复用 native-math 的编译入口而非另造渲染器，是『共享一个编译入口』式的复用范式 |
| Completer trait 接缝 |  | nebula-completions 从 Nushell 补全框架抽出的扩展点：实现该 trait 即可注入新的补全源，输出类型与终端视图无关 |
| 模糊匹配排序 |  | nucleo-matcher 对候选做前缀/子串/模糊三级匹配并按得分排序，是补全体验的排序层 |
