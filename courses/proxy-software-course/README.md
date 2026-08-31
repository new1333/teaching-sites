# 代理软件实现原理：从一条 TCP 隧道到 mini-proxy

面向会 TypeScript、用过代理工具的开发者：把 Clash 类正向代理软件的核心数据面——HTTP 正向代理、SOCKS5、规则引擎、DNS 策略、出站适配器、双入口运行时——逐章拆开讲解，并亲手实现成一个可以真实运行、可以测试的教学用 mini-proxy。

> ⚠️ **仅限自有或明确授权环境。** 本课程与配套的 mini-proxy 不教授流量伪装、证书劫持或绕过访问控制，全部自动化测试只连接 `127.0.0.1`，不访问公网。

## 怎么跑

### 在聚合站里看（项目根目录）

```bash
pnpm install
pnpm dev     # 根目录看全部课程，本课挂载于 /proxy-software-course/
```

### 只看这一门课

```bash
cd courses/proxy-software-course
pnpm install
pnpm docs:dev       # 单课预览，首页即 /
pnpm docs:build     # 构建静态站点
pnpm docs:preview   # 预览构建产物
```

### 跑配套的 mini-proxy（companion）

```bash
cd courses/proxy-software-course/companion
pnpm install
pnpm test        # vitest run —— 9 个章节测试文件，全部只连 127.0.0.1（已实测：84 项测试全绿）
pnpm typecheck    # tsc --noEmit
pnpm build        # tsc -p tsconfig.build.json，产物在 dist/

# 用 CLI 跑起来
node dist/cli.js examples/mini-proxy.json
# HTTP 代理监听 8080，SOCKS5 代理监听 1080，Ctrl+C 优雅关闭
```

## 章节目录

**第一部分 · 流量如何进入代理**

1. [代理不是魔法：先画清一条连接](docs/01-proxy-mental-model.md)
2. [HTTP 正向代理：改写请求与打通 CONNECT](docs/02-http-forward-proxy.md)
3. [SOCKS5：把目标地址装进二进制握手](docs/03-socks5-protocol.md)
4. [双向搬运：背压、半关闭与清理](docs/04-relay-lifecycle.md)

**第二部分 · 代理如何做决定**

5. [规则引擎：第一条命中为什么决定一切](docs/05-rule-engine.md)
6. [DNS 在哪里发生：域名规则与 IP 规则的拉扯](docs/06-dns-strategy.md)
7. [出站适配器：直连、拒绝与再套一层 SOCKS5](docs/07-outbound-adapters.md)

**第三部分 · 把积木组装成程序**

8. [配置先失败：不要让错误规则静默上线](docs/08-runtime-config.md)
9. [组装运行时：两个入口，共用一条决策管线](docs/09-runtime-assembly.md)
10. [收官：验证整条链，也看清离 Clash 还有多远](docs/10-end-to-end-boundary.md)

**附录**：[术语表](docs/glossary.md) · [协议字节与响应码速查](docs/protocol-reference.md) · [从配置词到代码模块](docs/implementation-map.md) · [mini-proxy 与生产代理的差异](docs/divergence.md) · [练习路线：从红到绿重写一遍](docs/exercises.md)

## 最终里程碑

一个双入口（HTTP 正向代理 + SOCKS5）、三出站（DIRECT / REJECT / SOCKS5 上游）、84 项测试全绿的本地代理。9 个章节测试文件（`tests/02-*.test.ts` 到 `tests/10-*.test.ts`）覆盖 HTTP、CONNECT、SOCKS5、拒绝规则与上游 SOCKS5 链的 `127.0.0.1` 端到端验证。

## 安全边界

代理技术具有双用途。本课程仅面向自有或明确获得授权的环境，不提供把这个 mini-proxy 组装成可公网部署服务的指引。第 10 章专门用一节区分"测试全绿"与"可以安全对外提供服务"，并列出开放代理、最小权限等威胁模型概念。

## 已实现 / 未实现概要

| 已实现 | 未实现（详见 [差异清单](docs/divergence.md)） |
| --- | --- |
| HTTP absolute-form 改写 + CONNECT 隧道 | HTTP keep-alive / 请求流水线 |
| SOCKS5 NO AUTH + CONNECT，IPv4/域名/IPv6 地址帧 | SOCKS5 其他认证方式、BIND、UDP ASSOCIATE |
| 背压感知 + 半关闭的双向 relay | — |
| DOMAIN / DOMAIN-SUFFIX / IP-CIDR（仅 IPv4）/ PORT / MATCH 规则 | IP-CIDR 的 IPv6 匹配 |
| preserve-domain / resolve-first 两种 DNS 策略（resolver 可注入） | 真实 DNS 缓存、多地址轮询、DoH/DoT |
| DIRECT / REJECT / SOCKS5 上游出站适配器 | 加密出站、流量混淆 |
| 严格 JSON 配置校验（MATCH 兜底、PROXY 交叉引用） | 配置热重载 |
| 双入口共享 route-DNS-dial-relay、依赖注入、结构化事件、优雅关闭 | 认证/访问控制、资源治理、生产级可观测性、平台集成、TUN |
