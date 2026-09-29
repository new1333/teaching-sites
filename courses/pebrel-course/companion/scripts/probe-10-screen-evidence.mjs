// 第 10 章 screen-evidence：屏幕证据——为未知 CLI 写状态推断规则。
// 对锁定 clone（.course/repo @ 360613aa）只读断言 TOML 规则面与屏幕观察提取：
// claude.toml / _shared.toml 的区域字段、not 负向条件与优先级结构，
// 规则注释中的日期化演化史（2026-08-22 恒假条件修正），ai_agents.rs 的
// Rule/Gate schema 与裁决语义（AND 门 + not 否决 + priority 严格更大者胜 +
// blocked 双重门），以及 screen_context.rs 的结构化观察提取函数面。
// 边界：宿主事件管线分层（ai_hook 五层、observe_screen 生命周期入口）由
// 第 9 章探针负责，本章只在规则面与观察提取面取证，不重复其断言面。
// clone 为 CRLF 检出：逐字断言先统一 \n；TOML 注释锚点按行断言（不跨行拼接）。
// 附带零依赖 TOML 子集解析器（覆盖本目录 21 份 manifest 的全部实际形态），
// 断言取自锁定 ref 上的静态文件内容，不执行目标仓库代码。
import { requireRepo, readRepoFile, repoFileExists, makeProbe } from './lib/repo.js';

const probe = makeProbe('screen-evidence');
requireRepo();

// 红绿纪律：首轮以 spinner 区域预期值 bottom_non_empty_lines(6) 运行观察到
// 预期 FAIL（实测 bottom_non_empty_lines(8)）；同轮还暴露一处探针自身计数错
// （把 _shared 的 3 条骨架计入 bundled 总数，实际 bundled 恰 61 条）。均已修正。
const SPINNER_REGION_EXPECTED = 'bottom_non_empty_lines(8)';

const unix = (s) => s.replace(/\r\n/g, '\n');

// ---- 零依赖 TOML 子集解析器 ---------------------------------------------------
// 覆盖 agent_detection/*.toml 的全部实际形态：顶层 key = value、[[rules]] /
// [[identity]] 表数组、双引号/单引号字符串、整数、（可跨行的）数组与内联表，
// 内联表可任意嵌套（kilo.toml 的 contains+any+all 三键内联表）。# 注释在
// 字符串外剥离。裸值（整数）以字符串形态返回，断言面按字符串比较。
function parseToml(text) {
  const src = unix(text);
  let i = 0;
  const err = (m) => { throw new Error(`toml@${i}: ${m}`); };
  const skipWs = () => { while (i < src.length && /\s/.test(src[i])) i++; };
  const skipWsComment = () => {
    for (;;) {
      skipWs();
      if (src[i] === '#') { while (i < src.length && src[i] !== '\n') i++; }
      else break;
    }
  };
  function parseString() {
    const q = src[i];
    if (q !== '"' && q !== "'") err('expected quote');
    i++;
    let out = '';
    while (i < src.length && src[i] !== q) {
      if (q === '"' && src[i] === '\\') { out += src[i] + (src[i + 1] ?? ''); i += 2; continue; }
      out += src[i++];
    }
    if (src[i] !== q) err('unterminated string');
    i++;
    return out;
  }
  function parseValue() {
    skipWsComment();
    const c = src[i];
    if (c === '"' || c === "'") return parseString();
    if (c === '[') return parseArray();
    if (c === '{') return parseInlineTable();
    let j = i;
    while (j < src.length && !/[\s,\]}#\n]/.test(src[j])) j++;
    const raw = src.slice(i, j);
    i = j;
    return raw;
  }
  function parseArray() {
    i++; // [
    const out = [];
    for (;;) {
      skipWsComment();
      if (src[i] === ']') { i++; return out; }
      out.push(parseValue());
      skipWsComment();
      if (src[i] === ',') { i++; continue; }
      if (src[i] === ']') { i++; return out; }
      err('expected , or ] in array');
    }
  }
  function parseInlineTable() {
    i++; // {
    const out = {};
    for (;;) {
      skipWsComment();
      if (src[i] === '}') { i++; return out; }
      let j = i;
      while (j < src.length && src[j] !== '=' && src[j] !== '\n') j++;
      const key = src.slice(i, j).trim();
      if (!key) err('empty key in inline table');
      i = j;
      if (src[i] !== '=') err('expected = in inline table');
      i++;
      out[key] = parseValue();
      skipWsComment();
      if (src[i] === ',') { i++; continue; }
      if (src[i] === '}') { i++; return out; }
      err('expected , or } in inline table');
    }
  }
  const doc = { rules: [], identity: [], top: {} };
  let target = doc.top;
  for (;;) {
    skipWsComment();
    if (i >= src.length) break;
    if (src.startsWith('[[', i)) {
      const close = src.indexOf(']]', i);
      const name = src.slice(i + 2, close).trim();
      i = close + 2;
      if (name !== 'rules' && name !== 'identity') err(`unknown table [[${name}]]`);
      target = {};
      doc[name].push(target);
      continue;
    }
    let j = i;
    while (j < src.length && src[j] !== '=' && src[j] !== '\n') j++;
    const key = src.slice(i, j).trim();
    if (!key) err('empty key');
    i = j;
    if (src[i] !== '=') err(`expected = after key ${key}`);
    i++;
    target[key] = parseValue();
  }
  return doc;
}

