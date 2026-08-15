---
title: 静态文件服务：root、index 与 MIME
---

# 静态文件服务：root、index 与 MIME

周五下午，你把刚构建好的 `dist` 交给运维放到服务器上。首页打开了，但页面是白的。打开 DevTools 的 Network 面板，`main.js` 躺在那一行红色里：

```text
Refused to execute script from 'https://shop.example.com/main.js' because its
MIME type ('text/plain') is not executable, and strict MIME checking is enabled.
```

`main.js` 明明就是 JS，为什么浏览器说它 MIME 类型是 `text/plain`？因为**文件是什么类型，不是由内容决定的，而是由响应头 `Content-Type` 声明的**。伺服这份 dist 的进程没有做扩展名映射，把所有文件都当纯文本发回来，浏览器按声明严格执行——声明是文本，就绝不当脚本执行。这是浏览器的安全防线（nosniff 严格检查），不是 bug。

这一章我们给 mini-nginx 装上第 1 章那张图里第 ③ 步的第一个 handler：把 URI 翻译成磁盘路径，配上正确的 MIME 类型（MIME type）送出去。做完之后，一份 `dist` 就能被正确地伺服。

## 伺服静态文件的本质：一次翻译加一次声明

把静态服务想透，它只做两件事：

1. **翻译**：URI `/img/logo.png` → 磁盘路径 `/var/www/dist/img/logo.png`。基准目录由 `root` 指令给出，翻译规则就是字符串拼接：`root + URI`。
2. **声明**：按扩展名查表，把 `logo.png` 声明成 `image/png`，写进 `Content-Type` 响应头。

真实 Nginx 里这件事只需要三行配置：

```nginx
server {
  listen 80;
  root /var/www/dist;   # 翻译的基准目录
  index index.html;     # 请求命中目录时找哪个文件
}
```

但三行配置背后藏着三个决定线上行为的细节，每个都值得亲手实现一遍。

**细节一：`index` 的语义。** 用户访问的 URI 几乎永远是 `/` 而不是 `/index.html`。`/` 翻译过来是一个目录，不能直接当文件发。Nginx 的处理是：URI 是目录时，追加 `index` 指令的文件名（默认 `index.html`）再试一次。目录里没有 `index.html` 会怎样？默认配置下返回 **403** 而不是 404——"目录存在但没有入口"在 Nginx 语义里是权限问题（autoindex 未开启，不允许列目录）。

**细节二：403 与 404 的分工。** 文件不存在 → 404；路径不合法或目录穿越 → 403。这不是咬文嚼字：第 12 章读 access_log 排障时，一个 403 和一个 404 指向完全不同的排查方向。

**细节三：MIME 表是有限枚举。** 真实 Nginx 靠 `mime.types` 文件提供一千多行映射；`html/js/css/svg/woff2` 这些前端高频项，一张二十行的表就够 mini-nginx 用了。

## mini-nginx 实现：从匹配到落盘

先定配置的形状。圣经里的约定是**配置键与 nginx.conf 指令逐字相同**，所以 mini-nginx 的配置长这样：

```ts
const config: MiniNginxConfig = {
  server: {
    root: wwwRoot,
    locations: [{ match: { type: 'prefix', path: '/docs' }, root: altRoot }],
  },
}
```

`root`、`locations` 与 nginx.conf 一一对应。请求进来后的主流程在 `src/server.ts` 里，此刻只有四步——解析 URI、做 location 匹配、确定 root、交给静态 handler：

```ts
const loc = findLocation(config.server.locations, uri)
const root = loc?.root ?? config.server.root
await serveStatic(res, root, uri, loc?.index ?? DEFAULT_INDEX)
```

注意解析 URI 时的一个坑：不能图省事用 `new URL(req.url)`，因为 WHATWG URL 规范会把路径里的 `/../` 段自动消解掉——听上去像帮了你，实际上它把穿越攻击的证据抹掉了。mini-nginx 手动截取 `?` 之前的原始路径再 `decodeURIComponent`，这样 `/img/../../etc/passwd` 里的 `..` 段才能原样进入防御检查。

静态 handler 的核心在 `src/static.ts`，防御与翻译都在这十几行里：

```ts
const relative = uri.slice(1)
if (relative.split('/').includes('..') || relative.includes('\\')) {
  return sendText(res, 403, 'forbidden')
}
const absPath = join(root, relative)
const info = await stat(absPath).catch(() => null)
if (info?.isFile()) return streamFile(res, absPath)
if (info?.isDirectory()) {
  const indexInfo = await stat(join(absPath, indexFile)).catch(() => null)
  if (indexInfo?.isFile()) return streamFile(res, join(absPath, indexFile))
  return sendText(res, 403, 'forbidden')
}
return sendText(res, 404, 'not found')
```

四个分支正好对应四个行为承诺：含 `..` 的路径 403；命中文件直接流式发送；命中目录找 index，找到发 index、找不到 403；都不命中 404。`streamFile` 发送前按扩展名查 `src/mime.ts` 的表写 `Content-Type`，并带上 `Content-Length`——浏览器进度条、范围请求都依赖这个头。

本章测试（`tests/serve-static.test.ts`）把这些行为逐条钉死：

```text
✓ GET / 命中默认 index，返回 index.html
✓ JS 文件返回 application/javascript（不再被当成文本）
✓ CSS 与 PNG 各自返回正确 MIME
✓ 不存在的文件返回 404
✓ 目录穿越路径返回 403
✓ location 级 root 覆盖 server 级 root
```

其中穿越测试特意绕过 `fetch` 用原生 socket 直发原始路径——因为 fetch 也会在客户端把 `../` 规范化掉，让 403 分支永远测不到。

## root 与 alias：一对最容易混的指令

上例配置里 `/docs` 的文件实际取自另一个目录。真实 Nginx 做同样的事有两种写法，语义差在**拼不拼 location 前缀**：

```nginx
# 写法一 root：最终路径 = /alt/docs/guide.html（拼接完整 URI）
location /docs/ { root /alt; }

# 写法二 alias：最终路径 = /alt/guide.html（剥掉 /docs/ 前缀再拼）
location /docs/ { alias /alt; }
```

mini-nginx 实现的是 root 语义（`root + 完整 URI`），因为它也是 server 级 `root` 的同一条代码路径。前端场景里 90% 的静态配置用 root 就够；alias 的典型用途是 `/static/` 直接映射到 CDN 落地目录这类"换前缀"需求。记住判别方法：**要保留 URI 前缀用 root，要去掉前缀用 alias**，以及一条老坑——alias 结尾的斜杠和 location 结尾的斜杠必须成对出现，不成对路径就会拼接错误。

## 验证

进入 `companion/` 目录执行 `npm run typecheck && npm test`，7 个断言全绿意味着：一份真实的 `dist` 放进 root 指向的目录，`/`、`/index.html`、JS、CSS、图片全部以正确的状态码和 MIME 返回，白屏问题从根上消失。本章之后，mini-nginx 拥有了 handler 的最简形态——下一章让"选 location"这一步从朴素的前缀顺序升级为真实 Nginx 的完整优先级算法。

---

**本章要点**：静态服务 = root 翻译路径 + MIME 表声明类型；URI 命中目录时追加 `index` 指令的文件名，无 index 的目录是 403 不是 404；403 管路径非法、404 管文件不存在；root 拼完整 URI，alias 剥前缀。浏览器拒绝执行 MIME 声明错误的脚本，白屏多数死在这一步。
