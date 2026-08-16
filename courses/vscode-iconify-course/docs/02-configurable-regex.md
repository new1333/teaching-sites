---
title: 可配置的正则组装：识别规则不该写死
---

# 可配置的正则组装：识别规则不该写死

一个团队把图标方案从 「 mdi:home 风格」切到 「UnoCSS 风格 i-carbon-home」，第二天全员发现编辑器里的图标预览全灭了——插件里那条正则是发布时写死的，只认前一种写法。找作者改一行正则，等下一次发版等了两周；期间所有人对着满屏的类名猜图标长什么样。这不是插件功能不够，是**识别规则被编译进了代码，而规则本来应该是数据**。这一章我们把识别规则从代码里拆出来，变成三组配置，再由代码现场把它们组装成正则。

## 原理：一条图标键的语法结构

先观察要识别的东西。一个图标键（Icon Key）长这样：

```text
i-carbon-home
│ └──┬──┘ └┬─┘
前缀  集合id  图标id
      └─分隔符─┘
```

三段语法成分天然就是三组配置：

- **前缀（prefixes）**：`i-`、`~icons/`，或者空——前缀为空串意味着「裸集合名也算」；
- **分隔符（delimiters）**：`:`、`--`、`-`、`/`，集合 id 和图标 id 之间的那道分隔；
- **后缀（suffixes）**：某些语法在名字后面还有尾巴，同样是一组候选。

组装的思路是把每组成分各自编译成一个正则片段，再按语法顺序拼接。三个片段各有一个共同的结构问题：**空串候选**。前缀组里有 `''` 时，前缀片段必须是「可选出现」——`(?:i-|~icons/)?`；全是非空候选时则必选。这个分支逻辑单独抽成一个函数，比把它埋在拼接代码里清晰得多。

还有两个不显眼但致命的细节。

**转义**。分隔符是用户配置，`:` 安全，`.` 和 `/` 都会按正则元字符解释。`'carbon.home'` 若不转义点号，`carbonXhome` 也会命中。所有候选拼进正则前必须过一遍 `escapeRegExp`。

**交替顺序**。JavaScript 正则的交替分支是「首个匹配优先」，不是「最长匹配优先」。集合 id 列表里 `mdi` 排在 `mdi-light` 前面时，`mdi-light:home` 会在 `mdi` 处就停住，把 `-light:home` 当成图标名。解法只有一条：交替候选按长度降序排列。这个坑在第 4 章解析阶段还会以另一种面目出现。

## 渐进实验：把规则做成数据

实验场这一章落两个模块。`src/config.ts` 承担「配置 + 组装」：

```ts
// src/config.ts · buildRegexes(节选)
export function buildRegexes(config: IconIntelliConfig): Regexes {
  // 交替分支按长度降序:正则的交替是首个匹配优先,长 id 必须排在短 id 前面
  const collectionIds = [...(config.collections ?? builtinCollectionIds)]
    .sort((a, b) => b.length - a.length)
  const aliasIds = [...(config.aliases ?? [])].sort((a, b) => b.length - a.length)

  const reDelimiters = `(${config.delimiters.map(escapeRegExp).join('|')})`
  const rePrefixes = buildOptionalAlternation(config.prefixes)
  const reSuffixes = buildOptionalAlternation(config.suffixes)

  const collectionPart = `(?:${collectionIds.join('|')})${reDelimiters}[\\w-]+`
  const aliasPart = aliasIds.length ? `|(?:${aliasIds.join('|')})` : ''

  const full = new RegExp(
    `[^\\w\\d]${rePrefixes}(${collectionPart}${aliasPart})${reSuffixes}(?![\\w-])`,
    'g',
  )
  // ...prefixed 与 namespace 见下文
  return { full, prefixed, namespace }
}
```

读这条 `full` 正则要从外往里看四层：

1. `[^\w\d]`——边界字符。图标键前面必须是非单词字符（空格、引号、冒号），这保证 `amdi:home` 这种粘在单词后面的东西不会误命中。它会被 consume 掉一个字符，所以后面还原区间时要加一；
2. `(?:i-|~icons/)?`——可选前缀段；
3. 捕获组——真正的内容：集合 id + 分隔符 + `[\w-]+`（图标名），或者一个别名；
4. `(?![\w-])`——右边界。负向前瞻断言名字后面不能再是单词字符或破折号，`mdi:homepage` 因此整体命中、不会被截成 `mdi:home` 多报一次。

`prefixed` 和 `namespace` 是同一条语法的两个「行尾视角」，第 9 章补全会用到：前者问「光标前是不是一个前缀后的词」，后者问「是不是已经写到了集合 + 分隔符的位置」。

扫描入口在 `src/scan.ts`：

```ts
// src/scan.ts · findIconKeys
export function findIconKeys(text: string, config: IconIntelliConfig): RawMatch[] {
  const { full } = buildRegexes(config)
  // 正则要求图标键前有一个非单词的「边界字符」;第 0 位的键没有可依托的前字符,
  // 前置一个哨兵空格补齐,命中区间再整体减一还原
  const padded = ` ${text}`
  const matches: RawMatch[] = []
  full.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = full.exec(padded))) {
    if (m[1])
      matches.push({ start: m.index, end: m.index + m[0].length - 1, key: m[1] })
    if (m.index === full.lastIndex)
      full.lastIndex++
  }
  return matches
}
```

这里有两个工程细节值得停一停。其一，**哨兵空格**：边界字符要求意味着文本第 0 位的图标键永远匹配不到——它前面没有字符。真实编辑器里文档末尾总有换行符兜底，但第一行行首的键照样漏。前置一个空格再整体减一，边界语义不变，漏洞补上。其二，每次调用重新 buildRegexes：全局正则自带 `lastIndex` 状态，跨调用复用同一个 RegExp 对象会得到幽灵般的「有时匹配有时不匹配」——这是正则状态机最经典的坑，测试里专门有一条锁住「两次 build 产物不是同一个对象」。

## 验证

```bash
cd companion && pnpm test
```

11 条断言全绿，关键的几条：默认配置下 `'text mdi:home more'` 命中 `{start: 5, end: 13, key: 'mdi:home'}`；`'<div class="i-carbon-home">'` 命中 `carbon-home`——正是开篇那个让全团队预览熄灭的写法；把 prefixes 改成 `['ic-']` 后，裸的 `mdi:home` 不再命中、`ic-mdi:home` 命中；分隔符配成 `['.']` 时 `carbonXhome` 不命中（转义生效）。回到开篇的事故：作者需要做的不再是发版，而是让用户改一行设置。

## 小结

识别规则由前缀、分隔符、后缀三组数据描述，代码只负责把它们组装成正则——规则是数据，改动就不需要发版。组装时三件事必须做对：候选转义、交替按长度降序、空串候选转成可选段。边界断言防截断，哨兵空格补行首，每次调用重建正则避开 lastIndex 状态。下一章把这些偏移区间换算成编辑器能用的行列坐标——装饰的定位全靠它。
