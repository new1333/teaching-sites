// 第 11 章 session-persistence：会话持久化——崩溃安全快照与恢复护栏。
// 对锁定 clone（.course/repo @ 360613aa）只读断言三件事在源码中的位置：
//   快照节奏——1 Hz 持续快照 + 跳过无变化帧（旧壳 event.rs 挂 1 Hz chrome
//   时钟、GPUI 壳 windowing.rs 每秒 autosave_tick；去重分别靠
//   last_saved_session 与 SessionPersistence::saved 的相等比较）；
//   恢复护栏——session.rs 的 MAX_BOOT_ATTEMPTS = 3 与 should_restore，
//   boot 前 mark_boot_attempt 先落盘、跳闸后 quarantine 隔离现场，
//   首次成功自动保存经 Session::new 把计数归零；
//   版本化 schema——VERSION = 4 是 session.rs 的常量（schema 属主），
//   v1–v3 解析时原地升版、v≠4 一律拒绝；v4 记录整棵分屏树
//   （LayoutSession）与每 tab 启动身份（LaunchSession），同一格式经
//   save_to/load_from 兼作工作区导出文件；写盘走 atomic_file 的
//   临时文件 + sync_all + 原子替换。
// 模块地图：常量与结构住在 schema 属主 nebula_app/src/session.rs（声明
// mod identity / mod window_layout 落在 session/ 子目录），壳侧接线在
// gpui_shell/workspace/session_persistence.rs（去重与 SaveReason），启动
// 恢复路径在 workspace/session_recovery.rs，多窗合并的护栏传递在
// session/window_layout.rs；旧壳（daemon）侧节奏在 event.rs 与
// window_context.rs。
// 分工边界：pane 生命周期三件套与 shutdown/Drop 双保险由第 5 章探针负责，
// ConPTY 对账死线与 resize 去抖由第 3 章探针负责——本章只断言持久化节奏、
// schema 与护栏，不重复其断言面。D 组用自建最小输入按源码公式重演，
// 不执行目标仓库代码。
import { requireRepo, readRepoFile, repoFileExists, makeProbe } from './lib/repo.js';

const probe = makeProbe('session-persistence');
requireRepo();

const norm = (s) => s.replace(/\s+/g, ' ');

const sp = readRepoFile('nebula_app/src/session.rs');
const wl = readRepoFile('nebula_app/src/session/window_layout.rs');
const pers = readRepoFile('nebula_app/src/gpui_shell/workspace/session_persistence.rs');
const sr = readRepoFile('nebula_app/src/gpui_shell/workspace/session_recovery.rs');
const win = readRepoFile('nebula_app/src/gpui_shell/workspace/windowing.rs');
const ws = readRepoFile('nebula_app/src/gpui_shell/workspace.rs');
const ev = readRepoFile('nebula_app/src/event.rs');
const wc = readRepoFile('nebula_app/src/window_context.rs');
const af = readRepoFile('nebula_app/src/atomic_file.rs');

// ---- A. 快照节奏：1 Hz 持续快照 + 跳过无变化帧 ------------------------------
probe.check(
  'schema 属主的节奏合同逐字：模块头声明「A snapshot is written continuously (1 Hz, skipped when nothing changed), so a crash or force-kill still restores to within a second of where you were.」',
  norm(sp).includes('A snapshot is written continuously (1 Hz, skipped when nothing changed), so //! a crash or force-kill still restores to within a second of where you were.'),
);

probe.check(
  '模块地图：session.rs 声明 mod identity; / mod window_layout; 且文件落在 session/ 子目录（结构体与合并逻辑不在本体）',
  /^mod identity;$/m.test(sp) && /^mod window_layout;$/m.test(sp)
    && repoFileExists('nebula_app/src/session/identity.rs')
    && repoFileExists('nebula_app/src/session/window_layout.rs'),
);

probe.check(
  '旧壳节奏源：event.rs 给每窗口挂重复 1 秒 NebulaClock 定时器——schedule(tick, Duration::from_secs(1), true, clock_timer)',
  ev.includes('self.scheduler.schedule(tick, Duration::from_secs(1), true, clock_timer);'),
);

