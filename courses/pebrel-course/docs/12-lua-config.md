---
title: 第 12 章 Lua 配置：本地执行、产物可校验
---

# Lua 配置：本地执行、产物可校验

## 工具箱

配置这条线要调的旧积木，两块都产自同一片地基（第 1 章）。

- **命名双轨** — 引用代码用 crate 现名 nebula_*，讲产品用 Pebrel；旧前缀与旧名字按兼容层理解，这里的关键形态是「旧名字还活着，且收敛在一处」。
- **所有权地图** — 落点查表入口：拿改动描述对 architecture.md 的 owns / must-not-become 两栏，读出该落在哪个 crate、不许变成什么。

有这两块，「配置机制住在哪、旧名字怎么处理」两个问题就都有查表答案。

## 钩子：一次拼错的保存

打开 pebrel.lua，想加大回滚缓冲，把 scrolling 拼成了 scolling，保存。终端没有崩，也没有静默吞掉这个键——报错指名道姓：这个字段不认识。从旧版本抄来的一段配置里还留着顶层的 shell 字段，报错换了个口吻：它已废弃，应改用 terminal.shell，另附一句「跑 nebula migrate 可自动迁移」。更舒服的是，几处错误在同一条消息里一起列出，不是修一个、再见一个。改完再存，新配置直接生效，全程不用重启——这就是配置的热更新。

这一连串体验背后是三个容易想当然的判断。可编程配置是不是等于「什么代码都能执行」？校验是不是天然只能报出第一个错误？热更新是不是必须整文件重载一遍？三个判断都错，但每个都错得很体面——它们的反例全部写在锁定源码里，本章逐一取证。

先拿所有权地图对一次账。architecture.md 给 nebula_config 与 nebula_config_derive 的合同有两栏。owns 一栏写 Configuration abstractions and derives；must not become 一栏写 Application orchestration——配置抽象归 domain crate，不许长成应用编排器。Lua 虚拟机的接线则住在 nebula_app/src/config/lua。一条机制、两个 crate，本章来回走这两处。

## 原理：先把边界画圆，再谈管道

### Lua 配置沙界：执行的是本地文件，不是任意来源

**Lua 配置沙界**——Lua 配置的执行边界：只执行本地受信配置文件，配置发现过程中不下载、不执行任何远端代码。先看这条边是用什么料画出来的。

依赖声明只有一行：

```toml
# Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:Cargo.toml:66
mlua = { version = "0.11.4", features = ["lua54", "vendored", "serialize", "send"] }
```

四个 features 各司其职：lua54 锁定语言版本；vendored 把一份 Lua 5.4 的源码直接编进 Pebrel 的二进制，不依赖系统里装没装 Lua；serialize 打通 Lua 值与 serde 类型的转换桥；send 让 VM 的类型能跨线程移动。nebula_app 用 mlua.workspace = true 继承这一行（nebula_app/Cargo.toml:99），features 只此一个来源，没有第二个 crate 另行裁剪。

边界本身写在官方手册的开篇（docs/lua-configuration.md）。原文三句话：

```markdown
# Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:docs/lua-configuration.md:3-10
Pebrel uses vendored Lua 5.4 for programmable configuration. Load its API with
`require 'pebrel'` and generate a configuration with `pebrel config init`.
Existing `require 'nebula'` calls resolve to the same API table, so old Lua
configurations continue to work.

Lua configuration is executable local code. Only use configuration files and
modules that you trust. Pebrel does not download or execute remote
configuration during discovery.
```

「可编程配置等于可以执行任意来源代码」这个直觉，有一半是对的。先替它把话说完：vendored Lua 5.4 是带标准库的完整语言，配置文件就是程序，这一半没法否认。但「任意来源」恰好不成立——边界画在代码的来处，不在代码的能力上。手册第二段说得直白：配置是可执行的本地代码，只用你信任的文件与模块；发现过程不下载、不执行远端配置。这不是一个「塞进不受信代码也安全」的硬沙箱，而是一份「执行本地受信代码」的边界声明，受信责任明交给用户。

Pebrel 自己注入 Lua 环境的那张模块表，暴露面是可清点的——下表十四个入口，没有一个网络类的名字：

