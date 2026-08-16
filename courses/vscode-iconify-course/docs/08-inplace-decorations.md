---
title: 装饰收集器与 in-place 模式：光标行不藏字
---

# 装饰收集器与 in-place 模式：光标行不藏字

in-place 模式刚上线时收获一片赞叹：图标名文字被藏起来，页面上只剩一枚枚图标，代码干净得像设计稿。三天后第一位「受害者」出现了——他把光标移到某个图标名中间想改名，却看不见自己在改什么：文字是藏着的，光标还在闪，改一下盲猜一下，连错三次。问题不该由用户「记住别在这一行编辑」来解决，**正在编辑的行必须豁免隐藏**——这一章把前七章的全部能力组装成第一条真正的用户可见通道：装饰，并顺手把这个豁免做进去。

## 原理：两套装饰与一条豁免线

装饰在第 1 章划过边界：只影响显示，不影响内容。落到图标场景，普通模式只做一件事——在图标键旁边画一枚小图，文字照旧显示。真正需要设计的是 in-place 模式：隐藏文字、只留图标。实现上它不是「一套更聪明的装饰」，而是**两套装饰叠在一起**：一套负责画图标（所有匹配），一套负责藏文字（被豁免的行除外）。两套各司其职，豁免逻辑只作用于第二套——画图标那套永远不需要豁免，图标画着不碍事，藏字才碍事。

豁免的判定维度也值得想清楚：不是「这个图标键」，而是「这一行」。用户在行内任何位置打字，整行文字都该回来——只在光标紧邻图标键时豁免，会把「看得见开头看不见结尾」的怪状态留给用户。所以规则是：光标所在行的所有匹配都不隐藏，其余行照常。光标一移走，隐藏恢复。用户的体验因此是连续的：想编辑，行文字自动出现；编辑完，图标自动接管。

还有一条贯穿性的小原则：装饰描述符里的 `key` 保留用户书写的原始形态。别名 `save` 展开成 `mdi:home` 去取数据，但描述符上记的仍是 `save`——用户写的是什么，悬停提示与后续交互看到的就是什么。所见即所得，展开只是内部手段。

## 渐进实验：collectDecorations

新模块 `src/decorations.ts`，一个函数把识别、解析、加载、渲染串成完整链路：

```ts
// src/decorations.ts · collectDecorations
export async function collectDecorations(
  text: string,
  env: DecorationEnv,
): Promise<DecorationDescriptor[]> {
  // 别名表是唯一事实源:它的键同时驱动识别(正则的别名 id)与展开(键 → 真实键)
  const config = env.aliases
    ? { ...env.config, aliases: Object.keys(env.aliases) }
    : env.config
  const matches = collectMatches(text, config)
  const decorations: DecorationDescriptor[] = []
  for (const match of matches) {
    const actualKey = applyAlias(match.key, env.aliases ?? {})
    const parsed = parseIcon(actualKey, env.collectionIds)
    if (!parsed)
      continue
    const set = await env.loadIconSet(parsed.collection)
    if (!set)
      continue
    const info = toRenderInfo(set, parsed.icon, actualKey)
    if (!info)
      continue
    decorations.push({
      range: match.range,
      key: match.key,
      dataUrl: env.render.getIconDataUrl(info, env.fontSize ?? 12, env.color ?? 'currentColor'),
      hoverMarkdown: `\`${match.key}\``,
      hideText: env.inplace === true && match.range.start.line !== env.cursorLine,
    })
  }
  return decorations
}
```

这个函数本身就是一份复习提纲：`collectMatches` 是第 2、3 章的识别与换算，`applyAlias` + `parseIcon` 是第 4 章的名字层，`loadIconSet` 是第 5 章的注入式缓存，`getIconDataUrl` 是第 6 章的渲染管线——每一段都是前面亲手建过的模块，这里只是接线。三个新决策都发生在组装处：

其一，别名表的**单一事实源**。开发这个函数时我踩了个坑：测试里别名 `save` 死活不出装饰——识别正则用的配置里没有别名 id，`save` 根本没被认出来。修法就是开头那行合并：别名表的键既派生识别配置、又做展开映射，一张表喂两处。两张表各维护一份迟早漂移，这是数据一致性的老规律在最小尺度上的重演。

其二，**静默跳过的容错链**。四个 `continue` 对应四类坏输入：识别的形态解析不出、集合加载失败、图标名在集合里不存在——全都安静跳过，一个坏键绝不能让整份装饰列表付之东流。这与第 4 章「解析失败返回 undefined」是同一条约定的延续。

其三，`hideText` 的判定收在最后一行：`inplace === true && 行号 !== cursorLine`。注意它是一个**描述符上的布尔**而不是两套分离的类型——编辑器侧拿到列表后自己按布尔分桶，分桶策略留给宿主，库这边只陈述事实。

## 验证

```bash
cd companion && pnpm test
```

52 条断言全绿，本章新增 5 条。普通模式两行两个图标，装饰按出现顺序、range 落在正确行列、data URL 前缀齐全、hover 提示含键名；in-place 开启且光标在第 0 行时，第 0 行 `hideText: false`、第 1 行 `hideText: true`，光标移到第 1 行则对调——盲改事故的两端各有一条测试镇守。别名 `save` 展开后取到 `mdi:home` 的数据，描述符上的 key 仍是 `save`；集合加载失败（`ph:cycle` 无数据源）与图标不存在（`mdi:ghost`）都返回空列表，不抛异常。

## 小结

装饰通道 = 识别 → 解析 → 加载 → 渲染的接线，加上两条新规则：in-place 的豁免以行为单位（光标行不藏字），别名表作为单一事实源同时驱动识别与展开，描述符保留用户书写的原始键。坏输入一路静默跳过。到这里「画图标」已经完整，下一章做剩下两条通道——补全与悬停，并把「昂贵的事推迟到必须做的那一刻」这个原则用到提供方上。
