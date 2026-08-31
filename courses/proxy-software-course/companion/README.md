# mini-proxy 伴生工程

配套课程「proxy-software-course」的教学用迷你代理实现：TypeScript + Node.js `node:net` + Vitest。
覆盖 HTTP 正向代理、CONNECT 隧道、SOCKS5 服务端/客户端、规则引擎、DNS 策略、出站适配器、
运行时组装这一整条 Clash 类代理的数据面主线，供逐章阅读源码、跑测试、动手改代码。

> ⚠️ **仅用于授权环境下的学习与实验。** 本项目不做任何认证、加密、流量伪装或反审查设计，
> 不要在生产环境或未经授权的网络中使用；所有测试都只连接 `127.0.0.1`，不会、也不应该被
> 改造成访问公网的工具。

## 这是什么，不是什么

- **是**一个可以真实跑起来的最小代理：HTTP 正向代理 + SOCKS5 服务端，共享同一套规则引擎、
  DNS 策略与出站适配器。
- **不是** Clash / V2Ray / sing-box 的克隆或替代品，没有它们的协议生态、订阅管理、GUI、
  流量伪装、多用户认证等能力。
- 目的是让你看清一个代理内核最核心的几块积木：转发/隧道、地址帧编解码、规则匹配、DNS 时机、
  出站拨号、双向 relay 的背压与半关闭——这些积木理解了，再看真实项目的源码会容易得多。

## 功能边界

| 能力 | 支持情况 |
| --- | --- |
| HTTP 正向代理 | absolute-form → origin-form 改写并转发；CONNECT 建立隧道 |
| HTTP keep-alive / 请求流水线 | 不支持，一条连接只处理一个请求/隧道 |
| SOCKS5 认证 | 仅 `NO AUTH`（0x00），不支持用户名密码等其他方式 |
| SOCKS5 命令 | 仅 `CONNECT`；`BIND` / `UDP ASSOCIATE` 按 RFC 1928 回 `COMMAND_NOT_SUPPORTED` |
| SOCKS5 地址类型 | IPv4 / 域名 / IPv6 均支持，握手与请求帧允许任意 TCP 分片 |
| 规则引擎 | `DOMAIN` / `DOMAIN-SUFFIX`（尊重标签边界）/ `IP-CIDR`（仅 IPv4）/ `PORT` / `MATCH`，按首条命中 |
| DNS 策略 | `preserve-domain`（DIRECT 才解析）与 `resolve-first`（先解析再判断），resolver 可注入 |
| 出站 | `DIRECT`、`REJECT`、`SOCKS5` 上游客户端（可链到另一个 SOCKS5 代理） |
| 传输安全 | 无 TLS/mTLS，无流量混淆；不要用来传输真实敏感数据 |

## 目录结构

```
src/
  types.ts          共享类型：地址、规则、DNS 策略、出站、运行时配置、事件
  authority.ts       host:port 解析、HTTP absolute-form → origin-form 改写
  socket-reader.ts   在裸 socket 上做「读到分隔符/读定长」的顺序化读取（处理 TCP 分片）
  relay.ts           双向转发：背压、半关闭、error/close 清理
  rules.ts           规则引擎：按首条命中
  dns.ts             DNS 策略：preserve-domain / resolve-first
  socks5-wire.ts      SOCKS5 地址帧编解码，服务端与客户端共用
  dialers.ts          出站适配器：DIRECT / REJECT / SOCKS5 客户端
  http-server.ts      HTTP 正向代理服务端
  socks5-server.ts    SOCKS5 服务端
  config.ts           JSON 配置解析与严格校验
  runtime.ts          组装层：同时起 HTTP / SOCKS5，共享 route/dial 管线
  cli.ts              命令行入口：从配置路径启动，支持 SIGINT/SIGTERM 优雅关闭
  index.ts            统一导出

tests/
  02-http-forward-proxy.test.ts   第 2 章：HTTP 正向代理
  03-socks5-server.test.ts        第 3 章：SOCKS5 服务端
  04-bidirectional-relay.test.ts  第 4 章：双向 relay
  05-rule-engine.test.ts          第 5 章：规则引擎
  06-dns-strategy.test.ts         第 6 章：DNS 策略
  07-outbound-adapters.test.ts    第 7 章：出站适配器
  08-runtime-config.test.ts       第 8 章：运行时配置
  09-assembly.test.ts             第 9 章：组装层（runtime + cli）
  10-end-to-end.test.ts           第 10 章：端到端
  support.ts                      测试专用小工具（起停 server、读写裸 socket）

examples/
  mini-proxy.json    可直接喂给 CLI 的示例配置
```

## 命令

```bash
pnpm install     # 仅安装这个伴生工程的依赖（devDependencies：typescript / vitest / @types/node）
pnpm test        # vitest run —— 9 个章节测试文件，全部只连 127.0.0.1
pnpm typecheck   # tsc --noEmit —— 严格模式，不用 any/unknown 断言绕过类型检查
pnpm build       # tsc -p tsconfig.build.json —— 产物在 dist/（已 gitignore）
```

## 用 CLI 跑起来

```bash
pnpm build
node dist/cli.js examples/mini-proxy.json
# HTTP 代理监听端口 8080，SOCKS5 代理监听端口 1080
# Ctrl+C（SIGINT）或 kill -TERM 都会等 close() 跑完再退出
```

`examples/mini-proxy.json` 长这样（字段含义见 `src/types.ts` 的 `ProxyConfig`）：

```json
{
  "listeners": {
    "http": { "host": "127.0.0.1", "port": 8080 },
    "socks": { "host": "127.0.0.1", "port": 1080 }
  },
  "dnsStrategy": "preserve-domain",
  "rules": [
    { "type": "DOMAIN", "value": "ads.internal.test", "action": "REJECT" },
    { "type": "DOMAIN-SUFFIX", "value": "example.com", "action": "DIRECT" },
    { "type": "IP-CIDR", "value": "10.0.0.0/8", "action": "REJECT" },
    { "type": "PORT", "value": "25", "action": "REJECT" },
    { "type": "DOMAIN-SUFFIX", "value": "needs-proxy.test", "action": "PROXY", "outbound": "upstream-socks5" },
    { "type": "MATCH", "value": "", "action": "DIRECT" }
  ],
  "outbounds": {
    "DIRECT": { "type": "DIRECT" },
    "REJECT": { "type": "REJECT" },
    "upstream-socks5": { "type": "SOCKS5", "host": "127.0.0.1", "port": 10800 }
  }
}
```

规则**按数组顺序首条命中**生效，因此末尾必须有一条 `MATCH` 兜底——`config.ts` 会在启动前
严格校验这一点，以及端口范围、未知 action、`PROXY` 缺少/引用不存在的 `outbound` 等错误配置，
全部显式报错，不做静默兜底。

## 只用本机 curl 验证

先在另一个终端启动只监听 `127.0.0.1` 的本地 HTTP 源站：

```bash
node -e "require('node:http').createServer((_, res) => res.end('local-ok')).listen(18080, '127.0.0.1')"
```

再配合上面的 CLI 验证两个入口。目标、入口和源站都留在本机：

```bash
curl -x http://127.0.0.1:8080 http://127.0.0.1:18080/
curl --socks5 127.0.0.1:1080 http://127.0.0.1:18080/
```

如果在你明确获授权的域名环境中测试 SOCKS5 域名规则，请使用 `--socks5-hostname`，
让域名随 SOCKS5 地址帧交给代理；`--socks5` 会先在 curl 所在机器解析域名。
