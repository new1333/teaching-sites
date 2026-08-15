---
title: 缓存控制：一半用户新一半用户旧的怪事
---

# 缓存控制：一半用户新一半用户旧的怪事

发版之后的第二天，客服群里出现了一种诡特的分裂：同样的链接，一批用户看到新版本，另一批用户死活还是旧版——让他们 Ctrl+F5 才解决。你以为这就完了，周三上线修复版，这次是另一种翻车：用户打开白屏，控制台报 `Failed to load resource: 404`，加载的是 `/assets/app-3f9c12.js`——**一个新版本里已经不存在的文件**。

两个现象是同一枚硬币的两面，都出在缓存层。第二个尤其反直觉：明明没配置任何缓存，为什么浏览器还在"缓存"？因为 HTTP 缓存的默认行为不是"不缓存"——没有 `Cache-Control` 时，浏览器会用自己的启发式算法猜一个新鲜期（通常基于上次响应的年龄猜出文件寿命的 10%）。你没收过浏览器的缓存权，它就自己做主。

## 两级缓存：谁发起请求，谁判定新鲜

把机制想成两级，后面所有配置都是在这两级上做文章：

**强缓存（strong caching）**——浏览器完全自己做主，**连请求都不发**。服务器说过 `Cache-Control: max-age=31536000`，一年之内浏览器直接用本地副本，Network 面板里显示 `(from disk cache)`，服务器毫无感知。

**协商缓存（conditional request）**——浏览器带着凭证问服务器"我这份还新鲜吗"。凭证是 `ETag`（资源的指纹），问法是 `If-None-Match: "指纹"`。服务器比对指纹：没变 → 回 `304 Not Modified` 空体（只有头，没有一个字节的 body）；变了 → 回 200 全量。**协商缓存永远有请求往返，但没变时零 body 传输。**

两级的关系：强缓存期内协商根本不会发生；`Cache-Control: no-cache` 的意思不是"不缓存"而是"**存，但每次用前必须协商**"——这个词害过无数人，它的真实含义是"跳过强缓存"。

现在两个事故都能诊断了。分裂怪象：没配缓存 → 启发式缓存 → 不同浏览器猜的新鲜期不同 → 有人用旧版有人用新版。404 白屏：某个旧版本的 `index.html` 被浏览器留着（启发式缓存），它引用带旧 hash 的 JS 文件，而服务器上旧 hash 文件已随发版删除。

## 前端构建产物的标准答案

现代构建工具（Vite、webpack）都给产物文件名带内容 hash：内容变 → 文件名变。这给了一个可以背诵的缓存策略，两个 location，两种待遇：

```nginx
# 带 hash 的产物：内容寻址，文件名就是指纹，放心强缓存一年
location ^~ /assets/ {
  expires 1y;
  add_header Cache-Control immutable;
}

# 入口页：绝不能强缓存，每次都协商
location / {
  try_files $uri /index.html;
  add_header Cache-Control no-cache;
}
```

逻辑闭环在哪？`index.html` 每次协商 → 发版后第一次访问就拿到新 HTML → 新 HTML 引用的是新 hash 文件名 → 浏览器缓存里没有这个名字 → 请求服务器 → 拿到新文件并缓存一年。**入口永远新鲜，产物永远不重复下载**。`immutable` 是锦上添花：它告诉浏览器"这文件这辈子不会变"，连用户按 F5 时的再验证都省了（没有它，刷新会让浏览器对缓存资源发一轮协商）。

第 4 章埋的伏笔在这里兑现：hash 文件 404 只在"旧 HTML 活过了一个版本"时发生。把 `index.html` 钉死在 `no-cache`，旧 HTML 的寿命就只有一次协商——404 白屏从机制上消失。

## mini-nginx 实现：指纹、比对、304

三个函数收在 `src/cache.ts`，每个都短到能背：

```ts
export function cacheControlFor(policy: ExpiresPolicy | undefined): string | undefined {
  if (!policy) return undefined
  if (policy === 'no-cache') return 'no-cache'
  return policy.immutable
    ? `max-age=${policy.maxAge}, immutable`
    : `max-age=${policy.maxAge}`
}

export function entityTag(stat: Stats): string {
  return `"${Math.floor(stat.mtimeMs / 1000).toString(16)}-${stat.size.toString(16)}"`
}
```

`entityTag` 是 nginx 的同款算法：**修改时间（秒）十六进制 + `-` + 文件大小十六进制**。它不是加密级指纹（同秒同大小的两次修改会撞车），但对"发版后文件变没变"这个判定场景，便宜且足够——这也是为什么带 hash 的文件名更可靠：hash 由内容算出，而 ETag 由元信息算出。

协商的执行点在 `src/static.ts` 的 `streamFile` 里，排在压缩之前——304 连 body 都没有，自然没什么可压：

```ts
if (etag && etagMatches(ctx?.ifNoneMatch, etag)) {
  const headers: Record<string, string> = { ETag: etag }
  if (cacheControl) headers['Cache-Control'] = cacheControl
  res.writeHead(304, headers)
  res.end()
  return
}
```

`etagMatches` 处理了 `If-None-Match` 的现实噪声：客户端可能带 `W/` 弱验证前缀、可能一次列多个候选、可能发 `*`。比对时把这些都归一化，才不会出现"明明一样却 200"的诡异 bug。

配置面上是两条既定路线，正好复用第 3、4 章的结构——`^~ /assets/` 抢占式前缀管产物，`/` 兜底管入口：

```ts
locations: [
  { match: { type: '^~', path: '/assets/' }, expires: { maxAge: 31536000, immutable: true } },
  { match: { type: 'prefix', path: '/' }, expires: 'no-cache' },
]
```

## 验证

`npm run typecheck && npm test`，49 个断言全绿，本章新增五条：

```text
✓ hash 资源：max-age 一年 + immutable，附 ETag
✓ index.html：no-cache（每次协商，绝不强缓存）
✓ If-None-Match 命中返回 304 空体
✓ 文件变化后 ETag 变化，旧 ETag 拿到 200 新内容
✓ etag: false 的块不输出 ETag，也不会 304
```

304 用例值得看一眼：先发一次普通请求拿到 ETag，再带着它发第二次，断言状态 304 且 `body.length === 0`。"文件变化"用例则改写文件后拿旧指纹问——大小一变，ETag 即变，200 新内容返回。这两个往返就是协商缓存的全部生命周期。

## 顺带说清 no-store 与代理缓存

两个延伸概念，混进面试和事故复盘的频率很高：

- **`no-store`** 比 `no-cache` 更狠：**存都不许存**，每次全量。用于敏感数据响应（个人报表、支付页）。静态资源永远不该用它。
- **代理/CDN 缓存**与浏览器缓存是两个独立层，各自遵守同一套 `Cache-Control` 语义。挂在 CDN 后面的站点改配置时，记得 CDN 边缘节点的缓存也要失效——"Nginx 改了怎么没生效"的另一半答案通常在那里。

压缩省的是单次传输的体积，缓存省的是整次传输——到这里，静态侧的性能课闭环。下一章处理剩下的高频跨域问题：`add_header` 与 CORS。

---

**本章要点**：强缓存不发请求，协商缓存零 body（304）；`no-cache` 是"每次协商"不是"不缓存"，无配置时浏览器用启发式缓存自作主张；标准答案 = hash 产物 `max-age` 一年 + `immutable`，入口 `no-cache`；ETag = mtime-size 十六进制，文件名 hash 比它更可靠。
