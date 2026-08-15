---
title: gzip 压缩：把 2.3MB 的 vendor.js 降到 600KB
---

# gzip 压缩：把 2.3MB 的 vendor.js 降到 600KB

投放页上线第一天，投放组来要说法：落地页在 4G 下白屏 9 秒，一半流量在白屏期间流失了。打开 DevTools 的 Network 面板，原因一目了然——`vendor.js` 传输体积 2.3MB。Lighthouse 早就把答案挂在性能评分里了：一条红色警告「Enable text compression」（启用文本压缩），一直没人处理。

要理解这条警告有多亏：这 2.3MB 是打包压缩后的 JS 文本，gzip（gzip 压缩）对这类高冗余文本的压缩比通常在 3-5 倍——**服务器上五行配置，传输量降到 600KB 左右，零代码改动**。这不是优化，是捡钱。

## 压缩是协商出来的

HTTP 压缩是个双向协议，不是服务器单方面决定的：

1. 浏览器发请求时带上 `Accept-Encoding: gzip, deflate, br`——"我解得开这些格式"；
2. 服务器看到自己支持且响应适合压缩，就压缩响应体，加 `Content-Encoding: gzip` 头发回；
3. 浏览器按声明解压。

任何一环缺失——客户端没声明、服务器没开启、类型不在白名单——响应就以原样返回。所以排查"为什么没压缩"永远查三件事：请求有没有 `Accept-Encoding`，响应有没有 `Content-Encoding`，配置覆盖没覆盖这个类型。

第三件事是高频坑。真实 Nginx 的配置：

```nginx
gzip on;                # 总开关
gzip_min_length 1k;     # 小于 1KB 不压：省下的还不够 gzip 头的 ~20 字节开销
gzip_types text/css application/javascript application/json image/svg+xml;
```

坑在 `gzip_types` 的默认值**只有 `text/html`**。无数人配了 `gzip on` 就以为完事了，curl 一测 JS 还是原样——因为 JS 根本不在默认白名单里。mini-nginx 的默认白名单直接内置了前端全家桶（html/css/js/json/svg/plain），但你要记住真实 Nginx 需要显式写全。

两个"不压"同样值得讲透：

- **图片不压**。PNG、JPEG、WOFF2 本身就是压缩格式，信息冗余已经被榨干，再过一遍 gzip 体积几乎不变，CPU 全白烧。所以白名单是"文本类 MIME 类型（MIME type）"的黑名单式排除——这就是 MIME 表存在的另一个理由：压缩决策按 Content-Type 走。
- **小文件不压**。gzip 流自带约 20 字节的头尾开销，50 字节的文件压完可能更大，还搭上一次 CPU。`gzip_min_length` 就是这条经济学红线，mini-nginx 对应 `gzip.minLength`。

## mini-nginx 实现：一个纯函数，两条管线

决策逻辑收在 `src/gzip.ts` 的一个纯函数里，三个条件与上节一一对应：

```ts
export function shouldGzip(
  contentType: string,
  size: number,
  acceptEncoding: string | undefined,
  options: GzipOptions | undefined,
): boolean {
  if (!options) return false
  const types = options.types ?? DEFAULT_GZIP_TYPES
  if (!types.includes(contentType)) return false
  if (size < (options.minLength ?? 0)) return false
  return (acceptEncoding ?? '').includes('gzip')
}
```

执行在 `src/static.ts` 的 `streamFile`，压缩前后是两条不同的响应管线：

```ts
if (ctx && shouldGzip(contentType, info.size, ctx.acceptEncoding, ctx.gzip)) {
  // 压缩后长度不可预知：去掉 Content-Length，交给 chunked 传输
  res.writeHead(200, { 'Content-Type': contentType, 'Content-Encoding': 'gzip' })
  createReadStream(filePath).pipe(createGzip()).pipe(res)
  return
}
res.writeHead(200, { 'Content-Type': contentType, 'Content-Length': info.size })
createReadStream(filePath).pipe(res)
```

注意压缩分支悄悄做了一件事：**摘掉了 `Content-Length`**。未压缩时文件大小已知，可以声明精确长度；压缩后要等压缩机吐完最后一个字节才知道总长，只能改用 HTTP 的 chunked 传输（分块发送，块头标长度）。浏览器进度条因此拿不到总长——这是压缩唯一的体验代价，而 Node 的 `zlib.createGzip()` 是流式的，8.9KB 和 8.9GB 走的是同一套管道，内存占用恒定。真实 Nginx 同理，压缩永远在流上进行，不会把整个文件读进内存。

`server.ts` 只多了三行：把请求的 `Accept-Encoding` 和 `gzip` 配置打包成 `serveCtx` 传给静态 handler——第 9 章的缓存策略、第 10 章的跨源头会坐进同一辆"上下文"车。

## 验证（以及为什么不用 fetch 测）

`npm run typecheck && npm test`，44 个断言全绿，本章新增七条：

```text
✓ 带 Accept-Encoding: gzip 的请求收到 gzip 响应，解压后与原文件一致
✓ 压缩比可观：8.9KB 文本显著缩小（实测 < 1/5）
✓ 不带 Accept-Encoding 时不压缩，原样返回
✓ PNG 不压缩：已压缩格式收益为负
✓ 小于 minLength 的文件不压缩
✓ SVG 属于文本类资源，压缩
✓ 未配置 gzip 的服务器不压缩（server 级开关，默认关闭）
```

测试用例里藏着一个值得记录的工程细节：断言响应头和字节必须用 `rawGet`（`node:http` 原生请求），不能用 `fetch`——undici 会**透明解压** gzip 响应并把头摘掉，你永远看不到 `Content-Encoding: gzip`。测试工具替你"优化"掉的东西，恰恰是你要验证的东西。这个坑和第 2 章"fetch 会规范化掉 `../`"是同一族：**测试基础设施会悄悄改变被测系统的输入**，黑盒断言前先确认盒子没被动过手脚。

## 生产延伸：brotli 与 gzip_static

两条常用进阶，mini-nginx 未实现（原因和取舍记录在第 12 章差异地图）：

- **brotli（br）**：Google 的压缩算法，同 CPU 档位下比 gzip 再小 15-20%，现代浏览器全支持。Nginx 需要 `ngx_brotli` 模块，配置面与 gzip 同构（`brotli on; brotli_types ...`）。
- **gzip_static**：构建时预压缩（Vite 配 `vite-plugin-compression` 产出 `.gz` 文件），Nginx 开 `gzip_static on` 后直接发现成的 `.gz`，省掉运行时压缩的 CPU。流量大的站点值得，长尾小站 gzip 实时压足够。

下一章是与压缩并列的另一半性能课：缓存。压缩省的是"传输体积"，缓存省的是"传输次数"——后者天花板更高，但配错时的爆炸力也更大。

---

**本章要点**：压缩是 `Accept-Encoding` × `Content-Encoding` 的协商结果；真实 Nginx 的 `gzip_types` 默认只有 html，前端全家桶要显式加白；图片已压缩、小文件不划算，都不压；压缩响应摘 `Content-Length` 改 chunked；测试基础设施（fetch 透明解压）会掩盖你要断言的事实，黑盒前先验盒子。
