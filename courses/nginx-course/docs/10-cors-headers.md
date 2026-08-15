---
title: CORS 与 add_header：跨域资源共享在网关层怎么做
---

# CORS 与 add_header：跨域资源共享在网关层怎么做

图片服务搬上 CDN 域名的那次重构，埋了两颗雷。第一颗当天爆：营销页要做活动海报合成，`canvas.getImageData()` 抛出 `SecurityError: The operation is insecure`——canvas 被跨域图片"污染"（tainted）了。第二颗隔周爆：新的 H5 站调主站接口，Fetch 报 CORS 错误，DevTools 里能看到一个 `OPTIONS` 请求被打了 405——后端说"我的接口只写了 GET 和 POST 处理，没有 OPTIONS，405 是框架的正确行为"。

两个人都没说错，但用户看到的 就是失败。这一章把跨域资源共享（CORS，Cross-Origin Resource Sharing）在网关层的解法做出来——`add_header` 注入跨源头、`OPTIONS` 预检应答，以及一个让无数人熬夜的继承陷阱。

## 先复习：谁在拦你

第 5 章说过：同源策略是**浏览器**的检查，服务器之间没有这种烦恼。CORS 是浏览器给服务器开的一套"补发通行证"协议：服务器通过 `Access-Control-*` 响应头声明"我允许某某源访问我"，浏览器看到声明才放行 JS 拿到响应。

请求分两类，待遇不同：

**简单请求**（GET/HEAD/POST，且没带自定义头）——浏览器直接发出去，**响应到了之后**再检查有没有 `Access-Control-Allow-Origin`。没有就拦截，JS 拿到报错。canvas 污染就是这类：图片取回来了、也画上去了，但因为响应没带授权头，像素被锁死不给读。

**预检请求（preflight）**——浏览器判断"这个请求有风险"（方法是 PUT/DELETE，或带 `Authorization`、`Content-Type: application/json` 这类自定义/复杂头），就先发一个 `OPTIONS` 询问：

```text
OPTIONS /api/user
Origin: https://h5.example.com
Access-Control-Request-Method: POST
Access-Control-Request-Headers: content-type
```

服务器应答 `204` 加一组 `Access-Control-Allow-*` 头，浏览器才放行真正的请求。405 的雷就在这里：**后端框架没实现 OPTIONS 路由**，预检被当成"未知方法"拒了。谁该应答？在网关架构里，Nginx 是更合适的应答人——它在路由层就知道 Allow 列表，不需要惊动业务代码。

## add_header：最朴素的响应头注入

Nginx 给任何响应加头的指令就是 `add_header`，跨源头只是它的一种用途：

```nginx
# 通用安全头
add_header X-Frame-Options DENY;

location /assets/ {
  # 跨域读图授权：canvas 不再被污染
  add_header Access-Control-Allow-Origin https://app.example.com;
}
```

但它有一条反直觉的继承规则，值得专门写个测试钉死：**add_header 的继承是"全有或全无"——location 里只要出现了一条 add_header，server 级的 add_header 就整体不再继承**，不是合并！后果很真实：你在 server 块给全站加了安全头，某天给某个 location 加了一条跨源头，那个 location 的安全头全丢了——扫描工具半夜报警的那种事故。mini-nginx 把这条语义做进了 `src/headers.ts`：

```ts
export function effectiveAddHeader(
  loc: LocationBlock | null,
  server: ServerBlock,
): Record<string, string> | undefined {
  if (loc?.add_header) return loc.add_header
  return server.add_header
}
```

三行，就是那条坑的完整实现：子块有就用子块的（丢掉父块），没有才继承。想两份都要？在子块里把父块的头重抄一遍——真实 Nginx 里也只有一个笨办法：重抄。

## CORS 的网关实现：注入 + 预检短路

跨域头的生成也在 `headers.ts`，普通请求只带 `Access-Control-Allow-Origin`（外加 `Vary: Origin`，给中间缓存提个醒：响应因源而异，别按 URL 一刀切缓存）。预检请求额外带 Allow-Methods / Allow-Headers / Max-Age：

