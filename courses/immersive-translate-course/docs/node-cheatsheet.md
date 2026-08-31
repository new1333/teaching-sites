---
title: 节点分类速查表
---

# 节点分类速查表

引擎判定「谁能成为可译块」的全部默认值，与 `companion/src/extract.ts` 逐字一致。改清单改门槛，都在 `ExtractOptions` 里注入覆盖。

## 块级标签清单（BLOCK_TAGS）

对「默认独占一行」的工程近似——真身是浏览器默认样式表的 `display: block`（第 2 章「块级与内联的真身」）。清单没收的标签一律按内联处理。

| 类别 | 标签 |
|---|---|
| 标题 | `p` `h1` `h2` `h3` `h4` `h5` `h6` |
| 列表 | `li` `dd` `dt` |
| 引用与表格 | `blockquote` `td` `th` `figcaption` |
| 容器 | `div` |

## 默认跳过清单（DEFAULT_SKIP_TAGS）

四族标签，命中的元素整棵子树剪掉、不送翻（每族成因见第 2 章「跳过规则」）：

| 族 | 标签 | 成因 |
|---|---|---|
| 机器吃的 | `script` `style` `noscript` | 不是给人读的自然语言 |
| 代码类 | `code` `pre` | 机器翻代码只产出垃圾 |
| 表单控件 | `button` `input` `select` `textarea` | 界面指令与用户草稿，不是阅读内容 |
| 版面地标 | `nav` `footer` `aside` | 全站重复的锅炉板 |

注意 `header` **不**在跳过清单：它常在文章内部包标题，一刀切会误杀正文标题。

## 长度门槛与选项

```ts
// src/extract.ts · 两份清单常量
export const BLOCK_TAGS: ReadonlySet<string> = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'li', 'dd', 'dt', 'blockquote', 'td', 'th', 'figcaption', 'div',
])

export const DEFAULT_SKIP_TAGS: readonly string[] = [
  'script', 'style', 'noscript',
  'code', 'pre',
  'button', 'input', 'select', 'textarea',
  'nav', 'footer', 'aside',
]

/** 长度门槛默认值：挡住「Nov 8」（5 字符）这类不是句子的短串，正文句子都远长于它。 */
export const DEFAULT_MIN_CHARS = 6
```

| 选项 | 默认 | 作用 |
|---|---|---|
| `skipTags` | 上表 13 个标签 | 替换整份跳过清单（合并进新清单需自己带上原标签） |
| `minChars` | 6 | 短于它的直接文本不成块；调小会放行「Nov 8」这类短串 |

## 已知偏差

清单是对 CSS display 真身的近似，两条已知误判登记在[差异清单](./divergence)：作者改过 `display` 的元素会误判；清单未收录的标签一律按内联处理。
