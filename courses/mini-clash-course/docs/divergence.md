---
title: 与真实 Clash 的差异清单
---

# 与真实 Clash 的差异清单

正文每一处「教学版简化为…」的集中登记：mini 与真实实现的全部差异，按章排布、逐条注明出处（点击章标题回到正文）。第 12 章的差异地图按主题归组指路本页。差异不是欠账——每一条都换来了「那一章只教一件事」。

### 第 2 章 · [HTTP 正向代理：两种把流量交出来的方式](./02-http-proxy)

- 不支持 Transfer-Encoding: chunked（只认 Content-Length）
- 上游连接不复用（每条请求新拨）
- CONNECT 目标缺端口统一回 502（RFC 9110 建议 400）
- 无代理认证

### 第 3 章 · [SOCKS5：一个字节级的入口协议](./03-socks5-server)

- 只实现 CONNECT，BIND/UDP ASSOCIATE 回 REP=07
- 认证只谈无认证（00）；不带 00 回 FF 收线
- ATYP 不支持 IPv6（04），回 REP=08
- BND.ADDR/BND.PORT 固定回 0.0.0.0:0
- 目标接通失败不区分原因，统一 REP=01

### 第 4 章 · [两跳链路：本地代理与远端中继](./04-two-hop-relay)

- 中继链路协议为自造教学协议，真实对应物（Shadowsocks）第 6 章对表
- 远端零认证，能连上即可请代连
- 全链路不检查 write 返回值（无背压）
- 每条浏览器连接独占一条入口↔远端连接，无复用
- 失败回执统一 01、CONNECT 帧不做 IPv6

### 第 6 章 · [加密隧道：Shadowsocks 风格 AEAD 帧](./06-aead-tunnel)

- 对 SS 规范：子密钥派生用 HKDF-SHA256(密码,盐) 一步派生（规范为 EVP_BytesToKey+HKDF-SHA1），无口令慢哈希拉伸
- 保留第 4 章 1 字节回执（规范无回执、直接断线）
- 首块载荷为教学 CONNECT 帧（规范为 SOCKS5 地址格式，思想一致：目标进密文）
- 只实现 aes-256-gcm、只做 TCP（规范另有 chacha20 等与 UDP）
- 无长度填充：块长与到达时机线上可见，流量分析不防

### 第 7 章 · [规则引擎：流量的调度台](./07-rule-engine)

- 规则类型只做五种承重形态（GEOIP/SRC-IP/PROCESS/逻辑规则/订阅 providers 不实现，未知类型带行号报错）
- IP-CIDR 无 no-resolve 选项——对域名目标一律不解析（真实 Clash 默认会解析去试 IP 行）
- 出站只认 DIRECT/PROXY（组名出站第 10 章接）
- 规则表在调用参数里，无配置文件（第 10 章接管）
- 不做 IPv6 目标

### 第 8 章 · [DNS 与 fake-ip：先把名字这一关接管](./08-fake-ip)

- 只实现 UDP 与 A 查询；AAAA/其他 QTYPE 回 RCODE=0 空答案（真实另有 TCP DNS、EDNS0、IPv6 段）
- AA/RA 位置 1 是『解析器戏服』；RD 从查询抄回；TTL 固定 1 秒
- 压缩指针只用在应答 NAME 指回问题区（0xC00C）
- QDCOUNT 只认 1；坏查询不回应答只记日志（不回 FORMERR）
- 池满 FIFO 回收、无持久化；默认容量 131071（真实默认 198.18.0.1/16 且可配）
- 还原后的真解析交给操作系统（真实走配置的 nameserver）

### 第 9 章 · [TUN 模式：虚拟网卡与全系统流量](./09-tun-lab)

- 不建真 TUN 设备/不改路由/不做 ARP 与 DNS 接管（实验全在自造样本上）
- 用户态栈只当读侧：不回 SYN|ACK、不跟踪连接状态机
- 校验和不验证（样本填 0）；TTL/窗口/标识/分片不读
- 重排只按 seq 升序拼接：不处理重传/重叠/回绕
- 不处理 IP 分片与 IPv6；TCP 选项只跳过不解释
- 非 TCP 包只计 skipped（真实 TUN 里 UDP/DNS 需接管应答）
- client/server 由首包发送方定义（中途截流时方向命名是约定）

### 第 10 章 · [配置与代理组：从硬编码到声明式](./10-config-groups)

- 配置用 JSON 非 YAML（同构语义，零 yaml 依赖）
- 节点只有「带密码中继」一种类型
- 组只做 select 与 url-test；组员只认节点（组套组/DIRECT 组员不做）
- url-test 建组测一轮：无 interval/tolerance/lazy/expected-status（全灭回退名单第一个）
- 探测只支持 http:// 测速 URL
- select 切换只有编程接口，无面板/外部控制器
- inbound 只有 port 一项
- 配置层拒绝出站 PROXY（parseRules 仍认它以保旧章）

### 第 11 章 · [总装：跑起来的 mini-clash](./11-assemble)

- DNS 监听端口不进配置（真实 dns 段可配 listen/enable；教学版随机起）
- 整机入口只挂 SOCKS5：无 mixed 双协议端口、无入口认证（startHttpProxy 未接入）
- fake-ip 的系统级接线不做：整机 DNS 需手工指向（第 8/9 章已声明边界）