const DIR = 'nebula_app/src/agent_detection';
const CLAUDE_TOML = `${DIR}/claude.toml`;
const SHARED_TOML = `${DIR}/_shared.toml`;
const ENGINE = 'nebula_app/src/ai_agents.rs';
const SCREEN_CTX = 'nebula_app/src/ai_agents/screen_context.rs';

probe.check('四个证据文件（claude.toml / _shared.toml / ai_agents.rs / screen_context.rs）都在锁定 ref 上存在',
  [CLAUDE_TOML, SHARED_TOML, ENGINE, SCREEN_CTX].every(repoFileExists));

const claudeToml = unix(readRepoFile(CLAUDE_TOML));
const sharedToml = unix(readRepoFile(SHARED_TOML));
const engine = unix(readRepoFile(ENGINE));
const screenCtx = unix(readRepoFile(SCREEN_CTX));

// 解析失败会直接抛异常终止探针（exit 非 0），本身就是断言。
const claude = parseToml(claudeToml);
const shared = parseToml(sharedToml);

// ---- A. claude.toml 规则面 ----------------------------------------------------
const [liveForm, spinner, promptIdle] = claude.rules;
probe.check(
  'claude manifest：id="claude"、aliases=["claude-code"]、恰 3 条规则 live_form_blocked/spinner_working/prompt_idle，states 依次 blocked/working/idle',
  claude.top.id === 'claude'
    && JSON.stringify(claude.top.aliases) === JSON.stringify(['claude-code'])
    && claude.rules.length === 3
    && liveForm.id === 'live_form_blocked' && liveForm.state === 'blocked'
    && spinner.id === 'spinner_working' && spinner.state === 'working'
    && promptIdle.id === 'prompt_idle' && promptIdle.state === 'idle',
);
probe.check(
  `区域字段三种形态各占其一：live_form_blocked=after_last_horizontal_rule（最后水平分隔线之后）、spinner_working=${SPINNER_REGION_EXPECTED}、prompt_idle=bottom_non_empty_lines(4)（底部 N 非空行）`,
  liveForm.region === 'after_last_horizontal_rule'
    && spinner.region === SPINNER_REGION_EXPECTED
    && promptIdle.region === 'bottom_non_empty_lines(4)',
);
probe.check(
  '优先级阶梯 blocked>working>idle：live_form_blocked=900 > spinner_working=400 > prompt_idle=100（数值比较）',
  Number(liveForm.priority) === 900 && Number(spinner.priority) === 400 && Number(promptIdle.priority) === 100
    && Number(liveForm.priority) > Number(spinner.priority) && Number(spinner.priority) > Number(promptIdle.priority),
);
probe.check(
  'live_form_blocked 门 = contains AND any：contains=["esc to cancel"] + any 恰 4 项（enter to select / enter to confirm / do you want to proceed? / tab to amend），每项都是单 contains 内联表，且无 not',
  JSON.stringify(liveForm.contains) === JSON.stringify(['esc to cancel'])
    && Array.isArray(liveForm.any) && liveForm.any.length === 4
    && JSON.stringify(liveForm.any.map((g) => g.contains)) === JSON.stringify([
      ['enter to select'], ['enter to confirm'], ['do you want to proceed?'], ['tab to amend'],
    ])
    && liveForm.not === undefined,
);
probe.check(
  'spinner_working 门是单条件正证据：contains=["esc to interrupt"]，无 any / not / line_regex 键',
  JSON.stringify(spinner.contains) === JSON.stringify(['esc to interrupt'])
    && spinner.any === undefined && spinner.not === undefined && spinner.line_regex === undefined,
);
probe.check(
  'prompt_idle 门 = line_regex + not 负向证据：line_regex=[\'^\\s*❯(?:\\s|$)\']，not 恰 3 项 contains（esc to cancel / enter to select / esc to interrupt），无正向 contains',
  JSON.stringify(promptIdle.line_regex) === JSON.stringify(['^\\s*❯(?:\\s|$)'])
    && Array.isArray(promptIdle.not) && promptIdle.not.length === 3
    && JSON.stringify(promptIdle.not.map((g) => g.contains)) === JSON.stringify([
      ['esc to cancel'], ['enter to select'], ['esc to interrupt'],
    ])
    && promptIdle.contains === undefined,
);

