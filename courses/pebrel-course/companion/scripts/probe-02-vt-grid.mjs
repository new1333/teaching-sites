// 第 2 章 vt-grid：VT 解析与网格状态机。
// 对锁定 clone（.course/repo @ 360613aa）只读断言本章 milestone：
// TermMode 位标志集合、vte 依赖存在与回调接线、DECSET 2031 私有扩展处理点，
// 外加正文推理要用的网格/单元格结构与 damage 追踪证据。
// 所有断言取自锁定 ref 上的静态文件内容，不执行目标仓库代码。
import { requireRepo, readRepoFile, repoFileExists, makeProbe } from './lib/repo.js';

const probe = makeProbe('vt-grid');
requireRepo();

const P = {
  term: 'nebula_terminal/src/term/mod.rs',
  grid: 'nebula_terminal/src/grid/mod.rs',
  damage: 'nebula_terminal/src/term/damage.rs',
  cell: 'nebula_terminal/src/term/cell.rs',
  eventLoop: 'nebula_terminal/src/event_loop.rs',
  cargo: 'nebula_terminal/Cargo.toml',
  lib: 'nebula_terminal/src/lib.rs',
  tests: 'nebula_terminal/src/term/tests.rs',
};
for (const p of Object.values(P)) {
  if (!repoFileExists(p)) {
    console.error(`vt-grid: 锁定 clone 缺少 ${p}`);
    process.exit(1);
  }
}
// 锁定 clone 在本机检出为 CRLF 行尾；断言前统一归一为 \n，行号不受影响。
const read = (p) => readRepoFile(p).replace(/\r\n/g, '\n');
const term = read(P.term);
const grid = read(P.grid);
const damage = read(P.damage);
const cell = read(P.cell);
const eventLoop = read(P.eventLoop);
const cargo = read(P.cargo);
const lib = read(P.lib);
const tests = read(P.tests);

// 文本内首次出现的行号（1 起，找不到为 -1），供证据锚点汇总。
const lineOf = (text, needle) => {
  const idx = text.indexOf(needle);
  return idx < 0 ? -1 : text.slice(0, idx).split('\n').length;
};
const countOf = (text, needle) => text.split(needle).length - 1;

// ---- A. TermMode 位标志集合 -----------------------------------------------------
// 切出 bitflags! 块：从 `pub struct TermMode: u32 {` 到配对的 `\n    }\n}`。
const flagsDecl = 'pub struct TermMode: u32 {';
const flagsStart = term.indexOf(flagsDecl);
const flagsEnd = flagsStart >= 0 ? term.indexOf('\n    }\n}', flagsStart) : -1;
const flagsBlock = flagsStart >= 0 && flagsEnd > flagsStart ? term.slice(flagsStart, flagsEnd) : '';

probe.check(
  'bitflags! 块声明 pub struct TermMode: u32（nebula_terminal/src/term/mod.rs）',
  flagsBlock.length > 0,
);

// 解析每个 `const NAME = value;` 成员：0 / 1 / 1 << k 是单标志，
// Self::X.bits() 组合是聚合标志，u32::MAX 是 ANY。
const entries = [...flagsBlock.matchAll(/const\s+([A-Z_0-9]+)\s*=\s*([^;]+);/g)].map((m) => ({
  name: m[1],
  value: m[2].trim(),
}));
const single = entries.filter((e) => /^0$|^1$|^1 << \d+$/.test(e.value));
const bits = new Set(single.map((e) => (e.value === '0' ? -1 : e.value === '1' ? 0 : Number(e.value.slice(4)))));
const composite = entries.filter((e) => e.value.includes('Self::'));
const anyEntry = entries.find((e) => e.value === 'u32::MAX');

