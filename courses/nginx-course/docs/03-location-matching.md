---
title: location 匹配：一个 URI 命中哪条规则
---

# location 匹配：一个 URI 命中哪条规则

后端同事在 Nginx 里加了一段配置，把 `/api` 交给新服务。上线十分钟后，前端文档站挂了：访问 `https://shop.example.com/api-docs`，浏览器渲染出来的不是文档，而是一串 JSON——正是那个新接口的响应。后端喊冤：我只加了一个 `location /api`，怎么会动到 `/api-docs`？

会，因为 **`location /api` 是前缀匹配**。`/api-docs` 以 `/api` 开头，命中了这条规则，于是整个请求被代理走。这不是玄学，是 location 匹配（location matching）的语义本来如此——只是多数人第一次遇到时没有这张判定地图。

这一章我们把 Nginx 选 location 的完整算法实现出来。它是全书最值得亲手写一遍的算法：写完之后，"哪条规则会命中"这个问题从"翻文档背规则"变成"读自己写过的代码"。

## 四种修饰符，一张判定地图

location 的写法由「修饰符 + 路径」构成，共四种：

```nginx
location = /health { }      # 精确匹配：URI 必须一字不差
location /api { }           # 前缀匹配（无修饰符）：以 /api 开头即命中
location ^~ /assets/ { }    # 前缀匹配 + 阻断正则
location ~ \.js$ { }        # 正则匹配（区分大小写；~* 不区分）
```

关键在于：**这些规则不是按声明顺序从上到下试的**。Nginx 的判定顺序可以背诵成五步：

1. 先查精确 `=`，命中立即返回；
2. 再看所有前缀规则（无修饰符和 `^~` 一起），记住**最长**命中者；
3. 最长者若带 `^~`，直接返回它，**不再看正则**；
4. 否则按**声明顺序**逐个试正则，第一个命中的返回；
5. 没有正则命中，返回第 2 步记住的最长前缀块；一个都没有才落空。

开篇事故在这个算法里走一遍：`/api-docs` 没有精确块；前缀候选有 `/api`（假设还有个 `/`），最长命中是 `/api`；`/api` 不带 `^~`；没有正则；返回 `/api` 块——请求被代理。修法也就清楚了：把规则写成 `location = /api { }`（只接管一字不差的 `/api`），或者 `location /api/ { }`（带尾斜杠，`/api-docs` 不以 `/api/` 开头）。两种修法选哪个，取决于后端接口有没有统一挂在 `/api/` 前缀下。

顺带解释两个设计动机。`^~` 的存在是因为正则昂贵：静态资源都收在 `/assets/` 目录里，明确不需要正则再判一遍，`^~` 就是给这条前缀"封路"的开关。精确 `=` 则不仅语义清晰，在真实 Nginx 里还享受独立的静态哈希表查找——高频健康检查路径值得这么配。

## mini-nginx 实现：两轮循环加一次正则扫描

算法直接落在 `src/location.ts`，与五步一一对应：

```ts
export function matchLocation(
  locations: LocationBlock[] | undefined,
  uri: string,
): LocationBlock | null {
  if (!locations || locations.length === 0) return null

  for (const loc of locations) {
    if (loc.match.type === '=' && uri === loc.match.path) return loc   // ①
  }

  let longestPrefix: LocationBlock | null = null
  for (const loc of locations) {
    if (loc.match.type !== 'prefix' && loc.match.type !== '^~') continue
    if (!uri.startsWith(loc.match.path)) continue                       // ②
    const current = longestPrefix?.match.path.length ?? 0
    if (loc.match.path.length >= current) longestPrefix = loc
  }
  if (longestPrefix?.match.type === '^~') return longestPrefix          // ③

  for (const loc of locations) {
    const { type, path } = loc.match
    if (type === '~' || type === '~*') {
      const re = new RegExp(path, type === '~*' ? 'i' : undefined)      // ④
      if (re.test(uri)) return loc
    }
  }

  return longestPrefix                                                  // ⑤
}
```

三个容易看漏的点，也是这段代码的教学价值所在：

- **"最长前缀"与"声明顺序"是两个维度**。第 ② 步不关心谁先声明，只比路径长度——`/api/v2` 永远压过 `/api`，无论书写顺序。第 ④ 步的正则才按声明顺序取第一个命中。两套排序规则并存，正是 location 配置"看着简单、调起来烧脑"的根源。
- **`^~` 的判定挂在"最长者"身上**，不是"任意一个前缀命中就阻断"。`/assets/a.js` 同时被 `/` 和 `^~ /assets/` 前缀命中，最长者是 `/assets/`，它带 `^~`，于是 `~ \.js$` 根本没机会参与。
- **正则每次匹配前现编译**。mini-nginx 图省事 `new RegExp`；真实 Nginx 在配置加载阶段把正则预编译好，worker 运行时只做匹配——这就是配置文件也是"程序"的一个侧面。

`matchLocation` 是纯函数：输入 location 列表和 URI，输出命中块。`src/server.ts` 的分发逻辑只改了一行——`findLocation`（第 2 章的朴素版本）换成 `matchLocation`。上一章的七个测试原样通过，因为对"只有一个前缀块"的配置，朴素版和完整版行为一致；新增的九个断言专门钉住优先级：

```text
✓ 精确 = 优先于一切：/exact 不落入前缀 /
✓ 普通前缀取最长：/api/v2/orders 命中 /api/v2 而非先声明的 /api
✓ 正则按声明顺序优先于最长普通前缀：/app.js 命中 ~ \.js$ 而非前缀 /
✓ ^~ 阻断正则：/assets/ 下的 js/png 不再被正则抢走
✓ ~ 大小写敏感、~* 不敏感：/logo.PNG 与 /photo.JPG 分流
✓ GET /health 走精确块，GET /health/x 落回前缀块
```

集成用例里有个细节值得留意：`location = /health` 配的 root 下，文件名必须是 `health` 而不是 `index.html`——因为静态翻译规则是 `root + 完整 URI`，精确块拿到 URI 是 `/health`，翻译结果就是 root 目录下的 `health` 文件。写这个测试时我自己都先写错过一次，恰好说明：匹配和翻译是两个独立步骤，精确块只影响"命中谁"，不影响"怎么翻译路径"。

## 验证与常见事故速查

`npm run typecheck && npm test` 全绿后，把本章事故修法沉淀成速查表（真实 Nginx 语法与 mini-nginx 同构）：

| 现象 | 原因 | 修法 |
|---|---|---|
| `/api-docs` 被代理 | `location /api` 前缀吞掉 | `= /api` 或 `/api/` |
| `/assets/a.js` 走了正则块 | `^~` 没加 | `^~ /assets/` |
| `.JPG` 请求没命中正则 | `~` 区分大小写 | 换 `~*` |
| 规则永远不生效 | 被更长的前缀盖住 | 检查是否有更具体的前缀块 |

下一章是最常搜的一个问题：前端路由history 模式下，刷新就 404。你已经有了匹配算法，只差一条 `try_files`。

---

**本章要点**：判定五步——精确、最长前缀、`^~` 阻断、正则按声明顺序、前缀兜底；"最长"与"声明顺序"是两个维度；`/api` 会吞 `/api-docs`，精确或带尾斜杠的前缀才收口。匹配决定"谁处理"，翻译（root + URI）决定"读哪个文件"，两步互相独立。