// ---- B. claude.toml 注释演化史（逐行锚点，CRLF 已归一）-------------------------
probe.check(
  'manifest 首行注释逐字：# Screen-chrome evidence for this CLI (idle / working / blocked).',
  claudeToml.includes('# Screen-chrome evidence for this CLI (idle / working / blocked).'),
);
probe.check(
  'spinner 可靠性论证逐行：回合进行中的唯一可靠证据是底栏的「esc to interrupt」……回合一结束整行消失（Claude Code 只在真正可中断即回合未结束时打印它）',
  claudeToml.includes('# 回合进行中的唯一可靠证据是底栏的「esc to interrupt」：Claude Code 只在')
    && claudeToml.includes('# 真正可中断（即回合未结束）时打印它，回合一结束整行消失。'),
);
probe.check(
  '演化史时点 2026-08-22 逐行：此前要求「盲文点阵 spinner 行」AND「esc to interrupt」——Gate 是 AND 语义（ai_agents.rs:528）',
  claudeToml.includes('# 2026-08-22：这条规则此前要求「盲文点阵 spinner 行」AND「esc to interrupt」')
    && claudeToml.includes('# ——Gate 是 AND 语义（ai_agents.rs:528），而 Claude Code 的动画符号是'),
);
probe.check(
  '演化史事故链逐行：动画符号 ·✢✳✶✻✽ 而非盲文点阵→第一个条件恒假整条规则从未命中→连续两拍把 Working 降级成 Done→总结行「✳ Baked for 14m 41s」用的是同一组符号',
  claudeToml.includes('# ·✢✳✶✻✽ 而非盲文点阵，第一个条件恒假，整条规则从未命中过。')
    && claudeToml.includes('# 屏幕只剩 prompt_idle 命中，连续两拍把 Working 降级成 Done，侧栏在 Claude')
    && claudeToml.includes('# 「✳ Baked for 14m 41s」用的是同一组符号。'),
);
probe.check(
  'prompt_idle 的 not 注释逐行：输入框在回合进行中同样可见（允许排队输入）→「看见 ❯」本身不等于空闲→not 直接兜住 / 由 spinner_working 更高优先级取胜',
  claudeToml.includes('# 输入框在回合进行中同样可见（Claude Code 允许排队输入），所以「看见 ❯」')
    && claudeToml.includes('# 本身不等于空闲。底栏离输入框足够近时这条 not 直接兜住；离得远时由')
    && claudeToml.includes('# spinner_working 的更高优先级取胜。'),
);