probe.check(
  `TermMode 成员数 = 29（实测 ${entries.length}）：26 单标志 + MOUSE_MODE + KITTY_KEYBOARD_PROTOCOL + ANY`,
  entries.length === 29 && single.length === 26 && composite.length === 2 && !!anyEntry,
  entries.map((e) => e.name).join(', '),
);
const bitList = [...bits].filter((b) => b >= 0);
const noHoles = Array.from({ length: 25 }, (_, i) => i).every((b) => bitList.includes(b));
probe.check(
  '单比特标志覆盖 1<<0 .. 1<<24 无空洞（NONE=0 之外共 25 位，最高位即 COLOR_SCHEME_UPDATES）',
  bits.has(-1) && bits.size === 26 && bitList.length === 25 && noHoles
    && single.find((e) => e.name === 'COLOR_SCHEME_UPDATES')?.value === '1 << 24',
  bitList.sort((a, b) => a - b).join(','),
);
const refsOf = (name) => {
  const e = composite.find((c) => c.name === name);
  return e ? [...e.value.matchAll(/Self::([A-Z_0-9]+)\.bits\(\)/g)].map((m) => m[1]) : [];
};
probe.check(
  '聚合标志 MOUSE_MODE = MOUSE_REPORT_CLICK | MOUSE_MOTION | MOUSE_DRAG（鼠标协议互斥的清位靶）',
  refsOf('MOUSE_MODE').length === 3
    && ['MOUSE_REPORT_CLICK', 'MOUSE_MOTION', 'MOUSE_DRAG'].every((n) => refsOf('MOUSE_MODE').includes(n)),
  refsOf('MOUSE_MODE').join(' | '),
);
probe.check(
  '聚合标志 KITTY_KEYBOARD_PROTOCOL = 5 个 kitty 键盘报告标志的并集',
  refsOf('KITTY_KEYBOARD_PROTOCOL').length === 5
    && ['DISAMBIGUATE_ESC_CODES', 'REPORT_EVENT_TYPES', 'REPORT_ALTERNATE_KEYS', 'REPORT_ALL_KEYS_AS_ESC', 'REPORT_ASSOCIATED_TEXT']
      .every((n) => refsOf('KITTY_KEYBOARD_PROTOCOL').includes(n)),
  refsOf('KITTY_KEYBOARD_PROTOCOL').join(' | '),
);
probe.check(
  'ANY = u32::MAX，且 WIN32_INPUT_MODE / COLOR_SCHEME_UPDATES 的文档注释分别点名 DECSET 9001 / DECSET 2031',
  anyEntry?.name === 'ANY'
    && /\/\/\/ Microsoft ConPTY Win32 input mode \(DECSET 9001\)\.\s*\n\s*const WIN32_INPUT_MODE/.test(flagsBlock)
    && /\/\/\/ DECSET 2031[\s\S]{0,400}?const COLOR_SCHEME_UPDATES\s+= 1 << 24;/.test(flagsBlock),
);
const defaultImpl = term.slice(term.indexOf('impl Default for TermMode {'), term.indexOf('impl Default for TermMode {') + 300)
  .replace(/\s+/g, ' ');
probe.check(
  'TermMode 默认值 = SHOW_CURSOR | LINE_WRAP | ALTERNATE_SCROLL | URGENCY_HINTS',
  defaultImpl.includes('TermMode::SHOW_CURSOR | TermMode::LINE_WRAP | TermMode::ALTERNATE_SCROLL | TermMode::URGENCY_HINTS'),
);

// ---- B. vte 依赖存在 ------------------------------------------------------------
const vteDep = cargo.match(/^vte = \{([^\n]*)\}/m)?.[1] || '';
probe.check(
  'nebula_terminal/Cargo.toml 声明 vte = { version = "0.15.0", default-features = false, features = ["std", "ansi"] }',
  /version = "0\.15\.0"/.test(vteDep) && /default-features = false/.test(vteDep)
    && /features = \["std", "ansi"\]/.test(vteDep),
  vteDep,
);
probe.check(
  'serde feature 把 bitflags/serde 与 vte/serde 一起接线（Term/Cell 可序列化）',
  /serde = \["dep:serde", "bitflags\/serde", "vte\/serde"\]/.test(cargo),
);
probe.check(
  'lib.rs `pub use vte;` 重导出：crate 内一律经 crate::vte 使用，不直接依赖路径',
  /^pub use vte;$/m.test(lib) && term.includes('use crate::vte::ansi::{'),
);

