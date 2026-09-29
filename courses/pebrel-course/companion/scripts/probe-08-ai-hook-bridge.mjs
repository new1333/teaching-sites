// 第 8 章 ai-hook-bridge：钩子桥进程的隐形合同。
// 对锁定 clone（.course/repo @ 360613aa）只读断言 nebula_hook 的三条设计约束：
// INVISIBLE（panic 也退 0）、SCOPED（PEBREL_* 环境变量哨兵）、BOUNDED（纯 std +
// 1MiB 载荷上限 + 2s 转发超时），外加 --chain 兼容被占用的 notify 槽位。
// 所有断言取自锁定 ref 上的静态文件内容，不执行目标仓库代码。
import { requireRepo, readRepoFile, repoFileExists, makeProbe } from './lib/repo.js';

const probe = makeProbe('ai-hook-bridge');
requireRepo();

const MAIN = 'nebula_hook/src/main.rs';
const HOOK_CARGO = 'nebula_hook/Cargo.toml';
const HOST = 'nebula_app/src/ai_hook.rs';
probe.check('三个证据文件都在锁定 ref 上存在', [MAIN, HOOK_CARGO, HOST].every(repoFileExists));

const main = readRepoFile(MAIN);
const cargo = readRepoFile(HOOK_CARGO);
const host = readRepoFile(HOST);
// 文档约束句跨行：先剥掉行首 // 与 //! 注释前缀再按空白归一，否则拼不回整句。
const flatMain = main
  .split(/\r?\n/)
  .map((l) => l.replace(/^\s*\/\/!?\/?\s?/, ''))
  .join(' ')
  .replace(/\s+/g, ' ');

// ---- A. 无第三方依赖（zero deps / std-only）------------------------------------
const cargoSections = [...cargo.matchAll(/^\s*\[+([^\]]+)\]+/gm)].map((m) => m[1]);
const depSections = cargoSections.filter((s) => /(^|\.)(dev-)?dependencies/.test(s) || /build-dependencies/.test(s));
probe.check(
  `nebula_hook/Cargo.toml 不含任何依赖表（实测 section：${cargoSections.join(', ')}）`,
  depSections.length === 0,
  depSections.join(', '),
);
const uses = [...main.matchAll(/^\s*use\s+([^;]+);/gm)].map((m) => m[1].trim());
const external = uses.filter((p) => !/^(std|core|alloc|super|crate|self)::/.test(p));
probe.check(
  `main.rs 全部 use 导入仅 std/super（实测 ${uses.length} 条）`,
  external.length === 0,
  external.join(', '),
);
probe.check(
  'Cargo.toml 注释自述 zero-dep 动机：startup IS the latency budget、No deps = minimal imports = <15 ms cold',
  cargo.includes('Pure std on purpose') && /No deps = minimal imports = <15 ms cold/.test(cargo),
);

// ---- B. 隐形合同：任何路径（含 panic）都退出码 0 --------------------------------
probe.check(
  '模块文档约束 1 逐字（归一后）：Every path — including panic — must exit 0',
  flatMain.includes('Every path — including panic — must exit 0'),
);
probe.check(
  'main() 把全部转发工作包进子线程的 catch_unwind（main.rs:181 逐字）',
  main.includes('let _ = std::panic::catch_unwind(|| run(&forwarding_args));'),
);
probe.check(
  '超时后不 join 卡死的 worker：recv_timeout(FORWARD_TIMEOUT) 后 main 照常返回，注释写明 The provider sees exit code 0.',
  main.includes('let _ = finished.recv_timeout(FORWARD_TIMEOUT);')
    && main.includes('The provider sees exit code 0.'),
);

// ---- C. 有界转发：1MiB 载荷上限 / 2s 转发超时 -----------------------------------
probe.check(
  'MAX_PAYLOAD_BYTES 逐字 = 1 << 20（即 1_048_576 字节 = 1 MiB，不是 1_000_000）',
  main.includes('const MAX_PAYLOAD_BYTES: usize = 1 << 20;') && (1 << 20) === 1_048_576,
);
probe.check(
  'FORWARD_TIMEOUT 逐字 = Duration::from_secs(2)',
  main.includes('const FORWARD_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(2);'),
);
probe.check(
  '超时罩住整个转发操作（含 stdin 抽干与管道写），而非只读超时',
  main.includes('Bound the entire forwarding operation, including stdin drain and pipe'),
);
probe.check(
  '超限载荷先抽干再丢弃、绝不转发截断 JSON：take(MAX_PAYLOAD_BYTES + 1) + copy 到 sink，去向记为 payload-too-large',
  main.includes('reader.by_ref().take((MAX_PAYLOAD_BYTES + 1) as u64).read_to_end(&mut bytes)?;')
    && main.includes('std::io::copy(&mut reader, &mut std::io::sink())?;')
    && main.includes('Self::PayloadTooLarge => "payload-too-large"'),
);

