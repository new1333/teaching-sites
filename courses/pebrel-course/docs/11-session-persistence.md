---
title: 第 11 章 会话持久化：崩溃安全快照与恢复护栏
---

# 会话持久化：崩溃安全快照与恢复护栏

## 工具箱

把工作区原样搬过一次重启，本章只调用两块旧积木。

- pane 生命周期——每个终端 tab 的户籍：panes + tree + focused 三件套，pane 的出生、关闭、搬迁都由它裁定（[第 5 章](./05-gpui-shell.md)）。
- 树叶集合不变式——「pane id 集合 == 布局树叶集合」的等式，树与视图两本账的对账判据，破坏即出现幽灵 pane 或丢 pane（[第 4 章](./04-split-tree.md)）。

另有几件旧积木会中途顺手取用，首用时一句接口就地给出。

## 强杀之后都回来了——然后它突然失忆

做一个两分钟的实验。开三个 tab：第一个左右分屏，左边跑本地 shell，右边连着跳板机后面的服务器；第二个跑 Claude；第三个停在一个很深的目录。现在不做任何「保存」动作，直接在任务管理器里结束进程——kill -9 或 taskkill /F 都行。重开终端：分屏比例、每个 pane 的目录、哪个 tab 连着哪台机器、焦点落在哪个 pane，全部回来了，误差不超过一秒。

奇怪的地方在于：进程根本没走到「退出」。强杀不给任何收尾机会，所以这些状态必然在崩溃之前的某一刻就已经躺在磁盘上了——**快照节奏**（每隔一秒拍一帧、没变化就跳过的持续写盘合同）回答它何时、多频繁地躺上去。

实验还有第二幕，不用真做，推演就行。假设坏掉的恰好是会话文件本身：一恢复就崩。于是重启，恢复，又崩；再重启，再崩。第三次之后再启动——布局没了，干干净净一个新 tab，旧工作区像被抹掉了一样。这不是损坏，是**恢复护栏**（恢复本身成为故障源时强制放手的断路器）在工作：连续三次没能活过启动，就放弃恢复、干净启动。旧工作区也没有丢——整个挪进了 session.crashed.json，等你去看。

第三块积木先挂号后展开：版本化 schema（会话文件自带版本号、由版本闸控制读写兼容的格式设计）——它决定这份文件怎么随版本演进而不把用户的工作区变成牺牲品。三块积木分别回答：什么时候写盘、恢复不动怎么办、格式怎么变。先从节奏开始。

## 每秒一帧：快照节奏

先看约束。终端的死法清单很长：强杀、崩溃、断电、系统更新替你重启。这些死法有个共同点——都绕过「退出」。先替「退出时存一次」的直觉说句公道话：桌面软件的保存动作确实挂在用户操作上，正常退出的程序也确实有机会写最后一份文件，这个模型对文档编辑器是成立的。边界在于终端是长跑进程：用户强杀它的概率不低，而退出钩子覆盖不到的死法，恰恰是会话持久化要服务的主要场景。

于是设计反了过来：不等退出，持续快照。格式与护栏的属主 nebula_app/src/session.rs 把节奏写成了模块合同：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/session.rs（行 1–8）
//! Session restore: reopen with the same tabs (and their directories) you had
//! when the window closed, with no "restore?" dialog.
//!
//! A snapshot is written continuously (1 Hz, skipped when nothing changed), so
//! a crash or force-kill still restores to within a second of where you were.
//! `boot_attempts` guards against a restore-crash loop: it's bumped before the
//! restore is attempted and cleared by the first successful autosave, so after
//! three failed launches Nebula starts clean to break the cycle.
```

第一句定产品行为：恢复不打扰、不弹「是否恢复」对话框。第二句定节奏与精度：1 Hz、跳过无变化、崩溃后恢复到一秒以内。第三句是护栏的预告，下一节展开。但你可以在这份文件里找一个叫 SNAPSHOT_HZ 之类的频率常量——找不到。「1 Hz」不是一个常量，是一份由三层证据撑起来的合同。

### 没有频率常量的节奏

第一层：合同句本身。session.rs 只声明节奏，不提供实现；它甚至不关心谁在按什么频率调它。

第二层：两个壳各自挂自己的 1 秒定时器。仓库里有两代界面壳（[第 5 章](./05-gpui-shell.md)），持久化在两边各实现一遍。旧壳是常驻的 winit 壳，给每个窗口挂一条重复定时器。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/event.rs（行 364–368）
        let clock_timer = TimerId::new(Topic::NebulaClock, id);
        if !self.scheduler.scheduled(clock_timer) {
            let tick = Event::new(EventType::NebulaTick, id);
            self.scheduler.schedule(tick, Duration::from_secs(1), true, clock_timer);
        }
```

