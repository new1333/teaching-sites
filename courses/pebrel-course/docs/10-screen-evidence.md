---
title: 第 10 章 屏幕证据：为未知 CLI 写状态推断规则
---

# 屏幕证据：为未知 CLI 写状态推断规则

## 工具箱

屏幕推断要站在两块旧积木上，先把接口摆出来：

- **能力集分层**——「该加钩子还是加屏幕规则」的裁决依据：钩子优先给结构化事件，屏幕只补缺口（[第 9 章](./09-ai-lifecycle.md)）。
- **网格与单元格**——屏幕一切可见状态的家：每个单元格持有字符与样式，屏幕快照就是从这张网格上取出的纯文本（[第 2 章](./02-vt-grid.md)）。

手边有这两块，一条状态推断规则从数据源到裁决层都能自己走通。

## 一个没接上钩子的 CLI

Codex 在 pane 里跑，侧栏亮着蓝点，回合结束弹通知。这条链路你已经走透过：CLI 调用钩子桥——一座命名管道桥——把载荷送进宿主，宿主把异构载荷归一成类型化事件、过门控排序，再进状态机。现在换一个刚发布、什么都不支持的 CLI。钩子不存在，环境变量哨兵没处可设，宿主一个事件也收不到，侧栏一片灰。可它的界面上明明印着「esc to cancel」，你一眼看得出它在等你确认——宿主为什么看不出？

因为还有最后一层可退，你手里的能力集分层积木正好在这里被真实调用：钩子是第一层，结构化事件拿得到就绝不用猜；**屏幕证据**——直接检查终端网格上的文字来推断 CLI 状态——只作为缺失能力的回退层。这一层的全部家当是一组 TOML 规则。写规则的人很快会撞上三个词：这条特征住在屏幕哪里（区域规则）、看见什么也不算数（负向证据）、多条规则同时命中听谁的（规则优先级）。

新手的第一版规则几乎总是同一句话：看见提示符，就算空闲。本章要证明这句话错在哪、错一次的真实代价是什么、以及正确写法长什么样。

## 屏幕快照从哪来

先把「看屏幕」落到机械层面。宿主看的不是像素，是网格文本。取样代码在终端视图里：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/gpui_shell/terminal/view/agent_activity.rs
            let screen = self.agent_activity.allows_screen().then(|| {
                let start = Point::new(Line((lines - lines.min(24)) as i32), Column(0));
                let end =
                    Point::new(Line(lines as i32 - 1), Column(term.columns().saturating_sub(1)));
                term.bounds_to_string(start, end)
            });
```

取样由一只 1 Hz 的看门狗驱动，逐个终端 pane 敲门：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/gpui_shell/workspace/agents.rs
    /// 1 Hz 遍历所有终端 pane 跑屏幕看门狗（旧壳 `refresh_agent_screen_states`
    /// 的调度对应物）：纠正丢边的 hook 状态、给无 hook 客户端补位。非
    /// agent pane 在 view 侧一行判断就退出，代价可忽略。
```

两段接起来是一条完整的取样链。看门狗每秒遍历 workspace 手里的每个终端 pane（pane 的开合由 pane 生命周期管理，[第 5 章](./05-gpui-shell.md)；看门狗只管敲门）。刷新经 GPUI Entity 的 update 通道改视图状态；取样则在 FairMutex 锁下读出 Term，把底部最多 24 行拼成一个字符串，交给规则引擎。这些字符当初可能是裹着 VT 转义序列进来的字节流，解析之后样式与字符落进各自的单元格——快照取的就是单元格里的字符序列。

三个边界让这件事便宜得恰到好处。其一，只看底部 24 行：规则关心的键盘提示都贴着屏幕底部住，上部历史不看。其二，只看字符：单元格样式、TermMode 位域里的模式状态、damage 追踪的重绘账本，规则引擎一概不见——它的世界只有文本行。其三，按节拍轮询：看门狗不挂在渲染帧上，非 agent pane 一行判断就退出。

