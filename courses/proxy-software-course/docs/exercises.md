---
title: 练习路线：从红到绿重写一遍
---

# 练习路线：从红到绿重写一遍

跟着测试依赖顺序，把 companion 的核心模块自己重写一遍：先让对应测试失败（红），再照着正文把实现补回去，直到测试通过（绿）。全程只在你自己的机器上操作，只连接 `127.0.0.1`，不需要也不应该指向任何公网或未授权目标。

## 准备一份可以随便改的副本

不要直接在 `companion/src/` 里做破坏性修改。二选一：

```bash
# 方式一：复制一份练习目录（Windows PowerShell）
Copy-Item -Recurse companion companion-practice
cd companion-practice
pnpm install

# 方式二：在 git 里开一个练习分支，改完随时能 checkout 回终态
git checkout -b proxy-course-practice
```

两种方式都能让你随时对照 `companion/` 的终态代码，检查自己写的实现是否等价，而不需要真的删除已经跑通的参考实现。

## 依赖顺序：按测试文件从 02 到 10

依赖关系来自 `.course/outline.json` 的 `depends_on` 字段，决定了下面这条从红到绿的路线。每一步先清空或简化对应函数体（让测试变红），再对照本章正文补全（让测试变绿）。

| 步骤 | 清空/简化的函数 | 对应测试 | 依赖前置步骤 |
| --- | --- | --- | --- |
| 1 | `src/authority.ts` 的 `rewriteAbsoluteForm`、`src/http-server.ts` 的 `handleConnect` | `tests/02-http-forward-proxy.test.ts` | [第 1 章](./01-proxy-mental-model) 的三段模型 |
| 2 | `src/socks5-wire.ts` 的 `encodeAddress`/`readAddressFrame`、`src/socks5-server.ts` 的握手逻辑 | `tests/03-socks5-server.test.ts` | [第 1 章](./01-proxy-mental-model) 的三段模型 |
| 3 | `src/relay.ts` 的 `relay` | `tests/04-bidirectional-relay.test.ts` | 步骤 1、2（两种入口都要调用 relay） |
| 4 | `src/rules.ts` 的 `route`、`ipInCidr`、`domainSuffixMatches` | `tests/05-rule-engine.test.ts` | [第 1 章](./01-proxy-mental-model) 的路由承诺 |
| 5 | `src/dns.ts` 的 `planRoute` | `tests/06-dns-strategy.test.ts` | 步骤 4（route 函数） |
| 6 | `src/dialers.ts` 的 `createDirectDialer`/`createRejectDialer`/`createSocks5Dialer` | `tests/07-outbound-adapters.test.ts` | 步骤 2（地址帧编解码）、步骤 5（dialTarget） |
| 7 | `src/config.ts` 的 `parseProxyConfig` | `tests/08-runtime-config.test.ts` | 步骤 4、5、6（校验规则与出站的交叉引用） |
| 8 | `src/runtime.ts` 的 `connect`/`pickDialer`/`trackConnections`、`src/cli.ts` 的 `installGracefulShutdown` | `tests/09-assembly.test.ts` | 步骤 1、2、3、7 |
| 9 | 不改代码，只搭端到端拓扑并核对全量门槛 | `tests/10-end-to-end.test.ts` + `pnpm test` + `pnpm typecheck` + `pnpm build` | 步骤 8 |

## 每一步的操作命令

以步骤 1 为例，其余步骤把编号和测试文件换成对应值即可：

```bash
cd companion-practice   # 或你的练习分支

# 1. 先看红：把 rewriteAbsoluteForm 函数体临时改成 `return null`
pnpm vitest run tests/02-http-forward-proxy.test.ts
# 预期看到用例失败

# 2. 对照《HTTP 正向代理：改写请求与打通 CONNECT》重新实现
#    （对照 ./02-http-forward-proxy 里的代码片段和讲解，不是照抄参考实现里的每一行）

# 3. 再跑一次，确认变绿
pnpm vitest run tests/02-http-forward-proxy.test.ts
```

## 毕业任务

按上表把步骤 1 到 9 全部走完之后，运行一次全量门槛：

```bash
pnpm test        # 9 个章节测试文件全绿
pnpm typecheck
pnpm build
```

全部通过，即代表你独立重建出了 [第 10 章](./10-end-to-end-boundary) 承诺的最终产物：一个双入口（HTTP 正向代理 + SOCKS5）、三出站（DIRECT / REJECT / SOCKS5 上游）、84 项测试全绿的本地代理，且全程只验证过 `127.0.0.1` 拓扑。