NebulaTick 到点时，持久化搭的是便车。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/event.rs（行 997–1003）
            (EventType::NebulaTick, Some(window_id)) => {
                if let Some(window_context) = self.windows.get_mut(window_id) {
                    // Agent screen semantics (blocked/working/idle) are a
                    // cheap 1 Hz fallback under exact lifecycle hooks.
                    window_context.refresh_agent_screen_states();
                    // Piggyback session persistence on the 1 Hz chrome clock.
                    window_context.autosave_session();
```

注释原话是 "Piggyback session persistence on the 1 Hz chrome clock"。把会话持久化捎在 1 Hz 界面时钟上，就是这半句的意思。新壳（GPUI 壳）不借时钟，自己起一条后台循环。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/gpui_shell/workspace/windowing.rs（行 233–239）
    cx.spawn(async move |cx| {
        loop {
            cx.background_executor().timer(Duration::from_secs(1)).await;
            cx.update(autosave_tick);
        }
    })
    .detach();
```

而旧壳那班便车本身还不是严格 1 Hz。window_context.rs 的字段注释写明时钟节奏是三档：空闲 1 Hz、有限动画 8 fps、任务转圈时 60 fps。动画期间持久化也跟着醒得更频繁，这就要靠第三层兜住。

第三层：相等去重。「每秒检查一次」和「每秒写一次盘」是刻意拆开的两件事。写不写，由内容变没变决定。先看旧壳。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/window_context.rs（行 1757–1777）
    /// 1 Hz autosave (piggybacks on the chrome clock tick): persist the session
    /// when it changed, so a crash or force-kill restores to within a second.
    /// Only the focused window writes — two open windows must not fight over
    /// the file every second; last-focused wins, which is also the window the
    /// user most plausibly wants back.
    pub fn autosave_session(&mut self) {
        if self.session_exempt {
            return;
        }
        let focused =
            self.pane(self.focused_pane_id()).is_some_and(|p| p.terminal.lock().is_focused);
        if !focused {
            return;
        }
        let snapshot = self.session_snapshot();
        if self.last_saved_session.as_ref() == Some(&snapshot) {
            return;
        }
        session::save(&snapshot);
        self.last_saved_session = Some(snapshot);
    }
```

新壳的等价物是 SessionPersistence::save_with 里对上一份已落盘快照的比较。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/gpui_shell/workspace/session_persistence.rs（行 84–92）
        let Some(mut session) = candidate else { return Ok(()) };
        if !retry_checkpoint {
            session.clean_exit = matches!(reason, SaveReason::WindowClose | SaveReason::Quit);
        }
        self.latest = Some(session.clone());
        if self.saved.as_ref() == Some(&session) {
            self.quitting |= reason == SaveReason::Quit;
            return Ok(());
        }
```

配套测试把「无变化帧不写盘」钉死——第二笔写盘函数直接 panic。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/gpui_shell/workspace/session_persistence.rs（行 257–264）
    #[test]
    fn unchanged_checkpoints_do_not_rewrite_storage() {
        let mut state = ordinary_window();
        let _ = state.save_with(Some(sample_session()), SaveReason::Checkpoint, |_| Ok(()));
        let _ = state.save_with(Some(sample_session()), SaveReason::Checkpoint, |_| {
            panic!("unchanged checkpoint must not write")
        });
    }
```

三层合起来才是快照节奏的完整含义：合同句定精度（一秒内），两个壳各自保证「至少每秒检查一次」，去重把实际写盘频率交给变化本身。想改节奏，要动的是两个壳的定时器；session.rs 一行不用改。折算一下体感：一小时 3600 次 tick，其中真正写盘的次数等于你的操作数——没动的每一秒只花一次结构体比较。

还有一处对照值得记下：写盘所有权两边答案不同。旧壳只有聚焦窗口写（上面引文里的 "Only the focused window writes"——两个窗口不该每秒抢同一个文件）；新壳反过来，单一全局定时器把所有窗口的快照合成一份再写。两种答案服从的是同一份合同。

### 写不坏一帧：原子落盘

每秒写一次盘，还引出一个新的硬约束：写了一半崩了怎么办。save 的合同注释把因果说透了：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/session.rs（行 314–326）
/// Persist `session`. Best-effort: failures must never take the terminal down.
/// The atomic replace matters here — this file is written every second and a
/// crash mid-write must not cost the very session it exists to restore.
pub fn save(session: &Session) {
    if let Err(error) = try_save(session) {
        log::warn!("Could not persist terminal session: {error}");
    }
}

pub(crate) fn try_save(session: &Session) -> std::io::Result<()> {
    let json = serde_json::to_string(session).map_err(std::io::Error::other)?;
    crate::atomic_file::write(&session_path(), json.as_bytes())
}
```

正因为每秒都写，写坏一帧的概率不再是理论值；而写坏的那一帧，恰恰就是用来救你命的那份会话。答案在 atomic_file.rs：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/atomic_file.rs（行 1–5）
//! Small cross-platform primitives for durable application-state files.
//!
//! State writers use a sibling temporary file followed by an atomic replace,
//! so a crash cannot leave a half-written JSON document. A best-effort lock
//! prevents two Nebula processes from compacting the same store at once.
```

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/atomic_file.rs（行 20–31）
    let sequence = NEXT_TEMPORARY.fetch_add(1, Ordering::Relaxed);
    let file_name = path.file_name().and_then(|name| name.to_str()).unwrap_or("state");
    let temporary =
        parent.join(format!(".{file_name}.nebula-tmp-{}-{sequence}", std::process::id()));

    let result = (|| {
        let mut file = OpenOptions::new().write(true).create_new(true).open(&temporary)?;
        file.write_all(contents)?;
        file.sync_all()?;
        drop(file);
        replace(&temporary, path)
    })();
```

四步：写进同目录的临时文件、write_all 落内容、sync_all 把内容从页缓存逼到盘上、replace 原子换名。临时文件与目标同目录（sibling），换名才不会跨文件系统。Windows 侧的 replace 走 MoveFileExW：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/atomic_file.rs（行 161–177）
pub(crate) fn replace(source: &Path, destination: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MoveFileExW,
    };

    let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let destination: Vec<u16> = destination.as_os_str().encode_wide().chain(Some(0)).collect();
    let ok = unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if ok == 0 { Err(io::Error::last_os_error()) } else { Ok(()) }
}
```

REPLACE_EXISTING 允许覆盖既有文件；WRITE_THROUGH 让换名本身同步完成。Unix 侧是 std::fs::rename 之后再把父目录 sync_all 一次——源码注释解释了多出的这一步：掉电恢复时不留下「内容已落盘、文件名更新却丢了」的窗口。

**每秒写一帧的前提，是永远写不坏一帧**——节奏与原子写不是两个特性，是一个特性的两半。

顺带两个小事实。其一，会话文件的落点是 %APPDATA%\Pebrel\session.json。session.rs 里有一条注释还写着旧路径 %APPDATA%\Nebula——那是改名前留下的陈旧注释，不是运行时事实：paths.rs 的 settings_dir() 用的是 default_dir("Pebrel")，启动时 migrate_legacy_data() 会把旧 Nebula 目录整体搬进新名，windows_path_uses_pebrel_layout 测试钉住的就是新布局。注释会撒谎，测试不会——这是「读码时该信谁」的一个现成判例（命名双轨的口径见[第 1 章](./01-repo-map.md)）。其二，「退出时也存一次」确实存在，但它只是同一条流水线的另一种理由。收尾路径与周期路径走同一个入口，只差一个理由枚举。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/gpui_shell/workspace/windowing.rs（行 1448–1452）
fn save_combined_session(cx: &mut App, clean: bool) -> std::io::Result<()> {
    let session = combined_session(None, cx);
    let reason = if clean { SaveReason::Quit } else { SaveReason::Checkpoint };
    cx.global_mut::<WindowRegistry>().session_persistence.save(session, reason)
}
```

Quit 与 Checkpoint 的区分只用来标注 clean_exit——这笔快照是不是走完了收尾，供下次启动分辨上次是崩溃还是正常退出。退出保存不是另一套机制，是快照节奏的一个特例。这一点有测试直接背书：不给任何退出回调，直接把持久化状态 drop 掉。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/gpui_shell/workspace/session_persistence.rs（行 168–180）
    #[test]
    fn process_kill_restores_the_last_checkpoint_without_an_exit_callback() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("session.json");
        let expected = sample_session();
        let mut state = ordinary_window();
        save_to(&mut state, &path, Some(expected.clone()), SaveReason::Checkpoint);
        drop(state);
        let restored = crate::session::load_from(&path).unwrap();
        assert!(crate::session::should_restore(&restored));
        assert!(crate::session::was_crash(&restored));
        assert_eq!(restored.tabs, expected.tabs);
    }
