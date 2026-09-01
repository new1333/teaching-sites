# mini-git 与真 git 的差异

正文每处「mini-git 从简/不实现」的集中登记。分两类:**简化项**(mini-git 换了一种更简单的做法)与**未实现项**(真 git 有、mini-git 没造)。每条注明出处章节;对拍口径以各章正文为准。

## 未实现项

| 未实现能力 | 真 git 那边是什么 | mini-git 现状 | 出处 |
|---|---|---|---|
| packfile 与 delta 压缩 | 对象打包成 pack + idx,相近对象存增量,`git gc` 负责整理 | 全书只做松散对象,一个对象一个文件 | [第 2 章](./02-content-addressed-store)、[第 11 章](./11-sync-operations) |
| 多轮协商与 want/have 对话 | 引用发现之后还有能力协商、多轮 want/have、side-band 进度 | 一轮定案:清单 → 请求 → 判词 | [第 10 章](./10-wire-protocol)、[第 11 章](./11-sync-operations) |
| rebase / cherry-pick / amend | 提交图上的重放与改写 | 未造;第 4 章只演示了改写历史的哈希雪崩 | [第 4 章](./04-commit-dag)、[第 12 章](./12-end-to-end) |
| reflog 与 gc | 引用移动的流水账;`gc` 清理不可达对象,reflog 兜底 30/90 天 | 不写 reflog,游离提交无兜底(可达性判定与真 git 一致) | [第 8 章](./08-merge-base) |
| submodule / gitlink(160000) | 嵌套仓库挂成 tree 条目 | 不产不解 | [第 3 章](./03-tree-snapshots) |
| 符号链接对象(120000) | tree 条目的一种模式 | 不产不解 | [第 3 章](./03-tree-snapshots) |
| tag 引用 | refs/tags 与指向 tag 对象 | 只认 refs/heads;广告也只列分支 | [第 6 章](./06-refs-branches)、[第 10 章](./10-wire-protocol) |
| 冲突的 index 三阶段(stage 1/2/3) | 冲突路径挂三条条目,`git ls-files -u` 可查 | index 只登记带标记稿单份,flags 高 4 位非零判损坏 | [第 5 章](./05-index-file)、[第 9 章](./09-three-way-merge) |
| MERGE_HEAD 与冲突收尾 | 冲突解决后的提交仍是 merge(双父) | 不写 MERGE_HEAD,收尾提交是单父 | [第 9 章](./09-three-way-merge) |
| refspec 与 `--force` | push/fetch 可指定映射与强推 | 无 refspec;push 只有 ff 一档,非快进即拒 | [第 11 章](./11-sync-operations) |

## 简化项(做法不同,口径已对拍或声明)

