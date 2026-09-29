---
title: 第 3 章 PTY 桥与事件循环：shell 输出的跨线程旅程
---

# PTY 桥与事件循环：shell 输出的跨线程旅程

## 工具箱

本章调用三块旧积木。

- VT 转义序列 —— shell 输出中以 ESC 开头的控制片段，vte 解析器把它切成结构化回调，是字节流里的"动词"（[第 2 章](./02-vt-grid.md)）。
- damage 追踪 —— 网格自记自上次渲染以来变化的最小行区间，渲染侧只重绘损坏部分（[第 2 章](./02-vt-grid.md)）。
- 所有权地图 —— 判断一个改动落在哪个 crate、踩不踩禁区的查表入口（[第 1 章](./01-repo-map.md)）。

手边有这三块，本章从零起点也能读：我们只追问一件事——shell 吐出的字节，是怎么跨过进程和线程的边界，变成你窗口里的像素的。

## 一屏"回声"

在 Windows 上开一个终端窗口跑 PowerShell，然后拖住窗口右下角来回缩放。你会看到整屏内容重放一遍：提示符、历史输出、彩色片段按新宽度重新铺开，像一段"回声"。松手的瞬间，画面稳稳落回整齐的网格，光标停在提示符后面，一行都没有串位。

这段回声不是 bug。窗口尺寸一变，Windows 的伪终端（pseudo terminal，下文称 PTY）会把整屏内容按新几何重放一遍。重放字节、本地网格重排、shell 重画提示符，三件事挤在同一瞬间，而你的屏幕没有糊掉——靠的是一套对账（realign）机制在幕后把两份状态重新对齐。

要讲清这套机制，得先回答一个更基本的问题：shell 进程从头到尾没有碰过你的窗口，它的输出是怎么进来的？本章沿这条线建立四块积木：PTY 伪终端、事件循环、FairMutex、ConPTY 对账。前两块搭出通道，第三块维持通道的秩序，第四块处理通道上最难的一段——resize。

## 伪终端：shell 以为自己在跟显示器说话

先替一个流行直觉说句公道话："shell 直接把字符画进窗口"——对窗口里的 GUI 程序来说，"自己画自己的界面"确实是常态，这个直觉有来处。它对终端恰好不成立，原因是历史分工：终端模拟器诞生时，shell 已经学会了对"真终端硬件"说话。为了让几十年的 shell 不用改一行代码，内核提供了一个善意的骗局。

**PTY 伪终端**（pseudo-terminal）是内核提供的一对主从设备：从设备（slave）交给 shell，让它以为自己在跟真实终端对话；主设备（master）握在终端模拟器手里，读到的正是 shell 写出的每个字节。shell 检测终端用的 `isatty` 为真，彩色、光标控制、交互式提示全部照常工作；另一端，模拟器只是一个普通读者。

反过来说：要是没有这层骗局，shell 的 stdout 接的就是普通管道，`isatty` 为假，ls 不上色、vim 拒绝启动、提示符退化成一行 `bash-5.2$`。PTY 不是性能装饰，是 shell 世界观的地基。

Pebrel 在 `nebula_terminal` crate 里实现这座桥——产品名与 crate 名的命名双轨（[第 1 章](./01-repo-map.md)）在这里再次露面。桥的平台分叉写在文件结构上：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_terminal/src/tty/mod.rs
#[cfg(not(windows))]
mod unix;
#[cfg(not(windows))]
pub use self::unix::*;

#[cfg(windows)]
pub mod windows;
#[cfg(windows)]
pub use self::windows::*;
```

（本课程逐字引用 GPL-3.0 项目的源码片段，许可与署名集中声明于关于页。）

非 Windows 走私有的 `unix` 模块，Windows 走公开的 `windows` 模块，但两侧实现同一个接口。接口合同就在 `mod.rs`：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_terminal/src/tty/mod.rs
/// A pseudoterminal (or PTY).
///
/// This is a refinement of EventedReadWrite that also provides a channel through which we can be
/// notified if the PTY child process does something we care about (other than writing to the TTY).
/// In particular, this allows for race-free child exit notification on UNIX (cf. `SIGCHLD`).
pub trait EventedPty: EventedReadWrite {
    /// Tries to retrieve an event.
    ///
    /// Returns `Some(event)` on success, or `None` if there are no events to retrieve.
    fn next_child_event(&mut self) -> Option<ChildEvent>;
```