// ---- C. _shared.toml 共享规则基线 --------------------------------------------
const [sharedBinary, sharedAwaiting, sharedInterrupt] = shared.rules;
probe.check(
  '_shared.toml 头三行合同逐字：Fallback rules…All blocked candidates also pass ai_agents::screen_context\'s live-control/form boundary…words in assistant output are not events',
  sharedToml.includes('# Fallback rules for clients without complete lifecycle hooks. All blocked')
    && sharedToml.includes('# candidates also pass ai_agents::screen_context\'s live-control/form boundary.')
    && sharedToml.includes('# Shared rules describe keyboard chrome; words in assistant output are not events.'),
);
probe.check(
  '_shared 恰 3 条规则：shared_binary_confirmation(blocked,800,bottom_non_empty_lines(1)) / shared_awaiting_answer(blocked,800,(3)) / shared_interrupt_hint_working(working,350,(3))',
  shared.rules.length === 3
    && sharedBinary.id === 'shared_binary_confirmation' && sharedBinary.state === 'blocked'
    && sharedBinary.priority === '800' && sharedBinary.region === 'bottom_non_empty_lines(1)'
    && sharedAwaiting.id === 'shared_awaiting_answer' && sharedAwaiting.state === 'blocked'
    && sharedAwaiting.priority === '800' && sharedAwaiting.region === 'bottom_non_empty_lines(3)'
    && sharedInterrupt.id === 'shared_interrupt_hint_working' && sharedInterrupt.state === 'working'
    && sharedInterrupt.priority === '350' && sharedInterrupt.region === 'bottom_non_empty_lines(3)',
);
probe.check(
  'shared_binary_confirmation 只用 line_regex（无 contains/any/not）：y/n 二元问句脚注，锚定最后 1 非空行',
  JSON.stringify(sharedBinary.line_regex) === JSON.stringify([
    '(?i)^\\p{L}[^\\n]*[?:]\\s*(?:\\(\\s*y(?:es)?\\s*/\\s*n(?:o)?\\s*\\)|\\[\\s*y(?:es)?\\s*/\\s*n(?:o)?\\s*\\])\\s*[:?]?\\s*$',
  ])
    && sharedBinary.contains === undefined && sharedBinary.any === undefined && sharedBinary.not === undefined,
);
probe.check(
  'shared_interrupt_hint_working 的 not 恰 2 项 line_regex，与 shared_awaiting_answer 的 any 逐字同构（负向守门：中断提示不得被误读为等待确认表单）',
  Array.isArray(sharedInterrupt.not) && sharedInterrupt.not.length === 2
    && Array.isArray(sharedInterrupt.any) && sharedInterrupt.any.length === 4
    && sharedInterrupt.not.every((g) => Array.isArray(g.line_regex) && g.line_regex.length === 1)
    && JSON.stringify(sharedInterrupt.not.map((g) => g.line_regex))
      === JSON.stringify(sharedAwaiting.any.map((g) => g.line_regex)),
);

// ---- D. 引擎 schema 与裁决语义（ai_agents.rs）--------------------------------
const ruleStruct = engine.slice(engine.indexOf('struct Rule {'), engine.indexOf('#[derive(Debug, Deserialize, Clone, Default)]\nstruct Gate'));
probe.check(
  'Rule schema 逐字：id/state 必填，priority 默认 0（#[serde(default)]），region 默认 whole_recent（#[serde(default = "whole_recent")]），gate 以 #[serde(flatten)] 并入',
  ruleStruct.includes('    id: String,')
    && ruleStruct.includes('    state: RuleState,')
    && ruleStruct.includes('    #[serde(default)]\n    priority: i32,')
    && ruleStruct.includes('    #[serde(default = "whole_recent")]\n    region: String,')
    && ruleStruct.includes('    #[serde(flatten)]\n    gate: Gate,'),
);
probe.check(
  'Gate schema 逐字：contains/regex/line_regex/all/any + TOML 键 not 经 #[serde(default, rename = "not")] 映射为 not_gate，两结构都 #[serde(deny_unknown_fields)]（拼错键即拒载）',
  engine.includes('    #[serde(default, rename = "not")]\n    not_gate: Vec<Gate>,')
    && engine.includes('#[serde(deny_unknown_fields)]\nstruct Gate {')
    && engine.includes('#[serde(deny_unknown_fields)]\nstruct Rule {'),
);
probe.check(
  'CompiledGate::matches 语义逐字（六行 AND 链）：contains/regex/line_regex/all 全 AND，any 空则过、非空则 OR，not_gate 任一命中即整体为假',
  engine.includes('        self.contains.iter().all(|needle| lower.contains(needle))\n')
    && engine.includes('            && self.line_regex.iter().all(|regex| text.lines().any(|line| regex.is_match(line)))\n')
    && engine.includes('            && (self.any.is_empty() || self.any.iter().any(|gate| gate.matches(text)))\n')
    && engine.includes('            && !self.not_gate.iter().any(|gate| gate.matches(text))'),
);
probe.check(
  'detect() 裁决逐字：无命中返回 None（callers retain their higher-confidence hook/process state rather than fabricating idle）；blocked 候选额外过 live_input 双重门且区域取 attention_screen；priority 严格更大才替换，同优先级保留先声明者（local rules precede shared rules）',
  engine.includes('/// Match one live screen snapshot. No match is `None`: callers retain their')
    && engine.includes('/// higher-confidence hook/process state rather than fabricating idle.')
    && engine.includes('        let blocked = matches!(rule.state, RuleState::Blocked);')
    && engine.includes('        if blocked && !live_input {')
    && engine.includes('        let text = region(if blocked { attention_screen } else { screen }, &rule.region);')
    && engine.includes('        // Equal priorities keep the first declared match (local rules precede shared rules).')
    && engine.includes('        if best.is_none_or(|(previous, _)| rule.priority > previous.priority) {'),
);
probe.check(
  '共享骨架并入每一份 manifest（bundled 与用户 override 一视同仁），包装键只许 after_last_prompt_row，规则数上限 1..=64',
  engine.includes('    for mut rule in shared_rules().iter().cloned() {')
    && engine.includes('        manifest.rules.push(rule);')
    && engine.includes('if manifest.shared_rule_region.as_deref().is_some_and(|value| value != "after_last_prompt_row")')
    && engine.includes('return Err("manifest must contain 1..=64 rules".to_owned());')
    && engine.includes('    // 共享骨架并入每一份 manifest——bundled 与用户 override 一视同仁，装了'),
);
probe.check(
  'region() 支持的四种形态逐字：whole_recent 原样 / after_last_prompt_row(inner) 先取内层再 from_last_empty_prompt / bottom_non_empty_lines(N) 自底向上取 N 非空行 / after_last_horizontal_rule 取最后一条 ≥3 个 ─ 的分隔线之后',
  engine.includes('    if spec == "whole_recent" {')
    && engine.includes('strip_prefix("after_last_prompt_row(")')
    && engine.includes('if let Some(count) = region_count(spec, "bottom_non_empty_lines")')
    && engine.includes('            .filter(|(_, line)| !line.trim().is_empty())')
    && engine.includes('            .take(count)')
    && engine.includes('    if spec == "after_last_horizontal_rule" {')
    && engine.includes("if trimmed.chars().filter(|character| *character == '─').count() >= 3"),
);

