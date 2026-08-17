# 你配过的指令 → 课程实现的机制

学完课程回头看自己写过的 nginx.conf：每条常见指令背后是哪一章的机制，这张表负责把它们钉在一起。**左列是你抄过的配置，右列是你亲手写过的代码。**

## 指令对照

| 你配过的 | 背后的机制 | 章 |
|---|---|---|
| `worker_processes auto;` | worker 数跟 CPU 核数走、不跟连接数走；master 建总机、worker 各自一个事件循环 | [7](./07-master-workers) |
| `keepalive_timeout 65;` | keep-alive：一条连接说完一件再说下一件，空闲超时由连接账本收割（TIME_WAIT 与端口耗尽那笔账） | [4](./04-keepalive-reuse) |
| `events { worker_connections 1024; }` | 每连接一个文件描述符的 1024 墙；连接注册表的上限拒绝 | [1](./01-c10k-and-event-driven)、[2](./02-connection-registry) |
| `large_client_header_buffers` / 请求行长限制 | 解析器的行长上限——慢速攻击（Slowloris）的解药 | [3](./03-http-parser-state-machine) |
| `sendfile on;` | 零拷贝：数据不进程序内存，页缓存直达网卡，省两次 CPU 搬运 | [11](./11-zero-copy-write-path) |
| `gzip on;`（写在 http/server/location 三层） | 配置继承：子块覆盖、未写沿外层第一站取值 | [6](./06-config-inheritance) |
| `proxy_pass http://backend;` | 反向代理：拨号上游、盖 X-Forwarded-For 邮戳、缓冲回写、失联回 502 | [8](./08-reverse-proxy) |
| `upstream { server ...; }` | 后端名单：轮询分发 + 失败记账 | [9](./09-load-balance) |
| `server b max_fails=2 fail_timeout=10s;` | 失败账：连续失败摘除、期满试探回归（`downUntil <= now()`） | [9](./09-load-balance) |
| `limit_req zone=api rate=10r/s burst=20 nodelay;` | 漏桶：漏速=rate、桶容量=burst、nodelay=立即放行但占额度 | [10](./10-rate-limit-leaky-bucket) |
| `limit_req_status 503;` | 溢出请求的拒绝码（默认 503，可配 429） | [10](./10-rate-limit-leaky-bucket) |
| `limit_req_zone ... key=$binary_remote_addr` | 一人一桶：按来源 IP 分桶，而不是按连接分桶（连接带端口，永远打不满） | [10](./10-rate-limit-leaky-bucket) |

## 你见过但课程未展开的（诚实清单）

| 指令 | 一句话去向 |
|---|---|
| `client_body_buffer_size` / `client_max_body_size` | 请求体的缓冲与上限——课程的解析器只到「头部结束」，body 定长读取是同族问题 |
| `proxy_buffering on/off` | 第 8 章「收齐再转」与「流式转发」的开关，课程实现的是简化版 |
| `proxy_http_version 1.1` + `upstream keepalive` | 上游连接池——课程每请求一条上游连接，省三次握手的账在第 4 章 |
| `least_conn;` | 负载均衡的另一规则：谁手头活少给谁（课程实现了轮询） |
| `ssl_certificate ...` | TLS 终结在反代——加密数据必须重新生成，sendfile 链条断点（第 11 章边界） |
