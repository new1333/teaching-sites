---
title: try_files 与 SPA History 路由回退
---

# try_files 与 SPA History 路由回退

上线两周的订单系统，客服每周都接到同一类工单：「页面丢了」。你复现了一下：从首页点进订单详情，URL 变成 `/orders/42`，一切正常；在这个页面按 F5 刷新，404。首页能开、站内跳转能开、唯独刷新就死——这不是路由代码的 bug，是**路由模式和服务器之间的一纸契约还没签**。

Vue Router 或 React Router 的 history 模式靠 `history.pushState` 改 URL。点进 `/orders/42` 时，浏览器并没有向服务器发请求——页面切换全在 JS 里完成，URL 只是"本地记了一笔账"。可 F5 是真的请求：浏览器拿着 `/orders/42` 请求服务器，而服务器磁盘上只有 `index.html` 和一堆静态资源，根本没有 `orders` 目录。404 是磁盘诚实汇报的结果。

hash 模式（`/#/orders/42`）为什么没这个问题？因为 `#` 后面的部分根本不会发给服务器，服务器永远只收到 `/`。history 模式把路由信息放进了请求路径，代价就是：**服务器必须认识这些路径，但它并不认识**。解决办法就是告诉服务器一条兜底规则——文件不存在时，回 `index.html`，让前端路由自己接管。这条规则叫 `try_files`。

## try_files 的语义：逐项尝试，末项特殊

```nginx
location / {
  try_files $uri $uri/ /index.html;
}
```

读法：对每个请求，先把 `$uri`（当前请求 URI 的占位符）当文件路径试；再当目录试（找 index）；都不存在，执行最后一项 `/index.html`。最后一项的语义和前面不同——**以 `/` 开头的末项不是文件，是内部重定向**：Nginx 把 URI 换成它，然后从头重新走一遍"匹配 location → 选 handler"的流程。`/index.html` 重新匹配到 `location /`，这次 `$uri` 是 `/index.html`，磁盘上存在，文件被返回。

内部重定向意味着无限循环的可能：如果回退目标永远不存在、而它又总能匹配回同一个 location，请求就会转圈。真实 Nginx 的保护是硬上限 10 次，超限记日志并返回 500——这不是理论风险，配置写错时（比如回退目标拼写错误）它就是你的 500 页面。

## mini-nginx 实现：一个受保护的循环

解析逻辑在 `src/static.ts`，语义逐条对齐：

```ts
export async function resolveTryFiles(
  entries: string[],
  uri: string,
  root: string,
): Promise<TryFilesResult> {
  const expand = (entry: string): string => entry.replaceAll('$uri', uri)
  for (const entry of entries.slice(0, -1)) {
    const candidate = expand(entry)
    if (await isFileUnder(root, candidate)) return { kind: 'file', uri: candidate }
  }
  const last = expand(entries[entries.length - 1])
  if (last.startsWith('/')) return { kind: 'redirect', uri: last }
  if (await isFileUnder(root, last)) return { kind: 'file', uri: last }
  return null
}
```

返回值有三种：命中文件（`file`）、需要重走匹配的回退（`redirect`）、全部落空（`null` → 404）。非末项只做文件存在性检查，末项以 `/` 开头即内部重定向——这两条正是 nginx 文档里最容易被略读的句子。

真正让它跑起来的是 `src/server.ts` 里 handler 的这次结构升级。上一章的 handler 是单程的，现在变成了一个循环：try_files 的回退 URI 会**重新进入 location 匹配**，这需要对齐真实 Nginx 的行为，而不是简单地把 index.html 读出来完事：

```ts
let uri = rawPath
for (let hop = 0; hop < MAX_INTERNAL_REDIRECTS; hop++) {
  const loc = matchLocation(config.server.locations, uri)
  const root = loc?.root ?? config.server.root
  if (!root) return sendText(res, 500, 'no root configured')
  const index = loc?.index ?? DEFAULT_INDEX

  if (loc?.try_files?.length) {
    const next = await resolveTryFiles(loc.try_files, uri, root)
    if (!next) return sendText(res, 404, 'not found')
    if (next.kind === 'redirect') {
      uri = next.uri
      continue
    }
    return serveStatic(res, root, next.uri, index)
  }

  return serveStatic(res, root, uri, index)
}
return sendText(res, 500, 'internal redirection cycle')
```

`MAX_INTERNAL_REDIRECTS = 10`，超限返回 500——测试里专门有一条：配置 `try_files: ['$uri', '/loop']` 且 `/loop` 永不存在，请求必须返回 500 而不是把进程挂死。

## 一个必须配对的反例：回退不能无差别兜底

看本章测试的配置，注意 `/assets/` 是独立的 `^~` 块，**没有** try_files：

```ts
locations: [
  { match: { type: '^~', path: '/assets/' } },                                   // 静态直取，缺失 404
  { match: { type: 'prefix', path: '/' }, try_files: ['$uri', '/index.html'] },  // 页面路由回退
]
```

为什么不给所有路径统一回退？想象 `location /` 一把兜底的配置：用户请求 `/assets/app-3f9c.js`（发版后旧 hash 文件已被删除），回退逻辑返回 `index.html`——**状态码 200，Content-Type 是 text/html**。浏览器拿 HTML 当 JS 解析，控制台报出那句著名的 `Uncaught SyntaxError: Unexpected token '<'`。资源 404 本身只是小事故（第 9 章会用缓存策略根治），被回退伪装成 200 之后才变成难查的大事故——Network 面板里一片绿色，错误却来自"内容不对"。

所以生产配置的黄金结构是两层：**资源路径（`/assets/`）不回退，缺失诚实 404；页面路径（`/`）回退 index.html**。`^~` 在这里再次出场：阻止正则块插队，也让这条例外的优先级盖过 `/`。

## 验证

`npm run typecheck && npm test`，21 个断言全绿，本章新增的五条：

```text
✓ 深层路由 /orders/42 回退返回 index.html（刷新不再 404）
✓ 真实存在的资源命中 $uri 分支，按文件返回
✓ /index.html 自身经 $uri 分支正常返回
✓ ^~ 静态块不回退：缺失资源直接 404
✓ 回退目标永不存在时返回 500 而非死循环
```

到这里，第 1 章那张图的第 ③ 步（静态 handler）和第 ② 步（匹配）都完整了，mini-nginx 已经是一个能正确伺服任意 SPA 的静态服务器。但前端工程师的 Nginx 故事通常不止静态文件——下一章进入第二分部：`proxy_pass`，让 `/api` 找到后端。

---

**本章要点**：history 路由刷新 404 是因为服务器磁盘上没有路由路径对应的文件；`try_files $uri /index.html` 的末项以 `/` 开头即内部重定向，会重走 location 匹配；循环上限 10 次、超限 500；生产配置两层结构——资源块不回退（诚实 404），页面块回退（防刷新白屏）。