两个平台各自怎么填这份合同？Unix 侧的结构最省话：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_terminal/src/tty/unix.rs
pub struct Pty {
    child: Child,
    file: File,
    signals: UnixStream,
    sig_id: SigId,
}
```

一个 `File` 同时当读端和写端（`reader()` 和 `writer()` 都返回它），加一条把 SIGCHLD 信号转成可轮询字节的 `UnixStream`。建线三件套在探针里有逐行证据：`rustix_openpty::openpty` 开主从对，`pre_exec` 里用 TIOCSCTTY 把从设备设成控制终端，SIGCHLD 经 signal_pipe 落进管道。

Windows 侧的 ConPTY 不是一对设备，而是一对命名管道加一个 conhost 服务进程。结构因此换了一副身板：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_terminal/src/tty/windows/mod.rs
pub const PTY_CHILD_EVENT_TOKEN: usize = 1;
pub const PTY_READ_WRITE_TOKEN: usize = 2;

type ReadPipe = UnblockedReader<AnonRead>;
type WritePipe = UnblockedWriter<AnonWrite>;

pub struct Pty {
    // XXX: Backend is required to be the first field, to ensure correct drop order. Dropping
    // `conout` before `backend` will cause a deadlock (with Conpty).
    backend: Backend,
    conout: ReadPipe,
    conin: WritePipe,
    child_watcher: ChildExitWatcher,
}
```

注意那个 XXX 注释：字段顺序本身是合同——drop 时先关后端再排空管道，反了会死锁。Unix 侧的轮询 token 取 0 和 1，Windows 侧取 1 和 2；两侧取值不同是各自的实现选择，源码没有公开理由，这里不编。

到这里，"shell 直接画窗口"可以正式下葬了：shell 只往从设备写字节；字节的读者是模拟器里一条专门的 I/O 线程；画窗口的又是另一个线程。三段旅程、两类边界——进程边界由伪终端跨过，线程边界由本章剩下的故事跨过。

## 事件循环：一条线程的搬运节拍

字节过河之后落进谁手里？`event_loop.rs` 的文档注释一句话交代了职责：The main event loop which performs I/O on the pseudoterminal——在伪终端上做 I/O 的主循环。

**事件循环**（event loop）是 nebula_terminal 的 I/O 线程主循环：等读写就绪、分块读字节、喂给 Term、给 UI 发通知。它是本地 shell 输出进入界面的唯一通道，跨线程搬运的起点。

