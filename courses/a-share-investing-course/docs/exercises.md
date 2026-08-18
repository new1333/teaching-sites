---
title: 练习路线：从零重建你的技术分析引擎
---

# 练习路线：从零重建你的技术分析引擎

读完全书，最强的验证方式不是再做一遍笔记，而是把引擎删掉重写一遍。实验场的测试是按章解锁的作业梯子：每章的测试文件就是那章的目标规格，你从零实现 `src/`，让测试逐章从红转绿。

## 玩法三步

1. **拿到骨架**：进入 `companion/`，跑 `npm install`（一次性）；然后清空 `src/`（保留 `tests/` 与 `scripts/`）。
2. **按章转绿**：从第 3 章的 `tests/candle-anatomy.test.ts` 开始，跑 `npm test` 看它红着，按第 3 章正文重写 `src/candles/` 与 `src/data/`，直到这份测试变绿；再进入下一章的测试文件。旧章测试持续全绿，就是你自己版本的 API 兼容哨兵——后章实现破坏前章行为时，红的是你，不是书。
3. **对照终态**：全书测试都绿后（应为 404 项），你的实现与课程终态在行为上等价；写法不同完全正常——测试断言的是行为，不是实现细节。

## 各章测试 ↔ 教的什么

| 测试文件 | 章 | 你要重建的能力 |
|---|---|---|
| `candle-anatomy.test.ts` | [第 3 章](./03-candle-anatomy) | 逐笔聚合成 K 线、周期聚合、实体影线占比 |
| `candle-rendering.test.ts` | [第 4 章](./04-candle-rendering) | OHLC 到像素的几何映射 |
| `single-patterns-wicks.test.ts` | [第 5 章](./05-single-patterns-wicks) | 影线族七形态与位置换名 |
| `single-patterns-doji.test.ts` | [第 6 章](./06-single-patterns-doji) | 十字族六分类与犹豫分级 |
| `multi-patterns-two.test.ts` | [第 7 章](./07-multi-patterns-two) | 九种双根形态 |
| `multi-patterns-three.test.ts` | [第 8 章](./08-multi-patterns-three) | 七种多根形态与确认层 |
| `pattern-stats.test.ts` | [第 9 章](./09-pattern-stats) | 胜率/基准/随机对照验货 |
| `moving-averages.test.ts` | [第 11 章](./11-moving-averages) | SMA/EMA/金叉死叉 |
| `volume-analysis.test.ts` | [第 12 章](./12-volume-analysis) | 量能标签与量价背离 |
| `support-resistance.test.ts` | [第 13 章](./13-support-resistance) | 枢轴、聚类成位、斐波那契 |
| `chip-distribution.test.ts` | [第 14 章](./14-chip-distribution) | 换手衰减筹码模型 |
| `reversal-structures.test.ts` | [第 15 章](./15-reversal-structures) | 头肩/双顶结构与量度目标 |
| `macd.test.ts` | [第 16 章](./16-macd) | MACD 三层与背离检测 |
| `rsi-kdj.test.ts` | [第 17 章](./17-rsi-kdj) | RSI/KDJ 与钝化断言 |
| `bollinger.test.ts` | [第 18 章](./18-bollinger) | 布林带/收口/带外统计 |
| `expectancy-risk.test.ts` | [第 20 章](./20-expectancy-risk) | 期望值/凯利/破产概率 |
| `backtest-engine.test.ts` | [第 21 章](./21-backtest-engine) | 含费用与 T+1 的回测引擎 |

第 1、2、10、19、22 章是原理章，没有测试文件——它们的「作业」在正文末尾的自查问里。

## 两个提醒

- 卡住时先回正文：每章「渐进实验」段贴的代码就是这份测试的实现路径图，标注出处的代码块与终态逐字一致。
- 重写完跑一遍 `npm run export-docs`：如果它还能产出全部图表数据且两次运行字节一致，说明你的确定性纪律（固定种子、无时间戳）也过关了。
