---
title: 从配置词到代码模块
---

# 从配置词到代码模块

一条连接从入口进来，到最终建立出站连接，会依次经过下表这些真实的 companion 模块。路径与导出名均取自 `companion/src/` 当前终态，供跨章回查。

## 入口（entry）

| 配置词/协议 | 模块 | 导出 API | 对应章 | 测试文件 |
| --- | --- | --- | --- | --- |
| HTTP 正向代理 / CONNECT | `companion/src/http-server.ts` | `createHttpForwardServer` | [第 2 章](./02-http-forward-proxy) | `tests/02-http-forward-proxy.test.ts` |
| absolute-form ⇄ origin-form 改写 | `companion/src/authority.ts` | `parseRequestLine`、`rewriteAbsoluteForm`、`parseAuthority`、`toTargetAddress` | [第 2 章](./02-http-forward-proxy) | `tests/02-http-forward-proxy.test.ts` |
| SOCKS5 服务端 | `companion/src/socks5-server.ts` | `createSocks5Server` | [第 3 章](./03-socks5-protocol) | `tests/03-socks5-server.test.ts` |
| SOCKS5 地址帧编解码 | `companion/src/socks5-wire.ts` | `encodeAddress`、`readAddressFrame`、`SOCKS5_VERSION`、`ATYP`、`CMD`、`REPLY`、`METHOD` | [第 3 章](./03-socks5-protocol)、[第 7 章](./07-outbound-adapters) | `tests/03-socks5-server.test.ts`、`tests/07-outbound-adapters.test.ts` |
| 按分隔符/定长顺序读取（处理 TCP 分片） | `companion/src/socket-reader.ts` | `createSocketReader` | [第 3 章](./03-socks5-protocol) | `tests/03-socks5-server.test.ts` |

## Relay（双向转发）

| 能力 | 模块 | 导出 API | 对应章 | 测试文件 |
| --- | --- | --- | --- | --- |
| 双向 pipe、背压、半关闭、单次清理 | `companion/src/relay.ts` | `relay` | [第 4 章](./04-relay-lifecycle) | `tests/04-bidirectional-relay.test.ts` |

## 路由（route）

| 配置词 | 模块 | 导出 API | 对应章 | 测试文件 |
| --- | --- | --- | --- | --- |
| DOMAIN / DOMAIN-SUFFIX / IP-CIDR / PORT / MATCH | `companion/src/rules.ts` | `route`、`ipInCidr` | [第 5 章](./05-rule-engine) | `tests/05-rule-engine.test.ts` |

## DNS（解析时机）

| 配置词 | 模块 | 导出 API | 对应章 | 测试文件 |
| --- | --- | --- | --- | --- |
| `dnsStrategy: preserve-domain \| resolve-first` | `companion/src/dns.ts` | `planRoute` | [第 6 章](./06-dns-strategy) | `tests/06-dns-strategy.test.ts` |

## 出站（dialer）

| 配置词 | 模块 | 导出 API | 对应章 | 测试文件 |
| --- | --- | --- | --- | --- |
| `outbounds[].type: DIRECT` | `companion/src/dialers.ts` | `createDirectDialer` | [第 7 章](./07-outbound-adapters) | `tests/07-outbound-adapters.test.ts` |
| `outbounds[].type: REJECT` | `companion/src/dialers.ts` | `createRejectDialer` | [第 7 章](./07-outbound-adapters) | `tests/07-outbound-adapters.test.ts` |
| `outbounds[].type: SOCKS5` | `companion/src/dialers.ts` | `createSocks5Dialer` | [第 7 章](./07-outbound-adapters) | `tests/07-outbound-adapters.test.ts` |

## 运行时与配置（runtime/config）

| 配置词/能力 | 模块 | 导出 API | 对应章 | 测试文件 |
| --- | --- | --- | --- | --- |
| `ProxyConfig` 严格校验（含 MATCH 兜底、PROXY 交叉引用） | `companion/src/config.ts` | `parseProxyConfig` | [第 8 章](./08-runtime-config) | `tests/08-runtime-config.test.ts` |
| 共享 `connect` 管线、依赖注入、结构化事件、连接追踪 | `companion/src/runtime.ts` | `createProxyRuntime` | [第 9 章](./09-runtime-assembly) | `tests/09-assembly.test.ts` |
| CLI 入口、SIGINT/SIGTERM 优雅关闭 | `companion/src/cli.ts` | `installGracefulShutdown` | [第 9 章](./09-runtime-assembly) | `tests/09-assembly.test.ts` |
| 共享类型（`TargetAddress`、`Rule`、`RouteContext`、`Dialer`、`ProxyEvent` 等） | `companion/src/types.ts` | 类型定义 | 全书 | 全部测试文件 |
| 统一导出入口 | `companion/src/index.ts` | 重导出以上全部公共 API | — | — |

## 端到端（全链路）

| 场景 | 涉及模块 | 对应章 | 测试文件 |
| --- | --- | --- | --- |
| HTTP 直连 + CONNECT 隧道 + SOCKS5 入口 + REJECT + 转发上游 SOCKS5 | 以上全部模块经 `createProxyRuntime` 组装 | [第 10 章](./10-end-to-end-boundary) | `tests/10-end-to-end.test.ts` |

配套示例配置见 `companion/examples/mini-proxy.json`；其字段定义见 `companion/src/types.ts` 的 `ProxyConfig`。