// ---- C. vte 回调接线（解析器 → Handler → 网格）------------------------------------
probe.check(
  'Term 实现 vte Handler：impl<T: EventListener> Handler for Term<T>',
  term.includes('impl<T: EventListener> Handler for Term<T> {')
    && term.includes('use crate::vte::ansi::{')
    && /\bHandler\b/.test(term.slice(term.indexOf('use crate::vte::ansi::{'), term.indexOf('use crate::vte::ansi::{') + 400)),
);
probe.check(
  '打印路径 Handler::input → write_at_cursor：把 cursor.template 的 fg/bg/flags 连同字符写进光标处单元格',
  term.includes('fn input(&mut self, c: char) {')
    && term.includes('let fg = self.grid.cursor.template.fg;')
    && term.includes('let bg = self.grid.cursor.template.bg;')
    && term.includes('let flags = self.grid.cursor.template.flags;')
    && term.includes('cursor_cell.fg = fg;') && term.includes('cursor_cell.bg = bg;') && term.includes('cursor_cell.flags = flags;'),
);
probe.check(
  '样式路径 terminal_attribute：Attr::Foreground 改 cursor.template.fg，Attr::Reset 把模板清回默认',
  term.includes('Attr::Foreground(color) => cursor.template.fg = color,')
    && term.includes('Attr::Reset => {')
    && term.includes('cursor.template.flags = Flags::empty();'),
);
probe.check(
  'event_loop.rs 的 StreamProcessor 持有 vte ansi::Processor，按 4096 字节分块 parser.advance(terminal, chunk) 驱动 Term',
  eventLoop.includes('parser: ansi::Processor,')
    && eventLoop.includes('for chunk in bytes.chunks(4096) {')
    && eventLoop.includes('self.parser.advance(terminal, chunk);'),
);

// ---- D. DECSET 2031 私有扩展处理点 ------------------------------------------------
const setMatch = 'if matches!(mode, PrivateMode::Unknown(2031)) {';
probe.check(
  `set_private_mode 有 2031 早退分支（出现 ${countOf(term, setMatch)} 处：set/unset 各一），注释写明只订阅、不回报当前配色`,
  countOf(term, setMatch) === 2
    && term.includes('DECSET 2031 只订阅后续配色变化，不是 CSI ? 996 n 查询；')
    && term.includes('self.mode.insert(TermMode::COLOR_SCHEME_UPDATES);')
    && term.includes('self.mode.remove(TermMode::COLOR_SCHEME_UPDATES);'),
);
probe.check(
  'report_color_scheme 以 mode.contains(COLOR_SCHEME_UPDATES) 为门，PtyWrite 发 \\x1b[?997;1n（暗）/ \\x1b[?997;2n（亮）',
  term.includes('fn report_color_scheme(&mut self)')
    && term.includes('if !self.mode.contains(TermMode::COLOR_SCHEME_UPDATES) {')
    && term.includes('Event::PtyWrite(format!("\\x1b[?997;{value}n"))'),
);
probe.check(
  '锁定源码记录成因：2031 不在 vte 0.15 的 NamedPrivateMode 表里，只能以 PrivateMode::Unknown(2031) 落到 handler',
  tests.includes('2031 不在 vte 0.15 的 `NamedPrivateMode` 表里')
    && tests.includes('fn decset_2031_survives_the_real_parser()')
    && tests.includes('parser.advance(&mut term, b"\\x1b[?2031h");'),
);
probe.check(
  '2031 的位落点即 TermMode::COLOR_SCHEME_UPDATES = 1 << 24（bitflags 块内文档注释 DECSET 2031 — 订阅色彩方案）',
  /const COLOR_SCHEME_UPDATES\s+= 1 << 24;/.test(flagsBlock)
    && flagsBlock.includes('订阅色彩方案（亮/暗）变更通知'),
);

