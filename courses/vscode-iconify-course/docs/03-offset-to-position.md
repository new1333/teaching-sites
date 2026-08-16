---
title: 偏移、行列与范围：装饰为什么盖错了地方
---

# 偏移、行列与范围：装饰为什么盖错了地方

一个只在 macOS 上开发的功能，到了 Windows 同事那里集体错位：模板字符串里第三行的图标装饰，盖到了下一行开头多出的那个逗号上。两边代码一个字都没改。排查半天， culprit 是行尾——Windows 文件的行尾是 `\r\n` 两个字符，正则给出的偏移（offset）把 `\r` 也算作行内内容，而编辑器的行列坐标不认这个账。每个换行差一个字符，二十行之后就差出了整整一行。这一章解决的就是这层换算：**从「第几个字符」到「第几行第几列」**，装饰定位的最后一块拼图。

## 原理：两套坐标系

文本智能里同时存在两套坐标，各有各的主人。

**偏移坐标**属于字符串处理：从 0 数到末尾，`text[i]` 直接索引，正则的 `match.index` 也是它。扫描在第 2 章产出的就是偏移区间。

**行列坐标（Position）**属于编辑器：`{line, character}`，行和列都从 0 起。装饰、补全、诊断，所有编辑器 API 只认这套坐标。

换算规则只有两条，坑全在边界上：

1. 行号 = 偏移之前换行符的个数；列号 = 偏移减去所在行的起始偏移。`\n` 属于它前面的行还是后面的行？答案是把它当作行与行之间的分隔符——数行号时它让行数加一，但它自己不算任何一行的内容。
2. CRLF 的 `\r` 是行尾序列的一部分，不是行内字符。偏移恰好落在 `\r` 之后（还没过 `\n`）时，列号要减一。这就是开篇那个错位的全部原因：两个平台的编辑器都把 `\r\n` 显示成一个换行，但字符串层面它占两个偏移位。

还有一个必须写进约定的行为：越界偏移怎么办？装饰计算的输入来自正则匹配，理论上不会越界，但作为公共函数就该有明确语义——收敛到文本末尾（或开头），不抛异常。约定写进测试，后来者才敢依赖。

## 渐进实验：positionAt 与 collectMatches

换算函数落在 `src/scan.ts`，和扫描放在一起——它们操作同一段文本：

```ts
// src/scan.ts · positionAt
export function positionAt(text: string, offset: number): Position {
  const o = Math.max(0, Math.min(offset, text.length))
  let line = 0
  let lineStart = 0
  for (let i = 0; i < o; i++) {
    if (text[i] === '\n') {
      line++
      lineStart = i + 1
    }
  }
  let character = o - lineStart
  // CRLF:偏移恰好落在 \r 之后时,\r 属于行尾序列而非行内字符
  if (text[o - 1] === '\r')
    character--
  return { line, character }
}
```

一遍扫描同时记两个数：`line` 数过了几个 `\n`，`lineStart` 记住本行从哪开始。列号就是差值。循环条件是 `i < o` 而不是 `<=`——偏移自己踩着的字符如果是 `\n`，它属于下一行的开端，不该计入本行。CRLF 修正只看前一个字符是不是 `\r`：只有偏移停在 `\r` 和 `\n` 之间这种悬空位置才需要，其余情况自然正确。

顺带一提这个实现的复杂度：每次调用都从头扫到偏移处，O(offset)。对教学足够；编辑器真实实现会预建行首索引表把每次查询降到 O(log 行数)——当一个装饰循环里要做几百次换算时，这个差异就会浮出水面。实验场不优化它，但你要知道优化点在哪。

有了换算，第 2 章的偏移匹配升级成编辑器可直接消费的形态：

```ts
// src/scan.ts · collectMatches
export interface IconMatch {
  range: { start: Position, end: Position }
  key: string
}

export function collectMatches(text: string, config: IconIntelliConfig): IconMatch[] {
  return findIconKeys(text, config).map(m => ({
    key: m.key,
    range: {
      start: positionAt(text, m.start),
      end: positionAt(text, m.end),
    },
  }))
}
```

`range` 的语义与编辑器一致：start 含、end 不含。`mdi:home` 在 `'x mdi:home'` 里从第 0 行第 2 列到第 0 行第 10 列——十个字符，正好盖住键名本身。

## 验证

```bash
cd companion && pnpm test
```

16 条断言全绿。最有分量的一条是「同一图标在 LF 与 CRLF 文本里得到相同的行列」：把 `x mdi:home\ny mdi:home` 与 `x mdi:home\r\ny mdi:home` 分别喂给 `collectMatches`，两个结果深度相等——第二个图标的坐标都是 `{line: 1, character: 2}`。这正是开篇事故的回归测试：无论文件从哪个平台来，装饰都盖在它该盖的地方。越界收敛（`positionAt('ab', 100)` 得到行尾）也有专测锁定。

## 小结

偏移属于字符串，行列属于编辑器，两套坐标靠「数换行、记行首、CRLF 减一」完成换算；范围语义 start 含 end 不含。换行符是分隔符不是内容，`\r` 属于行尾不属于行内——记住这两句，跨平台的装饰错位就再也坑不到你。到这里，识别段的输出已经是可以直接画到屏幕上的东西了；下一章往回走半步，把识别出的键拆成集合与图标名——你会发现「先匹配谁」在那里同样致命。
