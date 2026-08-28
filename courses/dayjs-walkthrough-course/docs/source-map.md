---
title: 源码地图速查
---

# 源码地图速查

锁定 ref：iamkun/dayjs@0f6c19e（MIT）。走读顺序即依赖顺序——第一列按本课章节顺序排列。

| 文件/目录 | 一句话 | 在本课的 角色 |
|---|---|---|
| src/index.js | 全部内核：工厂、解析、类、格式化、locale、插件挂载（467 行） | 入口 |
| src/constant.js | 单位枚举、毫秒换算、两条核心正则 | 支撑 |
| src/utils.js | 给插件用的工具集（补零、类型判断、包装） | 支撑 |
| src/locale/en.js | 默认英文语言包：星期、月份、序数词 | 数据 |
| src/locale/zh-cn.js | 中文语言包样例：weekStart 周一起始 | 数据 |
| src/plugin/weekOfYear/index.js | 一个完整插件：给原型挂 week 方法 | 插件样例 |
| test/ | 官方测试：行为语义的对照面 | 对照 |
| types/ | TypeScript 声明：API 面的正式描述 | 对照 |

| 机制 | 入口位置（锁定 ref） | 走读章 |
|---|---|---|
| 工厂与克隆防御 | src/index.js · dayjs 函数 | [第 1 章](./01-factory-and-instance) |
| 四路解析 | src/index.js · parseDate | [第 2 章](./02-parse-date) |
| 预计算缓存 | src/index.js · parse/init | [第 3 章](./03-init-cache) |
| 不可变 | src/index.js · $set/set/add + wrapper | [第 4 章](./04-immutability) |
| 单位对齐 | src/index.js · startOf/endOf | [第 5 章](./05-startof-endof) |
| 格式化 | src/index.js · format + constant.REGEX_FORMAT | [第 6 章](./06-format) |
| 多语言 | src/index.js · L/Ls/parseLocale | [第 7 章](./07-locale-registry) |
| 插件 | src/index.js · extend + plugin/weekOfYear | [第 8 章](./08-plugin-system) |