```text
# 模块暴露面清点（探针口径：11 个字面键 + 3 个日志函数）
config_file  config_dir  home_dir  executable_dir  version  target_triple
platform  array  reload_configuration  add_to_config_reload_watch_list
config_builder
log_error  log_warn  log_info
```

模块加载也圈在本地。package.path 被前缀上配置文件所在目录（runtime.rs:146-150），require 只在本地路径上搜索；runtime.rs:151-165 还把 searcher 包了一层，凡是 require 成功的本地模块，顺手登记进热更新观察名单。观察名单上限 1024 条（runtime.rs:116-120）。

这张表还有一处命名双轨的漂亮收敛。旧配置写 require 'nebula'，新配置写 require 'pebrel'——两个名字，同一张表：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/config/lua/runtime.rs:143-144
        loaded.set("pebrel", module.clone())?;
        loaded.set("nebula", module)?;
```

相邻两行用的是同一个 module 句柄；clone 只复制表引用，不是两份数据。这与环境变量双前缀的回退链（先读新名、落空读旧名）是两种形态：这里没有回退，两个名字从注册那一刻起就是同一张表。配套测试用 rawequal(pebrel, legacy) 断言同表，再用 pebrel 的名字请求重载、用旧名开 builder，确认重载状态跨名共享（runtime.rs:294-313）。手册那句 Existing `require 'nebula'` calls resolve to the same API table，说的就是这两行。

### 诊断作用域：把 serde 的第一个错误变成一张清单

「校验只能给出第一个错误」——这个直觉的来路很正：serde 的原生行为确实是第一个错误就停，Result 一路问号传播，反序列化器当场返回。错的不是对 serde 的认识，是以为别无选择。

Pebrel 的选择是给反序列化装一个收集器。**诊断作用域**——挂在当前线程上的一个捕获栈：进入作用域后，serde 反序列化过程中发出的字段级报告不再直接进日志，而是推进栈顶的收集器；作用域结束时整批交还。成因就是要「一次收集全部字段错误」；载体是这行 thread-local：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_config/src/lib.rs:42-44
thread_local! {
    static DIAGNOSTIC_SCOPES: RefCell<Vec<DiagnosticScope>> = const { RefCell::new(Vec::new()) };
}
```

入口长这样：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_config/src/lib.rs:69-82
pub fn capture_diagnostics<T>(
    policy: UnknownFieldPolicy,
    operation: impl FnOnce() -> T,
) -> (T, Vec<ConfigDiagnostic>) {
    DIAGNOSTIC_SCOPES.with(|scopes| {
        scopes
            .borrow_mut()
            .push(DiagnosticScope { unknown_fields: policy, diagnostics: Vec::new() });
    });
    let guard = DiagnosticGuard { active: true };
    let result = operation();
    let diagnostics = guard.finish();
    (result, diagnostics)
}
```

push 一个携带 policy 的新作用域，跑完 operation，guard 交还时 pop 并取出整批诊断。栈结构意味着可嵌套：嵌套捕获时报告进的是栈顶（scopes.last_mut()），各层互不串门。guard 还实现了 Drop（lib.rs:59-67）：operation 里 panic 也会弹栈，不污染这条线程后续的作用域。

往栈里推报告的是三个入口，lib.rs:84-135 恰好三段，看一个就够：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_config/src/lib.rs:84-100
pub fn report_unknown_field(target: &'static str, field: &str) {
    let message = format!("Unused config key: {field}");
    let captured = DIAGNOSTIC_SCOPES.with(|scopes| {
        let mut scopes = scopes.borrow_mut();
        let Some(scope) = scopes.last_mut() else { return false };
        scope.diagnostics.push(ConfigDiagnostic {
            kind: DiagnosticKind::UnknownField,
            field: Some(field.to_owned()),
            message: message.clone(),
            error: scope.unknown_fields == UnknownFieldPolicy::Deny,
        });
        true
    });
    if !captured {
        log::warn!(target: target, "{message}");
    }
}
```

注意两端。推入端先看类别。诊断分三类：UnknownField、DeprecatedField、InvalidValue；错误语义各不相同。unknown 字段算不算错，由作用域的 policy 决定（Deny 才算错）；deprecated 字段永远不算错；invalid 值永远算错。取不到作用域的那端：降级成日志输出——前两类降 warn，invalid 降 error。这个降级分支不是摆设。凡在没有作用域的地方反序列化配置，字段报告就走日志；后文自查会回来考它。

