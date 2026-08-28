# dayjs 源码走读：一个日期库的最小内核

一门 guided-walkthrough 源码课：按学习路径逐机制读懂 dayjs 内核，全书引用出自锁定提交 `iamkun/dayjs@0f6c19e`（MIT）并逐字标注出处。

## 怎么跑

- 项目根 `pnpm dev`，从聚合站进入本课程；
- 或本目录 `pnpm install && pnpm docs:dev` 单独预览。

探针（repo-probe 验证物，直接运行锁定 ref 的源码；按章分组的断言收在单文件总线 probes/run-all.mjs 里，取其依赖共享 dayjs 实例之便——拆按章文件等价可行）：

```bash
cd companion && npm install && npm test   # 8 组 53 条探针全绿
```

探针带一个 ESM resolve hook（`probes/loader.mjs`）：为源码的无扩展名相对导入补 `.js`、把语言包自引的裸包名 `dayjs` 映射到锁定源码本体——断言跑的是仓库源码，不经任何转写。探针运行需要 `.course/repo/` 的 clone（已在课程管线中，未随 git 提交；缺它时重跑：`git clone https://github.com/iamkun/dayjs.git .course/repo && cd .course/repo && git checkout 0f6c19e3b63bcc3ff74917cb3a60125020c75648`，并在 package.json 加 "type": "module"（探针运行前提，不改动 src）。）

## 章节目录

| # | 章 | 机制 |
|---|---|---|
| 1 | dayjs() 是个工厂 | 入口、克隆防御、鸭子标记 |
| 2 | parseDate 四路解析 | 正则分水岭与兜底 |
| 3 | init 预计算缓存 | 九字段全景、getter 注册表 |
| 4 | 不可变性 | clone().$set、wrapper、月末夹持 |
| 5 | startOf/endOf | 两个工厂、weekStart 翻转 |
| 6 | format | 一次 replace 的三级短路 |
| 7 | locale 注册表 | 回退链、两档切换 |
| 8 | extend 插件协议 | 三参数、$i 幂等 |
| 9 | 复盘 | 能力对账 + 八问自查 |

## 终点里程碑

一张可复走的源码地图，8 组探针在锁定 ref 全绿（`cd companion && npm test`）。

## 声明

引用源码遵循 MIT 许可（Copyright (c) 2018-present, iamkun）；本课程为独立教学解读，非官方文档。上游演进后实现可能与引用行不同，以你 checkout 的版本为准。
