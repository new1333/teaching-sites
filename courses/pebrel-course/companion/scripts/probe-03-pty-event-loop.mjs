// 第 3 章 pty-event-loop：PTY 桥与事件循环。
// 对锁定 clone（.course/repo @ 360613aa）只读断言本章 milestone：
// 平台分叉文件结构、READ_BUFFER_SIZE 常量与 FairMutex 的公平性实现锚点，
// 外加正文推理要用的 I/O 主循环证据链（polling / 分块读 / 喂 Term / UI 通知）
// 与 ConPTY resize 对账 + ALIGN_DELAY 静默期。
// 聚焦 I/O 线程与平台桥；vte 回调接线（StreamProcessor 内部 4096 分块）归第 2 章探针，不重复。
// 所有断言取自锁定 ref 上的静态文件内容，不执行目标仓库代码。
import fs from 'node:fs';
import path from 'node:path';
import { requireRepo, readRepoFile, repoFileExists, makeProbe } from './lib/repo.js';

const probe = makeProbe('pty-event-loop');
const root = requireRepo();

const P = {
  ttyMod: 'nebula_terminal/src/tty/mod.rs',
  ttyUnix: 'nebula_terminal/src/tty/unix.rs',
  ttyWin: 'nebula_terminal/src/tty/windows/mod.rs',
  ttyConpty: 'nebula_terminal/src/tty/windows/conpty.rs',
  eventLoop: 'nebula_terminal/src/event_loop.rs',
  sync: 'nebula_terminal/src/sync.rs',
};
for (const p of Object.values(P)) {
  if (!repoFileExists(p)) {
    console.error(`pty-event-loop: 锁定 clone 缺少 ${p}`);
    process.exit(1);
  }
}
// 锁定 clone 在本机检出为 CRLF 行尾；断言前统一归一为 \n，行号不受影响。
const read = (p) => readRepoFile(p).replace(/\r\n/g, '\n');
const ttyMod = read(P.ttyMod);
const ttyUnix = read(P.ttyUnix);
const ttyWin = read(P.ttyWin);
const ttyConpty = read(P.ttyConpty);
const eventLoop = read(P.eventLoop);
const sync = read(P.sync);

// 文本内首次出现的行号（1 起，找不到为 -1），供证据锚点汇总。
const lineOf = (text, needle) => {
  const idx = text.indexOf(needle);
  return idx < 0 ? -1 : text.slice(0, idx).split('\n').length;
};
const countOf = (text, needle) => text.split(needle).length - 1;
// 压平空白后的包含判断（跨行文档注释用）。
const flat = (text) => text.replace(/\s+/g, ' ');
// 再剥掉行注释前缀（//、///、//!）后压平：多行文档注释逐行拼接用。
const flatDoc = (text) => text.replace(/\/\/+!?\s*/g, ' ').replace(/\s+/g, ' ');