先看这条线程的诞生。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_terminal/src/event_loop.rs
    pub fn spawn(mut self) -> JoinHandle<(Self, State)> {
        thread::spawn_named("PTY reader", move || {
            let mut state = State::default();
            if let Some(token) = self.remote_hook_token.take() {
                state.stream.set_remote_hook_token(token);
            }
            let mut buf = [0u8; READ_BUFFER_SIZE];

            let poll_opts = PollMode::Level;
```

线程有名字（"PTY reader"），缓冲直接开在线程栈上，大小是两个本章会用到的常量：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_terminal/src/event_loop.rs
/// Max bytes to read from the PTY before forced terminal synchronization.
pub(crate) const READ_BUFFER_SIZE: usize = 0x10_0000;

/// Max bytes to read from the PTY while the terminal is locked.
const MAX_LOCKED_READ: usize = u16::MAX as usize;
```

换算体感：0x10_0000 = 1 048 576 字节，恰好 1 MiB，一次 `pty_read` 最多攒这么多才强制同步；`u16::MAX` = 65 535——单次持锁最多喂约 64 KiB。这两个数马上都会用到。

轮询用的是 `polling` crate（Cargo.toml 里 `polling = "3.8.0"`），就绪模型是水平触发（Level）：只要还可读，每轮 `wait` 都会报告。每轮等多久？死线取两者中更早的一个：同步更新的超时，或挂起的 ConPTY 对账死线。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_terminal/src/event_loop.rs
            'event_loop: loop {
                // Wakeup the event loop when a synchronized update timeout or
                // the pending ConPTY align deadline was reached.
                let deadline = match (state.stream.next_sync_timeout(), state.align_at) {
                    (Some(sync), Some(align)) => Some(sync.min(align)),
                    (sync, align) => sync.or(align),
                };
                let timeout = deadline.map(|at| at.saturating_duration_since(Instant::now()));

                events.clear();
                if let Err(err) = self.poll.wait(&mut events, timeout) {
```

注意第二个死线来源 `state.align_at`——它是本章最后一节的伏笔，这里先按下。循环体里更近的事在排队：读到的字节要交给 Term，而 Term 同时还是 UI 线程的掌中物。

### FairMutex：互斥之外，还要先来后到

又一个流行直觉登场："锁只要互斥就够，先来后到无所谓"。公道话：互斥确实保住了正确性——两个线程不会同时改网格，数据永远不坏。直觉失效的边界在活性：一把普通的互斥锁不承诺等待者最终能拿到锁。一个刚刚解锁的线程可以立刻转身重新上锁，把队排到别人前面；如果它的节奏足够密，等待者可能一直醒不来。

这不是理论风险。I/O 线程在高压输出下就是"频繁重新上锁"的典型：读一批、锁上、喂 Term、解锁、再读一批，循环往复。UI 线程每次绘制都要拿同一把锁。要是 I/O 线程可以无代价地插队，UI 就会在 `cat` 一个大文件时冻住。

`sync.rs` 用一个额外的小锁解决这个问题，整个文件只有 49 行，核心是：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_terminal/src/sync.rs
/// A fair mutex.
///
/// Uses an extra lock to ensure that if one thread is waiting that it will get
/// the lock before a single thread can re-lock it.
pub struct FairMutex<T> {
    /// Data.
    data: Mutex<T>,
    /// Next-to-access.
    next: Mutex<()>,
}
```

**FairMutex** 是加一把"排队锁"的互斥锁：想拿数据锁，先在 `next` 上取号。已经在等的线程，必定先于同一线程的重复加锁拿到数据。看公平版 `lock()` 的两步：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_terminal/src/sync.rs
    /// Lock the mutex.
    pub fn lock(&self) -> MutexGuard<'_, T> {
        // Must bind to a temporary or the lock will be freed before going
        // into data.lock().
        let _next = self.next.lock();
        self.data.lock()
    }
```

先占 `next`，再拿 `data`。占住 `next` 的线程即使还没拿到数据，也已经把号取了——别人想公平加锁，得排在它后面。事件循环里 `terminal` 字段的类型就是 `Arc<FairMutex<Term<U>>>`，UI 侧绘制走的正是这个公平入口。

那 I/O 线程呢？它有另外两个入口：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_terminal/src/sync.rs
    /// Unfairly lock the mutex.
    pub fn lock_unfair(&self) -> MutexGuard<'_, T> {
        self.data.lock()
    }

    /// Unfairly try to lock the mutex.
    pub fn try_lock_unfair(&self) -> Option<MutexGuard<'_, T>> {
        self.data.try_lock()
    }
```

绕过排队直取数据。听起来正是刚才声讨的插队？妙处在第三个人口 `lease()`——只锁 `next`，占住"下一把锁"的号而不碰数据。`pty_read` 的开场就是它：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_terminal/src/event_loop.rs
        // Reserve the next terminal lock for PTY reading.
        let _terminal_lease = Some(self.terminal.lease());
        let mut terminal = None;
```

先取号，再进入读循环。循环里对锁的取舍：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_terminal/src/event_loop.rs
            // Attempt to lock the terminal.
            let terminal = match &mut terminal {
                Some(terminal) => terminal,
                None => terminal.insert(match self.terminal.try_lock_unfair() {
                    // Force block if we are at the buffer size limit.
                    None if unprocessed >= READ_BUFFER_SIZE => self.terminal.lock_unfair(),
                    None => continue,
                    Some(terminal) => terminal,
                }),
            };
```

读满 1 MiB 之前，`try_lock_unfair` 拿不到就 `continue`——继续往缓冲里读字节，不空等；只有攒满上限才升级成阻塞的 `lock_unfair`。因为号已经取了（`lease` 在手），阻塞等待时它就是下一位，谁也插不进来。源码没写为什么热路径不用公平 `lock()`，只算得出来的账：公平排队每次都要两把锁，取号一次、零成本试锁多次，把排队的开销摊薄了；而单次持锁喂不过 64 KiB（`MAX_LOCKED_READ`），霸位时长有硬上限。全仓库 `.lease()` 的调用点恰好一处，就是这个 `pty_read`——公平锁给 UI，取号加试锁给 I/O，是这套分工的全部现场。

拿到锁之后，字节终于见 Term：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_terminal/src/event_loop.rs
            state.stream.feed(&mut **terminal, &self.event_proxy, &buf[..unprocessed]);
            trace_terminal_state("after-pty-read", &terminal);

            processed += unprocessed;
            unprocessed = 0;

            // Assure we're not blocking the terminal too long unnecessarily.
            if processed >= MAX_LOCKED_READ {
                break;
            }
```

`feed` 里 vte 解析器逐条消费 VT 转义序列，回调落进网格与单元格——这正是你手里那台状态机的接口面。同一段代码还有一处值得驻足的诚实课。读缓冲区报"暂时无数据"（WouldBlock）时的分支：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_terminal/src/event_loop.rs
                Err(err) => match err.kind() {
                    ErrorKind::Interrupted | ErrorKind::WouldBlock => {
                        // Go back to mio if we're caught up on parsing and the PTY would block.
                        if unprocessed == 0 {
                            break;
                        }
                    },
                    _ => return Err(err),
                },
```

注释里的 "Go back to mio" 是上游遗留的陈旧注释。本仓库的轮询库是 `polling`，nebula_terminal 的 Cargo.toml 与产品源码里没有 mio。把 grep 的范围划准再下结论：在 nebula_terminal/src 里，`mio` 的词级命中恰好这一行注释。范围扩到全仓库则会翻出别的——Cargo.lock 里经 notify/tokio 传递进来的 mio 1.0.4，还有 vendored winit 注释里的提及；那些不是这里的产品代码。注释与代码一样会过期，且没人替你回收；断言的边界要跟着证据的范围走。顺带别和 `miow` 混淆：那是 Windows 命名管道库，ConPTY 建管道用的另一个 crate，与本行无关。

### 字节落库之后：damage 账本如何被消费

`feed` 改写单元格的同时，Term 在同一把锁内顺手记 damage 账——每次网格写入都调用 `damage_line`，把受影响的行区间标脏。这是 damage 账本（[第 2 章](./02-vt-grid.md)）在跨线程旅程里的位置：由 I/O 线程记账，由 UI 线程消费。记账之后，`pty_read` 的收尾发出跨线程的敲门声：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_terminal/src/event_loop.rs
        // Queue terminal redraw unless all processed bytes were synchronized.
        if state.stream.sync_bytes_count() < processed && processed > 0 {
            self.event_proxy.send_event(Event::Wakeup);
        }
```

不是每次输出都敲门——同步更新模式（sync update）期间的字节被有意攒着，不触发重绘。敲门声到达 UI 侧先过一道合并闸：Wakeup 在邮箱里去重，一扇门只能有一次未读的敲击：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/gpui_shell/terminal/event_mailbox.rs
impl EventSender {
    pub(super) fn send(&self, event: Event) {
        if matches!(&event, Event::UserVar { name, value }
            if name == "pebrel_cmd_prompt" && value == "1")
        {
            self.native_prompt.observe_prompt();
        }
        let wake = matches!(event, Event::Wakeup);
        if wake && self.wake_pending.swap(true, Ordering::AcqRel) {
            return;
        }
        if self.sender.unbounded_send(event).is_err() && wake {
            self.wake_pending.store(false, Ordering::Release);
        }
    }
}
```

最后一块拼图在 UI 侧的绘制路径。注意它所在的 crate：`nebula_app` 调用 `nebula_terminal`，依赖方向自下而上，与所有权地图的合同一致：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/display/mod.rs
        // Add damage from the terminal, keeping a pane-local copy: the shared
        // tracker gets flooded with a full-window mark every frame further
        // down, so "did the grid actually change?" (hint invalidation) must
        // be judged from the terminal's own report captured here.
        let mut term_damage_full = false;
        let mut term_damage_lines = Vec::new();
        match terminal.damage() {
            TermDamage::Full => {
                term_damage_full = true;
                self.damage_tracker.frame().mark_fully_damaged();
            },
            TermDamage::Partial(damaged_lines) => {
                for damage in damaged_lines {
                    self.damage_tracker.frame().damage_line(damage);
                    term_damage_lines.push(damage);
                }
            },
        }
        terminal.reset_damage();
```

`damage()` 返回损坏行区间（或整屏），喂进渲染的 damage tracker，然后 `reset_damage()` 把账清零。还有一个升级条款：TermMode 位域（[第 2 章](./02-vt-grid.md)）里若开着 INSERT 模式，`damage()` 第一件事就是把整屏标坏——半行插入的字形依赖上下文，局部重绘不再可信。从字节到像素的通道至此闭合，crate 依赖方向也在此现形：`nebula_app` 调用 `nebula_terminal`，自下而上，与所有权地图的合同一致。三块积木的分工由此定局。**事件循环 = polling 就绪通知 + FairMutex 交接 + damage 追踪的最小重绘**——前两块是本章新立的，第三块直接调用你手里的账本（[第 2 章](./02-vt-grid.md)）。"不全屏重绘也流畅"的承诺，在这里兑现为一次真实的函数调用。

## ConPTY 对账：resize 不是改一个变量

现在回收开篇的伏笔，也迎击第三个直觉："resize 就是改一个宽度变量"。公道话：对多数程序，窗口尺寸确实只是一个字段，改了自然生效。终端不行，因为 resize 同时牵动三个事实主体——本地网格、conhost 的缓冲区、shell 自己的绘制——三者还各有时差。Unix 侧直观可见：宽度经由 ioctl 写进内核：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_terminal/src/tty/unix.rs
impl OnResize for Pty {
    /// Resize the PTY.
    ///
    /// Tells the kernel that the window size changed with the new pixel
    /// dimensions and line/column counts.
    fn on_resize(&mut self, window_size: WindowSize) {
        let win = window_size.to_winsize();

        let res = unsafe { libc::ioctl(self.file.as_raw_fd(), libc::TIOCSWINSZ, &win as *const _) };

        if res < 0 {
            die!("ioctl TIOCSWINSZ failed: {}", Error::last_os_error());
        }
```

Windows 侧同一个动作委托给 ConPTY 后端，最终调 `ResizePseudoConsole`，失败只记 HRESULT 不崩进程。真正的难点在时序：本地改宽度是一瞬间，conhost 要把自己的整个缓冲区按新宽度重新折行（rewrap），ConPTY 还会把整屏内容重放一遍——就是开篇那段"回声"。重放期间，conhost 眼里的光标行号和本地网格记的光标行号是两套坐标系，差值来自两种折行语义。

事件循环用两条消息把 resize 拆成两个半程：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_terminal/src/event_loop.rs
    /// Reflow the local grid to a new geometry without telling the child.
    ///
    /// Keep local grid reflow separate from notifying the child. The legacy shell
    /// has always done this (`window_context/split.rs`: grids every drag tick,
    /// PTYs on settle). The
    /// two halves have opposite cost profiles: a client-side reflow is cheap and
    /// reversible, while every `ResizePseudoConsole` makes conhost rewrap its
    /// own buffer, and those rewraps accumulate cursor-row drift that nothing
    /// can undo. So the grid follows the pointer frame by frame — the viewport
    /// on screen is always a real reflow of the real geometry — and only the
    /// child is debounced.
    ///
    /// Goes through the same channel as `Resize` on purpose: the resize branch
    /// drains everything readable against the old geometry first, so absolute
    /// CUP sequences produced at the old width are never parsed into the new
    /// grid. A UI thread reaching into `Term::resize` directly would skip that.
    ResizeGrid(WindowSize),
```

拖动进行中每帧只发 `ResizeGrid`（本地网格逐帧重排，孩子不动），拖动落定才发 `Resize`（通知 conhost）。代价档案写得明白：客户端 reflow 便宜可逆，每次 `ResizePseudoConsole` 都让 conhost 全视口 rewrap，而 rewrap 累积的光标行漂移没有任何手段能撤销。风暴还要在通道口合并——一次 drain 只留最新：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_terminal/src/event_loop.rs
        let mut resize: Option<PendingResize> = None;
        while let Some(msg) = self.rx.recv() {
            match msg {
                Msg::Input(input) => state.write_list.push_back(input),
                Msg::Resize(window_size) => {
                    resize = Some(PendingResize { window_size, notify_pty: true })
                },
                Msg::ResizeGrid(window_size) => {
                    let notify_pty = resize.is_some_and(|pending| pending.notify_pty);
                    resize = Some(PendingResize { window_size, notify_pty });
                },
                Msg::Shutdown => return Err(()),
            }
        }
```

`ResizeGrid` 覆盖式合并，但不丢已挂起的通知标记；完整的 `Resize` 永远是最后看见的那个，不会被丢。真正提交 resize 时的顺序是三步。第一步，先排空旧几何下的可读字节。老宽度产出的绝对光标序列，必须落进老宽度的网格：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_terminal/src/event_loop.rs
                    loop {
                        match self.pty_read(&mut state, &mut buf, pipe.as_mut()) {
                            Ok(processed) if processed >= MAX_LOCKED_READ => continue,
                            Ok(_) => break,
                            Err(err) => {
                                error!("PTY read before resize failed: {err}");
                                failure = Some(format!("PTY read before resize failed: {err}"));
                                break 'event_loop;
                            },
                        }
                    }
```

第二步，先 reflow 本地模型，再让 ConPTY resize。顺序与 ConPTY 一致：它随后重放的 repaint 字节走的正是常规 readable 路径，解析发生在已重排的新网格上：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_terminal/src/event_loop.rs
                    // Match ConPTY's order: reflow the client model
                    // first, then ask ConPTY to resize. ResizePseudoConsole is
                    // synchronous; repaint bytes it produces are consumed by
                    // the normal readable-event path below against this grid.
                    {
                        let mut terminal = self.terminal.lock();
                        trace_terminal_state("before-resize", &terminal);
                        terminal.resize(window_size);
                        trace_terminal_state(
                            if notify_pty { "after-resize" } else { "after-resize-grid" },
                            &terminal,
                        );
                    }
```

第三步才是**ConPTY 对账**——向 conhost 要光标真值，把本地网格滚到同一坐标系。为什么必须在此刻做，源码注释给了完整论证：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_terminal/src/event_loop.rs
                        // 对账的唯一可信时点就是这里：`ResizePseudoConsole` 是同步
                        // 的，返回时 conhost 已按新宽度 rewrap 完毕，而本地网格还是
                        // 纯 reflow 的结果——两侧都没有被重绘字节动过，行号差就是
                        // 两种折行语义的真实差值。等到下面 pty_read 把 PSReadLine
                        // 的绝对 CUP 解析进来，光标已经被搬到 conhost 的坐标上，
                        // 差值归零，判据就永久丢失了（字节取证：分屏后 after-resize
                        // 是 cursor=15/prompts=[15]，120ms 后的 before-align 已经变成
                        // cursor=19/prompts=[15]——错位既成事实却测不出来）。
                        self.realign_to_conpty("align-sync", Some(window_size.num_lines));
                        // conhost 事后才做的塌缩/重锚探不到，留一次死线兜底；新
                        // resize 顺延死线，风暴天然合并成一次探针。
                        state.align_at = Some(Instant::now() + ALIGN_DELAY);
                        self.event_proxy.send_event(Event::Wakeup);
```

窗口只在同步返回后的一瞬"两侧都没动过"，行号差可测；错过这瞬，重放字节把两边各自搬动，差值归零，错位既成事实却再也测不出来。对账的本体如下。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_terminal/src/event_loop.rs
    /// 向 conhost 要光标真值并把本地网格滚到同一坐标系。
    ///
    /// `expect_rows` 非 None 时只采信视口高度已经等于该值的读数：
    /// `ResizePseudoConsole` 之后 conhost 若还停在旧几何，它报的行号属于上一
    /// 个坐标系，照它对账会把网格滚到更错的位置。宁可放弃这一次——死线上的
    /// 兜底探针会再来一遍。
    fn realign_to_conpty(&mut self, stage: &str, expect_rows: Option<u16>) {
        let Some(probe) = self.pty.child_pid().and_then(conpty_cursor_probe) else {
            return;
        };
        if resize_trace_enabled() {
            eprintln!(
                "[nebula:resize-trace] {stage} conhost row={} rows={} expect_rows={expect_rows:?}",
                probe.row, probe.rows,
            );
        }
        if expect_rows.is_some_and(|rows| rows != probe.rows) {
            return;
        }
        let mut terminal = self.terminal.lock();
        trace_terminal_state(&format!("before-{stage}"), &terminal);
        terminal.conpty_realign(probe.row);
        trace_terminal_state(&format!("after-{stage}"), &terminal);
        drop(terminal);
        self.event_proxy.send_event(Event::Wakeup);
    }
```

真值探针是 Windows 专属戏法：临时把自己的进程挂到 conhost 的控制台上，读一次屏幕缓冲区信息。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_terminal/src/event_loop.rs
/// 向 conhost 要光标真值：临时 `AttachConsole` 到 ConPTY 子进程的控制台，
/// 读 `GetConsoleScreenBufferInfo`，换算成视口相对行（0 基）。
///
/// 进程同一时刻只能挂一个控制台，多 pane 并发对账用全局锁串行化；每次
/// 探针都 attach→读→detach，窗口只有微秒级。Nebula 主进程是 GUI 子系统
/// （自身无控制台），detach 后回到无控制台状态，不影响任何组件。失败
/// （子进程已退出、权限等）一律返回 None，对账静默放弃。
#[cfg(windows)]
fn conpty_cursor_probe(pid: u32) -> Option<ConhostCursor> {
```

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_terminal/src/event_loop.rs
#[cfg(not(windows))]
fn conpty_cursor_probe(_pid: u32) -> Option<ConhostCursor> {
    None
}
```

Unix 侧恒返回 None——对账整个机制在非 Windows 上是空操作，因为那里没有第二份会自行 rewrap 的缓冲区要伺候。多 pane 并发时还有全局 `ATTACH_LOCK` 串行化（一个进程同一时刻只能挂一个控制台）。最后是死线兜底，回望本章开头那个 `state.align_at`：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_terminal/src/event_loop.rs
/// ConPTY 光标对账的静默期：最后一次 resize 提交后等这么久再探针，给
/// conhost 的内部整理（缓冲区塌缩/重锚）和 shell 的 resize 反应留时间。
const ALIGN_DELAY: Duration = Duration::from_millis(120);
```

同步对账一次，120 毫秒后再兜底一次——conhost 可能在事后才做缓冲区塌缩，死线上的第二次探针不校验视口高度，纯保险。两次探针之间留出的静默期，就是开篇那段"回声"的容身之处：重放字节在静默期内走常规路径解析进新网格，光标坐标系在对账中归一。**回声没有糊掉屏幕，是因为网格先行重排、回声走常规路径、对账在唯一可信时点校准**——三件事的顺序本身就是设计。

## 演练：跟着一批字节走完全程

不看上文，试着把 `ls --color` 的输出从 shell 到像素的每一步按顺序写下来，标注文件，然后对照：

| 步 | 发生什么 | 所在文件 |
| --- | --- | --- |
| 1 | shell 往 PTY 从设备 write 彩色字节（含 VT 转义序列） | 内核 tty 子系统 |
| 2 | 主设备可读，polling 报告就绪事件（Level 触发） | `nebula_terminal/src/event_loop.rs` |
| 3 | `pty_read` 先 `lease()` 取号，再分块读进 1 MiB 栈缓冲 | `event_loop.rs` + `sync.rs` |
| 4 | `try_lock_unfair` 拿锁，攒满上限才 `lock_unfair` 阻塞 | `event_loop.rs` |
| 5 | `stream.feed` 让 vte 解析，单元格落库，`damage_line` 记账 | `event_loop.rs` → `term/mod.rs` |
| 6 | 非同步字节发 `Event::Wakeup`，邮箱去重后到 UI | `event_loop.rs` → `event_mailbox.rs` |
| 7 | 绘制读 `terminal.damage()`，只重绘损坏行，`reset_damage` 重置账本 | `nebula_app/src/display/mod.rs` |
| 8 | 你看到颜色和文字 | GPU |

再跟一次 resize 风暴：拖动窗口的 2 秒里 UI 每帧发一条 `ResizeGrid`，共约 120 条，松手时发 1 条 `Resize`。先在纸上回答两个问题：conhost 总共收到几次 `ResizePseudoConsole`？每条消息都各自触发一次对账吗？答案：恰好 1 次——合并规则只保留最新且不丢 `notify_pty` 标记，落定的那次才走通知分支；对账每次 resize 提交后做一次同步探针加一次死线兜底，新 resize 顺延死线，风暴天然并成一次。若 UI 线程绕开通道直接调 `Term::resize`，被跳过的不只是合并，还有第一步的旧几何排空——老宽度的绝对光标序列会落进新宽度的网格，这正是 `ResizeGrid` 文档注释里点名的陷阱。

## 验证：先猜后跑

你来跑。在课程的 companion 目录里执行：

```bash
node scripts/probe-03-pty-event-loop.mjs
```

先猜后跑，四组离散预测，落纸再看输出：

1. 摘要行里 `buf=READ_BUFFER_SIZE(0x10_0000=1048576B)` 括号内的十进制值，你猜是多少？（正文给过换算）
2. 摘要行里 `ALIGN_DELAY=` 的毫秒值是多少？
3. 在锁定 clone 的仓库根执行 `grep -rnw "mio" --include=*.rs nebula_terminal/src`，会命中几行、各是什么？（先猜行数，再看是不是只有一行注释；去掉 `-w` 再跑一次，多出来的行分别属于哪两个词？）
4. 同样在仓库根执行 `grep -rn "\.lease()" --include=*.rs .`，命中几处？

跑完对照：应为退出码 0、`PASS [pty-event-loop] 27/27 checks`，摘要含 `1048576B` 与 `ALIGN_DELAY=120ms`；`mio` 词级命中恰好 1 行——event_loop.rs 里那句 "Go back to mio" 陈旧注释；`.lease()` 调用点恰好 1 处——`event_loop.rs` 的 `pty_read`。第 3 问去掉 `-w` 会多出 miow（ConPTY 建管道的库）和 termios（Unix 终端属性）的行——一个词的孤立程度，用 grep 就能度量。

定向破坏一次。在锁定 clone 的工作副本里打开 `nebula_terminal/src/event_loop.rs`，把 pty_read 里那行 `let _terminal_lease = Some(self.terminal.lease());` 整行注释掉。保存前先写预测：重跑探针，27 条里恰好哪几条红？

我的预测：恰好 2 条红。「pty_read 先 lease 保留锁位」那条断言找不到这行了；「全仓库 .lease() 调用点唯一」那条随之失效。而「lock() 先拿 next 再拿 data」那条仍然绿：它守的是 sync.rs 里 lock() 的到达序合同，与 lease() 调用点在不在无关。跑，核对。这 2 红也顺手标出了探针断言的边界：字符串在场检查守得住「合同写了什么、调用点在哪」，守不住「运行时是否真的走这条路」——那要靠编译器与上游测试。然后把那行还原，再跑一次确认回到 27/27——锁定 ref 是全书引用纪律的地基（[第 1 章](./01-repo-map.md)），你的 clone 必须复原，逐字引用的每一行都以它为准。

## 收束：通道的秩序

开篇的回声之谜现在有了完整答案。窗口尺寸变化时，本地网格先逐帧重排（`ResizeGrid`），落定才通知 conhost（`Resize`）；通知是同步调用，返回的瞬间两侧都还没动，是行号差唯一可信的测量点，对账在此校准；ConPTY 重放的整屏字节沿常规 readable 路径解析进已重排的网格，120 毫秒静默期后再兜底探针一次。三个事实主体各有各的时差，通道用顺序和死线把它们缝在一起——所以回声掠过，屏幕无恙。

本章新增四块积木。PTY 伪终端是内核的主从设备骗局，跨进程边界；事件循环是 I/O 线程的就绪-搬运-通知节拍，跨线程边界；FairMutex 是取号排序的互斥锁，维持通道秩序；ConPTY 对账是真值探针加静默期，缝平 resize 的时差。它们连同 damage 账本（[第 2 章](./02-vt-grid.md)）一起，构成了每个终端 pane 的完整供血线；这条供血线在界面侧如何接进渲染帧，是 GPUI 壳层的主题（[第 5 章](./05-gpui-shell.md)的 prepaint 回写会调用本章的 resize 对账链）。

自查三问，答案可回查对应小节：

1. `cat` 一个 100 MiB 的日志时，UI 线程为什么还能保持响应？列出三个数字各守的那道闸。（提示：1 MiB、64 KiB，还有一个排队位）
2. 把 `realign_to_conpty` 的调用参数从 `Some(window_size.num_lines)` 改成 `None`，据本章源码注释预测会发生什么更糟的事？
3. Unix 上 `conpty_cursor_probe` 恒返回 None，为什么 Unix 不需要对账也能不糊屏？（想想谁在 Unix 上拥有那份"第二缓冲区"）

<details>
<summary>参考答案</summary>

1. 攒满 `READ_BUFFER_SIZE`（1 MiB）才强制同步，读取有上限；单次持锁喂不过 `MAX_LOCKED_READ`（64 KiB），霸位有上限；`lease()` 排队位保证 UI 的公平 `lock()` 下一次必然轮到，饿死无门。
2. `expect_rows` 为 None 时不再校验视口高度：conhost 若还停在旧几何，它报的行号属于上一个坐标系，照它对账会把网格滚到更错的位置（"align-sync"文档注释原话）。
3. Unix 上 rewrap 只发生在本地网格一处，内核只存一对 winsize 数值（TIOCSWINSZ），没有 conhost 那份会自行重排的缓冲区，也就没有第二坐标系要对齐；shell 收到 SIGWINCH 自行重画。

</details>
