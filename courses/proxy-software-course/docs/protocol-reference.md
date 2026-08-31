---
title: 协议字节与响应码速查
---

# 协议字节与响应码速查

本页只收录 companion（`companion/src/`）已经实现并被测试覆盖的协议字段；未实现的字段单独标注，不与已实现项混排。协议事实核对 [RFC 1928](https://www.rfc-editor.org/rfc/rfc1928.html)、[RFC 9110 §9.3.6](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.3.6)、[RFC 9112](https://www.rfc-editor.org/rfc/rfc9112.html)。

## HTTP 正向代理：请求目标形式

| 形式 | 使用场景 | companion 行为 | 来源 |
| --- | --- | --- | --- |
| origin-form | 客户端直连源站，请求行只带路径与查询字符串 | 判定为已是 origin-form，原样转发不改写（`rewriteAbsoluteForm` 对以 `/` 开头的目标返回 `null`） | [第 2 章](./02-http-forward-proxy) |
| absolute-form | 客户端把请求发给代理，请求行携带完整 URL | `rewriteAbsoluteForm` 改写为 origin-form 并同步改写 `Host` 头，再转发给源站 | [第 2 章](./02-http-forward-proxy) |
| CONNECT | 客户端请求为 HTTPS 目标建立隧道 | `handleConnect` 拨号成功后回 `HTTP/1.1 200 Connection Established`，之后不解释隧道内容，交给 `relay` 双向转发；拨号失败回 `502 Bad Gateway`；协议不是 `http:` 时回 `400 Bad Request` | [第 2 章](./02-http-forward-proxy) |

**未实现**：HTTP keep-alive、请求流水线（pipelining）和任何消息体边界解析。`Content-Length` 与 chunked framing 都不校验；请求头之后的字节直接交给 `relay` 原样转发。一条连接只处理一个请求或一条隧道，详见 [差异清单](./divergence)。

## SOCKS5：握手与请求帧

字段与响应码定义于 `companion/src/socks5-wire.ts`，与 [RFC 1928](https://www.rfc-editor.org/rfc/rfc1928.html) 逐项对齐。

### 方法协商（greeting）

| 字段 | 长度 | 含义 | companion 支持 |
| --- | --- | --- | --- |
| VER | 1 字节 | 协议版本，固定 `0x05` | 是 |
| NMETHODS | 1 字节 | METHODS 字段长度 | 是 |
| METHODS | NMETHODS 字节 | 客户端支持的认证方法列表 | 是（只识别 `NO_AUTH`） |

### METHOD

| 值 | 名称 | companion 支持 |
| --- | --- | --- |
| `0x00` | NO_AUTH | 是，唯一支持的认证方法 |
| `0xFF` | NO_ACCEPTABLE | 是；服务端返回后，本实现主动 `end()`，RFC 1928 同时要求客户端关闭连接 |
| 其他（用户名密码等） | — | **本课程未实现** |

### CMD

| 值 | 名称 | companion 支持 |
| --- | --- | --- |
| `0x01` | CONNECT | 是，唯一实现的命令 |
| `0x02` | BIND | **本课程未实现**——回 `COMMAND_NOT_SUPPORTED` 并关闭连接 |
| `0x03` | UDP_ASSOCIATE | **本课程未实现**——回 `COMMAND_NOT_SUPPORTED` 并关闭连接 |

### ATYP（地址类型）

| 值 | 名称 | 地址长度 | companion 支持 |
| --- | --- | --- | --- |
| `0x01` | IPv4 | 4 字节 | 是 |
| `0x03` | 域名 | 1 字节长度前缀 + 变长 | 是 |
| `0x04` | IPv6 | 16 字节 | 是 |
| 其他 | — | — | 否，回 `ADDRESS_TYPE_NOT_SUPPORTED` |

### REPLY（响应码）

| 值 | 名称 | companion 会返回吗 |
| --- | --- | --- |
| `0x00` | SUCCEEDED | 是 |
| `0x01` | GENERAL_FAILURE | 定义于 `REPLY` 常量，供拨号失败时映射使用 |
| `0x02` | CONNECTION_NOT_ALLOWED | 是，规则命中 REJECT 时返回 |
| `0x03` | NETWORK_UNREACHABLE | 定义于 `REPLY` 常量 |
| `0x04` | HOST_UNREACHABLE | 定义于 `REPLY` 常量 |
| `0x05` | CONNECTION_REFUSED | 定义于 `REPLY` 常量 |
| `0x06` | TTL_EXPIRED | 定义于 `REPLY` 常量 |
| `0x07` | COMMAND_NOT_SUPPORTED | 是，收到 BIND/UDP_ASSOCIATE 时返回 |
| `0x08` | ADDRESS_TYPE_NOT_SUPPORTED | 是，ATYP 不识别时返回 |

**未实现**：UDP ASSOCIATE 数据通道、BIND 命令、除 NO_AUTH 外的任何认证方式，详见 [差异清单](./divergence)。

## 规则类型与动作

规则类型与匹配语义是本课程的实现选择，未对应任何外部标准；`route` 函数按数组顺序首条命中。

| RuleType | 匹配依据 | companion 实现 |
| --- | --- | --- |
| `DOMAIN` | 精确等于 `ctx.domain`（忽略大小写） | 是 |
| `DOMAIN-SUFFIX` | `ctx.domain` 等于后缀或以 `.` + 后缀结尾（尊重标签边界） | 是 |
| `IP-CIDR` | `ctx.ip` 落在 IPv4 CIDR 网段内 | 是，仅 IPv4 |
| `PORT` | `ctx.port` 的字符串形式等于规则值 | 是 |
| `MATCH` | 无条件命中，必须作为末尾兜底 | 是 |

| RuleAction | 含义 | companion 实现 |
| --- | --- | --- |
| `DIRECT` | 直连目标 | 是 |
| `REJECT` | 主动拒绝，不发起任何网络操作 | 是 |
| `PROXY` | 转交给 `outbounds` 中指定的 SOCKS5 上游 | 是，`outbound` 必须引用一个 `SOCKS5` 类型出站 |

**未实现**：`IP-CIDR` 的 IPv6 网段匹配、基于地理位置或运营商的规则类型。
