# fable-nginx：亲手复刻一个 nginx

一门原理重实现课：不复刻 nginx 的源码，而是把它的承重原理——HTTP 伺候、C10K 与一连接一线程的代价、非阻塞 IO 与事件循环、连接状态机、master-worker 多进程、反向代理——亲手重实现一遍，最后与真实 nginx 逐项对账。

- **读者**：会写代码、用过 HTTP，但没碰过网络编程与事件驱动的开发者
- **主线问题**：同一台机器，为什么「一连接一线程」的服务器几千连接就趴下，而 nginx 能扛几万？我们能不能亲手写一个这样的服务器？
- **终点里程碑**：一个事件驱动、多进程、可反向代理的迷你 nginx（Python 实现，56 项测试全绿）

## 怎么跑

两条路：

```bash
# 路一：项目根聚合站（全部课程一起预览）
pnpm dev

# 路二：只看本课程
cd courses/fable-nginx
pnpm install && pnpm docs:dev
```

验证物工程（读者课程结束拥有的迷你 nginx，v0 到 v5 全程可见；Python 3.10+ 纯标准库、零第三方依赖）：

```bash
cd courses/fable-nginx/companion
npm test          # = python -m unittest discover -s tests -t .（56 项行为测试）
npm run typecheck # = python -m compileall -q src
```

亲手开机（章节正文里每章都有指引）：`cd companion/src && python -m fable.proxy_server 127.0.0.1 8080 127.0.0.1:9001 127.0.0.1:9002`，配两台上游 `python -m fable.upstream_demo 127.0.0.1 9001 alpha` 与 `... 9002 beta`，curl 十次看轮询分单，杀一台上游后零报错。

## 章节目录

| # | 章 | 里程碑 |
|---|---|---|
| 1 | 一个 HTTP 服务器的最小闭环 | v0 阻塞版：curl 通；大文件传输时第二个 curl 干等 |
| 2 | 一连接一线程的代价：C10K 从哪来 | v1 线程版 + 压测探针：300 连接的线程/内存账 |
| 3 | 把「等」集中起来：非阻塞 IO 与事件循环 | v2 事件循环版：1 线程挂 300 连接的对照实验 |
| 4 | 半读半写的世界：事件驱动的连接状态机 | v3 状态机 + 收发缓冲：碎片请求/截断修复 |
| 5 | master 与 worker：nginx 的多进程骨架 | v4 多进程版：两 worker 实测分摊、优雅轮换 |
| 6 | 反向代理：既当前台，又当传话员 | v5 代理版：轮询分单 5/5、杀上游零报错 |
| 7 | 对账真 nginx：我们写的和它差在哪 | 差距地图（工程优化/架构差异/功能缺口） |

附录：[术语表](docs/glossary.md) · [差异清单](docs/simplifications.md) · [练习路线](docs/exercises.md)

## 验证物规模与事实源

`companion/src` 全部 Python 约 2000 行（含压测探针与演示工具；服务器演进本体 v0→v5 共六个形态），56 项行为测试全绿。正文一切资源账数字、报错原文、引文出处以 companion 实跑输出与权威文档清单（`.course/bible.json` 的 authority_docs）为事实源；我们对现实的每一处简化登记在差异清单。本课程无可视化资产，可感知成果以正文「亲手开机/亲手验证」段的服务器行为为准。
