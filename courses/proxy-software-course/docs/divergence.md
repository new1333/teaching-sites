---
title: mini-proxy 与生产代理的差异
---

# mini-proxy 与生产代理的差异

本页汇总正文与 `companion/README.md` 中出现过的全部教学简化与未实现能力，每条都标注它在正文里的出处，方便和 [协议字节与响应码速查](./protocol-reference) 互相对账。

## HTTP 正向代理层面的简化

| 简化项 | 说明 | 出处 |
| --- | --- | --- |
| 不支持 keep-alive / 请求流水线 | 一条 TCP 连接只处理一个请求或一条 CONNECT 隧道，处理完即结束，不复用连接处理下一个请求 | [第 2 章](./02-http-forward-proxy) |
| body framing 简化 | 不解析任何消息体边界：`Content-Length` 与 chunked framing 都不校验，头部之后的字节交给 `relay` 原样转发 | [第 2 章](./02-http-forward-proxy) |

## SOCKS5 层面未实现的能力

| 未实现项 | 说明 | 出处 |
| --- | --- | --- |
| 认证方式仅 NO AUTH | 不支持用户名密码等其他 METHOD | [第 3 章](./03-socks5-protocol)、[协议速查](./protocol-reference) |
| 命令仅 CONNECT | `BIND`、`UDP ASSOCIATE` 按 RFC 1928 回 `COMMAND_NOT_SUPPORTED` 后关闭连接，不做实际实现 | [第 3 章](./03-socks5-protocol) |
| 无 UDP 数据通道 | UDP ASSOCIATE 命令本身既不解析也不建立数据通道 | [第 3 章](./03-socks5-protocol) |

## 规则与 DNS 层面的简化

| 简化项 | 说明 | 出处 |
| --- | --- | --- |
| IP-CIDR 仅支持 IPv4 | 不解析、不匹配 IPv6 CIDR 网段 | [第 5 章](./05-rule-engine)、[协议速查](./protocol-reference) |
| DNS 简化为可注入的 `Resolver` | 只返回单个 IP，不做多地址轮询、TTL 缓存或真实的递归解析细节；测试全程注入固定假 resolver | [第 6 章](./06-dns-strategy)、[第 9 章](./09-runtime-assembly) |
| 无 DNS over HTTPS/TLS、无 DNS 层面的隐私保护 | `defaultResolver` 只是对 `dns.lookup` 的直接封装 | [第 6 章](./06-dns-strategy) |

## 网络层接管与出站层面的简化

| 未实现项 | 说明 | 出处 |
| --- | --- | --- |
| 无 TUN / 系统级流量接管 | 只处理主动连接到监听端口的流量，不创建虚拟网卡、不修改路由表 | [第 1 章](./01-proxy-mental-model)、[第 10 章](./10-end-to-end-boundary) |
| 无加密出站 / 无流量混淆 | DIRECT 与上游 SOCKS5 均为明文 TCP，没有可选 TLS 出站，也不做任何流量特征伪装 | [第 10 章](./10-end-to-end-boundary) |

## 运行时与安全层面未实现的能力

| 未实现项 | 说明 | 出处 |
| --- | --- | --- |
| 无认证 / 访问控制 | `createHttpForwardServer`、`createSocks5Server` 不校验"谁在发起连接"，本质是一个开放代理 | [第 10 章](./10-end-to-end-boundary) |
| 无资源上限治理 | 没有单连接/单客户端限流、超时回收、内存或文件描述符上限 | [第 10 章](./10-end-to-end-boundary) |
| 无生产级可观测性 | 只有结构化事件回调（`type` + `detail`），没有日志分级、指标导出或链路追踪 | [第 9 章](./09-runtime-assembly)、[第 10 章](./10-end-to-end-boundary) |
| 无配置热重载 | 配置只在启动时解析一次，运行中修改配置文件不会生效，需要重启进程 | [第 8 章](./08-runtime-config)、[第 9 章](./09-runtime-assembly) |
| 无平台集成 | 交付形态是一个 Node.js 进程 + JSON 配置 + CLI，没有系统服务管理、多平台安装包或 GUI | [第 10 章](./10-end-to-end-boundary) |
| 错误映射简化 | 拨号失败、规则拒绝等情况统一用字符串 `reason` 表达（如 `direct dial failed: ...`、`rejected by rule`），不是完整的错误码/错误类型体系 | [第 7 章](./07-outbound-adapters) |

以上全部是这门课程明确划定、**未在课程范围内实现**的能力，不是遗漏；第 10 章的生产差异表和边界声明是这份清单的正文来源。