```

drop(state) 模拟的正是强杀：没有任何收尾回调执行，照样完整恢复。「退出时存一次」的方案在这条测试里直接拿零分。

## 树的镜像：格式怎么演进

上一节回答了「何时写」；这一节回答「写什么、怎么演进」。先看格式本身。会话文件是一份 JSON 文档，顶层自带版本号：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/session.rs（行 235–241）
pub struct Session {
    pub version: u32,
    /// Launches since the last successful autosave (crash-loop breaker).
    #[serde(default)]
    pub boot_attempts: u32,
    pub active_tab: usize,
    pub tabs: Vec<TabSession>,
```

为什么必须有版本号？算一笔账：serde_json 默认忽略未知字段。没有版本号的话，一份未来格式的新文件会被旧构建静默读成残缺快照——该拒的拒不掉。版本号是文件里唯一能表达「比我新的我不懂」的门。看这扇门怎么开合：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/session.rs（行 29–34）
/// Highest snapshot format this build understands.
const VERSION: u32 = 4;

/// Give up restoring after this many launches that never reached a successful
/// autosave (i.e. crashed within the first second).
const MAX_BOOT_ATTEMPTS: u32 = 3;
```

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/session.rs（行 278–287）
/// Parse a session/workspace document, upgrading older versions in place.
fn parse(data: &str) -> Option<Session> {
    let mut session: Session = serde_json::from_str(data).ok()?;
    // Defaults fill fields introduced after v1. Upgrade in memory so the first
    // successful autosave (or re-export) rewrites the current format.
    if matches!(session.version, 1..=3) {
        session.version = VERSION;
    }
    (session.version == VERSION).then_some(session)
}
```

