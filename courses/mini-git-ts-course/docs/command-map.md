# 日常命令 → 内部机制对照表

把日常 git 命令钉回你亲手写过的机制。正本在[第 12 章](./12-end-to-end)的对照表;本表补充底层命令一列,供回查。未实现的行为(如 `--force`、refspec)见[差异附录](./divergence)。

## Porcelain(日常命令)

| 日常命令 | 底下发生了什么 | mini-git 对应物 | 章节 |
|---|---|---|---|
| git init | 建 .git 骨架:objects、refs/heads、HEAD | `initRepo` / `initRepoBare` | [第 2 章](./02-content-addressed-store) |
| git add | 文件内容做成 blob 落对象库,index 登记「路径 → 对象名」 | `writeObject` + `writeIndex` | [第 2 章](./02-content-addressed-store) / [第 5 章](./05-index-file) |
| git commit | 暂存区清单冻结成 tree,包一层 commit 对象,当前分支引用前移 | `writeTreeFromIndex` → `commitTree` → `updateRef` | [第 4 章](./04-commit-dag) / [第 6 章](./06-refs-branches) |
| git status | 工作区、暂存区、HEAD 三态两两比对 | `classifyStatus` | [第 5 章](./05-index-file) |
| git diff | 两份文本各摊成行,LCS 求编辑脚本,裁成 hunk | `diffLines` + `renderUnified` | [第 7 章](./07-line-diff) |
| git branch | 往 refs/heads 写一个 41 字节的小文件 | `updateRef` + `listBranches` | [第 6 章](./06-refs-branches) |
| git checkout | 解析目标(分支名或哈希),按其 tree 检出工作区与 index,改 HEAD | `resolveHead` + `restoreToTree` + `attachHead`/`detachHead` | [第 6 章](./06-refs-branches) |
| git merge | merge-base 找 base;一方可达自另一方则 fast-forward 挪引用,否则三方合并产双父提交 | `mergeBase`/`isAncestor` + `mergeCommits` | [第 8 章](./08-merge-base) / [第 9 章](./09-three-way-merge) |
| git pull | 先 fetch,再做一次整合(现行默认 `--ff-only`,merge 是 `--no-rebase` 一档) | `fetchObjects` + 第 8-9 章判定与合并 | [第 11 章](./11-sync-operations) |
| git push | 新尖端的可达闭包送给对端 bare 仓库;服务端量 isAncestor,非快进拒绝 | `pushObjects` + 服务端把关 | [第 11 章](./11-sync-operations) |
| git clone | 引用发现、全量拉对象、检出、重建清单 | `cloneRepo`(握手来自第 10 章) | [第 11 章](./11-sync-operations) |
| git fetch | 按对端引用清单算缺失对象,搬进对象库,只前移 remote-tracking 引用 | `discoverRefs` + `fetchObjects` | [第 10 章](./10-wire-protocol) / [第 11 章](./11-sync-operations) |

## Plumbing(底层命令)

mini-git 全书造的正是这一层;Porcelain 是它们的组合。

| 底层命令 | 做什么 | mini-git 对应物 | 章节 |
|---|---|---|---|
| git hash-object | 「类型 + 长度 + 内容」取 SHA-1,可落盘 | `hashObject` / `writeObject` | [第 2 章](./02-content-addressed-store) |
| git cat-file | 按名字读回对象(类型或原文) | `readObject` | [第 2 章](./02-content-addressed-store) |
| git write-tree | 把暂存区清单拼成 tree 对象图 | `writeTree` / `writeTreeFromIndex` | [第 3 章](./03-tree-snapshots) / [第 5 章](./05-index-file) |
| git commit-tree | 造一笔提交对象(tree、parent、身份、消息) | `commitTree` | [第 4 章](./04-commit-dag) |
| git update-ref | 读改一个引用文件 | `readRef` / `updateRef` | [第 6 章](./06-refs-branches) |
| git rev-parse | 把名字(HEAD、分支)解析成哈希 | `resolveHead` | [第 6 章](./06-refs-branches) |
| git merge-base | 两笔提交的最近公共祖先 | `mergeBase` / `isAncestor` | [第 8 章](./08-merge-base) |
| git ls-remote | 列出对端引用清单(不下载任何对象) | `discoverRefs` | [第 10 章](./10-wire-protocol) |
| git log | 从起点沿 parent 边现算遍历 | `logWalk` | [第 4 章](./04-commit-dag) |