probe.check(
  '旧壳接线：NebulaTick 分支注释「Piggyback session persistence on the 1 Hz chrome clock.」后调用 window_context.autosave_session()',
  ev.includes('// Piggyback session persistence on the 1 Hz chrome clock.')
    && ev.includes('window_context.autosave_session();'),
);

probe.check(
  '旧壳跳过无变化帧：autosave_session 合同「1 Hz autosave (piggybacks on the chrome clock tick): persist the session when it changed」——last_saved_session 相等即 return，否则 session::save(&snapshot)',
  norm(wc).includes('1 Hz autosave (piggybacks on the chrome clock tick): persist the session /// when it changed, so a crash or force-kill restores to within a second.')
    && wc.includes('pub fn autosave_session(&mut self) {')
    && wc.includes('if self.last_saved_session.as_ref() == Some(&snapshot) {')
    && wc.includes('session::save(&snapshot);'),
);

probe.check(
  'GPUI 壳节奏源：windowing.rs initialize 里 spawn 的循环每 1 秒醒一次——loop { timer(Duration::from_secs(1)).await; cx.update(autosave_tick); }',
  norm(win).includes('loop { cx.background_executor().timer(Duration::from_secs(1)).await; cx.update(autosave_tick); }'),
);

probe.check(
  'GPUI 壳接线：autosave_tick → save_combined_session(cx, false) → reason = if clean { Quit } else { Checkpoint }——周期检查点与收尾 Quit 走同一入口',
  win.includes('pub(crate) fn autosave_tick(cx: &mut App) {')
    && win.includes('if let Err(error) = save_combined_session(cx, false) {')
    && win.includes('let reason = if clean { SaveReason::Quit } else { SaveReason::Checkpoint };')
    && win.includes('log::warn!("Session checkpoint: {error}");'),
);

probe.check(
  'GPUI 壳跳过无变化帧：SessionPersistence::save_with 在 saved == candidate 时直接 return Ok(()) 不写盘（换行符外逐字段相等即无变化帧）',
  pers.includes('if self.saved.as_ref() == Some(&session) {')
    && pers.includes('return Ok(())')
    && pers.includes('fn unchanged_checkpoints_do_not_rewrite_storage() {'),
);

// ---- B. 恢复护栏：boot_attempts 三连败放弃恢复 -------------------------------
probe.check(
  '上限常量：session.rs 的 MAX_BOOT_ATTEMPTS = 3，合同注释「Give up restoring after this many launches that never reached a successful autosave (i.e. crashed within the first second).」',
  sp.includes('const MAX_BOOT_ATTEMPTS: u32 = 3;')
    && norm(sp).includes('Give up restoring after this many launches that never reached a successful /// autosave (i.e. crashed within the first second).'),
);

probe.check(
  '裁定式逐字：should_restore = session.boot_attempts < MAX_BOOT_ATTEMPTS && !session.tabs.is_empty()（计数到 3 或空会话都不恢复）',
  sp.includes('session.boot_attempts < MAX_BOOT_ATTEMPTS && !session.tabs.is_empty()'),
);

probe.check(
  '计数先于恢复落盘：mark_boot_attempt 体内 boot_attempts += 1 后立即 save；合同「Bump the attempt counter on disk before a restore is tried, so a crash during/after restore is counted against the loop breaker.」',
  sp.includes('pub fn mark_boot_attempt(session: &mut Session) {')
    && sp.includes('    session.boot_attempts += 1;')
    && sp.includes('    save(session);')
    && norm(sp).includes('Bump the attempt counter on disk before a restore is tried, so a crash /// during/after restore is counted against the loop breaker.'),
);

probe.check(
  '归零路径：新快照一律带 boot_attempts = 0（Session::new 构造），GPUI 侧 snapshot_session 合同「快照一律带 `boot_attempts = 0`：断路器只回答『这次启动活到了第一次自动保存没有』」',
  sp.includes('boot_attempts: 0,')
    && norm(sr).includes('快照一律带 `boot_attempts = 0`：断路器只回答「这次启动活到了第一次'),
);

