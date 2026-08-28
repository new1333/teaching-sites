---
title: 术语表
---

# 术语表

全书首教过的术语在此集中可查；正文首现处均附一句人话解释，这里是那句话的正式版。

| 术语 | 英文 | 一句话定义 |
|---|---|---|
| 工厂函数 | factory function | 不暴露 new、用普通函数创建并返回对象的封装方式，dayjs() 就是 |
| 鸭子类型标记 | duck typing flag | 用对象上的标志属性（如 $isDayjsObject）判断类型，不依赖 instanceof |
| 正则解析回退 | regex parse fallback | 字符串先用正则拆字段，拆不动交给 new Date 兜底的分层解析策略 |
| 预计算缓存 | precomputed cache | 构造时把年月日等字段先算好存在实例上，getter 直接读 |
| 不可变实例 | immutable instance | 任何修改操作都返回新实例、原实例保持不变的约定，dayjs 的核心承诺 |
| 单位对齐 | unit alignment | 把日期推到某单位边界（周初/月初/年首）的操作，startOf/endOf 的本质 |
| 占位符替换 | token replacement | 用正则逐段匹配格式串占位符并换成对应值的格式化方式 |
| 注册表模式 | registry pattern | 用一张表登记全部可用项、按名取用的组织方式，locale 的 Ls 就是 |
| 幂等安装 | idempotent install | 重复执行无副作用——插件用 $i 标记保证 extend 两次只装一次 |