// ---- E. screen_context.rs 结构化观察提取函数面 --------------------------------
probe.check(
  'screen_context 模块头两行逐字：Structural limits shared by every bundled and user-supplied screen rule. / Words in assistant prose are never sufficient evidence of a live input form.',
  screenCtx.includes('//! Structural limits shared by every bundled and user-supplied screen rule.')
    && screenCtx.includes('//! Words in assistant prose are never sufficient evidence of a live input form.'),
);
probe.check(
  '三个提取函数签名逐字：attention_region(agent, screen) -> &str / content_row(row) -> &str / has_live_input_controls(screen) -> bool（前两者供 detect 的 blocked 双重门使用）',
  screenCtx.includes('pub(super) fn attention_region(agent: AgentKind, screen: &str) -> &str {')
    && screenCtx.includes('fn content_row(row: &str) -> &str {')
    && screenCtx.includes('pub(super) fn has_live_input_controls(screen: &str) -> bool {')
    && engine.includes('    let attention_screen = screen_context::attention_region(agent, screen);')
    && engine.includes('    let live_input = screen_context::has_live_input_controls(attention_screen);'),
);
probe.check(
  'has_live_input_controls 体逐字：最新控制脚注优先（.rev() 后 .take(3)），边框行（─━╰╯└┘+）与空行跳过，BINARY 命中即真，CONTROLS 命中须不含 interrupt / to stop',
  screenCtx.includes('    // The latest control footer wins. A quoted old form above an interrupt')
    && screenCtx.includes('    // footer or a new composer cannot turn current work into an input request.')
    && screenCtx.includes('        .rev()')
    && screenCtx.includes('        .take(3)')
    && screenCtx.includes('        .filter(|row| !row.is_empty() && !row.chars().all(|c| "─━╰╯└┘+".contains(c)))')
    && screenCtx.includes('        if BINARY.is_match(row) {')
    && screenCtx.includes('            return !lower.contains("interrupt") && !lower.contains("to stop");'),
);
probe.check(
  'attention_region 以 from_last_empty_prompt 截屏（Codex 例外：无框 composer 的 › 草稿行不算表单边界），content_row 剥掉 │/┃ 边框',
  screenCtx.includes('    let screen = from_last_empty_prompt(screen);')
    && screenCtx.includes("    // Codex's unboxed composer contains a draft or rotating placeholder. Its")
    && screenCtx.includes('    row.trim().trim_matches([\'│\', \'┃\']).trim()'),
);

