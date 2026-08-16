---
title: 补全与悬停：延迟出图的提供方
---

# 补全与悬停：延迟出图的提供方

「7000 个 carbon 图标，谁能记得住名字？」每次要往代码里加图标，同事们的动作出奇一致：切到浏览器，打开图标检索站，翻两页，复制名字，切回来粘贴。review 别人代码时更狼狈——`ph:cycle` 长什么样？要跑起项目才知道。这两件事的正确打开方式都在编辑器里：打字的时候给候选，悬停的时候给预览。这一章实现剩下两条通道——补全与悬停，它们共享一个关键词：**昂贵的事，推迟到必须做的那一刻**。

## 原理：两段式补全与替换区间

图标键的补全天然分两段。用户敲到 `mdi:` 时，光标处于「集合 + 分隔符」的命名空间上下文——此刻该补的是**这个集合的图标名**；用户敲到 `i-ca` 时，处于裸前缀上下文——该补的是**集合 id**。同一次按键，两种上下文，两份候选。第 2 章埋下的 `namespace` 与 `prefixed` 两条正则，在这里各就各位：前者判定「命名空间已写完」，后者判定「光标在一个词的尾巴上」。

比「补什么」更容易做错的是「替换什么」。补全项不是简单插入光标处——它带着一个替换区间，接受候选时用 label 覆盖这段区间。区间算错，用户接受 `carbon` 之后可能得到 `<span class="i-">` 这种残句。这里的坑藏在一个字符里：**短横线属于词字符类 `[\w-]`**。从行尾倒着截「正在敲的词」，`i-ca` 会整个被截出来——替换它，`i-` 前缀就没了。正确算法是先锚定行尾最后一个「前缀或分隔符」结构，再取这个结构**之后**的词：`i-ca` 替换 `ca`、保住 `i-`，`mdi:ho` 替换 `ho`、保住 `mdi:`。

延迟出图是第二条原则。补全列表每次按键都可能弹出，一屏几十项——如果每项都预渲染一张图，一次弹窗就是几十次编码。提供方（Provider）的接口恰好把这件事拆成了两步：`provideCompletionItems` 出轻量候选（label + 类型，纯内存元数据），`resolveCompletionItem` 只在用户**选中某一项**时被调，为那一项取文档、渲染大图。几十次编码变成一次。悬停（Hover）同理：鼠标停留才触发，频率天然低，可以放心渲染 150px 的大图——不过仍复用第 6 章的渲染缓存，同一图标第二次悬停零成本。

## 渐进实验：providers.ts 与 markdown.ts

补全主体在 `src/providers.ts`：

```ts
// src/providers.ts · provideCompletions(节选)
export function provideCompletions(
  linePrefix: string,
  ctx: ProviderContext,
): CompletionItemDescriptor[] | null {
  const { prefixed } = buildRegexes(ctx.config)
  if (!linePrefix.match(prefixed))
    return null

  const replaceStart = computeReplaceStart(linePrefix, ctx.config)

  const aliasItems = Object.entries(ctx.aliases ?? {}).map(
    ([label, actual]) => ({ label, detail: actual, kind: 'alias', replaceStart }),
  )

  if (ctx.config.customAliasesOnly)
    return aliasItems

  const namespaceMatch = linePrefix.match(namespaceOf(ctx.config))
  if (namespaceMatch) {
    const id = namespaceMatch[1]!
    const meta = ctx.collections.find(c => c.id === id)
    if (meta) {
      return [
        ...aliasItems,
        ...meta.icons.map(icon => ({
          label: icon,
          detail: `${id}${ctx.config.delimiters[0]}${icon}`,
          kind: 'icon' as const,
          replaceStart,
        })),
      ]
    }
  }

  return [
    ...aliasItems,
    ...ctx.collections.map(c => ({ label: c.id, detail: c.id, kind: 'collection' as const, replaceStart })),
  ]
}
```

候选只从 `ctx.collections`（构建期元数据，常驻内存）里出——**整个补全路径零加载、零编码**。icon 项的 `detail` 存完整键 `mdi:home`，它是后续取文档的键。替换区间的计算单独收拢：

```ts
// src/providers.ts · computeReplaceStart
function computeReplaceStart(linePrefix: string, config: IconIntelliConfig): number {
  const breakers = [...config.prefixes.filter(Boolean), ...config.delimiters]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
  const anchored = new RegExp(`(?:${breakers.join('|')})[\\w-]*$`).exec(linePrefix)
  if (!anchored)
    return linePrefix.length - (/[\w-]*$/.exec(linePrefix)![0].length)
  const breaker = new RegExp(`^(?:${breakers.join('|')})`).exec(anchored[0])!
  const word = anchored[0].slice(breaker[0].length)
  return linePrefix.length - word.length
}
```

`breakers` 把前缀和分隔符合并成一张「分隔结构」表（按长度降序——又是那个首个命中优先的规则，第三次出场），行尾锚定找到最后一个分隔结构，其后的词才是替换区间。开发时这个函数的测试红过一次：`i-ca` 的期望起点在 `i-` 之后，实现却返回了 `i-` 之前——`[\w-]` 把 `-` 吃进词里的那一刻，规则才真正显形。

延迟文档就是一次按 kind 的分发：

```ts
// src/providers.ts · resolveCompletion
export async function resolveCompletion(
  item: CompletionItemDescriptor,
  ctx: ProviderContext,
): Promise<CompletionItemDescriptor & { documentation: string }> {
  const documentation = item.kind === 'collection'
    ? await ctx.getCollectionMarkdown(item.label)
    : await ctx.getIconMarkdown(item.detail)
  return { ...item, documentation }
}
```

悬停文档在 `src/markdown.ts`，与第 8 章同一条「别名展开 → 解析 → 加载 → 渲染」链路，只是产物从装饰描述符换成了 markdown 字符串：图标文档是一张表格，里面内嵌 data URL 大图和键名（键名保留用户书写形态——别名 `save` 的文档标题就是 `save`，图却是 `mdi:content-save` 的图）；集合文档是标题加至多五枚小图预览。查不到的一律返回空字符串，宿主拿到空串就不弹悬停框——安静，是提供方的礼貌。

## 验证

```bash
cd companion && pnpm test
```

63 条断言全绿，本章新增 11 条。`<span class="mdi:ho` 只出 mdi 的三个图标项，替换起点在 `:` 之后；`<span class="i-ca` 出集合 id 项，替换起点在 `i-` 之后；`customAliasesOnly` 下只有别名项。延迟语义有哨兵盯着：`provideCompletions` 全程不碰 markdown 函数；选中 `home` 后 `getIconMarkdown` 恰好被调一次，文档里含 data URL 与键名；三个图标项依次 resolve，网络计数始终是 1——第 5 章的缓存在补全链路上自动生效。悬停侧：图标文档内嵌 base64 大图，别名文档展示原始键，不存在的键安静返回空串，集合文档带标题和三枚预览。

## 小结

补全两段式：命名空间上下文补图标名，裸前缀上下文补集合 id；替换区间锚定「最后一个分隔结构之后的词」，短横线的词字符属性是最阴的坑。出候选只靠常驻元数据，大图延迟到 resolve 与悬停那一刻。三条通道至此全部就绪。但还剩一个系统性问题：用户改了配置——换分隔符、加自定义集合——这一切会自动跟着变吗？下一章给引擎装上依赖追踪，让配置活起来。