probe.check(
  '跳闸处置：quarantine 把现场 copy 到 session.crashed.json 再 remove 原文件（隔离而非留在原地——一秒后的自动保存会盖掉唯一现场）',
  sp.includes('pub fn quarantine() -> Option<PathBuf> {')
    && sp.includes('crate::display::nebula_data_dir().join("session.crashed.json")')
    && sp.includes('std::fs::copy(&from, &to).ok()?;')
    && sp.includes('let _ = std::fs::remove_file(&from);'),
);

const iLoad = sr.indexOf('let Some(mut session) = crate::session::load() else { return false };');
const iGuard = sr.indexOf('if !crate::session::should_restore(&session) {');
const iQuarantine = sr.indexOf('crate::session::quarantine()');
const iBump = sr.indexOf('crate::session::mark_boot_attempt(&mut session);');
probe.check(
  'GPUI 启动路径次序：load → should_restore 裁定 →（跳闸）quarantine → mark_boot_attempt 先于恢复执行（四个调用点按此顺序出现且各恰 1 处）',
  iLoad >= 0 && iGuard > iLoad && iQuarantine > iGuard && iBump > iQuarantine
    && sr.split('crate::session::mark_boot_attempt(&mut session);').length - 1 === 1
    && sr.split('crate::session::quarantine()').length - 1 === 1,
);

probe.check(
  '多窗合并不丢护栏：combine_sessions 取各窗 boot_attempts 的 max（任一窗挂起恢复都保住断路器计数）',
  wl.includes('combined.boot_attempts = combined.boot_attempts.max(session.boot_attempts);'),
);

// ---- C. 版本化 schema：v4 标记、升版/拒绝与导出复用 --------------------------
probe.check(
  '版本常量在 schema 属主：session.rs 的 VERSION = 4，注释「Highest snapshot format this build understands.」',
  sp.includes('const VERSION: u32 = 4;')
    && sp.includes('/// Highest snapshot format this build understands.'),
);

probe.check(
  '升版/拒绝逻辑：parse 对 v1..=3 原地改写 session.version = VERSION；最终 (session.version == VERSION).then_some(session)——v5 返回 None，更新路径把不可读工作区当 InvalidData 错误而不是清空',
  sp.includes('if matches!(session.version, 1..=3) {')
    && sp.includes('session.version = VERSION;')
    && sp.includes('(session.version == VERSION).then_some(session)')
    && sp.includes('std::io::Error::new(std::io::ErrorKind::InvalidData, "Invalid saved workspace")'),
);

probe.check(
  'v4 树结构：LayoutSession = Pane{cwd, custom_name, agent, launch} | Split{axis: SplitAxis, ratio_permille: u16, first/second: Box<LayoutSession>}；permille 整数合同「an integer, so autosave change detection and file diffs never trip on f32 serialization noise」',
  sp.includes('pub enum LayoutSession {')
    && sp.includes('axis: SplitAxis,')
    && sp.includes('ratio_permille: u16,')
    && sp.includes('first: Box<LayoutSession>,')
    && sp.includes('second: Box<LayoutSession>,')
    && norm(sp).includes('splits carry /// the axis and the first child\'s share in permille — an integer, so autosave /// change detection and file diffs never trip on f32 serialization noise.'),
);

probe.check(
  '每 tab 启动身份：LaunchSession 四变体 Default / Shell{name, program, args} / Profile{...} / Ssh{host}——命令整体嵌入而非按名引用（「so an exported workspace stays portable」）',
  sp.includes('pub enum LaunchSession {')
    && sp.includes('    Default,') && sp.includes('    Shell {') && sp.includes('    Profile {') && sp.includes('    Ssh {')
    && sp.includes('host: String,')
    && norm(sp).includes('launches embed their full command so an exported workspace stays portable'),
);