这份快照对本地与远端一视同仁。本地 pane 的字节经 PTY 伪终端、由事件循环喂进网格；远端 pane 的字节沿 SSH channel 进来——连接由 russh 连接复用承载，直连或经跳板（jump 路由在连接建立前解析成逐段计划）都一样。事件桥接（SshEventHost 那道接缝）的细节在远端章（[第 6 章](./06-ssh-session.md)）。字节汇入同一张网格，规则只对网格说话——传输层无关这条原则让同一套规则服务两种 pane。远端还附带一个好处：宿主看不见远端进程表，CLI 身份本来就只能靠屏幕辨认：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/ai_agents.rs
/// Establish an agent identity from brand-specific terminal chrome.
///
/// This is deliberately separate from [`detect`]: generic status chrome such
/// as a prompt glyph or an interrupt hint can refine a known agent, but must
/// never invent one. The fallback matters most on Windows-hosted WSL panes,
/// where Toolhelp can see `wsl.exe` but not the Linux `codex` process behind it.
```

规则引擎自己的住址也写进了所有权地图：

```text
# Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:docs/architecture.md
| `nebula_app/src/ai_agents` | Agent identity and structurally constrained screen observations | Authority to overwrite hook results or infer remote completion from silence |
```

地图把边界划得很硬。ai_hook 那一行的 owns 写着归一化事实与有界排序，禁区里明确列着 `Screen keyword rules`：事件归事件，关键词规则不许混进钩子层。ai_agents 的禁区写着 `Authority to overwrite hook results`：屏幕观察永远不得越权改写钩子结论。这就是能力集分层的地图表达。规则本身是 agent_detection/ 目录下的 TOML 数据文件，长在 nebula_app 里（命名双轨，[第 1 章](./01-repo-map.md)）。domain crate 对这些规则一无所知——crate 依赖方向照旧由外向内，加一百条规则也不会给 nebula_terminal 添一行代码。

## 区域规则：特征住在屏幕哪里

打开 claude.toml，第一条规则是全文件的样板：

```toml
# Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/agent_detection/claude.toml
id = "claude"
aliases = ["claude-code"]

[[rules]]
id = "live_form_blocked"
state = "blocked"
priority = 900
region = "after_last_horizontal_rule"
contains = ["esc to cancel"]
any = [
  { contains = ["enter to select"] },
  { contains = ["enter to confirm"] },
  { contains = ["do you want to proceed?"] },
  { contains = ["tab to amend"] },
]
```

每个 `[[rules]]` 块声明四件事。id 是名字；state 是命中后主张的状态（idle、working 或 blocked）；priority 参与裁决；region 圈定这场比赛的场地。**区域规则——每条规则用 region 字段声明自己只看屏幕的哪个窗口。**为什么第一步是选区域？因为要找的那些词——「esc to cancel」「enter to select」——是键盘提示，贴着屏幕底部住；而同样的词也会出现在 AI 刚刚输出的正文里，被引用、被列举、被讨论。全屏搜索会把「AI 聊到了 y/n」当成「AI 在问 y/n」。

「全屏匹配和区域匹配效果一样」这个直觉值得先说句公道话：对 grep 来说它就是对的，搜到哪行都算搜到。恰好不成立的地方在于，屏幕上的词有两重身份——正文里的词只是文字，底栏的词才是可点的按钮。区域就是用来区分这两重身份的。引擎支持四种形态：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/ai_agents.rs
fn region<'a>(screen: &'a str, spec: &str) -> &'a str {
    if spec == "whole_recent" {
        return screen;
    }
    if let Some(inner) =
        spec.strip_prefix("after_last_prompt_row(").and_then(|s| s.strip_suffix(')'))
    {
        return from_last_empty_prompt(region(screen, inner));
    }
    if let Some(count) = region_count(spec, "bottom_non_empty_lines") {
        let lines: Vec<&str> = screen.lines().collect();
        let Some(start) = lines
            .iter()
            .enumerate()
            .rev()
            .filter(|(_, line)| !line.trim().is_empty())
            .take(count)
            .last()
            .map(|(index, _)| index)
        else {
            return "";
        };
        return slice_from_line(screen, &lines, start);
    }
```

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/ai_agents.rs
    if spec == "after_last_horizontal_rule" {
        let mut offset = 0;
        let mut last = 0;
        for line in screen.lines() {
            offset = (offset + line.len() + 1).min(screen.len());
            let trimmed = line.trim();
            if trimmed.chars().filter(|character| *character == '─').count() >= 3 {
                last = offset;
            }
        }
        return &screen[last..];
    }