三段逻辑：反序列化；v1..=3 原地改写为 4；最后一句裁决——升上来的放行，v4 原样放行，v5 一律返回 None。「原地升版」的用意注释写得很清楚：只在内存里升，第一次成功的自动保存（或再导出）就会把它重写成当前格式。测试用一帧真实的 v3 文件走了一遍：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/session.rs（行 456–463）
    #[test]
    fn v3_file_upgrades_in_place_to_v4() {
        let json = r#"{"version":3,"boot_attempts":1,"active_tab":0,"tabs":[{"cwd":"D:/work"}]}"#;
        let session = parse(json).expect("v3 must parse");
        assert_eq!(session.version, VERSION);
        assert_eq!(session.tabs[0].layout, None);
        assert_eq!(session.tabs[0].active_pane, 0);
    }
```

拒绝之后的处置分两条路，姿态不同。正常启动里 load 返回 None——当作「没有会话」，干净启动。更新交接路径 load_update_windows 却把不可读工作区当错误上抛。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/session.rs（行 294–307）
/// An update must not replace an unreadable workspace with an empty snapshot.
pub(crate) fn load_update_windows() -> std::io::Result<Vec<Session>> {
    let data = match std::fs::read_to_string(session_path()) {
        Ok(data) => data,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(vec![Session::new(0, Vec::new())]);
        },
        Err(error) => return Err(error),
    };
    let session = parse(&data).ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidData, "Invalid saved workspace")
    })?;
    session.into_update_windows()
}
```

InvalidData 而不是空快照。第一条注释就是合同：更新流程宁肯失败，也不许用一份空会话盖掉用户的工作区。

### 格式演进的两条正道

现在可以给「会话文件改字段无所谓」这个直觉判刑了。先替它说句公道话：JSON 看起来人畜无害，改个字段名、换个类型，程序自己编译照样过。边界在于会话文件是一份跨版本的持久契约：今天写的文件，明天换了一版终端还要读。删掉或改名一个既有字段，老文件反序列化直接失败，parse 返回 None，整份会话被当成不存在；把可选字段改成必填，同样全军覆没。

源码自己认可两条演进路径。第一条：升版本号——v1 到 v4 每一代结构变化都走这里。第二条：追加可选字段，serde(default) 缺省、None 不写盘。LayoutSession 的 agent 字段注释就是判例。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/session.rs（行 139–142）
        /// v4 的追加可选字段（老文件缺省、老版本忽略，无需升版）：快照时
        /// 该 pane 前台的 AI CLI 对话，冷恢复据此自动接续。
        #[serde(default, skip_serializing_if = "Option::is_none")]
        agent: Option<AgentSession>,
```

「老文件缺省、老版本忽略，无需升版」——两个方向都兼容。clean_exit 字段的注释则给出反向判例：能靠 serde(default) 吸收的改动，「不值得为它单开一个版本号」。一句话：结构性变化升版，可缺省的追加不升版；删改既有字段没有第三条路。

### 快照里的树：三件套的镜像

v4 到底写了什么？每个 tab 的三个 v4 字段把它的全部几何与身份装了进去：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/session.rs（行 203–211）
    /// v4: how the first pane starts. `None` (older file) means `Default`.
    #[serde(default)]
    pub launch: Option<LaunchSession>,
    /// v4: the full split tree. `None` (older file) is a single pane at `cwd`.
    #[serde(default)]
    pub layout: Option<LayoutSession>,
    /// v4: focused leaf as a depth-first index into `layout`.
    #[serde(default)]
    pub active_pane: usize,
```

launch 是首 pane 的启动身份，layout 是整棵分屏树，active_pane 是焦点叶子在深度优先序里的下标。layout 的类型 LayoutSession 是布局树的落盘镜像。纯数据布局树——分屏行为的第一性模型，全在 nebula_split（[第 4 章](./04-split-tree.md)）——在内存里的形态是 SplitTree；落盘之后，同一棵树换成 LayoutSession 的面孔。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/session.rs（行 128–153）
/// A tab's pane tree. Leaves carry each pane's working directory; splits carry
/// the axis and the first child's share in permille — an integer, so autosave
/// change detection and file diffs never trip on f32 serialization noise.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum LayoutSession {
    Pane {
        cwd: String,
        /// User pane title, independent of the tab title and shell-reported title.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        custom_name: Option<String>,
        /// v4 的追加可选字段（老文件缺省、老版本忽略，无需升版）：快照时
        /// 该 pane 前台的 AI CLI 对话，冷恢复据此自动接续。
        #[serde(default, skip_serializing_if = "Option::is_none")]
        agent: Option<AgentSession>,
        /// Frozen per-pane shell/WSL/SSH launch. Older snapshots use tab defaults.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        launch: Option<LaunchSession>,
    },
    Split {
        axis: SplitAxis,
        ratio_permille: u16,
        first: Box<LayoutSession>,
        second: Box<LayoutSession>,
    },
}
```

快照怎么从活树生成？snapshot_session 遍历的正是 pane 生命周期三件套。panes 提供 cwd、自定义名与启动身份——经 GPUI Entity（界面状态的最小居住单元）的 read(cx) 借读，只借不占。tree 换算成 LayoutSession，focused 换算成 active_pane 下标。恢复反向同构：按叶子顺序逐个建 pane，再重建三件套。这套索引配对——快照叶子序与重建 spawn 序一一对应——靠的正是树叶集合不变式那本账。树上每个叶子恰有一个活 pane，深度优先序两边一致。LayoutSession 的方法注释把合同写死了。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/session.rs（行 173–175）
    /// Depth-first leaves — the SAME order `rebuild_layout` spawns panes in,
    /// so index i here pairs with the i-th live leaf after a restore.
    pub fn leaves(&self) -> Vec<&LayoutSession> {
```