```ts
export function corsHeadersFor(cors: CorsOptions, req: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': cors.origin,
    Vary: 'Origin',
  }
  if (isPreflight(req)) {
    headers['Access-Control-Allow-Methods'] = cors.methods ?? 'GET, HEAD, POST'
    headers['Access-Control-Allow-Headers'] =
      cors.allowHeaders ?? (req.headers['access-control-request-headers'] as string) ?? '*'
    headers['Access-Control-Max-Age'] = '600'
  }
  return headers
}
```

`isPreflight` 的判定是两个条件的与：`OPTIONS` 方法 **加** `Access-Control-Request-Method` 头——后者是预检的身份证，普通 OPTIONS（比如某些健康探测）不该被当成预检。

接入点在 `src/server.ts` 的分发循环里，预检被"短路"在所有 handler 之前：

```ts
const extraHeaders: Record<string, string> = { ...effectiveAddHeader(loc, config.server) }
if (loc?.cors) Object.assign(extraHeaders, corsHeadersFor(loc.cors, req))

// CORS 预检不进 handler：网关直接应答 204 + Allow-* 头
if (loc?.cors && isPreflight(req)) {
  res.writeHead(204, extraHeaders)
  res.end()
  return
}
```

`extraHeaders` 组装完同时流向两条路：静态响应把它叠进 200/304 的头；代理响应把它叠在 upstream 头**之上**（同名时网关的赢）——所以 `add_header X-Gateway mini` 对代理接口同样生效，跨源头也一样能开给后端接口。

注意"只对配置了 `cors` 的 location 放行"：默认一个头都不发。跨域授权是安全决策，宁可让没配的块报错（问题可见），也不能默认全开（漏洞沉默）。

## 两条路线的取舍

第 5 章的同源代理和本章的 CORS 头放行，是同一个问题的两条解法，怎么选：

| | 同源代理（proxy_pass） | CORS 头放行 |
|---|---|---|
| 改动面 | 网关配置，前端零改动 | 网关配置，前端可能要加 `crossorigin` 属性 |
| 适用 | 你同时控制前端和网关 | 消费方多、不可控（开放 API、第三方嵌入） |
| 副作用 | 后端拓扑被隐藏 | 每个消费源都要维护白名单 |

经验法则：**自家页面调自家接口，用代理同源化，一劳永逸；要把资源开放给别人家的页面读（CDN 图片、开放接口），才用 CORS 头**。canvas 那颗雷的完整拆除还要两步：网关加 `Access-Control-Allow-Origin`，同时 `<img>` 标签写 `crossorigin="anonymous"`——没有后者，浏览器根本不带凭证去要授权，头加得再对也污染。

## 验证

`npm run typecheck && npm test`，55 个断言全绿，本章新增六条：

```text
✓ server 级 add_header 被无自有头的块继承
✓ nginx 继承陷阱：块内出现 add_header 即遮蔽全部继承头
✓ cors 配置为响应注入 Access-Control-Allow-Origin
✓ OPTIONS 预检被网关应答：204 + Allow-* 头
✓ 未配置 cors 的块不输出跨源头
✓ add_header 同样作用于代理响应
```

第 3 章的 location 匹配在这章再次发挥作用——"只给 `/assets/` 开跨域"就是一条 `^~` 前缀规则的事。到这里，第 1 章五步图的第 ④ 步（响应处理）凑齐了 gzip、缓存、跨域三件套。下一章脱离代码，讲上线 HTTPS 前前端要懂的那一课。

---

**本章要点**：CORS 是浏览器执行的授权协议，预检 = OPTIONS + Access-Control-Request-Method，网关应答 204 + Allow-* 头最合适；add_header 继承是"全有或全无"，子块声明即遮蔽父块全部；跨域授权只给显式配置的块开；同源代理与 CORS 放行的取舍——自家流量代理化，开放资源 CORS 化。