// ---- A. 平台分叉文件结构 ---------------------------------------------------------
probe.check(
  'tty/mod.rs 用 cfg 分叉平台后端：非 windows 走私有 mod unix（pub use self::unix::*），windows 走 pub mod windows（pub use self::windows::*）',
  ttyMod.includes('#[cfg(not(windows))]\nmod unix;\n#[cfg(not(windows))]\npub use self::unix::*;')
    && ttyMod.includes('#[cfg(windows)]\npub mod windows;\n#[cfg(windows)]\npub use self::windows::*;'),
);
probe.check(
  '平台无关接缝在 mod.rs：EventedReadWrite（Reader/Writer 分离）+ EventedPty: EventedReadWrite（next_child_event），两侧 Pty 各自实现',
  ttyMod.includes('pub trait EventedReadWrite {')
    && ttyMod.includes('pub trait EventedPty: EventedReadWrite {')
    && ttyMod.includes('fn next_child_event(&mut self) -> Option<ChildEvent>;')
    && ttyUnix.includes('impl EventedPty for Pty {') && ttyUnix.includes('impl EventedReadWrite for Pty {')
    && ttyWin.includes('impl EventedPty for Pty {') && ttyWin.includes('impl EventedReadWrite for Pty {'),
);
const unixPty = ttyUnix.slice(ttyUnix.indexOf('pub struct Pty {'), ttyUnix.indexOf('pub struct Pty {') + 200);
probe.check(
  'unix Pty = { child, file, signals, sig_id }：一个 File 同时当 Reader 和 Writer（reader()/writer() 都返回 &mut self.file）',
  unixPty.includes('child: Child,') && unixPty.includes('file: File,')
    && unixPty.includes('signals: UnixStream,') && unixPty.includes('sig_id: SigId,')
    && ttyUnix.includes('type Reader = File;') && ttyUnix.includes('type Writer = File;')
    && countOf(ttyUnix, '&mut self.file') >= 2,
);
probe.check(
  'unix 建线三件：rustix_openpty::openpty 开主从对、pre_exec 里 TIOCSCTTY 设控制终端、SIGCHLD 经 signal_pipe 落 UnixStream 可轮询',
  ttyUnix.includes('use rustix_openpty::openpty;')
    && ttyUnix.includes('libc::ioctl(fd, TIOCSCTTY as _, 0)')
    && ttyUnix.includes('signal_pipe::register(sigconsts::SIGCHLD, sender)?'),
);
const winPty = ttyWin.slice(ttyWin.indexOf('pub struct Pty {'), ttyWin.indexOf('pub struct Pty {') + 400);
probe.check(
  'windows 子模块五件套（blocking/child/cmd_prompt/conpty/environment），Pty = { backend: Conpty, conout, conin, child_watcher }，注释声明 Backend 必须是第一个字段（drop 顺序合同）',
  ttyWin.includes('mod blocking;') && ttyWin.includes('mod child;') && ttyWin.includes('mod cmd_prompt;')
    && ttyWin.includes('mod conpty;') && ttyWin.includes('mod environment;')
    && winPty.includes('backend: Backend,') && winPty.includes('conout: ReadPipe,')
    && winPty.includes('conin: WritePipe,') && winPty.includes('child_watcher: ChildExitWatcher,')
    && flat(winPty).includes('Backend is required to be the first field, to ensure correct drop order'),
);
probe.check(
  '轮询 token 两侧取值不同：unix PTY_READ_WRITE_TOKEN=0 / PTY_CHILD_EVENT_TOKEN=1；windows PTY_CHILD_EVENT_TOKEN=1 / PTY_READ_WRITE_TOKEN=2',
  ttyUnix.includes('pub(crate) const PTY_READ_WRITE_TOKEN: usize = 0;')
    && ttyUnix.includes('pub(crate) const PTY_CHILD_EVENT_TOKEN: usize = 1;')
    && ttyWin.includes('pub const PTY_CHILD_EVENT_TOKEN: usize = 1;')
    && ttyWin.includes('pub const PTY_READ_WRITE_TOKEN: usize = 2;'),
);
probe.check(
  'resize 通道两侧分叉：unix 走 libc::ioctl TIOCSWINSZ；windows Pty::on_resize 委托 backend（Conpty::on_resize 调 api.resize 即 ResizePseudoConsole，失败只记 HRESULT 不崩）',
  ttyUnix.includes('libc::ioctl(self.file.as_raw_fd(), libc::TIOCSWINSZ, &win as *const _)')
    && ttyWin.includes('fn on_resize(&mut self, window_size: WindowSize) {\n        self.backend.on_resize(window_size)\n    }')
    && ttyConpty.includes('impl OnResize for Conpty {')
    && ttyConpty.includes('let result = unsafe { (self.api.resize)(self.handle, window_size.into()) };')
    && ttyConpty.includes('ResizePseudoConsole failed: HRESULT'),
);
probe.check(
  '两侧 new 入口同形：pub fn new(config: &Options, window_size: WindowSize, ...window_id) -> Result<Pty>，windows 直接转调 conpty::new',
  ttyUnix.includes('pub fn new(config: &Options, window_size: WindowSize, window_id: u64) -> Result<Pty> {')
    && ttyWin.includes('pub fn new(config: &Options, window_size: WindowSize, _window_id: u64) -> Result<Pty> {')
    && ttyWin.includes('    conpty::new(config, window_size)\n}'),
);