组装式点名：会话快照 = pane 生命周期三件套（读出与重建）+ 树叶集合不变式（索引配对的合法性）+ 版本化 schema（载体）。没有新造任何布局机制，只是给三件套拍了一张能穿越重启的照片。

Split 节点里还有一个字段类型的设计证据：ratio_permille: u16——千分比整数，不用 f32。理由就写在注释里。"an integer, so autosave change detection and file diffs never trip on f32 serialization noise"。翻译过来：f32 序列化有尾差，同一棵树两次序列化可能差在末位。相等去重从此永远判「变了」，每秒重写一次盘，人肉 diff 也会被噪声弄脏。字段类型的选择反过来服务快照节奏——两块积木互相咬合的物证。

轴类型 SplitAxis 也值得停一眼：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/session.rs（行 65–72）
/// Split axis, mirrored from `display::SplitDirection` so the display layer
/// stays serde-free.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SplitAxis {
    LeftRight,
    TopBottom,
}
```

镜像而非引用。注释只说了事实（display 层保持无 serde），不编动机。算得出来的账是：序列化依赖挡在展示层之外，session.rs 自己扛全部落盘关注点。按所有权地图——判断改动落点的权威查表入口（[第 1 章](./01-repo-map.md)）——改会话格式时，落点是 nebula_app 的 session.rs。nebula_split 与 display 一行不动。

### 启动身份与导出：一份格式两处消费

首 pane 怎么启动，也一并记下来了。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/session.rs（行 36–63）
/// How a tab's first pane starts. The persistable subset of `TabLaunch`:
/// document and settings tabs never enter a session. Shell and profile
/// launches embed their full command so an exported workspace stays portable
/// even when the target machine's config lists different profiles.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum LaunchSession {
    Default,
    /// A detected shell from the new-tab dropdown (e.g. a WSL distro).
    Shell {
        name: String,
        program: String,
        args: Vec<String>,
    },
    /// A quick-launch profile, embedded rather than referenced by name.
    Profile {
        name: String,
        command: String,
        args: Vec<String>,
        cwd: Option<String>,
        #[serde(default)]
        shell_id: Option<String>,
    },
    /// A saved SSH destination; restoring reconnects automatically.
    Ssh {
        host: String,
    },
}
```

最值得注意的是注释反复强调的一点：命令整体嵌入而非按名引用。Shell 和 Profile 把 program、args 全文写进文件。注释点破用意："so an exported workspace stays portable"——换一台配置不同的机器，工作区照样能起。Ssh 只存 host，注释说恢复时自动重连。远端 tab 与本地 tab 进同一份快照、走同一条恢复路径。这不意外：Term 栈本来传输层无关——同一套网格与渲染既吃本地 PTY 也吃 SSH channel（[第 6 章](./06-ssh-session.md)），会话记录自然不需要为远端单开格式。

模块头还宣布了这份格式的第二重身份。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/session.rs（行 10–15）
//! v2 additionally preserves each tab's custom name and optional color. v3
//! persists the normal logical window size and maximized state. v4 records the
//! full split tree of every tab (axis, ratio, per-pane cwd) plus the tab's
//! launch identity (shell / profile / SSH destination), and the same schema
//! doubles as the workspace-export file format: `session.json` is simply the
//! automatic, unnamed workspace.
```

"session.json is simply the automatic, unnamed workspace"——session.json 只是那份自动的、未命名的工作区。导出文件不是另一种格式，是同一份快照写到显式路径。区别只在打印。save_to 用 pretty-print，理由写在注释里：工作区文件是给人读、diff、进版本库的。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/session.rs（行 328–333）
/// Write a session as a named workspace file. Pretty-printed — workspace
/// files are user-visible artifacts meant to be read, diffed and versioned.
pub fn save_to(path: &Path, session: &Session) -> std::io::Result<()> {
    let json = serde_json::to_string_pretty(session).map_err(std::io::Error::other)?;
    crate::atomic_file::write(path, json.as_bytes())
}
```

导出菜单走的也是同一个快照入口。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/gpui_shell/workspace.rs（行 2372–2379）
    /// 导出整个窗口为工作区文件（旧壳 `export_workspace(None)`）。
    fn export_workspace(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let export = self.snapshot_session(cx);
        if export.tabs.is_empty() {
            return;
        }
        self.prompt_save_workspace(export, "workspace", window, cx);
    }