// ---- F. 规则面 corpus 级均匀性（解析器吃下全部 21 份 manifest）-----------------
const BUNDLED_SLUGS = ['claude', 'codex', 'gemini', 'cursor', 'opencode', 'copilot', 'grok', 'pi',
  'amp', 'antigravity', 'cline', 'devin', 'droid', 'hermes', 'kimi', 'kiro', 'kilo', 'qodercli', 'maki', 'codebuddy'];
const manifests = BUNDLED_SLUGS.map((slug) => ({ slug, doc: parseToml(readRepoFile(`${DIR}/${slug}.toml`)) }));
const allRules = manifests.flatMap((m) => m.doc.rules);
const STATES = ['idle', 'working', 'blocked'];
const REGION_FORM = /^(whole_recent|after_last_horizontal_rule|bottom_non_empty_lines\(\d+\)|after_last_prompt_row\(.+\))$/;
probe.check(
  `20 份 bundled manifest 全部解析成功且 top.id 与 slug 一一对应，bundled 规则共 ${allRules.length} 条 + _shared 骨架 3 条（include_str! 恰 21 处：20 bundled + _shared）`,
  manifests.every((m) => m.doc.top.id === m.slug)
    && allRules.length === 61
    && shared.rules.length === 3
    && (engine.split('include_str!("agent_detection/').length - 1) === 21, // 20 bundled + _shared
);
probe.check(
  '每条规则都有 id 与合法 state（idle/working/blocked），region 值全部落在四种形态文法内',
  allRules.every((r) => typeof r.id === 'string' && r.id.length > 0 && STATES.includes(r.state))
    && allRules.every((r) => typeof r.region === 'string' && REGION_FORM.test(r.region)),
);
const notFiles = [...manifests.map((m) => ({ name: m.slug, rules: m.doc.rules })),
  { name: '_shared', rules: shared.rules }]
  .filter((f) => f.rules.some((r) => r.not !== undefined));
probe.check(
  `负向证据是 corpus 级惯用法：带 not 数组的 manifest 恰 9 份（实测 ${notFiles.length}：${notFiles.map((f) => f.name).sort().join(',')}）`,
  notFiles.length === 9,
);
const gemini = manifests.find((m) => m.slug === 'gemini').doc.rules;
probe.check(
  `gemini.toml 恰 ${gemini.length} 条规则且只有 blocked/working 态（approval_blocked/cancel_hint_working）——没有 idle 规则也没有 not：不匹配即 None，宁可交给 hook/进程态，不凭提示符伪造空闲`,
  gemini.length === 2
    && gemini.every((r) => r.state === 'blocked' || r.state === 'working')
    && gemini[0].id === 'approval_blocked' && gemini[1].id === 'cancel_hint_working'
    && !gemini.some((r) => r.not !== undefined),
);

// ---- 摘要（milestone_verify：输出规则结构清单）--------------------------------
console.log(
  `summary [screen-evidence] claude.toml: live_form_blocked{blocked,prio=900,region=after_last_horizontal_rule,gate=contains["esc to cancel"]+any[4]}, ` +
  `spinner_working{working,400,bottom_non_empty_lines(8),contains["esc to interrupt"]}, ` +
  `prompt_idle{idle,100,bottom_non_empty_lines(4),line_regex['^\\\\s*❯(?:\\\\s|$)']+not[3:esc to cancel/enter to select/esc to interrupt]}; ` +
  `_shared.toml: shared_binary_confirmation{blocked,800,(1),line_regex y/n}, shared_awaiting_answer{blocked,800,(3),any[2 line_regex]}, ` +
  `shared_interrupt_hint_working{working,350,(3),any[4]+not[2 mirrors awaiting]}; ` +
  `engine=Rule{id,state,priority,region,flatten Gate{contains,regex,line_regex,all,any,not->not_gate}}, ` +
  `matches=AND+any-OR+not-veto, detect=priority strict-greater + blocked x live_input dual gate, region forms x4; ` +
  `screen_context.rs: attention_region/content_row/has_live_input_controls(rev.take(3),BINARY/CONTROLS); ` +
  `corpus: 20 manifests, 61 bundled rules + 3 shared, not-idiom in 9 files, gemini has no idle rule`,
);

probe.done();
