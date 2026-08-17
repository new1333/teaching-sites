# nginx 实现原理：亲手写一个事件驱动 HTTP 服务器

一门给「nginx 熟练用户」的实现原理课：不读 C 源码，用 TypeScript 亲手造一个最小的**事件驱动 HTTP 服务器 tinysrv**，让每条 nginx 原理都跑在可断言验证的代码上。

- **读者**：配过 nginx、懂 HTTP 的 Web 开发者；socket 层、系统编程零基础（书内从零教）。
- **产出**：tinysrv——连接注册表、HTTP/1.1 状态机、keep-alive、内存池、配置继承、反向代理、负载均衡、漏桶限流，52 个测试全绿收官（含 127.0.0.1 真实 socket 集成验证）。

## 运行

```bash
# 方式一：聚合站（推荐）——项目根目录
pnpm dev
# 首页是全部课程的卡片，本课挂在 /nginx-internals-course/ 路径下

# 方式二：单课独立运行
cd courses/nginx-internals-course
pnpm install
pnpm docs:dev
```

伴生实验场（读者课程结束拥有的最小工程）：

```bash
cd courses/nginx-internals-course/companion
npm install
npm test          # 52 个测试（vitest）
npm run typecheck
```

想挑战「清空 src、自己从红写到绿」，见课程附录《练习路线》。

## 章节目录

**第一部分 · 单线程的极限艺术：事件驱动**

1. C10K：一万个连接怎么把老牌服务器打爆
2. 连接注册表：把连接当成一等公民管理
3. HTTP 解析状态机：半个请求也能接
4. keep-alive：说完别挂电话

**第二部分 · 工程支柱：内存、配置与进程**

5. 请求内存池：整批进货，整仓清退
6. 配置继承：你写过的那些花括号
7. master 与 worker：一个老板一队员工

**第三部分 · 流量主场：代理、均衡与限流**

8. 反向代理：前台接待员的艺术
9. 负载均衡与故障转移：三台坏一台，用户看不见
10. 漏桶限流：你抄过的 rate 和 burst 到底是什么
11. 写回路径：少搬一次是一次

**附录**：术语表 · 信号与进程控制速查 · 你配过的指令 → 课程实现的机制 · 练习路线

## 终点里程碑

读完本课程，你拥有 **tinysrv——约千行的事件驱动 HTTP 服务器，含代理、均衡与限流**；它通过课程自设的 52 条原理断言测试，其中包括 localhost 真实 socket 的双跳代理与故障转移集成验证。更重要的是，你能不看资料讲清 nginx 为什么快、为什么稳：C10K 的三笔账、epoll 的登记与回报、TIME_WAIT 的端口账、内存池的结构性防泄漏、reload 不断流的六步时序、慢客户端为什么拖不死反代、坏一台为什么用户看不见、rate 与 burst 各挡什么流量。
