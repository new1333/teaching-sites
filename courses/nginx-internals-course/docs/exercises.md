# 练习路线：清空 src，自己写一遍

读本课程时你一直在读「别人写好的 tinysrv」。这份练习把它变成你的：**清空 `src/`，让 52 个测试从红到绿，全部亲手写一遍**。测试是课程管线按章现写的断言（先红后绿），它们本身就是一份按章解锁的作业梯子。

## 玩法

```bash
cd companion
npm install
rm -rf src        # 清空实现，只留测试
npm test          # 一片红——这是起点
```

然后按章推进：每次只让下一个测试文件变绿，绿一个文件再开下一个。

## 章节阶梯

| 步 | 让这个文件变绿 | 你要写什么 | 卡住时回看 |
|---|---|---|---|
| 1 | `connection-registry.test.ts` | `src/conn.ts`：createConnRegistry——入账、续命、空闲收割、满员拒绝 | 第 2 章 |
| 2 | `http-parser-state-machine.test.ts` | `src/http-parser.ts`：pending 跨 feed、三状态、行长上限 | 第 3 章 |
| 3 | `keepalive-reuse.test.ts` | `src/server.ts`：组装层 + ManagedConn.write；注意测试助手的报文格式别多打空行 | 第 4 章 |
| 4 | `memory-pool.test.ts` | `src/pool.ts`：批发零售、超大块直通、reset 清仓 | 第 5 章 |
| 5 | `config-inheritance.test.ts` | `src/config.ts`：切词（结构符补空格！）+ 栈式入树 + 路径合并 | 第 6 章 |
| 6 | `reverse-proxy.test.ts` | `src/proxy.ts`：proxyOnce + 502 + X-Forwarded-For；server.ts 接驳 proxy 选项 | 第 8 章 |
| 7 | `load-balance.test.ts` | `src/upstream.ts`：cursor 轮询 + 失败账 + downUntil；proxyRequestPooled | 第 9 章 |
| 8 | `rate-limit-leaky-bucket.test.ts` | `src/ratelimit.ts`：懒结算水位；server.ts 接驳 rateLimit（key 取 IP 段） | 第 10 章 |

## 三条规矩

- **旧章测试持续全绿**：每写一步都全量跑 `npm test`——它们是你自己版本的 API 兼容哨兵，红了说明你把前章的承诺改坏了。
- **先读测试再动手**：每个测试文件断言的都是「行为承诺」（能写进文档的那种），不是实现细节——照承诺设计接口，别照报错猜。
- **正文代码是参考答案不是抄写材料**：卡住先回对应章读原理段落，实在写不出再看 `src/` 里的原实现——然后把参考合上，自己写。

全部绿灯时，`npm test` 的 52 个用例就是你亲手造的 tinysrv 的验收报告——和课程交付时的那份一模一样。

## 加餐（可选）

- **多进程版**：用 Node 的 `cluster` 模块给 tinysrv 配上 master/worker（第 7 章讲的全套机制：共享监听端口、worker 崩溃自动补位），把「一个老板一队员工」也写出来。
- **流式代理**：把第 8 章「收齐再转」改成边收边转（环形缓冲），再给它配一个上游连接池——正文「诚实差异账」里列的三处简化，全部补齐。