| 方面 | 真 git | mini-git | 出处 |
|---|---|---|---|
| 对象名输入 | 支持缩写(前缀即可) | 只认完整 40 位 | [第 2 章](./02-content-addressed-store)、[第 6 章](./06-refs-branches) |
| 仓库发现 | 向上层目录找 .git | 只认当前目录 | [第 2 章](./02-content-addressed-store) |
| init 骨架 | 完整布局(config/hooks/info 等) | 只建 objects、refs/heads、HEAD 三件 | [第 2 章](./02-content-addressed-store) |
| 可执行位 | 平台相关 | Windows 下恒 100644,检出不设执行位 | [第 3 章](./03-tree-snapshots) |
| 提交可选头 | gpgsig、encoding 等 | 不解析,遇到判损坏 | [第 4 章](./04-commit-dag) |
| log 日期/双父行 | 换算日历,双父多打 Merge 行 | 打 Unix 秒原文;同刻次序自定(发现序、父一先于父二) | [第 4 章](./04-commit-dag) |
| 身份来源 | user.name/user.email 配置链 | 环境变量,缺省 mini-git;committer 恒等于 author | [第 4 章](./04-commit-dag) |
| write-tree 无 index 时 | 写空树 `4b825dc6…` | 退回整目录扫描(第 3 章老路) | [第 5 章](./05-index-file) |
| index 扩展与 stat | 读写 TREE 等扩展;stat 字段用于跳步 | 不读不写扩展;stat 存而不用,比对老实重算 | [第 5 章](./05-index-file) |
| add 范围 | 展开目录、可暂存删除 | 只收文件路径 | [第 5 章](./05-index-file) |
| status 输出 | 英文三段 + 分支行 | 中文简化段 | [第 5 章](./05-index-file) |
| checkout 安全 | 脏改动会被覆盖时拒绝 | 无条件覆盖被跟踪文件,未跟踪保留 | [第 6 章](./06-refs-branches) |
| commit 空清单 | 报「nothing to commit」 | 提交空树(行为被测试钉死) | [第 6 章](./06-refs-branches) |
| branch 起点 | `branch <name> <start>` | 不收起点参数 | [第 6 章](./06-refs-branches) |
| packed-refs | 引用可打包 | 只有松散引用文件 | [第 6 章](./06-refs-branches) |
| diff 算法 | 默认 Myers(可换 patience/histogram) | 朴素 LCS 动态规划;平手取「删在加前」 | [第 7 章](./07-line-diff) |
| diff 输出 | index 行、函数名提示、`\ No newline`、二进制检测、-U | 都不做;上下文固定 3;文件尾假定有换行 | [第 7 章](./07-line-diff) |
| merge-base 多候选 | 筛 best,规范 unspecified | 取 committer 时间戳最新、同刻哈希字典序最小;无 `--all` | [第 8 章](./08-merge-base) |
| merge-base 出口 | `--is-ancestor` 用退出码,无祖先进位 1 | 文字作答,无公共祖先抛可读的错 | [第 8 章](./08-merge-base) |
| 冲突块细化 | zealous refine、相邻冲突归并 | 不做;判定表「严格在前才自动、相触即冲突」 | [第 9 章](./09-three-way-merge) |
| 冲突报告 | 退出码 = 冲突块数 | 文本报告(命令层只产文本的既有口径) | [第 9 章](./09-three-way-merge) |
| 合并前提检查 | 未提交改动可能阻止合并 | 不检查,无条件合并;模式冲突取 ours | [第 9 章](./09-three-way-merge) |
| 协议承载 | SSH / HTTP(S) / git://(9418) | 自有裸 TCP,默认 9419,不与真 git 互通 | [第 10 章](./10-wire-protocol) |
| 能力协商 | 引用行带 NUL + capabilities | 不发 | [第 10 章](./10-wire-protocol) |
| 对象线上形状 | packfile | 自定帧:「类型 哈希 字节数」头 + 体帧,收方重算哈希对账 | [第 11 章](./11-sync-operations) |
| 被拒推送 | 协商期即拒,对象不过线 | 对象先落库再判 ff,被拒对象成 unreachable | [第 11 章](./11-sync-operations) |
| 推检出分支 | 默认拒收非当前分支的推送 | 不设卡 | [第 11 章](./11-sync-operations) |
| 远端命名 | `remote.<名>.fetch` 配置 | 从地址折成 `<主机>-<端口>` | [第 11 章](./11-sync-operations) |
| 服务端缓冲 | 流式 | 请求整段内存缓冲,5 秒无下文送客 | [第 11 章](./11-sync-operations) |

## 对拍口径备注

- 与真 git 的对拍一律用 `git -c core.autocrlf=false` 或 `--no-filters`,避开行尾过滤(Windows 下尤其);金样哈希全部由固定输入(同身份、同时间戳)固化,跨机器逐字符成立。
- `pull = fetch + merge` 的流行说法按现行 git-pull 文档校准:默认档是 `--ff-only`,merge 是 `--no-rebase` 一档(见[第 12 章](./12-end-to-end))。
- 重复行加平手口径的极端构造下,行对齐可能挪位,连「干净/冲突」判定都可能翻转(第 7 章 diff 口径的下游效应)。
