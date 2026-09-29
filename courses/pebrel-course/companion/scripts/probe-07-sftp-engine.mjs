// 第 7 章 sftp-engine：传输引擎内部——分段规划常量、句柄区间划分与 TransferObserver 接缝。
// 对锁定 clone（.course/repo @ 360613aa）只读断言本章 milestone：
//   1) limits.rs 的分段规划常量真实值与单位（分块 32 KiB、窗口 64、超时 30s、
//      分段下限两块、目录并发 4/4）与 window_per_file 的总量不变量；
//   2) plan_segments 的连续区间划分算法与 download_range 的每段私有句柄
//      + 双端 seek 对齐（含段尾缩短读，防止跨段写同一片区域）；
//   3) 单在途 READ 论证的代码/注释证据（上游 AsyncRead 每句柄一个在途 READ，
//      请求队列藏在私有字段，N 个句柄 = N 个在途 READ）；
//   4) TransferObserver trait 的两方法面与 UI 无关性（引擎文件零 UI 符号，
//      UI 侧 TaskContext 实现，唤醒走 WakeFn）；
//   5) 上传方向不需要多句柄的代码层证据（写并发由会话参数
//      max_concurrent_writes=UPLOAD_WINDOW 承担，upload_stream 单句柄顺序喂块）；
//   6) 跨平台落盘：各平台都有的 AsyncSeek + AsyncWrite，生产代码零 cfg 分支。
// 第 6 章探针已断言 exec/sftp 连接池共用，本探针不重复其断言面；
// 仅引用 ssh_session.rs 中 session_config 灌入 SftpSession 的参数管道。
// 所有断言取自锁定 ref 上的静态文件内容，不执行目标仓库代码。
import { requireRepo, readRepoFile, repoFileExists, makeProbe } from './lib/repo.js';

const probe = makeProbe('sftp-engine');
requireRepo();

const P = {
  limits: 'nebula_app/src/ssh_sftp/limits.rs',
  transfer: 'nebula_app/src/ssh_sftp/transfer.rs',
  sftp: 'nebula_app/src/ssh_sftp.rs',
  session: 'nebula_app/src/ssh_session.rs',
};
for (const p of Object.values(P)) {
  if (!repoFileExists(p)) {
    console.error(`sftp-engine: 锁定 clone 缺少 ${p}`);
    process.exit(1);
  }
}
// 锁定 clone 在本机检出为 CRLF 行尾；断言前统一归一为 \n，行号不受影响。
const read = (p) => readRepoFile(p).replace(/\r\n/g, '\n');
const limits = read(P.limits);
const transfer = read(P.transfer);
const sftp = read(P.sftp);
const session = read(P.session);

const lineOf = (text, needle) => {
  const idx = text.indexOf(needle);
  return idx < 0 ? -1 : text.slice(0, idx).split('\n').length;
};
const countOf = (text, needle) => text.split(needle).length - 1;
// 压平空白后的包含判断（跨行文档注释用）。
const flat = (text) => text.replace(/\s+/g, ' ');
// 再剥掉行注释前缀（//、///、//!）后压平：多行文档注释逐行拼接用。
const flatDoc = (text) => text.replace(/\/\/+!?\s*/g, ' ').replace(/\s+/g, ' ');

