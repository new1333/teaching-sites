---
title: 反向代理 proxy_pass：本地联调与同源部署
---

# 反向代理 proxy_pass：本地联调与同源部署

新项目开工第一天你就撞上它：页面跑在 `localhost:5173`，后端接口在 `test.example.com:8080`。`fetch('/api/user')` 发出去，控制台一片红：

```text
Access to fetch at 'http://test.example.com:8080/api/user' from origin
'http://localhost:5173' has been blocked by CORS policy: No 'Access-Control-
Allow-Origin' header is present on the requested resource.
```

后端说"接口我用 curl 是好的"。没错，curl 没有同源策略，浏览器有。你的第一反应可能是让后端加 CORS 响应头（第 10 章会讲），但生产环境的正解往往更简单：**让浏览器从头到尾只跟一个源打交道**。Nginx 站在最前面伺服静态文件，`/api` 开头的请求在 Nginx 内部转给后端——浏览器请求的是 `https://shop.example.com/api/user`，同源，CORS 检查根本不触发。这件事就叫反向代理（reverse proxy）。

于是前端的联调配置分裂成两份：开发期在 Vite 的 `devServer.proxy` 配一遍，上线再求运维在 Nginx 配一遍。这一章把两边打通——它们的语义同源，都来自 Apache 时代传下来的 proxy 规则，只是语法不同。mini-nginx 用与 nginx.conf 相同的 `proxy_pass` 键实现它，你写一遍，两份配置就都看得懂了。

## 为什么叫"反向"

先分清方向。你挂 VPN 翻墙，是**正向代理**：代理站在客户端这边，替你访问服务器，服务器不知道真实客户端是谁。反向代理反过来，站在服务端这边：客户端只知道 `shop.example.com`，不知道、也不需要知道背后有几台后端、在哪台机器上。

这个"客户端无感"带来三个前端工程师天天受益的能力：

1. **同源化**：跨域问题在网关层消失（本节开头的问题）；
2. **隐藏拓扑**：后端服务可以监听内网端口，永远不暴露公网；
3. **负载均衡与故障转移**：背后挂多台后端（第 7 章）。

## proxy_pass 的路径语义：一字符的事故

`proxy_pass` 最容易出事故的地方是**带不带路径**——差一个尾斜杠，后端收到的 URI 完全不同。规则只有两条：

- **不带路径**：`proxy_pass http://backend;` → 请求 URI **原样透传**。`/api/user` 到后端还是 `/api/user`。
- **带路径**：`proxy_pass http://backend/v2/;` → location 匹配的那段前缀**被替换**成这个路径。

第二条需要结合第 3 章：请求 URI 命中 location 的前缀被"剪掉"，剩下部分拼到 proxy_pass 路径后面。对照表（按 `location /api/` + `GET /api/user` 推导）：

| location | proxy_pass | 后端收到 | 说明 |
|---|---|---|---|
| `/api/` | `http://backend` | `/api/user` | 不带路径，透传 |
| `/api/` | `http://backend/` | `/user` | 前缀 `/api/` 被替换为 `/` |
| `/api/` | `http://backend/v2/` | `/v2/user` | 前缀被替换为 `/v2/` |
| `/api` | `http://backend/` | `//user` | 事故现场：前缀 `/api` 剪掉后剩 `/user`，拼上 `/` 变双斜杠 |

最后一行是真实的经典事故：location 不带尾斜杠而 proxy_pass 带尾斜杠，后端收到 `//user`，路由匹配不上，404。**口诀：location 和 proxy_pass 的尾斜杠要成对出现。**

## mini-nginx 实现：两条规则，两个管道

路径计算在 `src/proxy.ts`，就是上表的两条规则：

```ts
export function buildUpstreamPath(target: URL, loc: LocationBlock, uri: string): string {
  const basePath = target.pathname
  if (!basePath || basePath === '/') return uri          // 不带路径 → 透传
  const { type, path: prefix } = loc.match
  if (type === '~' || type === '~*') return uri          // 正则块不做前缀替换
  const rest = uri.startsWith(prefix) ? uri.slice(prefix.length) : ''
  return basePath + rest || '/'                          // 带路径 → 剪前缀、拼新路径
}
```

转发本体是 Node 的 `http.request` 加两个管道，值得逐行读：

```ts
const upstreamReq = http.request(
  {
    protocol: target.protocol, hostname: target.hostname, port: target.port || 80,
    method: req.method,
    path: buildUpstreamPath(target, loc, uri) + search,
    headers: { ...req.headers, host: target.host },
  },
  (upstreamRes) => {
    res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers)
    upstreamRes.pipe(res)
  },
)
upstreamReq.on('error', () => sendText(res, 502, 'bad gateway'))
req.pipe(upstreamReq)
```

三个设计点。**其一，两个 `pipe` 就是代理的全部数据面**：`req.pipe(upstreamReq)` 把客户端请求体流给上游（POST 的表单、上传的文件不需要在内存里攒完），`upstreamRes.pipe(res)` 把上游响应流回客户端。真实 Nginx 干的也是这件事，只是用 C 缓冲区而非 Node 流。**其二，Host 头默认改成上游主机**——这是 nginx 的默认行为（`$proxy_host`），后端虚拟主机路由因此能正常工作；哪些头该透传、哪些该改写是第 6 章的主题。**其三，上游连不上返回 502**——"bad gateway"，网关视角的"我去敲了门但没人应"。注意上游自己返回的 500 要**原样透传**：那是后端的真实状态，网关不能替它粉饰。

接入点在 `src/server.ts` 的分发循环里，一行：

```ts
if (loc?.proxy_pass) return proxyPass(req, res, loc, uri, search)
```

排在静态 handler 之前——一个 location 要么代理、要么伺服文件，与 nginx 的直觉一致。

## 验证

`npm run typecheck && npm test`，27 个断言全绿，本章新增六条：

```text
✓ 不带路径：URI 与查询串原样透传
✓ 带路径：location 前缀被 proxy_pass 路径替换
✓ POST 方法与请求体透传
✓ 自定义请求头透传
✓ 上游 500 原样透传，不被网关改写
✓ 上游拒连时网关返回 502
```

测试里的上游是 `tests/helpers.ts` 提供的 mock 服务器——把收到的请求录下来再应答，断言"后端到底收到了什么"因此成为可能，这个 helper 会一直用到第 7 章。

回头看开头的联调问题，现在有两层解法：临时方案让后端开 CORS 头，第 10 章教你；长期方案同源部署加代理，本章已经实现。下一章处理代理的第一批副作用——后端日志里全是 Nginx 机器的 IP、WebSocket 一断线就报 1006，两个现象同一个根源：**有些信息在穿过代理时丢了**。

---

**本章要点**：反向代理站在服务端前面，客户端无感；同源部署让 CORS 检查根本不触发；proxy_pass 不带路径透传 URI、带路径替换 location 前缀，尾斜杠要成对出现；数据面就是两个 pipe；上游 500 透传、拒连 502。