// ---- D. 环境变量哨兵：PEBREL_* / NEBULA_* 作用域合同 ----------------------------
probe.check(
  '宿主侧定义管道哨兵：PIPE_ENV = "PEBREL_NOTIFY_PIPE"、LEGACY_PIPE_ENV = "NEBULA_NOTIFY_PIPE"（ai_hook.rs:44-45 逐字）',
  host.includes('pub const PIPE_ENV: &str = "PEBREL_NOTIFY_PIPE";')
    && host.includes('pub const LEGACY_PIPE_ENV: &str = "NEBULA_NOTIFY_PIPE";'),
);
probe.check(
  '宿主同文件还有三对 PEBREL_*/NEBULA_* 常量：PANE_ID 与 HOOK_EXE 及各自 LEGACY',
  host.includes('pub const PANE_ENV: &str = "PEBREL_PANE_ID";')
    && host.includes('pub const LEGACY_PANE_ENV: &str = "NEBULA_PANE_ID";')
    && host.includes('pub const HOOK_EXE_ENV: &str = "PEBREL_HOOK_EXE";')
    && host.includes('pub const LEGACY_HOOK_EXE_ENV: &str = "NEBULA_HOOK_EXE";'),
);
probe.check(
  '钩子侧统一走 aliased_env：先读 PEBREL_{suffix}， miss 才回退 NEBULA_{suffix}（main.rs:85 逐字）',
  main.includes('read(&format!("PEBREL_{suffix}")).or_else(|| read(&format!("NEBULA_{suffix}")))'),
);
probe.check(
  '管道分支由 hook_env("NOTIFY_PIPE") 哨兵驱动：变量不存在 ⇒ NotHosted 无声 no-op',
  main.includes('if let Some(pipe) = hook_env("NOTIFY_PIPE")') && main.includes('Self::NotHosted => "not-hosted"'),
);
probe.check(
  '空串哨兵不回退旧名：测试钉住 an explicit empty scope must not fall through to a legacy host',
  main.includes('an explicit empty scope must not fall through to a legacy host'),
);
probe.check(
  '模块文档约束 2 逐字（归一后）：The scope guard is the environment … only exists for processes spawned inside Nebula',
  flatMain.includes('The scope guard is the environment: NEBULA_NOTIFY_PIPE only exists for processes spawned inside Nebula.'),
);

// ---- E. --chain：兼容被占用的 codex notify 槽位 ---------------------------------
probe.check(
  'chain_notifier 以 slice 模式接受 ["codex","--chain",prog,rest..] 并 spawn 原有 notifier（main.rs:336 逐字）',
  main.includes('if let ["codex", "--chain", prog, rest @ ..] = &strs[..]')
    && main.includes('std::process::Command::new(prog).args(fixed).args(json).spawn()'),
);
probe.check(
  '文档给出 --chain 成因：codex has a single `notify` slot which may already be taken',
  flatMain.includes('`--chain` exists because codex has a single `notify` slot which may already be taken'),
);

// ---- 摘要（milestone_verify：输出三条设计约束的证据锚点）-----------------------
console.log(
  `summary [ai-hook-bridge] INVISIBLE=${MAIN}:181 catch_unwind + :186 recv_timeout → exit 0; ` +
  `SCOPED=${HOST}:44-45 PEBREL_NOTIFY_PIPE/NEBULA_NOTIFY_PIPE + ${MAIN}:85 PEBREL_→NEBULA_ 回退; ` +
  `BOUNDED=${MAIN}:45-46 MAX_PAYLOAD_BYTES=1<<20(1MiB), FORWARD_TIMEOUT=2s; ${HOOK_CARGO} 无依赖表`,
);

probe.done();