// ---- A. limits.rs：分段规划常量的真实值与单位 --------------------------------------
probe.check(
  'TRANSFER_CHUNK = 32 * 1024（32 KiB，READ/WRITE 单请求数据长度）；模块文档钉死取舍：单请求越大越省往返但易踩服务端坑，超过 32 KiB 的 READ/WRITE 在部分服务端实现上会被静默截断——文件长度对得上而内容是错的，所以分块钉保守值、靠窗口拿吞吐',
  limits.includes('pub(crate) const TRANSFER_CHUNK: usize = 32 * 1024;')
    && flatDoc(limits).includes('32 KiB 是 SFTP 生态的事实底线')
    && flatDoc(limits).includes('超过 32 KiB 的 READ/WRITE')
    && flatDoc(limits).includes('在部分服务端实现上会被静默截断'),
);
probe.check(
  '单包上限覆盖协议头：PACKET_HEADROOM = 256，MAX_PACKET_LEN = (TRANSFER_CHUNK + PACKET_HEADROOM) as u32；文档算清 overhead——WRITE 是 21 字节固定头加句柄长度，READ 是 9 字节',
  limits.includes('const PACKET_HEADROOM: usize = 256;')
    && limits.includes('pub(crate) const MAX_PACKET_LEN: u32 = (TRANSFER_CHUNK + PACKET_HEADROOM) as u32;')
    && flatDoc(limits).includes('overhead 是 21 字节固定头加文件句柄长度，READ 是 9 字节'),
);
probe.check(
  '上传/下载窗口对称且都是 64：UPLOAD_WINDOW = 64（文档：32 KiB × 64 ≈ 2 MiB 在途；跨洲 200ms 往返、100 Mbps 带宽下填满管道需要约 2.5 MiB 在途）；DOWNLOAD_WINDOW = 64（文档点名上游 AsyncRead 每个文件句柄只维持一个在途 READ，所以这个窗口靠同一文件开多个句柄、每句柄负责一段连续区间来达成）',
  limits.includes('pub(crate) const UPLOAD_WINDOW: usize = 64;')
    && limits.includes('pub(crate) const DOWNLOAD_WINDOW: usize = 64;')
    && flatDoc(limits).includes('32 KiB × 64 ≈ 2 MiB 在途。')
    && flatDoc(limits).includes('填满管道需要约 2.5 MiB 在途')
    && flatDoc(limits).includes('每个文件句柄只维持一个在途 READ')
    && flatDoc(limits).includes('每句柄负责一段连续区间'),
);
probe.check(
  'REQUEST_TIMEOUT_SECS = 30（上游默认 10 秒；慢链路一次 32 KiB 往返可能超 10s，误判会把能完成的传输打断成失败重试，放宽到 30 秒仍能收敛）',
  limits.includes('pub(crate) const REQUEST_TIMEOUT_SECS: u64 = 30;')
    && flatDoc(limits).includes('上游默认 10 秒')
    && flatDoc(limits).includes('放宽到 30 秒'),
);
probe.check(
  '分段下限：MIN_SEGMENTED_DOWNLOAD = (TRANSFER_CHUNK * 2) as u64——一个文件至少要能切成两段才谈得上并发，小文件走单句柄顺序读（省一次 OPEN 往返加一个本地句柄）',
  limits.includes('pub(crate) const MIN_SEGMENTED_DOWNLOAD: u64 = (TRANSFER_CHUNK * 2) as u64;')
    && flatDoc(limits).includes('一个文件至少要能切成两段才谈得上并发'),
);
probe.check(
  '目录传输双并发与命名区分：DIRECTORY_FILE_CONCURRENCY = 4、DIRECTORY_LISTING_CONCURRENCY = 4；文档警告两并发度相乘会把服务端的 MaxSessions 和句柄表顶穿',
  limits.includes('pub(crate) const DIRECTORY_FILE_CONCURRENCY: usize = 4;')
    && limits.includes('pub(crate) const DIRECTORY_LISTING_CONCURRENCY: usize = 4;')
    && flatDoc(limits).includes('同时有几个文件在传')
    && flatDoc(limits).includes('一个文件内有几个请求在途')
    && flatDoc(limits).includes('MaxSessions')
    && flatDoc(limits).includes('和句柄表顶穿'),
);
probe.check(
  '总量不变量：window_per_file(concurrent_files) = (DOWNLOAD_WINDOW / concurrent_files.max(1)).max(1)——在途请求总数不随并发文件数增长，文件并发 × 单文件窗口始终不超过 DOWNLOAD_WINDOW；并发度为 0 不除零',
  limits.includes('pub(crate) fn window_per_file(concurrent_files: usize) -> usize {')
    && limits.includes('(DOWNLOAD_WINDOW / concurrent_files.max(1)).max(1)')
    && flatDoc(limits).includes('在途请求总数不随并发文件数增长'),
);
probe.check(
  'session_config() 把三个常量灌进上游会话：max_packet_len: MAX_PACKET_LEN、max_concurrent_writes: UPLOAD_WINDOW、request_timeout_secs: REQUEST_TIMEOUT_SECS——上传方向的并发就来自这里',
  limits.includes('pub(crate) fn session_config() -> russh_sftp::client::Config {')
    && limits.includes('max_packet_len: MAX_PACKET_LEN,')
    && limits.includes('max_concurrent_writes: UPLOAD_WINDOW,')
    && limits.includes('request_timeout_secs: REQUEST_TIMEOUT_SECS,'),
);

