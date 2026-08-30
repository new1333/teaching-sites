---
title: 练习路线：把 mini nginx 再写一遍
---

# 练习路线：把 mini nginx 再写一遍

读完了不算会——`companion/` 的测试是逐章「先红后绿」长出来的，天然是一副 TDD 作业梯子：把实现清空，按章序让验证一级级转绿，等于把 mini nginx 亲手再写一遍。

## 玩法

```bash
cd companion
# 1. 备份原实现（对照用）
cp -r src src-reference
# 2. 清空实现：保留包骨架与静态资产，删掉全部模块
rm src/fable/blocking_server.py src/fable/threaded_server.py src/fable/bench.py \
   src/fable/event_loop.py src/fable/event_server.py src/fable/http_parser.py \
   src/fable/buffers.py src/fable/slow_client.py src/fable/worker_pool.py \
   src/fable/proxy_server.py src/fable/upstream_demo.py src/fable/send_raw.py
# 3. 按章序开写：每级「先跑测试看到红 → 写实现 → 转绿」
#    每级只跑本级测试文件（如第 1 级）：
python -m unittest tests.test_first_http_server -v
#    中途跑 discover 全量会因后续级的模块还没写而报收集错误，属预期；六级写完再用 discover 验 56 全绿
```

## 梯子（每级一个测试文件，13+10+12+14+3+4 = 56 项断言）

| 级 | 测试文件 | 你要写出什么 | 超前依赖提示 |
|---|---|---|---|
| 1 | `tests/test_first_http_server.py` | `blocking_server`（serve/Request/parse_request/build_response）与 `send_raw` 工具、`www/` 静态资产 | 无 |
| 2 | `tests/test_thread_per_connection_cost.py` | `threaded_server`（一连接一线程）与 `bench` 探针（run_probe 一族） | 复用第 1 级的解析与组装 |
| 3 | `tests/test_event_loop.py` | `event_loop.EventLoop` 与 `event_server`（初版一锤子回调即可）；bench 加 event/fdlimit 模式 | 注意 Windows select 的空名单护栏与 512 上限本身就是测试点 |
| 4 | `tests/test_connection_state_machine.py` | `http_parser`（增量状态机）、`buffers`、`slow_client`；`event_server` 升级为带收发缓冲的连接状态机 | 第 3 级的 EventLoop 一行不用改 |
| 5 | `tests/test_master_workers.py` | `worker_pool`（master 派 worker 共享监听、补位、reload 轮换、看门狗） | worker 直接复用第 4 级的连接伺候；多进程测试较慢属正常 |
| 6 | `tests/test_reverse_proxy.py` | `proxy_server`（下游+上游同一事件循环、轮询分单、失败摘除）与 `upstream_demo` | 全书积木都在前五级 |

各级测试只 import 该级及之前引入的模块（已机械核验），梯子严格可爬。测试断言的是行为（返回什么、分摊多少、杀掉谁还活着），不是实现细节——同一份测试容得下你的不同写法。

## 毕业项目（选做）

给 `proxy_server` 的分单器加「最少连接（least conn）」策略：哪台上游在手连接最少就把新请求发给哪台。

- 需要的每项技能正文都示范过：给上游记账（第 5 章的 fable-stats 思路）、改分单器（第 6 章 `_pick` 三行）、加行为测试（第 6 章 5/5 分摊断言的写法照搬即可）。
- 分步提示：① 给每台上游加一个在途计数（发出请求 +1、响应齐 -1）；② `_pick` 从「游标走一格」换成「挑计数最小、并列取游标序」；③ 写一条断言：先压住一台上游的慢请求，再发的新请求应全落另一台。
- 对照真实 nginx 的 least_conn 语义见[第 7 章欠条二](./07-vs-real-nginx)。
