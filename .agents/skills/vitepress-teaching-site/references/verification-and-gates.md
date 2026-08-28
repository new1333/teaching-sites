# 验证物与门槛

本文只定义跨形态循环和分支路由。进入章节前先按 [`course-profiles.md`](course-profiles.md) 解析**一个具体模式**，然后只读该模式文件。

| 模式 | 验证物 | 分支正本 |
|---|---|---|
| `code-lab` | 行为测试 + 最小实现 | [`verification/code-lab.md`](verification/code-lab.md) |
| `canvas-app` | 可运行页面 + 可再生感知资产 | [`verification/canvas-app.md`](verification/canvas-app.md) |
| `worksheet` | fixture + 唯一答案 + 导出守门 | [`verification/worksheet.md`](verification/worksheet.md) |
| `observation` | 操作 + 可对照现象的任务清单 | [`verification/observation.md`](verification/observation.md) |
| `repo-probe` | 锁定源码上的静态/运行探针 | [`verification/repo-probe.md`](verification/repo-probe.md) |
| `none` | 评审可判定的解释/复盘证据 | [`verification/none.md`](verification/none.md) |

`mixed` 是课程级集合，不是模式。解析结果仍为 `mixed` 时停止写章并修 outline。

## 跨形态循环

1. **基线**：从已提交 companion 与 state 建本章快照，记录将运行的命令。
2. **验证物**：先建立能判定本章断言的产物。支持红绿语义的分支必须先观察到预期失败。
3. **转绿**：只实现本章 milestone，保留旧章验证信号。
4. **门槛**：运行 outline/companion 声明的命令；命令、退出码和关键计数进入 rolling 草稿。
5. **正文**：只引用门槛后的事实；代码、数字、图表与探针输出取自当前终态。
6. **引用闸门**：运行 chapter lint，检查来源、死链、术语与模式专项规则。
7. **评审**：新鲜眼复跑关键门槛，检查正文承诺与现实一致。

门槛命令使用仓库现有 package manager；已有 lockfile 时不混用。依赖只有在 manifest 改动或缺失依赖导致门槛失败时安装。

## 修复上限与回滚

同一门槛最多做 3 轮**有新错误信号的定向修复**。每轮都要基于上一轮输出缩小问题；没有新证据时停止自我改写。

仍失败时：

1. 恢复本章快照；
2. 生成带失败命令和最后错误摘要的占位页；
3. rolling/run 标记本章 `degraded`；
4. 按 outline DAG 把未完成的传递依赖章标记 `blocked`；
5. 只继续独立分支。

修复后从该章开始按拓扑顺序解锁。存在 degraded/blocked 的课程不能标记 complete。

## 占位页

```md
---
title: {章标题}
---

# {章标题}

::: warning 本章尚未完成
验证门槛 `{command}` 未通过。

**最后错误**：{≤500 字摘要}

依赖本章的章节已暂停；修复后会按依赖顺序重跑。
:::
```

## 终态一致性

companion 是全书共享状态。后章重构若改变前章引用过的函数、数字、图表或输出，必须回写相关正文并重跑其 lint。快照只用于回滚，不是读者可引用的历史版本；需要展示历史形态时标注“教学示意”，并链接终态位置。

## 练习梯子

只有 outline 声明 `exercises` 附录时生成。练习顺序来自验证物依赖图：读者逐章让验证从失败变通过。成文后在干净副本验证依赖拓扑；毕业任务需要的每项能力必须已在正文示范。