```

whole_recent 是不设限的默认值；bottom_non_empty_lines(N) 自底向上数 N 个非空行，从最早的那个非空行切到屏幕底；after_last_prompt_row(inner) 先取内层区域、再截到最后一个空提示符行之后；after_last_horizontal_rule 取最后一条至少三个 ─ 的分隔线之后的尾部。claude 的确认表单用第四种——表单画在分隔线下方，那就只看分隔线之后。共享基线 _shared.toml 的文件头把整条原则写成三行合同：

```toml
# Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/agent_detection/_shared.toml
# Fallback rules for clients without complete lifecycle hooks. All blocked
# candidates also pass ai_agents::screen_context's live-control/form boundary.
# Shared rules describe keyboard chrome; words in assistant output are not events.
```

第三行是整份合同的灵魂：共享规则描述的是键盘提示；助手输出里的词不是事件。

## 负向证据：提示符为什么不够

现在正面撞上新手规则。claude.toml 的第三条：

```toml
# Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/agent_detection/claude.toml
[[rules]]
id = "prompt_idle"
state = "idle"
priority = 100
region = "bottom_non_empty_lines(4)"
line_regex = ['^\s*❯(?:\s|$)']
not = [
  { contains = ["esc to cancel"] },
  { contains = ["enter to select"] },
  # 输入框在回合进行中同样可见（Claude Code 允许排队输入），所以「看见 ❯」
  # 本身不等于空闲。底栏离输入框足够近时这条 not 直接兜住；离得远时由
  # spinner_working 的更高优先级取胜。
  { contains = ["esc to interrupt"] },
]
```

正向条件只有一个 line_regex：行首的 ❯ 后跟空白。但这条规则的灵魂是 not 数组里的三个 contains。**负向证据——用 not 条件声明「看见 X 也不算数」的反向门槛：not 里任何一条命中，整条规则直接判负。**注释写明了动机，就在引用块中间那三行：输入框在回合进行中同样可见，因为 CLI 允许排队输入。

先替「看见提示符等于空闲」这个直觉说句公道话：在 shell 里它几乎总是对的，`$` 出现就是 bash 在等你，二十年的终端经验都站在它这边。把它带进 AI CLI 恰好不成立的边界只有一条：排队输入。回合进行中输入框照样可见，你打的字排队等着下一轮。于是「看见 ❯」与「空闲」是两件事，中间隔着整段正在进行的回合——负向证据就是用来把这段回合排除掉的。

not 的裁决语义在引擎里只有六行：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/ai_agents.rs
impl CompiledGate {
    fn matches(&self, text: &str) -> bool {
        let lower = text.to_lowercase();
        self.contains.iter().all(|needle| lower.contains(needle))
            && self.regex.iter().all(|regex| regex.is_match(text))
            && self.line_regex.iter().all(|regex| text.lines().any(|line| regex.is_match(line)))
            && self.all.iter().all(|gate| gate.matches(text))
            && (self.any.is_empty() || self.any.iter().any(|gate| gate.matches(text)))
            && !self.not_gate.iter().any(|gate| gate.matches(text))
    }
}
```

读这段代码抓三个词：AND、OR、否决。contains、regex、line_regex、all 之间全是 AND，一条不满足整门关闭；any 非空时退化为 OR，任一子门通过即可；not 是一票否决，任一 not 子门命中，前面全白搭。顺带两个写规则必须知道的细节：contains 双方都转小写再比，天然大小写不敏感；line_regex 原样编译，要忽略大小写得自己加 `(?i)`。

负向证据不是 claude 一家的特产，是 corpus 级惯用法——21 份 manifest 里恰有 9 份带 not。_shared.toml 的中断提示规则是最好的示范：