```

导出能力 = 快照能力 + pretty 打印 + 文件对话框，没有独立的导出格式。这是版本化 schema 的直接好处：格式只在一处演进，两个消费方自动对齐。

## 三次跳闸：恢复护栏

最后一个问题：恢复失败了怎么办。直觉会说——再试一次。先替这个直觉说句公道话：网络抖一下重连、文件被占用等半秒重读，重试对瞬时故障是正确策略，日常经验里大多数失败也确实是瞬时的。边界在别处：当失败源是快照内容本身时，崩溃是确定性的——同样的输入，再来一次还是崩。恢复、崩溃、重启、再恢复，死循环闭合。终端常常被更新器或崩溃自动拉起，用户甚至不在电脑前，循环可以烧一整夜。

护栏的答案不是「恢复得更小心」，是数数：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/session.rs（行 335–340）
/// Whether a loaded session should actually be restored: respects the
/// crash-loop breaker and skips empty sessions (a clean quit — every tab
/// closed one by one — persists an empty tab list on purpose).
pub fn should_restore(session: &Session) -> bool {
    session.boot_attempts < MAX_BOOT_ATTEMPTS && !session.tabs.is_empty()
}
```

一行裁定式：boot_attempts < MAX_BOOT_ATTEMPTS 且 tabs 非空。第二个条件别漏掉：一路关标签关到空的会话是正常退出，本来就不该恢复。第一个条件的关键是 boot_attempts 计的是什么。注释原话："launches that never reached a successful autosave (i.e. crashed within the first second)"。不是崩溃次数，是「没活过第一秒」的启动次数。

计数的时机比计数本身更重要：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/session.rs（行 381–386）
/// Bump the attempt counter on disk before a restore is tried, so a crash
/// during/after restore is counted against the loop breaker.
pub fn mark_boot_attempt(session: &mut Session) {
    session.boot_attempts += 1;
    save(session);
}
```

mark_boot_attempt 在恢复尝试之前就把 +1 写进磁盘。反事实：如果先恢复、成功了再计数，那么恢复途中崩掉的启动一次都不入账——而「恢复途中崩」恰恰是死循环里最常见的死法，账本会系统性漏记最需要记的那类失败。先落盘，恢复途中的崩溃就自动算在断路器头上。

归零不需要显式的 clear 调用：新快照一律带 boot_attempts = 0，写死在构造里——

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/session.rs（行 259–262）
    pub fn new(active_tab: usize, tabs: Vec<TabSession>) -> Self {
        Self {
            version: VERSION,
            boot_attempts: 0,
```

恢复成功后一秒内的第一次自动保存产生新快照，计数自然洗白。为什么按「活到第一次自动保存」而不是「正常退出」记账？快照侧的合同注释给了一个具体场景。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/gpui_shell/workspace/session_recovery.rs（行 158–163）
    /// 快照一律带 `boot_attempts = 0`：断路器只回答「这次启动活到了第一次
    /// 自动保存没有」（session.rs 模块合同）。agent 恢复目标尚未被 hook /
    /// 探针确认是另一回事——codex 停在 hooks 信任、目录选择或「已在别处
    /// 打开」的提示上可以是几小时，正常退出照样算一次失败的话，三次就把
    /// 整个工作区（含所有普通 tab）隔离掉了。未确认的目标本身仍随
    /// `session_agent()` 落盘，下次启动照旧接续。
```

codex 可能停在权限确认这类提示上几个小时。如果按「正常退出」记账，一次都没崩的启动也会因为用户没关窗口而记成失败，三次就把整个工作区隔离掉。断路器只回答一个问题——这次启动活到了第一次自动保存没有。

启动路径的完整次序，GPUI 壳的版本如下。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/gpui_shell/workspace/session_recovery.rs（行 34–51）
        let Some(mut session) = crate::session::load() else { return false };
        if !crate::session::should_restore(&session) {
            if !session.tabs.is_empty() {
                // 连续几次启动都没活到第一次自动保存：把「一恢复就崩」的
                // 现场挪去隔离文件（唯一的诊断材料），本次干净启动。
                if let Some(path) = crate::session::quarantine() {
                    crate::gpui_shell::toast::banner(
                        window,
                        cx,
                        ToastKind::Warning,
                        format!("连续多次启动未完成恢复，已跳过；现场保存在 {}", path.display()),
                    );
                }
            }
            return false;
        }
        let crashed = crate::session::was_crash(&session);
        crate::session::mark_boot_attempt(&mut session);
```

