---
title: upstream 负载均衡：发版不再 502
---

# upstream 负载均衡：发版不再 502

后端只有一个实例，每次发版都是固定流程：停服务、替换 jar 包、启动、等预热。这三四分钟里，网关返回 502（bad gateway，网关错误的一种——上游不可达），前端所有的接口报错红一片。更糟的是周五晚高峰，一次重启触发的重试洪峰把刚启动、还没预热完的实例又压趴了——雪崩就是这么开始的。

复盘会上老板问了一个特别朴素的问题：「能不能两台机器轮着发？」能。这一章就是把这个答案配上——`upstream`。它也是第 5 章反向代理的自然延伸：proxy_pass 的目标从"一台地址"升级成"一组地址"。

## upstream：给后端建个组

真实 Nginx 的写法：

```nginx
upstream backend {
  server 127.0.0.1:8081 weight=2;   # 权重：拿 2/3 的流量
  server 127.0.0.1:8082;             # 默认权重 1
  server 127.0.0.1:8083 down;        # 摘除：不参与分发
}

server {
  location /api/ { proxy_pass http://backend; }   # 引用组名
}
```

`proxy_pass http://backend` 里的 `backend` 不再是主机名，是 upstream 组名。分发策略有三种，按需选：

- **轮询（默认）**：依次分给每台，权重按比例放大某台的份额；
- **ip_hash**：同一客户端 IP 永远落到同一台——为 session 亲和而生；
- **least_conn**：分给当前连接数最少的那台——请求耗时差异大时比轮询均匀。

ip_hash 值得多说一句，因为它回答了一个常见架构问题：后端用内存存 session（登录态、验证码），多实例之后用户每次请求可能落到不同机器，登录态时有时无。正解是 session 出内存（进 Redis），网关层的 ip_hash 只是便宜的现状兼容——它会破坏轮询均匀性，而且客户端 IP 一变（手机切 Wi-Fi）亲和就断。

对前端工程师，upstream 最大的实际收益是**发版仪式**变了：

1. 后端起两台实例，Nginx 全量分发；
2. 发版时把其中一台标记 `down`（或干脆停掉，靠失败重试兜底）；
3. 升级这台、预热、挂回；
4. 换另一台重复。

全程没有一分钟是两台同时不可用的，502 从"每次发版的保留节目"变成"配置错误才出现的事故"。

## 失败重试：502 之前还有一道闸

`proxy_next_upstream` 是这个体系的保险丝。默认值 `error` 的含义：**连接失败（拒连、断链）时，换下一台重试**；注意上游"连上了但返回 500"不算 error，默认不重试——那是业务错误，重试可能造成重复扣款这类副作用。全部实例试完仍失败，才对客户端返回 502。

开源 Nginx 只有**被动**健康检查：某台连续失败会被临时拉黑（`max_fails` + `fail_timeout`），期间的请求直接跳过它。主动探测（health_check 指令定期打健康检查接口）是商业版功能——对多数团队，被动检查加上合理的发布流程已经够用。

## mini-nginx 实现：展开序列与递归重试

分发的核心在 `src/upstream.ts`，思路朴素到可以一眼验证——把权重**展开成序列**：

```ts
const active = servers.filter((s) => !s.down)
const seq: UpstreamServer[] = []
const remaining = active.map((s) => Math.max(1, s.weight ?? 1))
while (remaining.some((r) => r > 0)) {
  for (let i = 0; i < active.length; i++) {
    if (remaining[i] > 0) {
      seq.push(active[i])
      remaining[i]--
    }
  }
}
```

权重 2:1 展开成 `[a, a, b, a, a, b, ...]` 的循环序列，一个 `cursor++ % seq.length` 就是完整分发器。真实 Nginx 用的是**平滑加权轮询**（spread 出 `a, b, a` 这种间隔更均匀的序列，避免权重高的机器被连续打两发），展开序列在比例上等价、在节奏上更糙——这条差异会进第 12 章的地图。

`next(exclude)` 的排除参数是给重试用的：失败过的实例放进 `exclude` 集合，下一次 `next` 直接跳过。重试本体在 `src/proxy.ts` 的 `proxyPass` 里，结构是一次递归：

```ts
const attempt = (): void => {
  const server = pool?.next(tried)
  if (pool && !server) return sendText(res, 502, 'bad gateway')
  if (server) tried.add(server.host)
  const target = server ? new URL(`http://${server.host}`) : directTarget!
  const upstreamReq = http.request({ /* host: target, path, headers... */ }, (upstreamRes) => {
    res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers)
    upstreamRes.pipe(res)
  })
  upstreamReq.on('error', () => {
    // 对齐 nginx proxy_next_upstream error 默认行为：连接失败换下一台
    if (pool && !res.headersSent) return attempt()
    if (!res.headersSent) sendText(res, 502, 'bad gateway')
    else res.end()
  })
  req.pipe(upstreamReq)
}
```

读三行关键逻辑：`tried` 集合保证每台最多试一次；`!res.headersSent` 守门——响应头一旦发给客户端就不能再换目标重试了（客户端已经收到一半的响应，换台重发就成了两个响应拼接）；全试完 `next` 返回 null，502 收尾。

组名的识别在 `src/server.ts`：`proxy_pass` 形如 `http://backend`（无端口无路径）且名字命中 `config.upstreams` 时走池，否则按第 5 章的直连地址处理——两套语义共存，配置面上只是"名字有没有注册"的差别。

## 验证

`npm run typecheck && npm test`，37 个断言全绿，本章新增五条：

```text
✓ 轮询：8 次请求两台上游各收 4 次
✓ 权重 2:1：6 次请求按 4/2 分发
✓ 故障摘除：一台上游关闭后请求全部成功
✓ 全部不可达返回 502
✓ down:true 的实例不参与分发
```

测试里每台 mock 后端把自己的名字当响应体返回，数名字就能验证分布——比断言"某个内部计数器"诚实得多。故障摘除用例是真实发版事故的微缩版：先起一台、再关掉它、让网关的其余流量全部落在幸存者身上，而且客户端侧没有一个请求失败。

到这里，第二分部（代理）收束：你能把 `/api` 交给一组后端、让它们互相兜底，也让后端认识真实用户。第三分部回到静态侧的两大性能主题——先压缩，后缓存。

---

**本章要点**：upstream 组让 proxy_pass 的目标从一台变一组；轮询按权重展开，ip_hash 为 session 亲和兜底但有代价；`proxy_next_upstream` 默认只在连接失败时换台重试，响应头发出后永不重试；两台轮着发版，502 从流程常态降级为配置事故。
