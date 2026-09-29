// 第 15 章 completion-engine：独立补全引擎的接缝、内置源清单与排序依赖。
// 对锁定 clone（.course/repo @ 360613aa）只读断言：Completer trait 方法签名、
// 内置补全源（文件/目录/静态列表）的模块与 impl 形态、Nushell 出处的自述、
// nucleo-matcher 依赖与三级匹配、模糊排序细节、输出类型无 UI 依赖。
// 所有断言取自锁定 ref 上的静态文件内容，不执行目标仓库代码。
import { requireRepo, readRepoFile, repoFileExists, makeProbe } from './lib/repo.js';

const probe = makeProbe('completion-engine');
requireRepo();

// ---- 工具：TOML 按 header 取 section；源码取块并做规范化 ----------------------
function sectionOf(toml, header) {
  const out = [];
  let inside = false;
  for (const line of toml.split(/\r?\n/)) {
    const h = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (h) { inside = h[1] === header; continue; }
    if (inside) out.push(line);
  }
  return out;
}

// 取 `decl {` 到首个行首 `}` 的原始块（trait / struct / enum）。
function rawBlock(src, decl) {
  const start = src.indexOf(decl);
  if (start < 0) return '';
  const end = src.indexOf('\n}', start);
  return end < 0 ? '' : src.slice(start, end + 2);
}

// 规范化：剥文档注释 → 空白折叠 → 修掉换行造成的 `(` 后 / `, )` 空隙。
const canon = (block) => block
  .split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join(' ')
  .replace(/\s+/g, ' ')
  .replace(/\(\s+/g, '(')
  .replace(/,\s*\)/g, ')')
  .replace(/,\s*\}/g, ' }')
  .replace(/\s+\)/g, ')')
  .trim();

const variantsOf = (block) =>
  [...block.matchAll(/^ {4}([A-Z]\w+)(?:\([^)]*\))?,?\s*$/gm)].map((m) => m[1]);

// ---- A. crate 自述：Nushell 出处与能力清单（lib.rs）---------------------------
const lib = readRepoFile('nebula-completions/src/lib.rs');

probe.check(
  "自述证据：逐字含 \"Extracted from Nushell's `nu-cli` completions framework\"",
  lib.includes("Extracted from Nushell's `nu-cli` completions framework"),
);
probe.check(
  '自述内置源清单逐字：Built-in completers for files, directories, and static string lists.',
  lib.includes('Built-in completers for files, directories, and static string lists.'),
);
probe.check(
  '接缝与两个内置 Completer 实现均经 pub use 再导出（Completer / DirectoryCompletion / StaticCompletion）',
  lib.includes('pub use completer::Completer;')
    && lib.includes('pub use directory::DirectoryCompletion;')
    && lib.includes('pub use static_completion::StaticCompletion;'),
);

// ---- B. Completer trait 接缝（completer.rs）-----------------------------------
const completerSrc = readRepoFile('nebula-completions/src/completer.rs');
const traitBlock = rawBlock(completerSrc, 'pub trait Completer {');
const EXPECTED_TRAIT =
  'pub trait Completer { fn fetch(&mut self, cwd: &str, prefix: impl AsRef<str>, '
  + 'span: Span, offset: usize, options: &CompletionOptions) -> Vec<SemanticSuggestion>; }';

