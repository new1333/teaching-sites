# Redis 原理与最小实现：亲手写一个迷你 Redis

一门「原理重实现」课：从「磁盘为什么慢」出发，逐层拆解 Redis 快与省的原理（RESP 协议、单线程事件驱动、渐进式 rehash 哈希表、跳表、TTL、近似 LRU、AOF/RDB、复制概览），终点是亲手写一个迷你 Redis——**本机 `redis-cli` 能真连上它收发命令**。

- 读者画像：会 TypeScript、用过数据库、没读过存储内部的开发者。
- 终点里程碑：亲手写一个迷你 Redis：RESP、哈希表、TTL、淘汰、AOF 全实现，测试全绿。
- 验证：companion 工程 13 个源文件约 1300 行（不含空行）、101 条测试全绿。

## 怎么跑

两条路进站：

```bash
# 聚合入口：仓库根，全部课程一起预览
pnpm dev

# 单课预览
cd courses/mini-redis-course && pnpm install && pnpm docs:dev
```

验证物工程（读者课程结束拥有的最小实现）：

```bash
cd courses/mini-redis-course/companion
npm install
npm run typecheck   # tsc --noEmit
npm test            # vitest run，101 条

node src/boot.ts            # 起迷你服务器（默认 6399）
redis-cli -p 6399 PING      # PONG——真客户端连你写的服务器
node src/boot-naive.ts      # 第 3 章的串行反例（6398）
```

注意：第 8 章起 `boot.ts` 会读写 `appendonly.aof`（已 gitignore）；重跑旧章开机实验前先删掉它。

## 章节目录

| # | 章 | 类型 | 亲手产物 |
| --- | --- | --- | --- |
| 1 | 磁盘太慢了：Redis 到底解决什么问题 | 原理 | 延迟对照表 + cache-aside 时序 |
| 2 | RESP：两个进程怎么对话 | 动手 | RespDecoder + 能答 GET/SET 的服务器，redis-cli 可连 |
| 3 | 单线程的事件循环 | 动手 | 并发服务器 + 管道 + 串行反例 |
| 4 | 全局哈希表：所有键的家 | 动手 | Dict（渐进式 rehash），rehash 中读写照常 |
| 5 | 跳表：能二分查找的链表 | 动手 | SkipList + ZADD/ZRANGE/ZCARD |
| 6 | 过期删除：惰性与定期 | 动手 | 过期字典 + EXPIRE/TTL + 两路删除 |
| 7 | 内存满了：不精确的 LRU | 动手 | Evictor（抽 5 踢最旧）+ CONFIG |
| 8 | AOF：把每一步写下来重放 | 动手 | AOF 追加/重放/重写瘦身 |
| 9 | RDB 快照：fork 与写时复制 | 动手 | dump/load 快照 + COW 图解 |
| 10 | 一台是不够的：复制、哨兵与集群 | 原理（视野） | 全量同步时序 + 三形态对照 |
| 11 | 终章对账 | 复习 | 四问回收 + 差异清单收口 |

附录：[术语表](docs/glossary.md) · [练习路线](docs/exercises.md) · [差异清单](docs/divergence.md)（站点内在 `/glossary`、`/exercises`、`/divergence`）。

## 管线状态

`.course/` 内的 `ingestion.json`、`bible.json`、`outline.json`、`rolling.json`、`promises.json` 随课程提交（会话中断续跑凭它们）；`snapshots/` 等可再生物已 gitignore。