```toml
# Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/agent_detection/_shared.toml
[[rules]]
id = "shared_interrupt_hint_working"
state = "working"
priority = 350
region = "bottom_non_empty_lines(3)"
any = [
  { line_regex = ['(?i)^\s*(?:press\s+)?(?:esc|ctrl\+c)\s+(?:to\s+)?(?:interrupt|cancel|stop)\b'] },
  { line_regex = ['(?i)^\s*[^\n"{}]*[·•]\s*(?:press\s+)?(?:esc|ctrl\+c)\s+(?:to\s+)?(?:interrupt|cancel|stop)\b'] },
  { line_regex = ['(?i)^\s*esc:cancel\b'] },
  { line_regex = ['(?i)^\s*msg=interrupt\b'] },
]
not = [
  { line_regex = ['(?i)^\s*(?:press\s+)?(?:enter|↵)\s+(?:to\s+)?(?:confirm|submit|select)\b'] },
  { line_regex = ['(?i)^\s*(?:esc|tab|↑/?↓).*\b(?:enter\s+(?:to\s+)?(?:confirm|submit|select)|tab\s+(?:to\s+)?amend)\b'] },
]
```

这条 working 规则的 not，逐字复制了同文件 shared_awaiting_answer 规则的 any。理由：同一屏出现「enter to confirm」时，那是等待确认的表单，不是干活的中断提示——负向条件在这里当守门员，防止一条规则抢走另一条的球。

那如果正向证据本身就不值得信呢？gemini.toml 给出最硬的回答：

```toml
# Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/agent_detection/gemini.toml
[[rules]]
id = "approval_blocked"
state = "blocked"
priority = 800
region = "bottom_non_empty_lines(12)"
any = [
  { contains = ["apply this change"] },
  { contains = ["allow execution"] },
  { contains = ["waiting for user confirmation"] },
  { contains = ["do you want to proceed?"] },
]

[[rules]]
id = "cancel_hint_working"
state = "working"
priority = 300
region = "bottom_non_empty_lines(6)"
contains = ["esc to cancel"]
```

两根柱子：blocked 与 working。没有 idle 规则，一个 not 都没有。提示符特征不足以下断言时，正确动作是不写规则——detect 不命中时返回 None。注释原话：callers retain their higher-confidence hook/process state rather than fabricating idle。调用方保留更高置信度的钩子或进程状态，绝不凭屏幕伪造空闲。这份克制有家学：钩子桥那边对 CLI 隐形（失败绝不打扰用户的任务，隐形合同）、转发有界（载荷 1 MiB 上限、2 秒超时的有界转发）；屏幕这边的同款克制，就是宁可 None。

## 规则优先级：命中之后谁说了算