// ---- B. plan_segments：连续区间划分算法 ----------------------------------------------
probe.check(
  '签名即合同：plan_segments(total, window) -> Vec<(u64, u64)>，返回每段的 (起始偏移, 长度)；文档声明段数不超过 window、每段都是分块的整数倍（最后一段除外），顺序读对齐在请求边界上，不出现跨段的半个请求',
  limits.includes('pub(crate) fn plan_segments(total: u64, window: usize) -> Vec<(u64, u64)> {')
    && flatDoc(limits).includes('每段都是分块的整数倍')
    && flatDoc(limits).includes('跨段的半个请求'),
);
probe.check(
  '四步除法切区间：blocks = total.div_ceil(chunk)（总块数向上取整）→ segments = window.min(blocks)（段数不超过块数，排不出空段）→ blocks_per_segment = blocks.div_ceil(segments)（每段块数向上取整，段加起来覆盖整个文件）→ span = blocks_per_segment * chunk',
  limits.includes('let blocks = total.div_ceil(chunk);')
    && limits.includes('let segments = window.min(blocks);')
    && limits.includes('let blocks_per_segment = blocks.div_ceil(segments);')
    && limits.includes('let span = blocks_per_segment * chunk;'),
);
probe.check(
  '区间循环无缝隙：length = span.min(total - offset)，plan.push((offset, length))，offset += length 直到 total；total == 0 返回空 Vec——零字节文件不需要读，调用方建出空文件即是正确结果',
  limits.includes('let length = span.min(total - offset);')
    && limits.includes('plan.push((offset, length));')
    && limits.includes('return Vec::new();')
    && flatDoc(limits).includes('零字节文件不需要读'),
);

// ---- C. 句柄区间划分：download_segmented / download_range ---------------------------
probe.check(
  '引擎只从 limits 取三样：use super::limits::{MIN_SEGMENTED_DOWNLOAD, TRANSFER_CHUNK, plan_segments}——常量判据集中在 limits.rs，不散落在调用点',
  transfer.includes('use super::limits::{MIN_SEGMENTED_DOWNLOAD, TRANSFER_CHUNK, plan_segments};'),
);
probe.check(
  '小文件门槛在引擎侧收拢：window = if total < MIN_SEGMENTED_DOWNLOAD { 1 } else { window.max(1) }，再 plan = plan_segments(total, window)；plan.len() <= 1 时走单段顺序路径（文档：只有一段时开并发脚手架纯属浪费，绝大多数文件落在这一支）',
  transfer.includes('let window = if total < MIN_SEGMENTED_DOWNLOAD { 1 } else { window.max(1) };')
    && transfer.includes('let plan = plan_segments(total, window);')
    && transfer.includes('if plan.len() <= 1 {')
    && flatDoc(transfer).includes('只有一段时开并发脚手架纯属浪费'),
);
probe.check(
  '每段一套私有句柄 + 双端 seek 对齐：download_range 内 source = sftp.open(remote)（远端新句柄）、target = OpenOptions 写方式开同一本地文件，offset > 0 时两端各 seek(SeekFrom::Start(offset))；文档：远端句柄和本地句柄都是这一段私有的，段之间没有共享可变状态，不需要任何锁',
  transfer.includes('let mut source = sftp.open(remote.to_owned()).await?;')
    && transfer.includes('let mut target = tokio::fs::OpenOptions::new().write(true).open(local).await?;')
    && transfer.includes('source.seek(io::SeekFrom::Start(offset)).await?;')
    && transfer.includes('target.seek(io::SeekFrom::Start(offset)).await?;')
    && flatDoc(transfer).includes('远端句柄和本地句柄都是这一段私有的，所以段之间没有共享可变状态，')
    && flatDoc(transfer).includes('不需要任何锁。'),
);
probe.check(
  '段尾缩短读防越界：want = usize::try_from(remaining).unwrap_or(TRANSFER_CHUNK).min(TRANSFER_CHUNK)，读缓冲用 buffer[..want]；注释：只读到段边界为止，段末尾那次读必须缩短，否则会读进下一段的地盘，两个工作者写同一片区域',
  transfer.includes('let want = usize::try_from(remaining).unwrap_or(TRANSFER_CHUNK).min(TRANSFER_CHUNK);')
    && flatDoc(transfer).includes('只读到段边界为止：段末尾那次读必须缩短，否则会读进下一段的地盘，')
    && flatDoc(transfer).includes('两个工作者写同一片区域。'),
);
const production = transfer.slice(0, transfer.indexOf('#[cfg(test)]'));
probe.check(
  '「无锁」的代码面：生产代码（#[cfg(test)] 之前）零 Mutex 出现——段间隔离靠私有句柄，不靠锁；引擎只用原子量（AtomicBool/AtomicUsize，位于 run_bounded 的领活儿游标与失败位）',
  !production.includes('Mutex')
    && production.includes('AtomicBool')
    && production.includes('AtomicUsize'),
);
probe.check(
  '调用侧把窗口摊给文件并发：ssh_sftp.rs 里 files = plan.files.len().min(DIRECTORY_FILE_CONCURRENCY).max(1)，window = window_per_file(files)，再经隐藏临时文件 .{name}.nebula-download-{nonce:016x} 传给 download_segmented(sftp, remote, total, &temporary, window, context)；文档：单个大文件因此拿到完整窗口，而不是被目录传输的上限提前摊薄成四分之一',
  sftp.includes('let files = plan.files.len().min(limits::DIRECTORY_FILE_CONCURRENCY).max(1);')
    && sftp.includes('let window = limits::window_per_file(files);')
    && sftp.includes('transfer::download_segmented(sftp, remote, total, &temporary, window, context).await')
    && sftp.includes('destination.with_file_name(format!(".{name}.nebula-download-{nonce:016x}"));')
    && flatDoc(sftp).includes('因此拿到完整窗口，而不是被目录传输的上限'),
);