四步走：load 读快照；should_restore 裁定；跳闸时 quarantine 隔离现场；mark_boot_attempt 计数落盘。然后才开始恢复。quarantine 值得单独看。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/session.rs（行 355–367）
/// 断路器跳闸（连续 [`MAX_BOOT_ATTEMPTS`] 次启动都没活到第一次自动保存）时，
/// 把这份会话挪到 `session.crashed.json` 再让本次启动走干净路径。
///
/// 必须**挪走**而不是留在原地：启动一成功，一秒后的自动保存就会把
/// `session.json` 盖掉，那份「一恢复就崩」的现场是唯一的诊断材料。顺带
/// 也让 `boot_attempts` 自然归零，用户不必手工删文件才能恢复正常。
pub fn quarantine() -> Option<PathBuf> {
    let from = session_path();
    let to = crate::display::nebula_data_dir().join("session.crashed.json");
    std::fs::copy(&from, &to).ok()?;
    let _ = std::fs::remove_file(&from);
    Some(to)
}
```

为什么必须挪走而不是留在原地？注释给了因果：跳闸后本次启动走干净路径，一秒后的自动保存就会把 session.json 盖掉——那份「一恢复就崩」的现场是唯一诊断材料，留在原地必死无疑。挪走还顺带让 boot_attempts 自然归零，用户不必手工删文件。

多窗口场景还有一笔细账。新壳把所有窗口合成一份快照，各窗的 boot_attempts 怎么合？答案是取最大值。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/session/window_layout.rs（行 22–28）
        combined.window_layout.push(WindowLayout {
            tab_count: session.tabs.len(),
            active_tab: session.active_tab,
            active,
            window: session.window,
        });
        combined.boot_attempts = combined.boot_attempts.max(session.boot_attempts);
```

测试把理由写进了断言消息：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/gpui_shell/workspace/session_persistence.rs（行 300–307）
        second.boot_attempts = 2;
        let combined = combine_sessions([(false, first), (true, second)]).unwrap();
        assert_eq!(combined.tabs.len(), 3);
        assert_eq!(combined.active_tab, 2);
        assert_eq!(
            combined.boot_attempts, 2,
            "pending recovery in any window preserves the crash guard"
        );
