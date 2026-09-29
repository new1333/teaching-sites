// 第 12 章 lua-config：Lua 配置沙界、诊断作用域与双 require 兼容。
// 对锁定 clone（.course/repo @ 360613aa）只读断言本章 milestone：
//  - vendored Lua 5.4 依赖：mlua 以 workspace 依赖钉 lua54+vendored+serialize+send；
//  - capture_diagnostics 作用域结构：thread-local scope 栈、三类字段级诊断、
//    Deny/Warn 错误语义、无作用域时降级 log、Lua 路径的接线与全量收集；
//  - pebrel/nebula 双 require 同表兼容：注册代码、rawequal 测试与官方手册句；
//  - 沙界：模块面不含网络入口，手册声明不下载/不执行远端配置。
// 所有断言取自锁定 ref 上的静态文件内容，不执行目标仓库代码。
import { requireRepo, readRepoFile, repoFileExists, makeProbe } from './lib/repo.js';

const probe = makeProbe('lua-config');
requireRepo();

const norm = (s) => s.replace(/\s+/g, ' ');
// 从 Rust 源切出「某个顶层项的完整体」：从 header 起到下一个顶层声明前。
function itemBody(src, header) {
  const start = src.indexOf(header);
  if (start < 0) return null;
  const rest = src.slice(start);
  const m = rest.slice(1).search(/\n(pub fn |pub trait |#\[macro_export\]|#\[rustfmt|#\[cfg\(test\]\])/);
  return m < 0 ? rest : rest.slice(0, m + 1);
}

// ---- 0. 本章 relevant_files 存在 ------------------------------------------------
for (const f of ['nebula_config/src/lib.rs', 'nebula_app/src/config/lua/runtime.rs', 'docs/lua-configuration.md']) {
  probe.check(`relevant_file 存在：${f}`, repoFileExists(f));
}

// ---- A. vendored Lua 5.4 依赖 ----------------------------------------------------
const EXPECTED_MLUA_VERSION = '0.11.4';
const EXPECTED_FEATURES = ['lua54', 'vendored', 'serialize', 'send'];

const cargo = readRepoFile('Cargo.toml');
const wsDeps = cargo.slice(cargo.indexOf('[workspace.dependencies]'));
const mluaLine = wsDeps.slice(0, wsDeps.indexOf('\n[')).split(/\r?\n/).find((l) => /^mlua = \{/.test(l));
const mluaVersion = mluaLine?.match(/version\s*=\s*"([^"]+)"/)?.[1];
const mluaFeatures = [...(mluaLine?.match(/features\s*=\s*\[([^\]]*)\]/)?.[1] || '')?.matchAll(/"([^"]+)"/g) || []]
  .map((m) => m[1]);

probe.check(
  `mlua 声明在 [workspace.dependencies]，version = "${EXPECTED_MLUA_VERSION}"（实测 ${mluaVersion ?? '缺失'}）`,
  mluaVersion === EXPECTED_MLUA_VERSION,
  `实测行：${mluaLine ?? '未找到'}`,
);
const featsOk = mluaFeatures.length === EXPECTED_FEATURES.length
  && EXPECTED_FEATURES.every((f) => mluaFeatures.includes(f));
probe.check(
  `mlua features 恰为 ${EXPECTED_FEATURES.join('/')}（实测 [${mluaFeatures.join(', ')}]）——vendored 把 Lua 5.4 从源码编进二进制，serialize 打通 serde 桥`,
  featsOk,
  `实测：[${mluaFeatures.join(', ')}]`,
);
const appCargo = readRepoFile('nebula_app/Cargo.toml');
const appMluaLines = appCargo.split(/\r?\n/).filter((l) => /^mlua/m.test(l));
probe.check(
  'nebula_app 以 `mlua.workspace = true` 继承 workspace 声明（features 单一来源，无 per-crate 覆盖）',
  appMluaLines.length === 1 && /^\s*mlua\.workspace\s*=\s*true\s*$/.test(appMluaLines[0]),
  appMluaLines.join(' ; '),
);

// ---- B. capture_diagnostics 作用域结构（nebula_config/src/lib.rs）-----------------
const lib = readRepoFile('nebula_config/src/lib.rs');

probe.check(
  'capture_diagnostics 入口签名（空白归一后逐字）：(policy: UnknownFieldPolicy, operation: impl FnOnce() -> T) -> (T, Vec<ConfigDiagnostic>)',
  norm(lib).includes(
    'pub fn capture_diagnostics<T>( policy: UnknownFieldPolicy, operation: impl FnOnce() -> T, ) -> (T, Vec<ConfigDiagnostic>)',
  ),
);
probe.check(
  '作用域载体是 thread-local 栈：DIAGNOSTIC_SCOPES: RefCell<Vec<DiagnosticScope>>',
  /DIAGNOSTIC_SCOPES: RefCell<Vec<DiagnosticScope>>/.test(lib),
);
const captureBody = itemBody(lib, 'pub fn capture_diagnostics<T>');
const guardRegion = itemBody(lib, 'impl DiagnosticGuard');
probe.check(
  '进入作用域即 push（携带 policy），guard 交还时 pop 并取出收集到的诊断',
  !!captureBody && !!guardRegion
    && captureBody.includes('push(DiagnosticScope { unknown_fields: policy, diagnostics: Vec::new() })')
    && guardRegion.includes('pop().map(|scope| scope.diagnostics)'),
);
probe.check(
  'panic 安全：DiagnosticGuard 实现 Drop，异常退出也弹栈，不污染线程后续作用域',
  /impl Drop for DiagnosticGuard/.test(lib) && /if self\.active \{/.test(itemBody(lib, 'impl Drop for DiagnosticGuard') || ''),
);
const kindVariants = (lib.match(/pub enum DiagnosticKind\s*\{([^}]*)\}/)?.[1] || '')
  .split(/\r?\n/).map((l) => l.trim().replace(/,$/, '').split(':')[0]).filter(Boolean);
probe.check(
  `字段级类别恰为三类 UnknownField/DeprecatedField/InvalidValue（实测 ${kindVariants.join('/')}）`,
  kindVariants.length === 3 && ['UnknownField', 'DeprecatedField', 'InvalidValue'].every((v) => kindVariants.includes(v)),
  kindVariants.join('/'),
);
const reportFns = [
  ['report_unknown_field', 'DiagnosticKind::UnknownField', 'log::warn!', 'error: scope.unknown_fields == UnknownFieldPolicy::Deny'],
  ['report_deprecated_field', 'DiagnosticKind::DeprecatedField', 'log::warn!', 'error: false'],
  ['report_invalid_value', 'DiagnosticKind::InvalidValue', 'log::error!', 'error: true'],
];
for (const [fn, kind, logCall, errorExpr] of reportFns) {
  const body = norm(itemBody(lib, `pub fn ${fn}`) || '');
  probe.check(
    `${fn}：推入 ${kind.replace('DiagnosticKind::', '')} 诊断、携带 field: Some(field.to_owned())、错误语义 ${errorExpr}、无作用域时降级 ${logCall}`,
    !!body && body.includes(kind) && body.includes('field: Some(field.to_owned())')
      && body.includes(errorExpr) && body.includes(`if !captured { ${logCall}(`),
  );
}
probe.check(
  'lib.rs 测试 captures_unknown_and_invalid_fields_without_logging：unknown 与 invalid 双诊断同时收集且均判 error',
  lib.includes('fn captures_unknown_and_invalid_fields_without_logging()')
    && norm(lib).includes('diagnostic.kind == DiagnosticKind::UnknownField && diagnostic.field.as_deref() == Some("unknown") && diagnostic.is_error()')
    && norm(lib).includes('diagnostic.kind == DiagnosticKind::InvalidValue && diagnostic.field.as_deref() == Some("value") && diagnostic.is_error()'),
);

// ---- C. Lua 路径接线（nebula_app/src/config/lua/mod.rs）---------------------------
const luaMod = readRepoFile('nebula_app/src/config/lua/mod.rs');
probe.check(
  'validate_config_value 按 builder strict 选策略：strict→Deny、普通 table→Warn，capture_diagnostics 包住 UiConfig::deserialize',
  norm(luaMod).includes('let policy = if strict { UnknownFieldPolicy::Deny } else { UnknownFieldPolicy::Warn };')
    && norm(luaMod).includes('capture_diagnostics(policy, || UiConfig::deserialize(value))'),
);
probe.check(
  '全量收集而非首错即停：error 诊断 filter 成 Vec 整体作为 LuaConfigError::Diagnostics 返回，Display 逐条枚举',
  luaMod.includes('diagnostics.iter().filter(|diagnostic| diagnostic.is_error()).cloned().collect()')
    && luaMod.includes('LuaConfigError::Diagnostics(errors)')
    && luaMod.includes('for (index, diagnostic) in diagnostics.iter().enumerate()'),
);

// ---- D. SerdeReplace 局部替换（lib.rs + nebula_config_derive）---------------------
probe.check(
  'SerdeReplace trait 签名：fn replace(&mut self, value: Value) -> Result<(), Box<dyn Error>>',
  lib.includes('fn replace(&mut self, value: Value) -> Result<(), Box<dyn Error>>'),
);
probe.check(
  'HashMap 实现是合并而非整体替换：for (key, value) in hashmap { self.insert(key, value); } —— 补丁里没出现的键原样保留',
  norm(lib).includes('for (key, value) in hashmap { self.insert(key, value); }'),
);
probe.check(
  'Option 实现委托内层：Some(inner) => inner.replace(value)，None 时才整体反序列化',
  lib.includes('Some(inner) => inner.replace(value),') && lib.includes('None => replace_simple(self, value),'),
);
probe.check(
  '测试 replace_option：先替换 a=1 再替换 b=2，终值 Some(ReplaceOption { a: 1, b: 2 })——只动出现的字段',
  lib.includes('fn replace_option()')
    && lib.includes('assert_eq!(subject, Some(ReplaceOption { a: 1, b: 2 }));'),
);
const deStruct = readRepoFile('nebula_config_derive/src/config_deserialize/de_struct.rs');
const deriveReplace = readRepoFile('nebula_config_derive/src/serde_replace.rs');
probe.check(
  'derive 宏生成逐字段发射器：de_struct.rs 对 unused 键发 report_unknown_field(key)、字段反序列化失败发 report_invalid_value(literal)、废弃字段发 report_deprecated_field(literal)',
  deStruct.includes('nebula_config::report_unknown_field(#LOG_TARGET, key);')
    && deStruct.includes('nebula_config::report_invalid_value(#LOG_TARGET, #literal, &err.to_string());')
    && deStruct.includes('nebula_config::report_deprecated_field(#LOG_TARGET, #literal, #message);'),
);
probe.check(
  'serde_replace.rs 为命名字段结构生成递归 replace（pub fn derive_recursive），impl nebula_config::SerdeReplace',
  deriveReplace.includes('fn derive_recursive') && deriveReplace.includes('nebula_config::SerdeReplace for #ident'),
);

// ---- E. pebrel/nebula 双 require 同表兼容（runtime.rs + 官方手册）-----------------
const runtime = readRepoFile('nebula_app/src/config/lua/runtime.rs');
probe.check(
  'package.loaded 同一 module 句柄双注册：loaded.set("pebrel", module.clone()) 与 loaded.set("nebula", module) 相邻两行',
  /loaded\.set\("pebrel", module\.clone\(\)\)\?;\s*loaded\.set\("nebula", module\)\?;/.test(runtime),
);
probe.check(
  '测试 pebrel_and_legacy_require_share_the_same_api_and_reload_state：rawequal(pebrel, legacy) 断言同表，reload 状态跨名共享',
  runtime.includes('fn pebrel_and_legacy_require_share_the_same_api_and_reload_state()')
    && runtime.includes('rawequal(pebrel, legacy)'),
);
const manual = readRepoFile('docs/lua-configuration.md');
probe.check(
  '官方手册句逐字：Existing `require \'nebula\'` calls resolve to the same API table',
  manual.includes("Existing `require 'nebula'` calls resolve to the same API table"),
);

// ---- F. Lua 配置沙界（手册声明 + 模块面无网络入口）-------------------------------
const manualNorm = norm(manual);
probe.check(
  '手册三句沙界声明（空白归一逐字）：vendored Lua 5.4 / executable local code / does not download or execute remote configuration',
  manualNorm.includes('Pebrel uses vendored Lua 5.4 for programmable configuration.')
    && manualNorm.includes('Lua configuration is executable local code.')
    && manualNorm.includes('Pebrel does not download or execute remote configuration during discovery.'),
);
const EXPECTED_SURFACE = [
  'config_file', 'config_dir', 'home_dir', 'executable_dir', 'version', 'target_triple',
  'platform', 'array', 'reload_configuration', 'add_to_config_reload_watch_list', 'config_builder',
];
const surfaceLiterals = [...runtime.matchAll(/module\.set\(\s*"([^"]+)"/g)].map((m) => m[1]);
const surfaceOk = surfaceLiterals.length === EXPECTED_SURFACE.length
  && EXPECTED_SURFACE.every((k) => surfaceLiterals.includes(k));
const logFnsOk = ['log_error', 'log_warn', 'log_info'].every((n) => runtime.includes(`"${n}"`));
const networkKeys = [...surfaceLiterals, 'log_error', 'log_warn', 'log_info']
  .filter((k) => /net|http|fetch|socket|request|download|url/i.test(k));
probe.check(
  `暴露面 = 11 个字面键 + log_error/log_warn/log_info 共 14 个入口（实测 ${surfaceLiterals.length}+3），无任何网络类入口`,
  surfaceOk && logFnsOk && networkKeys.length === 0,
  `字面键：[${surfaceLiterals.join(', ')}]；网络键：[${networkKeys.join(', ')}]`,
);

// ---- G. 离线校验入口（cli.rs）----------------------------------------------------
const cli = readRepoFile('nebula_app/src/cli.rs');
probe.check(
  'cli.rs：ConfigCommand::Check 文档注释 "Validate a Lua, TOML, or YAML configuration without opening the GUI."',
  cli.includes('/// Validate a Lua, TOML, or YAML configuration without opening the GUI.')
    && cli.includes('Check(ConfigCheckOptions),'),
);

// ---- 摘要（milestone_verify：输出沙界与诊断证据）--------------------------------
console.log(
  `summary [lua-config] mlua=${mluaVersion} features=[${mluaFeatures.join(',')}]; ` +
  `diagnostic kinds=${kindVariants.join('/')}; ` +
  `package.loaded: pebrel+nebula -> same table (rawequal test); ` +
  `module surface=${surfaceLiterals.length + 3} entries, network=0`,
);

probe.done();
