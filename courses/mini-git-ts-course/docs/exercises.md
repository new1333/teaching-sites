# 练习梯子

八级练习加一个毕业任务,全部长在你已学过的机制上——每级需要的每个原语,正文都示范过。顺序即依赖:对象 → 树 → 提交 → 暂存区 → 引用 → diff → 合并 → 协议。做完一级跑 `pnpm test`,旧测试必须全绿。

## 第 1 级 · cat-file -s

给 `mini-git cat-file` 加 `-s`:只打印对象的字节数(对象体的长度,不含对象头)。空文件应得 0,`hello world\n` 应得 12。

<details>
<summary>要点</summary>

`readObject` 已返回 `{ type, body }`,`body.length` 就是答案;麻烦只在参数解析多认一个开关。回查[第 2 章](./02-content-addressed-store)的 cat-file 实现与对象头结构。

</details>

## 第 2 级 · ls-tree

实现 `mini-git ls-tree <tree哈希>`:一行一条列出某棵 tree 的条目(模式、类型、哈希、名字)。嵌套目录只列本层,不递归。

<details>
<summary>要点</summary>

`parseTree` 拿条目数组,`renderTree` 已经会渲染——它此刻只被 cat-file -p 内部调用;把渲染抽出来接一条命令即可。类型判定(`40000` → tree)回查[第 3 章](./03-tree-snapshots)。

</details>

## 第 3 级 · log --oneline

给 log 加 `--oneline`:每笔提交只打一行——哈希前 7 位加消息首行。短哈希仅用于显示,内部解析仍只认 40 位全名。

<details>
<summary>要点</summary>

`renderLogEntry` 已经产出整段卡片;另写一个短渲染函数,遍历 `logWalk` 的结果。7 位截断是显示层约定,回查[第 4 章](./04-commit-dag)的 log 渲染与第 2 章「只认全名」的口径。

</details>

## 第 4 级 · status --short

给 status 加 `--short`:输出两列状态码加路径(如 `M `、` M`、`??`、`D `),与真 git `status --short` 的两列语义对齐。

<details>
<summary>要点</summary>

`classifyStatus` 已产出四类判定;剩下是四类 → 两列码的映射表。第 1 章用真 git 演示过两列码的形状,第 5 章有三态对比的正本。对拍:同一目录状态跑 `git -c core.autocrlf=false status --short` 比对。

</details>

## 第 5 级 · branch -d

实现 `mini-git branch -d <名字>`:删除分支。当前分支不许删;要删的分支不存在时报可读的错。

<details>
<summary>要点</summary>

分支只是 `refs/heads/` 下的小文件——删除就是删文件。判断「当前分支」用 `readHead` 的符号引用形状。回查[第 6 章](./06-refs-branches)。

</details>

## 第 6 级 · diff 的 -U 参数

给 diff 加 `-U <n>`:上下文行数可调(默认 3)。上下文变窄,相邻改动组的合并判定跟着变——先在纸上预测 `-U 1` 时第 7 章的「间隔 6 行合并」金样会怎样,再跑。

<details>
<summary>要点</summary>

`CONTEXT_LINES` 目前是常量;把它变成 `renderUnified` 的参数,合并判断 `gap <= 2 * CONTEXT_LINES` 的算术原样搬。间隔 6 行的用例在 `-U 1` 下窗口 3+3 变 1+1,该拆开。回查[第 7 章](./07-line-diff)的 hunk 合并。

</details>

## 第 7 级 · merge --no-ff

给 merge 加 `--no-ff`:即便可以 fast-forward 也强制走真合并,产一笔双父提交(第二父指向被合分支)。

<details>
<summary>要点</summary>

`mergeCommits` 的 ff 短路在头两行;加一个开关跳过短路、直接走合并路径即可,base 就是另一方本身。回查[第 8 章](./08-merge-base)的 ff 等价与[第 9 章](./09-three-way-merge)的双父构造。

</details>

## 第 8 级 · ls-remote --heads 以外的过滤

给 ls-remote 加 `--count <n>`:只显示前 n 条引用(按现有顺序,HEAD 第一)。

<details>
<summary>要点</summary>

`discoverRefs` 返回数组,显示层已有一个过滤(零号占位行);再加一层 slice 即可。注意别把 flush 帧之类协议层概念混进显示层。回查[第 10 章](./10-wire-protocol)。

</details>

## 毕业任务 · mini-git rm

实现 `mini-git rm <路径>`:从暂存区清单删除该路径的登记,让下一次 commit 不再包含它;status 此刻应报出「已暂存的删除」。不删工作区文件(那是 `rm --cached` 的口径,正文只承诺这一种)。

完成标准:

1. `pnpm test` 全绿,且为 rm 新增的行为测试先红后绿;
2. 提交后,真 git 在同一仓库跑 `git -c core.autocrlf=false ls-files` 不再列出该路径;
3. 能用一句话说清 rm、add、commit 三个命令各自搬动三区域里的哪一跳。

<details>
<summary>要点</summary>

原语全是现成的:`loadIndex` 读清单、过滤掉目标条目、`saveIndex` 写回。「已暂存的删除」由 `classifyStatus` 自然报出——HEAD 里有、暂存区没有、工作区还有。回查[第 5 章](./05-index-file)的三态对比与[第 6 章](./06-refs-branches)的 commit 流水线。

</details>