```

断言消息只有一句："pending recovery in any window preserves the crash guard"。任何一个窗口还挂着未完成的恢复，断路器计数就不能丢。取 max 而不是求和：每个窗的计数记的是各自那代启动；求和会把没崩过的窗也计进去，过早跳闸。

**重试对付瞬时故障，断路对付确定性故障**——恢复护栏的全部设计可以用这一句带走。

## 演练：跟一次强杀和一次三连崩走完全链

把零件按时间串起来。链 A，强杀：

1. t=0 打开终端，建三个 tab：一个左右分屏（比例 618:382，千分比 618）、一个 Claude、一个深目录的本地 shell。
2. t≈1s 定时器第一次到点。快照与上一帧（空）不等，写盘：boot_attempts = 0，clean_exit = false。
3. 之后的一小时里，你换目录、再分屏：变化后的下一秒写盘；没动的每一秒，比较一次、发现相等、跳过写盘。
4. t=47min 强杀。进程蒸发，没有任何回调执行。盘上留着最后一帧，clean_exit 仍是 false。
5. 重启。load 读到快照；should_restore：0 < 3 且 tabs 非空，放行；mark_boot_attempt 把 1 写回盘上；restore_tab 按深度优先序逐叶建 pane、重建三件套；was_crash 为真，弹「上次未正常退出，已恢复 N 个标签」。
6. 启动后一秒内第一次自动保存。Session::new 的新快照 boot_attempts = 0——断路器归零，这一代启动宣告存活。

链 B，毒快照（推演）。无论毒源是什么——未来版本的 bug、磁盘错误、手工编辑弄坏的字段——只要「恢复即崩」成立：

1. 启动 1：计数 0→1 落盘，恢复，崩（没活到第一次自动保存）。
2. 启动 2：1→2，恢复，崩。启动 3：2→3，恢复，崩。
3. 启动 4：should_restore 判 3 < 3 为假，跳闸。quarantine 把现场挪进 session.crashed.json，banner 告知路径，干净启动。
4. 干净启动活过第一秒，新快照计数 0。循环结束，现场还在，等你去看。

对照探针把每一步钉在断言上（在 `courses/pebrel-course/companion` 目录执行）：

```bash
node scripts/probe-11-session-persistence.mjs
```

24 条断言分四组：A 组 8 条钉节奏——合同句、模块地图、双壳各自的定时器与接线、双壳的去重；B 组 7 条钉护栏——上限常量、裁定式、计数先落盘、归零路径、隔离、启动四步次序（按调用点出现位置断言，四个调用点各恰 1 处）、多窗合并取 max；C 组 7 条钉格式——版本常量、升版与拒绝、树结构、启动身份、v4 字段缺省、导出复用、原子写；D 组 2 条用自建最小输入按源码公式重演护栏与版本闸。末行 summary 打印三段式证据摘要。

## 验证：先猜后跑

一、护栏表手算。按 should_restore 的裁定式把下表写死——boot_attempts < 3 且 tabs 非空——再跑探针对照 D 组第一行。

| 盘上 boot_attempts | tabs 数 | 先猜 should_restore |
|---|---|---|
| 0 | 2 | ？ |
| 1 | 2 | ？ |
| 2 | 2 | ？ |
| 3 | 2 | ？ |
| 0 | 0 | ？ |

对照点：探针输出应出现「恢复裁定 [true, true, true, false]」，外加「空 tab 列表即使计数 0 也不恢复（false）」。顺带先猜 D 组第二行版本闸的输出——v1、v2、v3、v4、v5 各变成什么？答案是三个旧版本原地升 4、v4 原样接受、v5 拒绝为 null。

二、节奏考古。在锁定 clone 根目录执行，先猜命中数再看输出：

```bash
grep -rniE "snapshot_(hz|interval|frequency)|SESSION_SNAPSHOT_PERIOD" --include="*.rs" nebula_app/src
grep -rn "Duration::from_secs(1)" nebula_app/src/event.rs nebula_app/src/gpui_shell/workspace/windowing.rs
```

第一条应 0 条命中——不存在快照频率常量，节奏只活在合同句与两个壳的定时器里。第二条应两个文件各恰好 1 条命中——两个壳各挂各的 1 秒定时器，互不共享。若第一条冒出命中，说明锁定 clone 与课程版本脱节，先解决再往下读。

三、纸上手术（定向破坏）。不改 clone、不改探针，在纸面上完成：把 session.rs 行 385——mark_boot_attempt 体内那行 save(session);——删掉。先写两个离散预测再往下读。

预测一：探针 24 条里红几条？答案是 0 条。四空格缩进的 save(session); 在 session.rs 里恰有两处：行 385 这条在 mark_boot_attempt 里，行 346 那条在 save_final 里，两条逐字相同。探针的「计数先于恢复落盘」断言查的是字符串存在于文件中——save_final 那条替它续了命。这条断言守的是「这条链长什么样」（合同注释、调用点、次序），守不住「这个函数体内有没有一份」；守唯一性得靠计数类断言，这条探针没有为它设。

预测二：用户看得到什么？恢复途中崩掉的启动不再计数——+1 发生在内存里，还没落盘进程就没了。死循环回归：启动、恢复、崩，盘上计数永远停在 0，护栏永远不跳闸。而且完全静默：没有任何日志或提示会告诉你计数没写上去。「跳闸处置」那条断言也还绿——它守的是隔离逻辑本身，不是计数是否落盘。

（在纸面上）把那行放回去，24 条恢复全绿。

对照组这一枪可以真开（单行改动，安全可复原）：把 session.rs 里 `const MAX_BOOT_ATTEMPTS: u32 = 3;` 的 3 改成 5，改前先写下预言——红几条？跑 `node scripts/probe-11-session-persistence.mjs` 对答案：恰好 1 条红（「上限常量」那条变红），D 组护栏重演照绿：它重演用的是探针自带的公式副本，守的是数学一致性，不是文件里的常量值。改回 3，复跑恢复 24/24。

## 迁移自查

1. 你同时开着两个窗口。窗口 A 挂着两次未完成的恢复（boot_attempts = 2），窗口 B 一切正常（0）。下一次自动保存的合并快照里 boot_attempts 是几？为什么不是两个数相加？
2. 一个更新版本的终端写了 v5 文件，你回退到本锁定版本运行。正常启动会发生什么？更新交接路径（load_update_windows）又会发生什么？两条路径的处置为什么不同？
3. 你给 TabSession 加一个新字段 zoomed_pane: Option<u64>，记录 tab 是否处于临时满屏。需要把 VERSION 升到 5 吗？依据是格式演进两条正道里的哪一条？

<details>
<summary>参考答案</summary>

1. 2。combine_sessions 取各窗计数的 max——任何一个窗口还挂着未完成的恢复，断路器就必须保住计数；求和会把没崩过的窗口也计进去，让断路器过早跳闸。
2. 正常启动：parse 对 v5 返回 None，load 随之返回 None，当作没有会话，干净启动。更新交接路径：同样的 None 被 ok_or_else 转成 InvalidData 错误上抛——更新流程宁肯失败，也不许拿空快照盖掉可能还救得回来的工作区。一个是日常路径的宽容，一个是数据迁移路径的严格。
3. 不需要。zoomed_pane 是可缺省的追加字段：serde(default) 缺省、None 不序列化。老文件读出 None，老版本忽略它——agent 字段已做过同款判定（「老文件缺省、老版本忽略，无需升版」）。升版留给结构性、无法用缺省表达的变化。

</details>

## 收束

开篇的两幕现在都有了名姓。强杀之后一切都在，因为快照节奏在崩溃前就持续落盘——两个壳各挂一个 1 秒定时器，每秒拍一帧、相等即跳过、临时文件加原子换名写盘，崩溃最多丢掉最后一秒。三次崩溃之后失忆，因为恢复护栏判定「恢复本身已成分故障源」。计数先于恢复落盘，三次没活过第一秒就断路。现场挪进 session.crashed.json 隔离保存——不是丢了，是请你去看。而这两件事能长跑不腐，靠的是版本化 schema 把格式演进约束在两条正道上，还顺手让导出文件与自动快照共用同一份格式。

本章新添三块积木：快照节奏——持续快照、跳过无变化、原子落盘的写盘合同；恢复护栏——数「没活过第一秒的启动」、先落盘再恢复、三连败隔离现场的断路器；版本化 schema——自带版本号、老版本原地升、超前拒绝、追加字段走缺省的格式演进纪律。

下一站（[第 12 章](./12-lua-config.md)）：配置文件如何做到可执行又可逐字段诊断。更远的路：三块积木随全书地图在终章对账（[第 16 章](./16-review.md)）。