一屏可以同时命中多条规则：回合进行中，底栏有「esc to interrupt」（working 特征），输入框的 ❯ 也在（idle 特征）。裁决发生在 detect 里：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/ai_agents.rs
/// Match one live screen snapshot. No match is `None`: callers retain their
/// higher-confidence hook/process state rather than fabricating idle.
pub fn detect(program: &str, screen: &str) -> Option<Detection> {
    let agent = AgentKind::parse(program)?;
    refresh_overrides_if_needed();
    let guard = cache().read().ok()?;
    let loaded = guard.manifests.get(&agent)?;
    let attention_screen = screen_context::attention_region(agent, screen);
    let live_input = screen_context::has_live_input_controls(attention_screen);
    let mut best: Option<(&Rule, &CompiledGate)> = None;
    for (rule, gate) in loaded.manifest.rules.iter().zip(&loaded.rules) {
        let blocked = matches!(rule.state, RuleState::Blocked);
        if blocked && !live_input {
            continue;
        }
        let text = region(if blocked { attention_screen } else { screen }, &rule.region);
        if !gate.matches(text) {
            continue;
        }
        // Equal priorities keep the first declared match (local rules precede shared rules).
        if best.is_none_or(|(previous, _)| rule.priority > previous.priority) {
            best = Some((rule, gate));
        }
    }
    best.map(|(rule, _)| Detection { agent, status: rule.state.into(), rule_id: rule.id.clone() })
}
```

**规则优先级——多条规则同时命中时按 priority 数值裁决的顺序，数值大的赢。**detect 的裁决走三步。第一步是 blocked 双重门。主张 blocked 的规则要先过 has_live_input_controls：屏幕上真有活的输入控件（按钮脚注、y/n 问句）才允许说 blocked。同时匹配区域换到 attention_screen，即最后一个提示符之后的注意力区。防的是把 AI 聊天正文里引用的旧表单当成现在的问题。第二步，priority 严格更大才替换当前的 best：claude 的阶梯是 900 的 blocked 压过 400 的 working 压过 100 的 idle。第三步，同优先级保留先声明者——本地 override 的规则排在前面，_shared 并入的骨架排在后面，代码注释明说 local rules precede shared rules。

规则的 schema 本身也在防错。先看 Rule：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/ai_agents.rs
#[derive(Debug, Deserialize, Clone)]
#[serde(deny_unknown_fields)]
struct Rule {
    id: String,
    state: RuleState,
    #[serde(default)]
    priority: i32,
    #[serde(default = "whole_recent")]
    region: String,
    #[serde(flatten)]
    gate: Gate,
}
```

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/ai_agents.rs
#[derive(Debug, Deserialize, Clone, Default)]
#[serde(deny_unknown_fields)]
struct Gate {
    #[serde(default)]
    contains: Vec<String>,
    #[serde(default)]
    regex: Vec<String>,
    #[serde(default)]
    line_regex: Vec<String>,
    #[serde(default)]
    all: Vec<Gate>,
    #[serde(default)]
    any: Vec<Gate>,
    #[serde(default, rename = "not")]
    not_gate: Vec<Gate>,
}
```

deny_unknown_fields 意味着拼错一个键——比如把 not 写成 nots——整个 manifest 拒绝加载，错误在装规则时炸出来而不是在匹配时静默走样。not 在 TOML 里就叫 not，进 Rust 才改名为 not_gate；gate 以 flatten 并进 Rule，所以 contains、not 这些键在 TOML 里与 id、state 平级。共享骨架会被并入每一份 manifest——bundled 与用户 override 一视同仁，装了新 CLI 或改了本地规则都自动带上中断提示判据；规则数上限 1 到 64 条。

## 2026-08-22：一条规则的演化史

spinner_working 现在只有一行正证据：

```toml
# Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/agent_detection/claude.toml
# 回合进行中的唯一可靠证据是底栏的「esc to interrupt」：Claude Code 只在
# 真正可中断（即回合未结束）时打印它，回合一结束整行消失。
#
# 2026-08-22：这条规则此前要求「盲文点阵 spinner 行」AND「esc to interrupt」
# ——Gate 是 AND 语义（ai_agents.rs:528），而 Claude Code 的动画符号是
# ·✢✳✶✻✽ 而非盲文点阵，第一个条件恒假，整条规则从未命中过。于是运行中的
# 屏幕只剩 prompt_idle 命中，连续两拍把 Working 降级成 Done，侧栏在 Claude
# 正干活时显示「完成」蓝点。动画符号本身不能当证据：回合结束的总结行
# 「✳ Baked for 14m 41s」用的是同一组符号。
[[rules]]
id = "spinner_working"
state = "working"
priority = 400
region = "bottom_non_empty_lines(8)"
contains = ["esc to interrupt"]
```

它曾经有两个条件，而那两个条件造成过一次真实事故。把事故链拆开看，每一步都精确：

1. 旧规则要求「盲文点阵 spinner 行」AND「esc to interrupt」，两个条件都过才算命中。
2. Claude Code 的动画符号是 ·✢✳✶✻✽，不是盲文点阵。第一个条件恒假。
3. AND 语义下一个恒假条件让整条规则静默失效——没有报错，没有日志，spinner_working 从未命中过。
4. 运行中的屏幕只剩 prompt_idle 命中。看门狗约每秒取一拍，连续两拍看到 idle，状态机把 Working 降级成 Done。
5. 侧栏在 Claude 正干活时亮起「完成」蓝点。用户看到的与事实相反。

「两拍」值得多看一眼：状态机要求 idle 连续两拍才生效，单帧瞬态翻不起浪。瞬态的来源不少——半截输出、Windows 上 resize 后的内容重放（事件循环层的 ConPTY 对账会吸收，[第 3 章](./03-pty-event-loop.md)）——两拍门槛是它们外面的最后一层去抖。

这里要正面回答「规则条件越多越可靠」。直觉的出处很正：搜索里加条件收窄结果、减少误报，天经地义。但 AND 语义下，规则的可靠性等于它最弱的条件：每加一个条件就多一个能让整条规则死掉的点，而且死得无声——规则从未命中不是异常，是没有症状的病。修正的答案也不是修补第一个条件（换成点阵的字符类），而是删掉它：留下唯一经得起论证的证据——「esc to interrupt」只在真正可中断（回合未结束）时打印，回合一结束整行消失。一个条件，每个字都有出处。

时点性说明，两处。第一，这段注释是 2026-08-22 写下的日期化记录，描述的是当天的修正决策；本课程全部事实锚定在锁定 commit 上（整套源码钉在 SHA 钉版的 ref 上，[第 1 章](./01-repo-map.md)的方法在这里兑现），主分支后来的演进不自动进入本章。第二，注释里那个「ai_agents.rs:528」也是时点产物。在本课程锁定的 commit 上，第 528 行已经落在别处（build_cache 里），AND 语义实际住在 CompiledGate::matches。行号是注释写作年代的历史锚点，引用时以符号名为准——这也是读一切注释内行号引用的通用姿势。

## 演练：为「Gemini CLI」写一条 idle 规则

规则写作可以拆成四个决定。假设 Gemini CLI 还没被适配，你是第一个写规则的人，手头只有三个观察：

- 观察一：空闲时，最后一行是行首的 › 提示符，后面跟空白；
- 观察二：回合进行中，底栏出现「esc to cancel」，提示符行仍然可见——它也允许排队输入；
- 观察三：回合结束后，总结行以 ⏺ 一类的状态符号开头。

第一个决定：区域。提示符住在底部，取 bottom_non_empty_lines(4)，盖住提示符行与底栏，不碰上部历史。第二个决定：正证据。行首 › 加空白，用 line_regex 写 `^\s*›(?:\s|$)`。第三个决定：负向证据。观察二说明「看见 ›」在回合中照样成立，用 not 排除回合中的屏幕：底栏的 esc to cancel。第四个决定：优先级。idle 是最弱的主张，给 100，必须低于 cancel_hint_working 一类 working 规则的 300。

```toml
# 用法示例 · 教学示意（非仓库产物）：为假设的 Gemini CLI 写的 idle 规则
[[rules]]
id = "prompt_idle"
state = "idle"
priority = 100
region = "bottom_non_empty_lines(4)"
line_regex = ['^\s*›(?:\s|$)']
not = [
  { contains = ["esc to cancel"] },
]
```

四个决定各有理由，这条规则才算能见人。顺带一提，观察三的 ⏺ 不能拿来当 working 证据——总结行用的是同一组符号，拿符号当证据就会把「回合已结束」认成「回合进行中」，这正是 2026-08-22 教训的另一半。

但先别急着满意。你已经见过仓库里真实的 gemini.toml：它一条 idle 规则都没有。bundled 版本的作者面对同一个 CLI，结论是 › 提示符不足以下断言，宁可让 detect 返回 None 也不写。所以你的规则欠最后一个论证：为什么它比「不写」更好？答案必须落在负向证据上——not 兜得住「回合中提示符可见」这个已知反例，而且底栏与提示符都住在底部 4 行内，not 的射程够得着。兜不住时，正确答案是删掉整条规则，学 gemini.toml。

纸面跑一遍你写的规则。空闲帧：

```text
✔ Cached 3 files

