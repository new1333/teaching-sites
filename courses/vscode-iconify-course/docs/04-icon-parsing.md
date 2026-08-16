---
title: 图标名解析与别名：mdi-light 不是 mdi
---

# 图标名解析与别名：mdi-light 不是 mdi

一个图标扩展上线三个月，收到一个诡异的 issue：用户写 `mdi-light:home`，预览出来的却是另一个图标。复现、排查、打日志，最后发现解析器把这个键拆成了集合 `mdi`、图标名 `light:home`——去 Material Design Icons 主集合里找一个叫 `light:home` 的图标，居然真有个近似命中，于是张冠李戴。同一个月里还有第二类工单：团队约定了一批短别名（`save`、`back`），代码里别名和全名混用，解析器只认全名，一半图标不亮。这两个 bug 表面无关，其实同根：**识别只是「像不像」，解析才是「是什么」**——这一章把识别出来的字符串真正拆开。

## 原理：首个命中优先的陷阱

第 2 章的正则负责从文本里捞出「长得像图标键」的字符串。接下来要把它拆成 `{collection, icon}` 两段，才知道去哪个集合找哪个图标。

拆分算法朴素得不像有坑：拿集合 id 列表逐个试，看键是不是以它开头；命中后剥掉集合 id，再剥一个分隔符，剩下的就是图标名。坑在顺序。无论正则的交替分支还是字符串的前缀匹配，JavaScript 引擎的策略都是**首个命中优先**，不是最长匹配优先。集合 id 列表若按字母序排列，`mdi` 永远排在 `mdi-light` 前面——`mdi-light:home` 在 `mdi` 处就「命中」了。解法与第 2 章完全同构：候选按长度降序，先试长的。同一个陷阱在两个层面（正则交替、前缀匹配）各埋一次，这提醒我们它不是语言特性，而是所有「逐一试探」式匹配的共同属性。

分隔符剥离也藏着同一个问题。默认分隔符有 `:`、`--`、`-`、`/`，`carbon--home` 若先按 `-` 剥，图标名会变成 `-home`，带着一个洗不掉的前导短横线。多字符分隔符必须排在单字符前面。

别名是另一层正交的概念。别名表是一张「短名 → 真实键」的对照字典：`save` 指向 `mdi:content-save`。解析流程里它的位置有讲究——必须在解析**之前**展开。先查别名表，命中就换成真实键，再走拆分；没命中原样进入拆分。顺序反了，别名永远查不上。展开之后，别名与全名对解析器完全等价，第 2 章识别正则里的别名分支（`aliases` 配置）也是同一张表驱动的——一张表，两处消费。

## 渐进实验：parseIcon 与 applyAlias

新模块 `src/parse.ts`，两个导出：

```ts
// src/parse.ts · parseIcon
export function parseIcon(str: string, collectionIds: string[]): ParsedIcon | undefined {
  // 与正则交替同理:字符串前缀匹配是首个命中优先,长集合 id 必须先试
  const ids = [...collectionIds].sort((a, b) => b.length - a.length)
  for (const collection of ids) {
    if (!str.startsWith(collection))
      continue
    const rest = str.slice(collection.length)
    const delimiter = DELIMITERS.find(d => rest.startsWith(d))
    if (!delimiter)
      continue
    const icon = rest.slice(delimiter.length)
    if (!icon)
      return undefined
    return { collection, icon }
  }
  return undefined
}
```

四个出口对应四种输入形态：集合 id 不在清单里，循环走完返回 `undefined`；集合命中但后面不跟分隔符（比如裸字符串 `mdi`），`continue` 去试下一个候选——注意这里不能直接返回，万一更长的候选才对得上；分隔符剥完什么都不剩（残键 `mdi:`），返回 `undefined`；全部合法才返回拆分结果。解析失败一律返回 `undefined` 而不抛异常，这是圣经里的错误约定：识别管线面对的是任意文本，坏输入是常态不是事故，调用方用 `if (!parsed) continue` 静默跳过即可。

`DELIMITERS` 的构造值得看一眼：

```ts
// src/parse.ts · 模块常量
const DELIMITERS = [...createConfig().delimiters].sort((a, b) => b.length - a.length)
```

它直接从默认配置里取分隔符候选再排序——解析与识别共享同一份「什么是分隔符」的定义，不会出现识别认 `--` 而解析只认 `-` 的分裂。防御性的排序也做在函数内部（`collectionIds` 进来先排序再试），因为调用方给的列表什么顺序都可能有——第 11 章自定义集合加进来时，没人会记得维护这个顺序。

别名展开是个一行函数，但语义要钉死：

```ts
// src/parse.ts · applyAlias
export function applyAlias(key: string, aliases: Record<string, string>): string {
  return aliases[key] ?? key
}
```

命中映射到真实键，未命中原样返回——注意是「返回键」而不是「返回解析结果」，别名层不知道也不需要知道集合的存在。两层各管一段：别名层管名字替换，解析层管结构拆分。组合使用就是 `parseIcon(applyAlias(key, aliases), ids)`。

## 验证

```bash
cd companion && pnpm test
```

26 条断言全绿，本章新增 10 条。核心的几条：`parseIcon('mdi-light:home', ['mdi', 'mdi-light'])` 得到 `{collection: 'mdi-light', icon: 'home'}`——即使调用方把短 id 排在前面也能拆对；`parseIcon('carbon--home', ['carbon'])` 的图标名是 `home` 而不是 `-home`；`save` 经 `applyAlias` 换成 `mdi:content-save` 后解析出 `{collection: 'mdi', icon: 'content-save'}`；残键 `mdi:` 与裸词 `nosuch` 都安静地返回 `undefined`。

## 小结

识别回答「像不像」，解析回答「是什么」；从字符串到 `{collection, icon}`，靠的是「长候选先试、分隔符按长度剥、失败返回 undefined」。首个命中优先的陷阱在正则和前缀匹配里各出现一次，排序是唯一的解药。别名是名字层的替换，必须在解析之前展开，且与识别共享同一张表。至此识别段全部完成：文本进来，结构化的键列表出去。下一章进入数据段——拿到了集合 id，图标数据从哪里来、怎么来才不重复。