// ---- B. I/O 主循环：polling / 分块读 / FairMutex 喂 Term / UI 通知 -------------------
probe.check(
  'I/O 线程有名字：thread::spawn_named("PTY reader")，栈上缓冲 buf = [0u8; READ_BUFFER_SIZE]（1 MiB）',
  eventLoop.includes('thread::spawn_named("PTY reader", move || {')
    && eventLoop.includes('let mut buf = [0u8; READ_BUFFER_SIZE];'),
);
probe.check(
  'polling 就绪模型：Poller + PollMode::Level，poll.wait(&mut events, timeout)；timeout 取 sync 超时与 align 死线的较早者',
  eventLoop.includes('use polling::{Event as PollingEvent, Events, PollMode, Poller};')
    && eventLoop.includes('let poll_opts = PollMode::Level;')
    && eventLoop.includes('if let Err(err) = self.poll.wait(&mut events, timeout) {')
    && eventLoop.includes('let deadline = match (state.stream.next_sync_timeout(), state.align_at) {'),
);
const ptyRead = eventLoop.slice(eventLoop.indexOf('fn pty_read<X>('), eventLoop.indexOf('fn pty_write('));
probe.check(
  'pty_read 先 lease 保留下一把锁（terminal.lease()），锁内读用 try_lock_unfair，攒满 READ_BUFFER_SIZE 才升级 lock_unfair 强制阻塞',
  ptyRead.includes('let _terminal_lease = Some(self.terminal.lease());')
    && ptyRead.includes('match self.terminal.try_lock_unfair() {')
    && ptyRead.includes('None if unprocessed >= READ_BUFFER_SIZE => self.terminal.lock_unfair(),'),
);
probe.check(
  '喂 Term 路径：state.stream.feed(&mut **terminal, &self.event_proxy, &buf[..unprocessed]) 在 FairMutex guard 下执行；单次持锁上限 MAX_LOCKED_READ = u16::MAX',
  ptyRead.includes('state.stream.feed(&mut **terminal, &self.event_proxy, &buf[..unprocessed]);')
    && eventLoop.includes('const MAX_LOCKED_READ: usize = u16::MAX as usize;')
    && ptyRead.includes('if processed >= MAX_LOCKED_READ {'),
);
probe.check(
  'UI 通知：非同步更新字节处理完（sync_bytes_count() < processed 且 processed > 0）才 send_event(Event::Wakeup)',
  ptyRead.includes('if state.stream.sync_bytes_count() < processed && processed > 0 {')
    && ptyRead.includes('self.event_proxy.send_event(Event::Wakeup);'),
);
const drain = eventLoop.slice(eventLoop.indexOf('fn drain_recv_channel'), eventLoop.indexOf('fn drain_recv_channel') + 1800);
probe.check(
  'Msg 四消息（Input/Shutdown/Resize/ResizeGrid），drain 只留最新 resize（PendingResize 覆盖式合并），ResizeGrid 不丢已挂起的 notify_pty',
  eventLoop.includes('pub enum Msg {') && eventLoop.includes('Input(Cow<\'static, [u8]>),')
    && eventLoop.includes('Resize(WindowSize)') && eventLoop.includes('ResizeGrid(WindowSize)')
    && drain.includes('resize = Some(PendingResize { window_size, notify_pty: true })')
    && drain.includes('let notify_pty = resize.is_some_and(|pending| pending.notify_pty);'),
);

// ---- C. READ_BUFFER_SIZE 真实值与跨文件常量链 ---------------------------------------
probe.check(
  'READ_BUFFER_SIZE = 0x10_0000（= 1048576 字节 = 1 MiB），pub(crate)，注释定位为「强制终端同步前最多读多少字节」',
  eventLoop.includes('pub(crate) const READ_BUFFER_SIZE: usize = 0x10_0000;')
    && flat(eventLoop).includes('Max bytes to read from the PTY before forced terminal synchronization.'),
);
probe.check(
  'windows 管道容量直接复用同一常量：conpty.rs 里 PIPE_CAPACITY = crate::event_loop::READ_BUFFER_SIZE（两侧读取上限一致）',
  ttyConpty.includes('const PIPE_CAPACITY: usize = crate::event_loop::READ_BUFFER_SIZE;')
    && ttyConpty.includes('UnblockedReader::new(conout, PIPE_CAPACITY)'),
);