// ---- D. 单在途 READ 论证的代码/注释证据 ---------------------------------------------
probe.check(
  '引擎模块文档论证封顶公式：读方向每个句柄只持有一个在途 READ，下一个请求要等上一个的数据回来才发得出去，所以无论怎么调参数，单句柄顺序读的吞吐上限都是 分块 / 往返时延——跨洲链路上这个数字只有几 MB/s，和带宽无关',
  flatDoc(transfer).includes('方向每个句柄只持有*一个*在途 READ：下一个请求要等上一个的数据')
    && flatDoc(transfer).includes('回来才发得出去。所以无论怎么调参数，单句柄顺序读的吞吐上限都是')
    && flatDoc(transfer).includes('分块 / 往返时延')
    && flatDoc(transfer).includes('和带宽无关'),
);
probe.check(
  '多句柄方案的成立条件写明：拿不到底层请求队列（上游把它藏在私有字段里），所以下载的并发靠同一个远端文件开多个句柄、每个句柄负责一段连续区间；每个句柄内部依旧是顺序读，但 N 个句柄意味着 N 个 READ 同时在途，效果与请求级流水线等价，且不依赖上游的任何内部细节',
  flatDoc(transfer).includes('拿不到底层请求队列（上游把它藏在私有字段里）')
    && flatDoc(transfer).includes('远端文件开多个句柄、每个句柄负责一段连续区间')
    && flatDoc(transfer).includes('N 个句柄意味着 N 个 READ 同时在途，效果与请求级流水线等价，'),
);