// ---- E. 网格与单元格 -------------------------------------------------------------
const gridStruct = grid.slice(grid.indexOf('pub struct Grid<T> {'), grid.indexOf('pub struct Grid<T> {') + 1600);
probe.check(
  'Grid<T> 字段面：cursor/saved_cursor + raw: Storage<T> 行存储 + columns/lines + display_offset + max_scroll_limit',
  gridStruct.includes('pub cursor: Cursor<T>,') && gridStruct.includes('pub saved_cursor: Cursor<T>,')
    && gridStruct.includes('raw: Storage<T>,') && gridStruct.includes('columns: usize,')
    && gridStruct.includes('lines: usize,') && gridStruct.includes('display_offset: usize,')
    && gridStruct.includes('max_scroll_limit: usize,'),
);
probe.check(
  'Dimensions trait 声明 total_lines / screen_lines / columns，且 Grid<G> 与 Term<T> 都实现它',
  grid.includes('pub trait Dimensions {') && grid.includes('fn total_lines(&self) -> usize;')
    && grid.includes('fn screen_lines(&self) -> usize;') && grid.includes('fn columns(&self) -> usize;')
    && grid.includes('impl<G> Dimensions for Grid<G> {') && term.includes('impl<T> Dimensions for Term<T> {'),
);
probe.check(
  '滚动区在 Term 侧：scroll_region: Range<Line>，DECSTBM 之外的行为都按区域裁剪',
  term.includes('scroll_region: Range<Line>,')
    && term.includes('self.scroll_region = Line(0)..Line(self.screen_lines() as i32);'),
);
const cellStruct = cell.slice(cell.indexOf('pub struct Cell {'), cell.indexOf('pub struct Cell {') + 400);
probe.check(
  'Cell = { c: char, fg: Color, bg: Color, flags: Flags, extra }——颜色是单元格的属性，不是字符的',
  cellStruct.includes('pub c: char,') && cellStruct.includes('pub fg: Color,')
    && cellStruct.includes('pub bg: Color,') && cellStruct.includes('pub flags: Flags,')
    && cellStruct.includes('pub extra: Option<Arc<CellExtra>>,'),
);

// ---- F. damage 追踪 --------------------------------------------------------------
probe.check(
  'LineDamageBounds = { line, left, right }，expand 取 min/max 扩区间，is_damaged 判 left <= right',
  damage.includes('pub struct LineDamageBounds {') && damage.includes('pub line: usize,')
    && damage.includes('pub left: usize,') && damage.includes('pub right: usize,')
    && damage.includes('pub fn expand(&mut self, left: usize, right: usize) {')
    && damage.includes('pub fn is_damaged(&self) -> bool {')
    && damage.includes('self.left <= self.right'),
);
probe.check(
  'TermDamage 是 Full | Partial(TermDamageIterator) 二态：全屏损坏走 Full，否则按行迭代',
  damage.includes("pub enum TermDamage<'a> {") && damage.includes('Full,')
    && damage.includes("Partial(TermDamageIterator<'a>),")
    && damage.includes('pub(super) struct TermDamageState {')
    && damage.includes('pub(super) full: bool,') && damage.includes('pub(super) lines: Vec<LineDamageBounds>,')
    && damage.includes('pub(super) last_cursor: Point,'),
);
const damageCalls = countOf(term, 'self.damage.damage_line(') + countOf(term, 'self.damage.damage_point(');
probe.check(
  `Term 公开 damage()/reset_damage()，写路径共 ${damageCalls} 处 damage_point/damage_line 调用（>= 12）`,
  term.includes("pub fn damage(&mut self) -> TermDamage<'_> {")
    && term.includes('pub fn reset_damage(&mut self) {')
    && term.includes('pub use damage::{LineDamageBounds, TermDamage, TermDamageIterator};')
    && damageCalls >= 12,
  `damage_line=${countOf(term, 'self.damage.damage_line(')}, damage_point=${countOf(term, 'self.damage.damage_point(')}`,
);

// ---- 摘要（milestone_verify：列出解析→网格→damage 的证据锚点）--------------------
console.log(
  `summary [vt-grid] parse=${P.eventLoop}:${lineOf(eventLoop, 'self.parser.advance(terminal, chunk);')} (parser.advance); ` +
  `mode=${P.term}:${lineOf(term, 'if matches!(mode, PrivateMode::Unknown(2031)) {')} (DECSET 2031 -> COLOR_SCHEME_UPDATES 1<<24); ` +
  `style=${P.term}:${lineOf(term, 'fn terminal_attribute(&mut self, attr: Attr) {')} (CSI SGR -> cursor.template); ` +
  `cell=${P.term}:${lineOf(term, 'fn write_at_cursor(&mut self, c: char) {')} + ${P.cell}:${lineOf(cell, 'pub struct Cell {')}; ` +
  `grid=${P.grid}:${lineOf(grid, 'pub struct Grid<T> {')} / Dimensions:${lineOf(grid, 'pub trait Dimensions {')}; ` +
  `damage=${P.damage}:${lineOf(damage, 'pub struct LineDamageBounds {')} ..:${lineOf(damage, 'pub(super) struct TermDamageState {')}; ` +
  `TermMode: ${single.length} single flags bits 0..24 + ${composite.length} aggregates + ANY`,
);

probe.done();
