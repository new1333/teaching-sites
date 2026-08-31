# 手写 mini-clash：代理软件的原理与实现

一门原理重实现课：从「打开 Clash 之后流量经历了什么」讲起，12 章亲手写出一个 mini 版代理客户端——SOCKS5 入口、规则分流、AEAD 加密隧道、fake-ip DNS、TUN 报文解析、配置与代理组、端到端总装。

- **读者**：会写 TypeScript、能跑命令行；TCP/HTTP 报文与密码学零基础也可跟读（课程自带地基铺垫）。
- **终点**：拥有一个约一千五百行的 mini-clash 验证工程（10 个源文件、73 条测试全绿、9 个可跑 demo），能对外完整讲清代理链路的每一跳。
- **边界**：课程内容仅用于学习网络协议原理，全部实验在本机回环完成、不含任何真实节点信息；请在遵守当地法律法规的前提下学习。

## 怎么跑

**方式一（推荐）**：从项目根聚合站进入——仓库根目录 `pnpm dev`，首页点进本课程。

**方式二**：单独预览本课程——

```bash
cd courses/mini-clash-course
pnpm install
pnpm docs:dev
```

**验证物工程（companion）**：

```bash
cd courses/mini-clash-course/companion
npm install
npm run typecheck   # tsc --noEmit
npm test            # vitest run，73 条用例
```

**可跑 demo（都在回环，不出机器）**：`demo:http-proxy`、`demo:socks5`、`demo:two-hop`、`demo:aead-tunnel`、`demo:rule-engine`、`demo:fake-ip`、`demo:tun-lab`、`demo:config-groups`、`demo:mini-clash`（一条命令拉起远端 + mini-clash + 目标站，第三幕窗口内可用 curl 走完整条链路）。

## 章节目录

| # | 章 | 类型 |
| --- | --- | --- |
| 1 | 打开 Clash 之后，流量经历了什么 | principle |
| 2 | HTTP 正向代理：两种把流量交出来的方式 | build |
| 3 | SOCKS5：一个字节级的入口协议 | build |
| 4 | 两跳链路：本地代理与远端中继 | build |
| 5 | 加密在防谁：机密性、完整性与 AEAD | principle |
| 6 | 加密隧道：Shadowsocks 风格 AEAD 帧 | build |
| 7 | 规则引擎：流量的调度台 | build |
| 8 | DNS 与 fake-ip：先把名字这一关接管 | build |
| 9 | TUN 模式：虚拟网卡与全系统流量 | build |
| 10 | 配置与代理组：从硬编码到声明式 | build |
| 11 | 总装：跑起来的 mini-clash | build |
| 12 | 回望：从 mini 到真实 Clash | review |

附录：[术语表](docs/glossary.md) · [字节协议速查表](docs/wire-protocol-cheatsheet.md) · [与真实 Clash 的差异清单](docs/divergence.md)

## 终点里程碑

`startMiniClash(配置)` 一份配置文本进去：域名 DNS 查询得假门牌 → 入口还原域名 → 规则判决 → 代理组选节点 → AEAD 加密隧道 → 远端代连目标 → 响应原路返回；`npm run demo:mini-clash` 一条命令拉起全部角色，curl 经 mini-clash 拿到目标站响应，companion 全部测试绿。

## 课程管线状态

`.course/` 下五个关键 JSON（outline / bible / rolling / calibration / promises）随课程提交，是生成管线的事实源；`snapshots/` 与生成物不入库。
