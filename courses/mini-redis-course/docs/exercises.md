---
title: 练习路线：从红到绿重写一遍
---

# 练习路线：从红到绿重写一遍

读完一遍只是看着别人写。要把它变成自己的，最硬的路线是：**清空实现，按章序让 101 条测试从红一条条转绿**。测试文件就是梯子——每章一个文件、append-only、先红后绿，这是全书生成时就钉死的结构，天然是一套按难度排序的作业。

## 准备

1. 备份或另 clone 一份 `companion/`（别在正本上动手）。
2. 删掉 `companion/src/` 下全部 `.ts` 文件——**保留 `tests/`、`package.json`、`tsconfig.json`**。
3. `npm install` 后跑 `npm test`：全红（import 不到实现）。这就是起点。

## 梯子

按章序走，每章的测试文件名就是路标：

| 步 | 测试文件 | 你要写出什么 | 提示（正文出处） |
| --- | --- | --- | --- |
| 1 | `tests/resp-protocol.test.ts`（18 条） | `resp.ts` 的编码器与 RespDecoder、`db.ts` 的 PING/SET/GET/DEL、`server.ts` 雏形、`client.ts` | 第 2 章 |
| 2 | `tests/single-thread-event-loop.test.ts`（6 条） | `naive-server.ts` 串行反例、`client.ts` 的 pipe | 第 3 章 |
| 3 | `tests/hash-table-rehash.test.ts`（10 条） | `dict.ts`（链地址、翻倍扩容、渐进 rehash） | 第 4 章 |
| 4 | `tests/skiplist-zset.test.ts`（14 条） | `skiplist.ts`（随机层数可注入）、`db.ts` 加 ZADD/ZRANGE/ZCARD | 第 5 章 |
| 5 | `tests/ttl-expire.test.ts`（19 条） | `expire.ts`、`db.ts` 接入 SET EX/EXPIRE/TTL/KEYS 与节流周期 | 第 6 章 |
| 6 | `tests/eviction-lru.test.ts`（12 条） | `eviction.ts`、`db.ts` 接入 CONFIG 与内存关 | 第 7 章 |
| 7 | `tests/aof.test.ts`（13 条） | `aof.ts`、`db.ts` 接入记账与 BGREWRITEAOF | 第 8 章 |
| 8 | `tests/rdb-snapshot.test.ts`（9 条） | `rdb.ts`、`db.ts` 接入 SAVE/LOAD/FLUSHALL | 第 9 章 |

两个超前依赖要注意：

- 第 1 步的 `server.ts` 雏形要能过 TCP 往返测试——事件驱动的写法第 3 章才讲透，第 1 步照第 2 章的挂接回调写即可，别急着理解为什么它天然支持管道。
- 第 4 步起 `db.ts` 的键空间是 `Dict<string | SkipList>`（第 5 章），第 1 步先用 `Map`、第 3 步换 `Dict`——与正文演进顺序一致。

## 玩法

- 每步先跑该章测试看红在哪，再回正文对应章读「演练」槽，动手转绿；全绿前不进下一步。
- 卡死超过半小时：回正文找「验证」槽的小破坏实验，反着做一遍（先看哪条红），往往就通了。
- 全部转绿后，`node src/boot.ts` + `redis-cli -p 6399` 走一遍第 2 章验证槽——那是毕业典礼。

毕业的判据只有一条：`npm test` 全绿，且你能对着任何一个红过的地方讲清「它为什么红」。
