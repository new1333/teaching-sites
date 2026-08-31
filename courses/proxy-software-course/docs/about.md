# 关于本课程

**当应用把一个目标地址交给 Clash 类软件后，连接究竟经过哪些判断与搬运？** 这是贯穿全书的主线问题——十章的全部内容，就是这句问题的完整答案。

## 课程概况

《代理软件实现原理：从一条 TCP 隧道到 mini-proxy》面向**会 TypeScript、用过代理工具的开发者**：你知道 Promise、判别联合、URL 与 HTTP 请求头这些基础，也用过系统代理或规则型代理工具，但裸 TCP socket、HTTP 正向代理协议、SOCKS5 二进制握手、背压与半关闭、DNS 与路由的先后顺序，这些通常都被工具封装得看不见。

课程由一句主题输入生成：**「clash 等代理软件的原理是什么，怎么自己写一个代理软件」**。全书 10 章、3 个分部，全部 10 章完成生成、无降级章、无阻断章。每一章都不只是讲解协议，而是把对应的行为亲手实现成 companion 工程 `companion/` 里可以运行、可以测试的 TypeScript 代码。

最终产物：**一个双入口（HTTP 正向代理 + SOCKS5）、三出站（DIRECT / REJECT / SOCKS5 上游）、84 项测试全绿的本地代理**，由 9 个章节测试文件覆盖 HTTP、CONNECT、SOCKS5、拒绝规则与上游 SOCKS5 链的 `127.0.0.1` 端到端验证。

## 能力阶梯：学到第几章，你能做什么

| 章 | 学完这一章，你能… |
| --- | --- |
| 1. 代理不是魔法：先画清一条连接 | 用入口、路由、出站三段模型解释正向代理，并区分系统代理、TUN、反向代理与 VPN |
| 2. HTTP 正向代理：改写请求与打通 CONNECT | 实现 absolute-form 改写，并用 CONNECT 为 HTTPS 建立不解密内容的 TCP 隧道——**HTTP 入口能改写 absolute-form 并为 CONNECT 返回 200 后双向转发** |
| 3. SOCKS5：把目标地址装进二进制握手 | 实现 NO AUTH 方法协商与 CONNECT 请求，正确编解码 IPv4、域名、IPv6 地址帧并处理分片——**SOCKS5 入口支持 NO AUTH + CONNECT 和三种地址类型，并显式拒绝不支持的命令** |
| 4. 双向搬运：背压、半关闭与清理 | 实现不会无界缓存、不会把单向 FIN 当成整条连接结束的双向 relay——**relay 用双向 pipe 传播背压，用 end 传播半关闭，并在错误或关闭时只清理一次** |
| 5. 规则引擎：第一条命中为什么决定一切 | 从连接元数据实现 DOMAIN、DOMAIN-SUFFIX、IPv4 CIDR、PORT 与 MATCH 的确定性决策——**纯函数 route 按顺序返回 DIRECT、REJECT 或 PROXY** |
| 6. DNS 在哪里发生：域名规则与 IP 规则的拉扯 | 实现 preserve-domain 与 resolve-first 两种策略——**planRoute 根据策略决定解析时机，返回决策与 dialTarget，所有 DNS 副作用可注入** |
| 7. 出站适配器：直连、拒绝与再套一层 SOCKS5 | 用统一 Dialer 接口实现 DIRECT、REJECT 和 SOCKS5 上游——**三种出站共享 Dialer 契约，SOCKS5 客户端完成协商、CONNECT 与响应校验** |
| 8. 配置先失败：不要让错误规则静默上线 | 从 unknown JSON 严格收窄 ProxyConfig——**parseProxyConfig 返回有效配置或完整错误数组，并校验规则与出站的交叉引用** |
| 9. 组装运行时：两个入口，共用一条决策管线 | 让 HTTP 与 SOCKS5 入口共享 route-DNS-dial-relay——**createProxyRuntime 启动双入口并共享连接函数，返回实际端口、事件和可等待的 close** |
| 10. 收官：验证整条链，也看清离 Clash 还有多远 | 用本地端到端矩阵证明已实现能力——**HTTP、CONNECT、SOCKS5、REJECT 与 SOCKS5 上游链在纯本机拓扑中全部通过，并形成生产差异表** |

## 权威事实来源

本课程的协议与行为断言以下列文档为核实入口，测试自洽不替代事实正确。**内容截至 2026-08-28**：协议、标准与 Node.js 行为类事实以下表来源为准，超出此日期的规范修订或运行时变更不在覆盖范围内。

| 来源 | 用途 |
| --- | --- |
| [RFC 1928: SOCKS Protocol Version 5](https://www.rfc-editor.org/rfc/rfc1928.html) | SOCKS5 方法协商、命令、地址类型与响应码的协议事实源 |
| [RFC 9110: HTTP Semantics, CONNECT](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.3.6) | CONNECT 的隧道语义与安全限制 |
| [RFC 9112: HTTP/1.1](https://www.rfc-editor.org/rfc/rfc9112.html) | HTTP/1.1 请求目标、消息边界与转发约束 |
| [RFC 9293: Transmission Control Protocol](https://www.rfc-editor.org/rfc/rfc9293.html) | TCP 连接、字节流与关闭语义的标准依据 |
| [RFC 1034: Domain Names - Concepts and Facilities](https://www.rfc-editor.org/rfc/rfc1034.html) | DNS 分层名字与解析概念的事实源 |
| [RFC 4632: Classless Inter-domain Routing](https://www.rfc-editor.org/rfc/rfc4632.html) | IPv4 CIDR 前缀表示与匹配依据 |
| [RFC 8446: TLS 1.3](https://www.rfc-editor.org/rfc/rfc8446.html) | 解释 CONNECT 隧道内 TLS 仍由客户端与目标端点建立 |
| [Node.js net and stream documentation](https://nodejs.org/api/net.html) | companion 使用的异步 TCP、allowHalfOpen 与 stream 行为依据 |
| [Linux kernel TUN/TAP documentation](https://docs.kernel.org/networking/tuntap.html) | TUN 交付 IP 包、TAP 交付以太网帧的边界说明 |

## 安全与伦理边界

代理技术具有双用途。本课程与配套的 mini-proxy **仅面向你自己拥有或已经明确获得授权的环境**，不教授流量伪装、证书劫持或绕过访问控制；全部自动化测试只连接 `127.0.0.1`，不访问公网。第 10 章会用一整节把"测试全绿"和"可以安全对外提供服务"分开讨论，并列出这个 mini-proxy 还没有实现的认证、访问控制、资源治理等能力——详见 [mini-proxy 与生产代理的差异](./divergence)。
