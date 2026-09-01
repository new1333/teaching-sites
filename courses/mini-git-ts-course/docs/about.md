# 关于本课程

**git add 之后、push 之前,.git 里到底发生了什么?一条命令如何变成一堆对象和引用?**

这是全书的主线问题。十二个章节就是它的答案:每章实现一块机制,最后你手里有一个自己写的 mini-git——它的对象能被真 git 直接读取。

## 课程由来

课程由主题「git 原理:使用 TypeScript 实现一个 git」生成为 principle-reimpl 形态:不做源码走读,而是从零重实现。全书 12 章(12/12 完成),主线是本地完整版加远端同步;packfile、rebase 等未实现能力集中在[差异附录](./divergence)诚实登记。

每章的节奏相同:先看到日常 git 的一个现象,再把机制拆成可验证的最小实现,最后用真 git 对拍。全部代码、测试与命令输出都取自随课程交付的 companion 工程(`companion/`),门槛命令是 `pnpm typecheck` 与 `pnpm test`(222 项测试)。

## 能力阶梯

- 学完第 1 章,你能解剖任意仓库的 .git 目录,把 git add/commit 分解为工作区、暂存区、对象库之间的搬运。
- 学完第 2 章,你能实现 mini-git init/hash-object/cat-file,任意文件的哈希与真 git 完全一致。
- 学完第 3 章,你能从零掌握 Buffer 字节操作,编码并解析 tree 二进制格式,实现 write-tree 与整树检出。
- 学完第 4 章,你能实现 commit 对象读写与 log 遍历,解释提交哈希为何改一行历史就全变。
- 学完第 5 章,你能解析并生成 index v2 二进制格式,实现 mini-git add/status,三态判定与 git status 同口径。
- 学完第 6 章,你能用文件操作实现引用读写、分支创建切换与第一个 porcelain 级 mini-git commit。
- 学完第 7 章,你能实现行级 LCS diff 与 unified diff 输出,mini-git diff 能对任意两次改动给出 hunk。
- 学完第 8 章,你能实现可达性与最近公共祖先,会判定 fast-forward,为合并找到 base。
- 学完第 9 章,你能实现三方文件合并与冲突标记,mini-git merge 产出双父提交或冲突现场。
- 学完第 10 章,你能实现 pkt-line 帧编解码与最小引用发现服务,mini-git ls-remote 能列出对端引用。
- 学完第 11 章,你能实现对象枚举与传输,mini-git fetch/push/clone 打通,说清远端引用与本地分支的分野。
- 学完第 12 章,你能用真 git 读取 mini-git 仓库完成互操作对拍,把全书机制收口成日常命令地图。

## 读者画像

会写日常 TypeScript,用过 Node 的 crypto/zlib 内置库;对 .git 内部结构、二进制格式解析、从零搭带测试的工程都是零基础——课程从 Buffer 和字节偏移讲起,分支与合并也只假设你见过现象。详见各章开篇的「你多半撞见过」。

## 怎么跑

```bash
cd companion
pnpm install
pnpm test        # 222 项测试,含与真 git 的互操作对拍(有 git 才跑,无 git 显式跳过)
pnpm mini-git --help
```