›
```

底部非空行是「✔ Cached 3 files」和「›」，都在 4 行窗口内；line_regex 命中 › 行；not 里找不到 esc to cancel——idle 成立。干活帧：

```text
⏺ Generating…

(esc to cancel)

› queued
```

esc to cancel 落在底部 4 行内，not 命中，idle 规则判负；同一帧里 cancel_hint_working 用正证据主张 working，优先级 300 大于 100 取胜。两帧都判对，靠的是双保险：not 在近距离兜底，优先级在远距离兜底——claude.toml 的注释原话说得最准：「底栏离输入框足够近时这条 not 直接兜住；离得远时由 spinner_working 的更高优先级取胜」。

## 验证：先猜后跑

验证一：跑探针。companion 目录下执行 `node scripts/probe-10-screen-evidence.mjs`。先猜三个离散结果再跑：检查总数（应为 30 条）、退出码（应为 0）、summary 末尾关于 gemini 的半句（应为 gemini has no idle rule）。任何一条对不上，说明锁定 clone 与课程版本脱节，先解决再往下读。

验证二：定向破坏，复刻探针自己的红绿纪律。把探针复制成 companion/scripts/probe-10-scratch.mjs（同目录复制，import 不受影响）。再把第 20 行的 SPINNER_REGION_EXPECTED 改成注释里的初值 'bottom_non_empty_lines(6)'——探针作者首轮跑出的预期失败值。先猜：几条检查会红？跑：应恰好 1 条红——「区域字段三种形态各占其一」那条，其余 29 条照绿。哪条没变？其余 29 条：改的是一个期望常量，只牵连引用它的那一条断言，它守的是「spinner 区域的真实值必须逐字来自锁定文件」。改回 (8)、删掉副本再复跑，确认回到 30/30。副本务必删掉——聚合 runner 会扫 scripts 下的全部探针，别让它带伤进场。

验证三：纸面推演双重门。screen_context.rs 的测试里有一组真实表单：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/ai_agents/screen_context.rs
        for (agent, form) in [
            ("codex", "Allow command?\n› 1. Yes\n2. No\nPress enter to confirm or esc to cancel"),
            ("claude", "Do you want to proceed?\n❯ 1. Yes\n2. No\nEsc to cancel · Tab to amend"),
            ("pi", "Continue? [y/n]"),
            ("gemini", "Allow execution?\n1. Yes\n2. No\nEnter to confirm · Esc to cancel"),
        ] {
            assert_eq!(
                detect(agent, form).unwrap().status,
                AgentStatus::Blocked,
                "{agent}: {form}"
            );
        }
```