probe.check(
  'Completer trait 规范化后逐字一致：唯一方法 fetch，5 参数，返回 Vec<SemanticSuggestion>',
  canon(traitBlock) === EXPECTED_TRAIT,
  canon(traitBlock) || '（未找到 pub trait Completer）',
);
probe.check(
  '接缝唯一性：trait 体内 fn 定义数 = 1',
  (traitBlock.match(/\bfn \w+\(/g) || []).length === 1,
  `实测 ${(traitBlock.match(/\bfn \w+\(/g) || []).length}`,
);
probe.check(
  '接缝参数与返回类型不含任何 UI 类型（无 gpui / widget / window / ratatui / crossterm 字样）',
  !/(gpui|widget|[Ww]indow|ratatui|crossterm)/.test(traitBlock),
);

// ---- C. 内置补全源清单：文件 / 目录 / 静态列表 --------------------------------
probe.check(
  '内置源·模块形态：file.rs / directory.rs / static_completion.rs 三文件均存在',
  repoFileExists('nebula-completions/src/file.rs')
    && repoFileExists('nebula-completions/src/directory.rs')
    && repoFileExists('nebula-completions/src/static_completion.rs'),
);
probe.check(
  '模块声明形态：pub mod file（公共函数面）；mod directory / mod static_completion（私有模块 + pub use 出口）',
  /^pub mod file;$/m.test(lib) && /^mod directory;$/m.test(lib) && /^mod static_completion;$/m.test(lib),
);

const directorySrc = readRepoFile('nebula-completions/src/directory.rs');
probe.check(
  '内置源·目录：impl Completer for DirectoryCompletion，类型为单元结构体 pub struct DirectoryCompletion;',
  directorySrc.includes('impl Completer for DirectoryCompletion {')
    && directorySrc.includes('pub struct DirectoryCompletion;'),
);
probe.check(
  '目录源组装自文件机制：fetch 内委托 complete_item(true, span, prefix, &[cwd], options, true, None)',
  directorySrc.includes('complete_item(true, span, prefix, &[cwd], options, true, None)'),
);

const staticSrc = readRepoFile('nebula-completions/src/static_completion.rs');
probe.check(
  "内置源·静态列表：impl Completer for StaticCompletion，持有 Cow<'static, [String]>",
  staticSrc.includes('impl Completer for StaticCompletion {')
    && staticSrc.includes('pub struct StaticCompletion {')
    && staticSrc.includes("options: Cow<'static, [String]>"),
);
probe.check(
  "静态列表双构造器：new(Cow<'static, [String]>) 与 from_static(&'static [&'static str])",
  staticSrc.includes("pub fn new(options: Cow<'static, [String]>) -> Self")
    && staticSrc.includes("pub fn from_static(options: &'static [&'static str]) -> Self"),
);
probe.check(
  '静态列表把匹配排序委托给同一引擎：CandidateMatcher::new(prefix, options, true) → matcher.suggestion_results()',
  staticSrc.includes('CandidateMatcher::new(prefix, options, true)')
    && staticSrc.includes('matcher.suggestion_results()'),
);

const fileSrc = readRepoFile('nebula-completions/src/file.rs');
probe.check(
  '内置源·文件：不以 trait impl 提供，而是 pub fn complete_item(...) -> Vec<FileSuggestion> 公共函数面',
  /pub fn complete_item\(/.test(fileSrc) && /\) -> Vec<FileSuggestion> \{/.test(fileSrc)
    && /pub struct FileSuggestion \{/.test(fileSrc),
);

// impl Completer 全 crate 扫描：以 lib.rs 声明的全部模块为穷尽面。
const modNames = [...lib.matchAll(/^(?:pub )?mod (\w+);$/gm)].map((m) => m[1]);
const crateSrc = modNames.map((m) => readRepoFile(`nebula-completions/src/${m}.rs`)).join('\n');
const implNames = [...crateSrc.matchAll(/impl Completer for (\w+)/g)].map((m) => m[1]);
probe.check(
  `impl Completer 全 crate 扫描（${modNames.length} 个模块）= 2 处（实测 ${implNames.length}：${implNames.join(', ')}）`,
  implNames.length === 2 && implNames.join(',') === 'DirectoryCompletion,StaticCompletion',
);

// ---- D. nucleo-matcher 依赖与三级匹配（Cargo.toml / options.rs / matcher.rs）--
const cargo = readRepoFile('nebula-completions/Cargo.toml');
const depLines = sectionOf(cargo, 'dependencies').filter((l) => /^[\w-]+\s*=/.test(l));
const depNames = depLines.map((l) => l.match(/^([\w-]+)/)[1]);
const EXPECTED_NUCLEO = 'nucleo-matcher = "0.3"';

probe.check(
  `[dependencies] 恰好 5 项（实测 ${depNames.length}）：nucleo-matcher / unicase / unicode-segmentation / nu-ansi-term / lscolors`,
  depNames.length === 5
    && ['nucleo-matcher', 'unicase', 'unicode-segmentation', 'nu-ansi-term', 'lscolors']
      .every((d) => depNames.includes(d)),
  depNames.join(', '),
);
probe.check(
  `nucleo-matcher 依赖行逐字为 ${EXPECTED_NUCLEO}（非 optional，无条件参与构建）`,
  depLines.includes(EXPECTED_NUCLEO),
  depLines.find((l) => l.startsWith('nucleo-matcher')) || '（无该依赖行）',
);

const optionsSrc = readRepoFile('nebula-completions/src/options.rs');
const maVariants = variantsOf(rawBlock(optionsSrc, 'pub enum MatchAlgorithm {'));
probe.check(
  `三级匹配枚举 MatchAlgorithm 恰有三变体（实测 ${maVariants.length}）：${maVariants.join(' / ')}`,
  maVariants.length === 3 && maVariants.join(',') === 'Prefix,Substring,Fuzzy',
  maVariants.join(','),
);
probe.check(
  '排序策略枚举 CompletionSort = { Alphabetical(默认), Smart }',
  variantsOf(rawBlock(optionsSrc, 'pub enum CompletionSort {')).join(',') === 'Alphabetical,Smart',
);

const matcherSrc = readRepoFile('nebula-completions/src/matcher.rs');
const useStmt = /use nucleo_matcher::\{[\s\S]*?\};/.exec(matcherSrc)?.[0] || '';
probe.check(
  'matcher.rs 实际调用 nucleo API：导入 Config / Matcher / Utf32Str / pattern::{Atom, AtomKind, CaseMatching, Normalization}',
  ['Config', 'Matcher', 'Utf32Str', 'Atom', 'AtomKind', 'CaseMatching', 'Normalization']
    .every((t) => useStmt.includes(t)),
);
probe.check(
  '构造器按算法分派：Prefix|Substring 走 State::Unscored，Fuzzy 走 State::Fuzzy（nucleo 只承担打分分支）',
  /MatchAlgorithm::Prefix \| MatchAlgorithm::Substring =>/.test(matcherSrc)
    && /State::Unscored\(Vec::new\(\)\)/.test(matcherSrc)
    && /MatchAlgorithm::Fuzzy =>/.test(matcherSrc) && /State::Fuzzy \{/.test(matcherSrc),
);

// ---- E. 模糊匹配排序细节（matcher.rs）-----------------------------------------
probe.check(
  '模糊得分类型为 u16（私有 FuzzyMatch.score: u16）',
  /score: u16/.test(rawBlock(matcherSrc, 'struct FuzzyMatch<T>')),
);
probe.check(
  'Smart 排序逐字：b.score.cmp(&a.score).then(a.haystack.cmp(&b.haystack)) —— 分数降序、同分字典序',
  matcherSrc.includes(
    'matches.sort_by(|a, b| b.score.cmp(&a.score).then(a.haystack.cmp(&b.haystack)));',
  ),
);
probe.check(
  '打分调 nucleo Atom::indices，且在 Config::DEFAULT 上设 prefer_prefix = true',
  matcherSrc.includes('cfg.prefer_prefix = true;')
    && matcherSrc.includes('atom.indices(haystack_utf32, matcher, &mut indices)'),
);
probe.check(
  '排序层测试移植自 Nushell：注释逐字 "(ported from nushell `completion_options.rs`, all names stripped)"',
  matcherSrc.includes('// Tests (ported from nushell `completion_options.rs`, all names stripped)'),
);
probe.check(
  '锁定测试 fuzzy_sort_by_score 记录期望顺序：fob → "foo bar" → "foo/bar"（最优分优先、同分字典序）',
  matcherSrc.includes('fn fuzzy_sort_by_score()') && matcherSrc.includes('assert_eq!("fob", results[0].0);'),
);

// ---- F. 零 UI 依赖：依赖面与输出类型 ------------------------------------------
const UI_CRATES = ['gpui', 'ratatui', 'crossterm', 'termion', 'ncurses', 'tui', 'egui', 'iced'];
probe.check(
  `依赖面零 UI crate：${UI_CRATES.join(' / ')} 均不在 [dependencies]`,
  depNames.every((d) => !UI_CRATES.includes(d)),
);
probe.check(
  '终端着色是可选能力：nu-ansi-term 与 lscolors 均 optional，挂在 default feature "color" 之后',
  depLines.filter((l) => /optional = true/.test(l)).length === 2
    && cargo.includes('default = ["color"]')
    && cargo.includes('color = ["dep:nu-ansi-term", "dep:lscolors"]'),
);

const suggestionSrc = readRepoFile('nebula-completions/src/suggestion.rs');
probe.check(
  '输出类型 SemanticSuggestion = { suggestion: Suggestion, kind: Option<SuggestionKind> }，纯数据字段',
  canon(rawBlock(suggestionSrc, 'pub struct SemanticSuggestion')) ===
    'pub struct SemanticSuggestion { pub suggestion: Suggestion, pub kind: Option<SuggestionKind> }',
);
probe.check(
  '输出类型唯一终端耦合字段 style 被 #[cfg(feature = "color")] 门控',
  /#\[cfg\(feature = "color"\)\]\s+pub style: Option<nu_ansi_term::Style>/.test(suggestionSrc),
);
probe.check(
  'suggestion.rs 全文无 gpui / widget / window / Entity 等 UI 词',
  !/(gpui|widget|[Ww]indow|Entity)/.test(suggestionSrc),
);

// ---- 摘要（milestone_verify：输出接缝与内置源清单）----------------------------
console.log(
  'summary [completion-engine] seam=Completer::fetch(&mut self, cwd: &str, '
  + 'prefix: impl AsRef<str>, span: Span, offset: usize, options: &CompletionOptions) '
  + '-> Vec<SemanticSuggestion>; '
  + `sources=directory(DirectoryCompletion)+static(StaticCompletion) impl Completer, `
  + `file(pub fn complete_item) [crate 扫描 ${implNames.length} 处 impl]; `
  + `matcher=nucleo-matcher@${EXPECTED_NUCLEO.match(/"([^"]+)"/)[1]}, `
  + 'algorithms=Prefix|Substring|Fuzzy, smart_sort=score_desc_then_alpha, prefer_prefix=true',
);

probe.done();