// ---- E. TransferObserver trait：方法面与 UI 无关性 ----------------------------------
const traitAt = transfer.indexOf('pub(crate) trait TransferObserver: Send + Sync {');
const traitBody = transfer.slice(traitAt, transfer.indexOf('/// 每个分块边界检查一次取消。'));
probe.check(
  '方法面恰好两个且零默认实现：trait TransferObserver: Send + Sync 内只有 fn advance(&self, bytes: u64) 与 fn cancelled(&self) -> bool——进度（增量字节）+ 取消（是/否），没有第三种 UI 概念漏进引擎',
  traitAt >= 0
    && countOf(traitBody, 'fn ') === 2
    && transfer.includes('fn advance(&self, bytes: u64);')
    && transfer.includes('fn cancelled(&self) -> bool;'),
);
probe.check(
  '解耦意图写在 trait 上：抽成 trait 而不是直接依赖某个 UI 类型——引擎跑在网络 runtime 上，它不该知道自己的进度最终画在哪儿，也不该知道取消这个意图是从哪个按钮来的',
  flatDoc(transfer).includes('抽成 trait 而不是直接依赖某个 UI 类型')
    && flatDoc(transfer).includes('引擎跑在网络 runtime 上')
    && flatDoc(transfer).includes('知道自己的进度最终画在哪儿')
    && flatDoc(transfer).includes('这个意图是从哪个按钮来的'),
);
probe.check(
  '取消粒度落在块边界：guard(observer) 只问 cancelled()，返回 Err(io::Error::new(ErrorKind::Interrupted, "操作已取消"))；trait 文档：引擎在每个分块边界询问，所以取消的响应粒度是一块',
  transfer.includes('fn guard(observer: &dyn TransferObserver) -> TransferResult<()> {')
    && transfer.includes('Err(io::Error::new(io::ErrorKind::Interrupted, "操作已取消").into())')
    && flatDoc(transfer).includes('取消的响应粒度是一块'),
);
probe.check(
  '引擎文件零 UI 符号：transfer.rs 全文不出现 gpui / winit / EventProxy——引擎对窗口系统一无所知；UI 侧在 ssh_sftp.rs 里 impl TransferObserver for TaskContext（advance 进 progress 并 wake_throttled，cancelled 读任务控制位），该文件顶部 use transfer::TransferObserver 反向依赖，方向单向',
  !transfer.includes('gpui')
    && !transfer.includes('winit')
    && !transfer.includes('EventProxy')
    && sftp.includes('impl TransferObserver for TaskContext {')
    && sftp.includes('use transfer::TransferObserver;')
    && sftp.includes('self.wake_throttled(false);')
    && sftp.includes('task_cancelled(&self.task_control, &self.generation, self.task_generation)'),
);
probe.check(
  '唤醒也是接缝：ssh_sftp.rs 定义 pub type WakeFn = Arc<dyn Fn() + Send + Sync>，文档：传输跑在网络 runtime 上，而画面归 UI 层，两者之间只需要一个响一声的信号，控制器不知道 UI 是哪一套窗口系统',
  sftp.includes('pub(crate) type WakeFn = Arc<dyn Fn() + Send + Sync>;')
    && flatDoc(sftp).includes('传输跑在网络 runtime 上，而画面归 UI 层。'),
);

// ---- F. 上传方向为何不需要多句柄（代码层证据）---------------------------------------
probe.check(
  '方向不对称写进引擎文档：写方向内部维护一个应答队列，同时可以有 max_concurrent_writes 个 WRITE 在途，配好参数后 write_all 自然就是流水线的，不需要我们做事；读方向才有单在途封顶',
  flatDoc(transfer).includes('方向内部维护一个应答队列')
    && flatDoc(transfer).includes('个 WRITE 在途。配好参数后')
    && flatDoc(transfer).includes('自然就是流水线的，不需要我们做事。'),
);
probe.check(
  'upload_stream 全文单句柄：open_with_flags(CREATE | TRUNCATE | WRITE) 开一个远端句柄，循环 source.read 到 buffer → target.write_all → observer.advance，末尾 target.shutdown() 把在途 WRITE 应答排空再关句柄；文档：写方向的并发由会话参数（max_concurrent_writes）承担，缓冲区固定一个分块——更大的缓冲不会提高在途请求数，只会让取消的响应变钝',
  transfer.includes('OpenFlags::CREATE | OpenFlags::TRUNCATE | OpenFlags::WRITE')
    && transfer.includes('target.shutdown().await?;')
    && flatDoc(transfer).includes('先把在途的 WRITE 应答排空再关句柄')
    && flatDoc(transfer).includes('写方向的并发由会话参数（')
    && flatDoc(transfer).includes('更大的缓冲不会提高在途')
    && flatDoc(transfer).includes('只会让取消的响应变钝'),
);
probe.check(
  '参数真的灌进了会话：ssh_session.rs 的 open_sftp 用 SftpSession::new_with_config(channel.into_stream(), ssh_sftp::limits::session_config())；注释算账：默认单包 256 KiB 会让每个 READ/WRITE 顶满巨型请求（部分服务端静默出错），而默认在途写请求只有 8 个，高时延链路填不满管道',
  session.includes('Ok(russh_sftp::client::SftpSession::new_with_config(')
    && session.includes('crate::ssh_sftp::limits::session_config(),')
    && flatDoc(session).includes('显式给参数而不是用上游默认值')
    && flatDoc(session).includes('默认单包 256 KiB')
    && flatDoc(session).includes('默认在途写'),
);