// ---- D. FairMutex 公平性实现锚点（sync.rs）------------------------------------------
const fairHeader = flat(sync.slice(0, sync.indexOf('pub struct FairMutex')));
probe.check(
  'FairMutex 文档自述公平机制：加一把额外的锁，保证已在等待的线程先于同一线程的重复加锁拿到锁',
  flatDoc(fairHeader).includes('Uses an extra lock to ensure that if one thread is waiting that it will get the lock before a single thread can re-lock it.'),
);
const fairStruct = sync.slice(sync.indexOf('pub struct FairMutex<T> {'), sync.indexOf('pub struct FairMutex<T> {') + 200);
probe.check(
  '双 Mutex 结构：data: Mutex<T>（真数据）+ next: Mutex<()>（到达序排队位），基于 parking_lot',
  sync.includes('use parking_lot::{Mutex, MutexGuard};')
    && fairStruct.includes('data: Mutex<T>,') && fairStruct.includes('next: Mutex<()>,'),
);
const lockFn = sync.slice(sync.indexOf('pub fn lock(&self)'), sync.indexOf('pub fn lock(&self)') + 260);
probe.check(
  'lock() 先拿 next 再拿 data（let _next = self.next.lock(); self.data.lock()），注释解释必须绑临时值防提前释放',
  lockFn.includes('let _next = self.next.lock();') && lockFn.includes('self.data.lock()')
    && flatDoc(lockFn).includes('Must bind to a temporary or the lock will be freed before going into data.lock().'),
);
probe.check(
  'lease() 只锁 next（占住下一把锁的排队位）；lock_unfair/try_lock_unfair 绕过 next 直取 data',
  sync.includes('pub fn lease(&self) -> MutexGuard<\'_, ()> {\n        self.next.lock()\n    }')
    && sync.includes('pub fn lock_unfair(&self) -> MutexGuard<\'_, T> {\n        self.data.lock()\n    }')
    && sync.includes('pub fn try_lock_unfair(&self) -> Option<MutexGuard<\'_, T>> {\n        self.data.try_lock()\n    }'),
);
// 全仓库 .lease() 调用点扫描：FairMutex 的公平入口只在事件循环里被用。
const walkRs = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? walkRs(full) : e.name.endsWith('.rs') ? [full] : [];
  });
const leaseSites = walkRs(root).filter((f) => readRepoFile(path.relative(root, f).split(path.sep).join('/')).includes('.lease()'));
probe.check(
  '全仓库 .lease() 调用点唯一：event_loop.rs 的 pty_read（I/O 线程保留锁位，UI 侧走公平 lock()）',
  leaseSites.length === 1 && leaseSites[0].endsWith(path.join('nebula_terminal', 'src', 'event_loop.rs')),
  leaseSites.map((f) => path.relative(root, f)).join(', '),
);
probe.check(
  'EventLoop 以 Arc<FairMutex<Term<U>>> 持有终端：terminal 字段 + new() 签名双锚点',
  eventLoop.includes('terminal: Arc<FairMutex<Term<U>>>,') && eventLoop.includes('use crate::sync::FairMutex;')
    && eventLoop.includes('pub fn new(\n        terminal: Arc<FairMutex<Term<U>>>,'),
);