先猜：detect 对这四帧各返回什么？断言里写着答案：全部 Blocked。再猜同文件测试里的另一组输入——"Use [y/n] in your code"、"contains = ['[y/n]']"、"Explain (y/n)"、"Do you want to proceed?"——返回什么？全部不是 Blocked。同是含关键词的屏幕，为什么前者放行、后者拦截？前者底部两三行内是活的控制脚注，has_live_input_controls 放行；后者的关键词躺在正文里、脚下没有控件，双重门拦下。双重门守的东西一句话：词不算数，词加活的控件才算数。

## 收束

回到开篇那个灰着的侧栏。宿主看不出新 CLI 在等确认，缺的不是一块「屏幕智能」，而是一条诚实的推断链。链上五环：快照切成区域（键盘提示贴底住）、正证据提名、负向证据排除已知反例（排队输入）、优先级裁决（blocked 压过 working 压过 idle）、全都不可靠时返回 None——不伪造。「看见提示符就算空闲」错在两处：把「可见」当成「空闲」，以及不知道 AND 语义下每个多余条件都是一个无声的失效点。2026-08-22 那次事故把两处都演了一遍，修正的方向是条件更少、每个字都有出处。

本章新添四块积木：屏幕证据、区域规则、负向证据、规则优先级。亲手写一条规则的入口在练习附录（「为未知 CLI 写屏幕证据规则」）；终章会把它们放回全书地图做一次总对账（[第 16 章](./16-review.md)）。

### 自查

1. 某 CLI 的确认表单固定占底部两行，上方是它刚输出的长文档，文档正文里也出现了「[y/n]」。region 选哪种形态？whole_recent 会出什么事？
2. 一条 working 规则只写了 contains = ["▌"]（光标块字符）。按 2026-08-22 的事故逻辑，它最可能怎么死？死的时候有日志吗？
3. 两条规则同时命中且 priority 都是 500：一条来自你的本地 override，一条是 _shared 并入的骨架。谁赢，凭什么？

<details>
<summary>参考答案</summary>

1. bottom_non_empty_lines(2)——窗口只够到表单就行。whole_recent 会把文档正文里的「[y/n]」也当证据；助手输出里的词不是事件。
2. 光标块可能根本不是打印进网格的字符，换个终端模式或版本符号就变，条件恒假；AND 失效是静默的，没有任何报错或日志。先找只在回合中存在的文字证据。
3. 本地规则赢。detect 逐条扫描，priority 严格更大才替换；相等时保留先声明者，而共享骨架并入在本地规则之后。

</details>