// ---- G. 跨平台落盘路径 --------------------------------------------------------------
probe.check(
  '跨平台论证写明：本地落盘不需要按偏移写，每个工作者把自己的本地文件句柄 seek 到段起点后顺序写，用的是各平台都有的 AsyncSeek + AsyncWrite；整个引擎里没有一处平台分支',
  flatDoc(transfer).includes('本地落盘不需要按偏移写')
    && flatDoc(transfer).includes('seek 到段起点后顺序写')
    && flatDoc(transfer).includes('用的是各平台都有的')
    && flatDoc(transfer).includes('整个引擎里没有一处平台分支。'),
);
probe.check(
  '「零平台分支」的代码面：transfer.rs 里 #[cfg( 恰好 1 处且就是 #[cfg(test)]——生产代码没有 cfg(windows)/cfg(unix) 等任何目标分支；I/O 全部经 tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt}',
  countOf(transfer, '#[cfg(') === 1
    && countOf(transfer, '#[cfg(test)]') === 1
    && transfer.includes('use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};'),
);

// ---- 摘要（milestone_verify：分段参数与接缝证据）-----------------------------------
console.log(
  `summary [sftp-engine] chunk=${P.limits}:${lineOf(limits, 'const TRANSFER_CHUNK')} 32KiB, ` +
  `packet=${lineOf(limits, 'const PACKET_HEADROOM')} (+256, WRITE 21B/READ 9B overhead), ` +
  `windows=${lineOf(limits, 'const UPLOAD_WINDOW')}/${lineOf(limits, 'const DOWNLOAD_WINDOW')} 64/64 (~2MiB in flight, 200ms/100Mbps≈2.5MiB BDP), ` +
  `timeout=${lineOf(limits, 'const REQUEST_TIMEOUT_SECS')} 30s, ` +
  `min-seg=${lineOf(limits, 'const MIN_SEGMENTED_DOWNLOAD')} 2*chunk, dir=4/4, ` +
  `invariant=${lineOf(limits, 'fn window_per_file')} files*w<=64, ` +
  `cfg=${lineOf(limits, 'fn session_config')} max_concurrent_writes=UPLOAD_WINDOW @${P.session}:${lineOf(session, 'new_with_config')}; ` +
  `plan=${lineOf(limits, 'fn plan_segments')} div_ceil(x3) contiguous (offset,len), ` +
  `gate=${P.transfer}:${lineOf(transfer, 'if total < MIN_SEGMENTED_DOWNLOAD')} seq<=1seg, ` +
  `range=${P.transfer}:${lineOf(transfer, 'async fn download_range')} per-seg sftp.open+seek(Start) x2, short-read=${lineOf(transfer, 'let want = usize::try_from')}, no-Mutex-in-prod; ` +
  `single-READ=${P.transfer}:${lineOf(transfer, 'pub(crate) trait TransferObserver')} doc 分块/往返时延, N handles = N READ; ` +
  `observer=${P.transfer}:${traitAt < 0 ? -1 : lineOf(transfer, 'pub(crate) trait TransferObserver')} advance+cancelled, cancel@chunk-boundary=${lineOf(transfer, 'fn guard(')}, ui-free(no gpui/winit/EventProxy), ui-impl=${P.sftp}:${lineOf(sftp, 'impl TransferObserver for TaskContext')} +WakeFn:${lineOf(sftp, 'pub(crate) type WakeFn')}; ` +
  `upload=1-handle open_with_flags(CREATE|TRUNCATE|WRITE)+shutdown, cross-plat=AsyncSeek+AsyncWrite, #[cfg(]=test-only`,
);

probe.done();