// ---- E. ConPTY resize 对账与 ALIGN_DELAY 静默期 --------------------------------------
probe.check(
  'ALIGN_DELAY = Duration::from_millis(120)：resize 提交后给 conhost 内部整理与 shell 反应留的静默期',
  eventLoop.includes('const ALIGN_DELAY: Duration = Duration::from_millis(120);')
    && flat(eventLoop).includes('ConPTY 光标对账的静默期：最后一次 resize 提交后等这么久再探针'),
);
const realign = eventLoop.slice(eventLoop.indexOf('fn realign_to_conpty'), eventLoop.indexOf('fn realign_to_conpty') + 900);
probe.check(
  'realign_to_conpty(stage, expect_rows)：child_pid().and_then(conpty_cursor_probe) 要真值；expect_rows 不匹配 conhost 视口高度即放弃本次；对账走 terminal.conpty_realign(probe.row) 后发 Wakeup',
  realign.includes('let Some(probe) = self.pty.child_pid().and_then(conpty_cursor_probe) else {')
    && realign.includes('if expect_rows.is_some_and(|rows| rows != probe.rows) {')
    && realign.includes('terminal.conpty_realign(probe.row);')
    && realign.includes('self.event_proxy.send_event(Event::Wakeup);'),
);
probe.check(
  'resize 边界双保险：同步对账 realign_to_conpty("align-sync", Some(num_lines)) 后设死线 state.align_at = now + ALIGN_DELAY；死线到点兜底 realign("align", None)（不校验视口）',
  eventLoop.includes('self.realign_to_conpty("align-sync", Some(window_size.num_lines));')
    && eventLoop.includes('state.align_at = Some(Instant::now() + ALIGN_DELAY);')
    && eventLoop.includes('self.realign_to_conpty("align", None);')
    && eventLoop.includes('if state.align_at.is_some_and(|at| Instant::now() >= at) {'),
);
const probeWin = eventLoop.slice(eventLoop.indexOf('fn conpty_cursor_probe'), eventLoop.indexOf('fn conpty_cursor_probe') + 600);
probe.check(
  'conpty_cursor_probe 平台分叉：#[cfg(windows)] 用 AttachConsole + GetConsoleScreenBufferInfo + FreeConsole 读 conhost 光标真值，全局 ATTACH_LOCK 串行化多 pane；#[cfg(not(windows))] 恒返回 None',
  eventLoop.includes('#[cfg(windows)]\nfn conpty_cursor_probe(pid: u32) -> Option<ConhostCursor> {')
    && probeWin.includes('AttachConsole') && probeWin.includes('GetConsoleScreenBufferInfo')
    && probeWin.includes('FreeConsole') && probeWin.includes('static ATTACH_LOCK: Mutex<()> = Mutex::new(());')
    && eventLoop.includes('#[cfg(not(windows))]\nfn conpty_cursor_probe(_pid: u32) -> Option<ConhostCursor> {\n    None\n}'),
);
probe.check(
  'child_pid 的平台差：unix 直接 Some(child.id())；windows 来自 child_watcher.pid()；tty/mod.rs 文档注释点名它服务 ConPTY cursor-realign probe',
  ttyUnix.includes('fn child_pid(&self) -> Option<u32> {\n        Some(self.child.id())\n    }')
    && ttyWin.includes('fn child_pid(&self) -> Option<u32> {\n        self.child_watcher.pid().map(std::num::NonZeroU32::get)\n    }')
    && flatDoc(ttyMod.slice(ttyMod.indexOf('fn child_pid(&self)') - 500, ttyMod.indexOf('fn child_pid(&self)') + 120))
      .includes('Windows uses it for the ConPTY cursor-realign probe (`AttachConsole` + `GetConsoleScreenBufferInfo`); other backends have no equivalent and keep the default.'),
);

// ---- 摘要（milestone_verify：I/O 循环证据链与常量值）-------------------------------
console.log(
  `summary [pty-event-loop] fork=${P.ttyMod}:${lineOf(ttyMod, 'mod unix;')}/win:${lineOf(ttyWin, 'pub struct Pty {')}; ` +
  `io=${P.eventLoop}:${lineOf(eventLoop, 'thread::spawn_named("PTY reader"')} spawn PTY reader, ` +
  `poll=${lineOf(eventLoop, 'self.poll.wait(&mut events, timeout) {')} Level-mode, ` +
  `read=${lineOf(eventLoop, 'let mut buf = [0u8; READ_BUFFER_SIZE];')} buf=READ_BUFFER_SIZE(0x10_0000=1048576B), ` +
  `lease=${lineOf(eventLoop, 'let _terminal_lease = Some(self.terminal.lease());')}, ` +
  `feed=${lineOf(eventLoop, 'state.stream.feed(&mut **terminal')} MAX_LOCKED_READ=${lineOf(eventLoop, 'const MAX_LOCKED_READ')}; ` +
  `fairmutex=${P.sync}:${lineOf(sync, 'pub struct FairMutex<T> {')} (data+next, lock 先 next 后 data); ` +
  `align=${P.eventLoop}:${lineOf(eventLoop, 'const ALIGN_DELAY')} ALIGN_DELAY=120ms, ` +
  `realign=${lineOf(eventLoop, 'fn realign_to_conpty')} (align-sync expect_rows + ALIGN 兜底), ` +
  `probe=${lineOf(eventLoop, 'fn conpty_cursor_probe')} windows-only AttachConsole/GetConsoleScreenBufferInfo; ` +
  `pipe-cap=${P.ttyConpty}:${lineOf(ttyConpty, 'const PIPE_CAPACITY')} = event_loop::READ_BUFFER_SIZE`,
);

probe.done();
