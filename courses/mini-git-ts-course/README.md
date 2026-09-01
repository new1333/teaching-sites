# Git 原理重实现:用 TypeScript 写一个 mini-git

一门 VitePress 课程:从零用 TypeScript 实现一个 mini-git,覆盖对象库、tree/commit 对象、index 暂存区、引用与分支、行级 diff、merge-base、三方合并、pkt-line 传输与 fetch/push/clone;终点产物能被真 git 直接读取。

- 章节状态:12/12 完成,无降级章
- 验证物:companion 工程,`pnpm test` 222 项测试全绿(含与真 git 的互操作对拍;无 git 环境显式跳过)
- 形态:principle-reimpl + code-lab,每章测试先红后绿

## 怎么跑

```bash
# 聚合站(全部课程)
pnpm install
pnpm dev          # 根目录预览,本课程挂载在 /mini-git-ts-course/
pnpm build

# 只看本课程
cd courses/mini-git-ts-course
pnpm install
pnpm docs:dev     # 单课预览 http://localhost:5173
pnpm docs:build   # 单课构建

# 验证物门槛
cd companion
pnpm install
pnpm typecheck    # tsc --noEmit,0 错误
pnpm test         # Vitest,222 项全绿(网络路径固定 127.0.0.1 回环 + 随机端口)
pnpm mini-git --help
```

说明:课程形态为纯 CLI 重实现,无可视/音频资产,可感知成果即 companion 的命令输出与对拍结果——每章「亲手验证」小节给出读者可直接复跑的命令序列。

## 章节目录

1. 把 .git 打开:三个区域和一堆文件
2. 内容的名字:SHA-1 与第一个对象
3. 目录也是对象:Buffer 与二进制格式初遇
4. 历史是一张图:提交对象与 log
5. 暂存区不是观念,是一个文件
6. 分支是一个文件,HEAD 是个指针的指针
7. 每一行增删的来历:diff 算法
8. 在提交图上找路:祖先与 merge-base
9. 合并:以 base 为裁判的三方对齐
10. 一根管道上的对话:pkt-line 与引用发现
11. fetch、push、clone:把图搬到另一边
12. 和真 git 对拍:你已经写了一个 git

附录:术语表、日常命令 → 内部机制对照表、mini-git 与真 git 的差异、练习梯子。

## 终点里程碑

从 add 到 clone 的 mini-git,产物能被真 git 直接读取——12 章测试先红后绿全数通过;终章用真 git cat-file 与 git log 读取 mini-git 仓库对拍成功。

## 边界

packfile、rebase、reflog、submodule、智能协商等未实现能力集中在 docs/divergence.md 登记;Windows 下与真 git 对拍统一用 `git -c core.autocrlf=false` / `--no-filters` 口径。
