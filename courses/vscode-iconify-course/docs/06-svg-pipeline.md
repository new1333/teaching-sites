---
title: SVG 渲染管线：currentColor、宽高比与 data URL
---

# SVG 渲染管线：currentColor、宽高比与 data URL

某天切到浅色主题，编辑器里的图标集体消失——一个都不剩。查了半小时才发现：图标 SVG 里写的着色是 `currentColor`，意思是「跟随所在环境的文字颜色」；而装饰渲染出来的 SVG 根本没有「所在环境」，浅色主题下它解析成了白色，白底白图标，全数隐身。同一个迭代里还有一张issue：旗帜类图标是 24×16 的长方形，渲染出来全被压成正方形，星星条纹扭成一团。两个 bug，一个关于颜色，一个关于形状，解法却在同一条渲染管线上。

## 原理：从裸片段到内嵌图片

缓存里拿到的图标数据只有一段裸的 `body`——`<path d="..." fill="currentColor"/>` 这样的内部片段，没有外壳、没有尺寸、不能直接当图片用。渲染管线要依次解决四件事。

**穿壳**。body 外面套一层 `<svg>` 壳，壳上带三样东西：`xmlns`（内嵌场景没有 HTML 上下文，命名空间必须自带）、`width`/`height`（显示尺寸）、`viewBox`（原始坐标系）。viewBox 用图标自己的宽高，让 body 里的路径坐标在原始坐标系里绘制；width/height 负责把原始坐标映射到屏幕尺寸——两者分工明确，变形事故就出在把两者混为一谈。

**宽高比**。24×16 的旗帜若硬套正方形壳，preserveAspectRatio 会把它居中缩放塞进方框，左右留白、图案缩小——好一点的情况；坏一点的情况是壳根本没按比例撑开。正确做法：高度取字号（图标与文字等高最自然），宽度按 `ratio = width / height` 撑开。24×16 的旗帜、字号 12 时，壳是 18×12——旗帜还是旗帜。

**主题色**。`currentColor` 在 SVG 里的语义是继承最近的 `color`。装饰场景里 SVG 是内嵌的 data URL，没有任何 DOM 祖先可继承，浏览器会拿默认色（往往是黑色或白色）——浅色主题白底白图的事故根源。既然没有环境，就把「环境」变成参数：渲染前把 `currentColor` 字符串替换成实际主题色，深色主题 `#eee`、浅色主题 `#222`。颜色因此成为渲染的输入之一，而不是渲染之后碰运气的结果。

**内嵌编码**。编辑器装饰只认图片 URL，不认 SVG 字符串。data URL 的形式是 `data:image/svg+xml;base64,<编码>`——把 SVG 文本编码成 base64 字符串塞进 URL 本身，「图片」就变成了一段自包含的字符串，不需要任何文件或网络请求。base64 是公开的标准编码：先 UTF-8 转字节，再每 3 字节（24 bit）拆成 4 个 6 bit 的字符表下标，缺位补 `=`。我们会手写一遍它——不止为了零依赖，更因为它把「为什么 URL 里能装下一张图」变成一件可解释的事。

最后是缓存。同屏 30 个 mdi 图标、字号固定、主题固定，编码 30 次毫无意义——data URL 按 `(颜色, 字号, 键)` 三元组缓存，三个维度任一变化才重新编码。

## 渐进实验：render.ts 与 base64.ts

尺寸回退链先钉死（图标自身 > 集合默认 > 16）：

```ts
// src/render.ts · toRenderInfo
export function toRenderInfo(set: IconSetData, icon: string, key: string): IconRenderInfo | undefined {
  const data = set.icons[icon]
  if (!data)
    return undefined
  const width = data.width ?? set.width ?? 16
  const height = data.height ?? set.height ?? 16
  return { key, body: data.body, width, height, ratio: width / height || 1 }
}
```

然后是壳与编码：

```ts
// src/render.ts · pathToSvg / createRenderer(节选)
export function pathToSvg(info: IconRenderInfo, fontSize: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${fontSize * info.ratio}px" height="${fontSize}px" preserveAspectRatio="xMidYMid meet" viewBox="0 0 ${info.width} ${info.height}">${info.body}</svg>`
}

export function createRenderer(options: { toDataUrl?: (svg: string) => string } = {}): Renderer {
  const encode = options.toDataUrl ?? toDataUrl
  const cache = new Map<string, string>()
  function getIconDataUrl(info: IconRenderInfo, fontSize = 32, color = 'currentColor'): string {
    const cacheKey = `${color}:${fontSize}:${info.key}`
    const hit = cache.get(cacheKey)
    if (hit !== undefined)
      return hit
    // currentColor 是 SVG 的继承占位,装饰场景没有继承链,渲染前换成实际主题色
    const svg = pathToSvg(info, fontSize).replaceAll('currentColor', color)
    const url = encode(svg)
    cache.set(cacheKey, url)
    return url
  }
  return { getIconDataUrl }
}
```

注意 `createRenderer` 注入的不是数据而是编码函数本身——缓存测试因此可以数「编码到底发生了几次」，第 5 章定下的注入风格在渲染层继续生效。base64 的编码器在 `src/base64.ts`，核心是 `utf8ToBytes`（码点遍历，代理对安全，中文和 emoji 各占 3、4 字节）加上 3 字节到 4 字符的打包循环；解码器反向：6 bit 一路累积，攒满 8 bit 吐一个字节，再按 UTF-8 还原。配套的解码导出不是摆设——「编码产物解码后等于原文」这条往返（round-trip）断言，是所有编解码实现最值钱的一条测试。

## 验证

```bash
cd companion && pnpm test
```

47 条断言全绿，本章新增 13 条。已知向量 `foobar → Zm9vYmFy` 与补位 `foob → Zm9vYg==` 锁定编码正确性；`中文图标`、`图标 😀🎉` 往返无损锁住 UTF-8 处理。渲染侧：24×16 旗帜在字号 12 下产出 `width="18px" height="12px" viewBox="0 0 24 16"`；浅色主题的 data URL 解码回 SVG 后含 `fill="#222"` 且不再含 `currentColor`——白底白图标的事故就此关闭；缓存测试证明同一 `(颜色, 字号, 键)` 只编码一次、任一维度变化都会重新编码。

## 小结

渲染管线四步：穿壳（xmlns + 显示尺寸 + 原始坐标系）、按 ratio 撑宽（高度跟字号，宽度跟宽高比）、主题色替换（没有继承链就把颜色变成输入）、base64 内嵌成 data URL（自包含的「图片」）。产物按三元组缓存。加上第 5 章的缓存加载，数据段已完整：集合 id 进去，能画出来的 data URL 出来。下一章停下来看一眼全局——这堆数据为什么这样拆、那样放，包体与离线之间的账是怎么算平的。
