# A股投资：从小白到专家

零基础小白的 A 股实战第一课。全书 16 章 + 3 附录，回答一个问题：**零基础的普通人进 A 股，凭什么长期赚钱，而不是给市场送钱？**

终点里程碑：读者带走一套可执行的投资体系——看得懂市场、算得出估值、管得住风险；能用一页纸计划书与七步研究清单，对一家真实公司完成一次完整投资决策，每步有可对照产出。

## 怎么跑

仓库根（聚合站，全部课程）：

```bash
pnpm install
pnpm dev        # 课程中心预览（含本课程）
pnpm build      # 聚合构建
```

单课程预览：

```bash
cd courses/astock-course
pnpm install
pnpm docs:dev
```

## 验证物门槛（companion）

```bash
cd courses/astock-course
pnpm typecheck   # 演算与数据集类型检查
pnpm test        # vitest：fixtures 期望答案与实现互锁（204 条）
pnpm export      # 图表数据导出（固定种子，连续两次运行逐字节一致）
pnpm docs:build  # 站点构建
```

正文全部承重数字来自 `companion/fixtures/*.json`（测试锁定）与导出的 `docs/assets/data/*.json`（第 4/5/9/10/13 章交互图表数据）；图表组件只消费导出产物，不手抄第二套算法。

## 章节目录

| 部分 | 章节 |
| --- | --- |
| 认知地基 | 1 时间价值与复利 · 2 股票的本质 |
| 进场 | 3 交易规则与成本 · 4 K线 · 5 均线与趋势 |
| 称重 | 6 财报三张表 · 7 估值倍数 · 8 安全边际与能力圈 |
| 活下来 | 9 风险的数学 · 10 分散与配置 · 11 仓位与定投 · 12 行为陷阱 |
| 成体系 | 13 指数基金与ETF · 14 七步研究清单 · 15 一页纸投资体系 · 16 进阶地图 |

附录：[术语表](docs/glossary.md)（71 术语）· [速查表](docs/reference-table.md)（费率/规则/公式）· [简化与差异清单](docs/divergence.md)（11 项教学简化登记）。

## 资产再生成

```bash
cd courses/astock-course && pnpm export   # 重新导出 docs/assets/data/*.json（固定种子，双跑一致）
```

## 说明

- 本课程内容仅用于学习交流，不构成任何投资建议；示例行情与示例公司均为合成教学数据或公开报道口径（含 as_of 标注），详见差异清单。
- 交互图表组件（K 线先猜后揭晓、均线回测对照、相关性实验台、回撤模拟器、定投回测）依赖 echarts 动态分包加载，首次打开图表页会有少量等待。