谁在反序列化的半路调这三个入口？答案在 derive 宏里。每个配置结构体标注 ConfigDeserialize 后，宏会生成一个不因错误中断的 visitor。这是全量收集的实现核心。字段这一侧的生成代码长这样：反序列化失败就报告、保留默认值，循环继续走向下一个键——Err 被换成报告，而不是向外传播。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_config_derive/src/config_deserialize/de_struct.rs:113-120
    let mut match_assignment_stream = quote! {
        match serde::Deserialize::deserialize(value) {
            Ok(value) => config.#ident = value,
            Err(err) => {
                nebula_config::report_invalid_value(#LOG_TARGET, #literal, &err.to_string());
            },
        }
    };
```

visitor 的骨架同样不中断。认识的键逐个落库，不认识的先进 unused 表；循环走完统一上报，最后永远返回 Ok：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_config_derive/src/config_deserialize/de_struct.rs:48-64
                while let Some((key, value)) = map.next_entry::<String, toml::Value>()? {
                    match key.as_str() {
                        #match_assignments
                        _ => {
                            unused.insert(key, value);
                        },
                    }
                }

                #flatten

                // Report unused keys through the active config diagnostic scope.
                for key in unused.keys() {
                    nebula_config::report_unknown_field(#LOG_TARGET, key);
                }

                Ok(config)
```

废弃字段的报告也由宏生成。标注 #[config(deprecated = "...")] 的字段被赋值时，宏追加一条 report_deprecated_field；消息里带替代建议，也带 nebula migrate 迁移提示（de_struct.rs:147-158）。顶层 shell 就是活例：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/config/ui_config.rs:104-106
    /// Path to a shell program to run on startup.
    #[config(deprecated = "use terminal.shell instead")]
    shell: Option<Program>,
```

开篇那句「已废弃，改用 terminal.shell，可跑 nebula migrate」的报错，出处就是这一行加消息模板。连迁移命令都挂着旧名——命名双轨又留了个签名。

Lua 路径的接线在验证入口处收拢：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/config/lua/mod.rs:106-115
    let value = lua_value_to_toml(lua, value)?;
    let policy = if strict { UnknownFieldPolicy::Deny } else { UnknownFieldPolicy::Warn };
    let (config, diagnostics) = capture_diagnostics(policy, || UiConfig::deserialize(value));
    let config = config.map_err(|error| LuaConfigError::Message(error.to_string()))?;
    let errors: Vec<_> =
        diagnostics.iter().filter(|diagnostic| diagnostic.is_error()).cloned().collect();
    if !errors.is_empty() {
        return Err(LuaConfigError::Diagnostics(errors));
    }
    Ok((config, diagnostics))
```

strict 默认为真。普通返回表按 strict 处理——builder_strict 对无标记的表返回 true（runtime.rs:225-232）；config_builder 同样 strict 起步，set_strict_mode(false) 是唯一的放松开关。错误诊断滤成一个 Vec 整体抛出，打印时逐条枚举：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/config/lua/mod.rs:42-50
            Self::Diagnostics(diagnostics) => {
                for (index, diagnostic) in diagnostics.iter().enumerate() {
                    if index > 0 {
                        formatter.write_str("\n")?;
                    }
                    formatter.write_str(&diagnostic.message)?;
                }
                Ok(())
            },
```

「全量收集」不是修辞，测试把它钉成了断言。同一份输入里塞一个错值加一个陌生键：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_config/src/lib.rs:218-221
        let (_, diagnostics) = capture_diagnostics(UnknownFieldPolicy::Deny, || {
            let value: Value = toml::from_str("value='wrong'\nunknown=1").unwrap();
            Subject::deserialize(value).unwrap()
        });
```

看第二行的 unwrap：反序列化直接 Ok——第一个错误没有中断任何东西——随后两类诊断双双在手。若走 serde 原生路径，'wrong' 就会把 unknown=1 一起埋掉。

这条链的出口是一个不开窗口的命令：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/cli.rs:862-865
#[derive(Subcommand, Debug)]
pub enum ConfigCommand {
    /// Validate a Lua, TOML, or YAML configuration without opening the GUI.
    Check(ConfigCheckOptions),
```

pebrel config check 的实现（config_cli.rs:15-43）只做两件事：发现配置文件、加载并校验。全程是本地文件读写加一个本地 Lua VM，没有窗口、没有网络——沙界声明了不下载远端配置，这条命令自然离线可用。成功输出 Configuration is valid 并列出 require 到的模块；失败退出码 1，错误按上文的 Display 逐条打印。

最后对一次账。诊断捕获住在 nebula_config，翻它的 Cargo.toml，依赖只有 log、serde、toml——没有 mlua。这不是疏忽：按 crate 依赖方向，domain crate 不依赖应用层，于是捕获机制对格式无感；Lua VM 这层应用接线才需要 mlua，所以住在 nebula_app。同一批 report 函数，Lua 路径包进作用域收成清单，TOML 路径没有作用域、降级成日志——一个机制，两个出口，正好把 ownership 合同的那两栏兑现。

### SerdeReplace：补丁只动出现的字段

「热更新必须整文件重载」——这个直觉的合理部分要承认。文件级热重载确实存在，每次保存都重新执行整个 Lua 文件（手册 Transactional Reload 一节）。不成立的是「必须」。整文件通道旁边，还有一条字段级的补丁通道。

**SerdeReplace**——一个补丁 trait：对配置值调用 replace(补丁)，补丁里出现的字段被换新，没出现的字段保持原值。声明只有三行：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_config/src/lib.rs:137-139
pub trait SerdeReplace {
    fn replace(&mut self, value: Value) -> Result<(), Box<dyn Error>>;
}
```

实现按类型分四档。标量与 String 整体反序列化（impl_replace! 宏批量实现，lib.rs:141-164），Vec 同样整体替换（lib.rs:175-179）——这两种类型没有「部分」可言。Option 委托内层：Some(inner) 就把补丁继续打进内层，None 才整体反序列化（lib.rs:181-188）。最有意思的是 HashMap，它是合并而非替换：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_config/src/lib.rs:190-202
impl<'de, T: Deserialize<'de>> SerdeReplace for HashMap<String, T> {
    fn replace(&mut self, value: Value) -> Result<(), Box<dyn Error>> {
        // Deserialize replacement as HashMap.
        let hashmap: HashMap<String, T> = Self::deserialize(value)?;

        // Merge the two HashMaps, replacing existing values.
        for (key, value) in hashmap {
            self.insert(key, value);
        }

        Ok(())
    }
}
```

补丁里没出现的键原样保留——旧键一个不丢。命名字段结构体则由宏生成递归版 replace：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_config_derive/src/serde_replace.rs:55-75
            fn replace(&mut self, value: toml::Value) -> Result<(), Box<dyn std::error::Error>> {
                match value.as_table() {
                    Some(table) => {
                        for (field, next_value) in table {
                            let next_value = next_value.clone();
                            let value = value.clone();

                            match field.as_str() {
                                #replace_arms
                                _ => {
                                    let error = format!("Field \"{}\" does not exist", field);
                                    return Err(error.into());
                                },
                            }
                        }
                    },
                    None => *self = serde::Deserialize::deserialize(value)?,
                }

                Ok(())
            }
```

补丁是表就逐字段下钻、递归 replace；出现结构体里不存在的键，当场报 Field does not exist。两次补丁互不冲掉的证据是一个四行测试：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_config/src/lib.rs:243-251
        let mut subject: Option<ReplaceOption> = None;

        let value: Value = toml::from_str("a=1").unwrap();
        SerdeReplace::replace(&mut subject, value).unwrap();

        let value: Value = toml::from_str("b=2").unwrap();
        SerdeReplace::replace(&mut subject, value).unwrap();

        assert_eq!(subject, Some(ReplaceOption { a: 1, b: 2 }));
```

先打 a=1，再打 b=2，终值两个字段都在——第二次补丁没有把第一次的成果抹掉。这不是习题代码，命令行真在用这条通道：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/cli.rs:1423-1439
    /// Apply CLI config overrides, removing broken ones.
    pub fn override_config(&mut self, config: &mut UiConfig) {
        let mut i = 0;
        while i < self.config_options.len() {
            let (option, parsed) = &self.config_options[i];
            match config.replace(parsed.clone()) {
                Err(err) => {
                    error!(
                        target: LOG_TARGET_IPC_CONFIG,
                        "Unable to override option '{option}': {err}"
                    );
                    self.config_options.swap_remove(i);
                },
                Ok(_) => i += 1,
            }
        }
    }
```

一条命令行覆盖就是一个 TOML 片段，经 config.replace 直接打进现有配置。不重读配置文件，不重建配置树；打不进的覆盖被剔除并记日志。两条热更新通道就此分工。改一个字段走补丁，只动出现的键；改一片配置走整文件代次交换——手册记着它的纪律：

```markdown
# Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:docs/lua-configuration.md:209-213
Configuration parsing and Lua execution run on one serial worker. Rapid file
saves are coalesced, and only the latest successful generation is published.
If Lua syntax, module loading, conversion, or validation fails, Pebrel keeps
the last-known-good `UiConfig` and Lua VM alive. Fixing and saving the file
causes the next valid generation to replace them together.
```

解析与执行在单个串行 worker 上排队，保存风暴被合并成最新一次，失败时上一份可用配置与 Lua VM 原地保留。「必须整文件重载」把这两条通道看漏了一条，又把另一条的失败语义想简单了。

## 演练：在锁定源码上核对

以下操作都在课程的锁定 clone（.course/repo @ 360613aa）上做，全程只读；定向破坏那一步除外，破坏后复原。

1. 先猜再打开根 Cargo.toml 第 66 行：写下你预测的四个 features，再对答案。预期 lua54、vendored、serialize、send；顺带确认 nebula_app/Cargo.toml 里 mlua 只以 workspace = true 出现。
2. 数收敛点：`grep -n "loaded.set" .course/repo/nebula_app/src/config/lua/runtime.rs`。预期恰好 2 行且行号相邻（143 与 144）——双名收敛只此一处，别处再无 loaded.set。
3. 走读三个报告入口。lib.rs:84-135 的 report_unknown_field、report_deprecated_field、report_invalid_value 各看一眼。给它们各写一句话：error 字段何时为 true？无作用域时降级到哪一级日志？
4. 跑本章探针，在课程根目录执行 `node companion/scripts/probe-12-lua-config.mjs`。预期 29 项全 ok：

```text
# companion/scripts/probe-12-lua-config.mjs 运行输出（节选）
ok   [lua-config] mlua 声明在 [workspace.dependencies]，version = "0.11.4"（实测 0.11.4）
ok   [lua-config] 暴露面 = 11 个字面键 + log_error/log_warn/log_info 共 14 个入口（实测 11+3），无任何网络类入口
ok   [lua-config] package.loaded 同一 module 句柄双注册：loaded.set("pebrel", module.clone()) 与 loaded.set("nebula", module) 相邻两行
ok   [lua-config] lib.rs 测试 captures_unknown_and_invalid_fields_without_logging：unknown 与 invalid 双诊断同时收集且均判 error
PASS  [lua-config] 29/29 checks
```

## 验证：先猜，再跑，再破坏

### 纸面推演：一份带两处错的配置

文件 pebrel.lua 只有一行：`return { windwo = {}, scrolling = { history = 'many' } }`。windwo 是陌生键，history 的值类型不对。把它交给 `pebrel config check`（或想象一次保存），先落笔写三个离散预测，再对答案。

- 退出码：0、1、崩溃退出，三选一。
- 错误输出：恰好 1 行、恰好 2 行、更多行，三选一。
- history 这处错会不会把 windwo 这处错遮住：会、不会，二选一。

答案：1；恰好 2 行；不会。普通返回表默认 strict，policy 走 Deny——windwo 报 UnknownField 且判错，history 报 InvalidValue 恒判错；derive 宏生成的 visitor 对每处错误只报告不中断，两条都进 Vec，Display 逐行枚举。若你押了「恰好 1 行」，那是 serde 原生语义的答案，恰好是本章被替换掉的行为。

### 定向破坏：从 features 里删掉一个词

把 .course/repo/Cargo.toml 第 66 行 features 数组里的 "vendored" 删掉。先预言：探针 29 项里恰好几项变红？哪一项必然仍绿？

在课程根目录执行 `node companion/scripts/probe-12-lua-config.mjs`，观察：恰好 1 项红——features 恰为 lua54/vendored/serialize/send 的逐字断言；version = "0.11.4" 的断言仍绿，版本号没被波及。

解释：这项检查守的不是风格偏好，而是「vendored 把 Lua 5.4 从源码编进二进制」这条正文断言与锁定源码逐字一致的事实合同——引用一旦与现实脱钩，机械检查先于读者发现；未动的版本断言不受牵连，说明各项检查各守各的事实。复原并确认：`git -C .course/repo checkout -- Cargo.toml`，重跑探针回到 29/29。

### 变体：给暴露面点名

`grep -n "module.set(" .course/repo/nebula_app/src/config/lua/runtime.rs`。预期字面键 11 处（grep 会打出 12 行——第 12 行是 runtime.rs:133 循环里注册三个 log 函数的那一处，不算字面键）；把 log_error、log_warn、log_info 三个函数名算上，暴露面共 14 个入口。再用 `grep -inE "net|http|fetch|socket|request|download|url"` 过滤这 14 个名字，预期 0 命中。哪天这里冒出一个 fetch 类入口，两个数字会同时变——暴露面清点是沙界最便宜的巡检，不需要读懂任何一个入口的实现。

三项验证各对一条结论：边界可清点——暴露面是数得出来的；收集是全量——错误清单的长短可以精确预言；引用有刚性——正文与源码的一致性由机器看守。

## 自查：换一个输入

1. 有人给你一段抄来的 pebrel.lua，里面 require 了一个名字古怪的本地模块。Lua 配置沙界挡得住它吗？该由谁把关？
2. 同样的拼写错误写进 pebrel.toml（TOML 路径），还能拿到逐字段的错误清单吗？那些字段报告去了哪里？
3. 配置里 env 字段现有 EDITOR = nvim 一项。一条补丁 replace 进 { env = { TERM = "xterm-256color" } }，终值里 EDITOR 还在吗？依据是哪段实现？
4. 一段配置里 require 'pebrel' 与 require 'nebula' 各调用一次 reload_configuration。宿主收到几次待处理的重载请求？

<details>
<summary>参考答案</summary>

1. 挡不住，也不归它挡。沙界管的是代码来处：发现过程不下载远端配置、注入模块无网络入口、require 只搜本地路径。本地模块属于「可执行的本地代码」，信任与否由用户负责。手册那句 Only use configuration files and modules that you trust，说的就是这回事。
2. 拿不到清单。capture_diagnostics 只包在 Lua 路径上（lua/mod.rs:108）；TOML 反序列化没有作用域，三个 report 入口走 if !captured 的降级分支，字段报告散进日志。unknown 与 deprecated 降 warn；invalid 降 error。同一批函数，两个出口。
3. 在。env 的类型是 HashMap<String, String>；replace 对 HashMap 是合并语义——补丁只覆盖出现的键，EDITOR 原样保留。对照：标量与 Vec 才是整体替换。
4. 一次。两个名字注册的是同一张表（runtime.rs:143-144）。reload_configuration 闭包与它背后的 ReloadSignal 也是同一个，两次调用打在同一个 AtomicBool 上；宿主看到的是同一路待处理信号，rawequal 测试顺手钉住了这个性质。

</details>

## 收束：可编程，但可清点

回到开篇的三个想当然。可编程配置没有变成任意代码执行，因为边界画在来源上：vendored Lua 5.4 只吃本地文件，注入的模块面 14 个入口、零网络类名字，require 只在本地路径上找模块。校验没有停在第一个错误，因为字段错误在反序列化途中被逐个报告而不是传播——derive 宏把 serde 的第一个错误换成一张清单，诊断作用域把清单整批收走，交给 `pebrel config check` 逐行打印。热更新不靠整文件硬重载独木桥，因为字段级还有 SerdeReplace 补丁通道，只动出现的字段；整文件那条路也有纪律——串行 worker、合并保存风暴、失败保住上一份可用配置。

本章交出三块积木：Lua 配置沙界，「配置即代码」的执行边界声明；诊断作用域，serde 全程可回溯到具体字段的收集器；SerdeReplace，只替换出现字段的补丁机制。迁移自查三问，以后再遇到「可编程配置」的产品就先答它们：执行边界画在来源还是能力上？字段错误是清单还是第一个错？改一个字段走补丁还是整文件重载？有一问答不上来，先别把配置文件当程序发给别人。