probe.check(
  'TabSession 的 v4 增量字段注释：launch（首 pane 启动）、layout（整棵分屏树）、active_pane（深度优先焦叶下标），三者都以 None 缺省兼容 v1–v3 老文件',
  sp.includes('/// v4: how the first pane starts. `None` (older file) means `Default`.')
    && sp.includes('/// v4: the full split tree. `None` (older file) is a single pane at `cwd`.')
    && sp.includes('/// v4: focused leaf as a depth-first index into `layout`.'),
);

probe.check(
  '同一格式兼作工作区导出：模块头「the same schema doubles as the workspace-export file format: session.json is simply the automatic, unnamed workspace」；save_to 写命名工作区文件（pretty-print，供人读/diff/版本化），load_from 从显式路径导入；GPUI 导出菜单走同一 snapshot_session',
  norm(sp).includes('the same schema //! doubles as the workspace-export file format: `session.json` is simply the //! automatic, unnamed workspace.')
    && sp.includes('pub fn save_to(path: &Path, session: &Session) -> std::io::Result<()> {')
    && norm(sp).includes('Write a session as a named workspace file. Pretty-printed — workspace /// files are user-visible artifacts meant to be read, diffed and versioned.')
    && sp.includes('pub fn load_from(path: &Path) -> Option<Session> {')
    && ws.includes('fn export_workspace(&mut self, window: &mut Window, cx: &mut Context<Self>) {')
    && ws.includes('let export = self.snapshot_session(cx);'),
);

probe.check(
  '崩溃安全写盘：try_save 走 crate::atomic_file::write——模块合同「sibling temporary file followed by an atomic replace, so a crash cannot leave a half-written JSON document」；临时文件 write_all 后 sync_all 再 replace（Windows 用 MoveFileExW REPLACE_EXISTING|WRITE_THROUGH）',
  sp.includes('crate::atomic_file::write(&session_path(), json.as_bytes())')
    && norm(af).includes('State writers use a sibling temporary file followed by an atomic replace, //! so a crash cannot leave a half-written JSON document.')
    && af.includes('file.sync_all()?;')
    && af.includes('replace(&temporary, path)')
    && af.includes('MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,'),
);

// ---- D. 自建最小输入重演（公式逐字取自 B/C 组源码，不执行仓库代码）------------
const shouldRestore = (bootAttempts, tabCount) => bootAttempts < 3 && tabCount > 0;
const boots = [0, 1, 2, 3].map((attemptsOnDisk) => shouldRestore(attemptsOnDisk, 2));
const emptyCase = shouldRestore(0, 0);
probe.check(
  `护栏重演：盘上计数 0/1/2/3 × 2 个 tab → 恢复裁定 [${boots.join(', ')}]；空 tab 列表即使计数 0 也不恢复（${emptyCase}）`,
  boots.join(',') === 'true,true,true,false' && emptyCase === false,
);

const gate = (v) => (v >= 1 && v <= 3 ? 4 : v === 4 ? 4 : null);
probe.check(
  `版本闸重演：v1→${gate(1)} v2→${gate(2)} v3→${gate(3)}（原地升 4）、v4→${gate(4)}（原样接受）、v5→${gate(5)}（拒绝为 null）`,
  gate(1) === 4 && gate(2) === 4 && gate(3) === 4 && gate(4) === 4 && gate(5) === null,
);

// ---- 摘要（milestone_verify 要求输出节奏/护栏/schema 证据）-------------------
console.log(
  `summary [session-persistence] cadence=1Hz(loop timer from_secs(1)) + skip-unchanged(last_saved_session / SessionPersistence.saved equality); ` +
  `guard=MAX_BOOT_ATTEMPTS:u32=3, should_restore=boot_attempts<3&&!tabs.is_empty(), bump-before-restore(mark_boot_attempt:+=1;save), reset=Session::new(boot_attempts=0), tripped=>quarantine(session.crashed.json, copy+remove); ` +
  `schema=VERSION:u32=4(session.rs), parse upgrades v1..=3 in place / rejects v!=4, v4=LayoutSession tree(axis,ratio_permille:u16)+LaunchSession(Default|Shell|Profile|Ssh)+active_pane, same format doubles as workspace export(save_to/load_from), write=atomic_file(temp+sync_all+MoveFileExW replace)`,
);

probe.done();
