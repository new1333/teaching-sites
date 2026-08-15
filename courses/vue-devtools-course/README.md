# Vue DevTools 原理：从零实现一个调试器内核

一门 VitePress 教学课程：拆解 Vue DevTools 的核心原理，并带你在伴生实验场里亲手做出一个约 700 行、无 DOM 依赖的最小调试器内核。仓库 `vuejs/devtools` 仅作作者侧备课资料，正文与实验场零仓库痕迹。

## 怎么跑

两条路进入课程：

```bash
# 1. 从聚合课程中心进入（项目根目录）
pnpm dev

# 2. 只看本课程（本课程目录内）
pnpm install
pnpm docs:dev
```

伴生实验场（原理实验工程）：

```bash
cd companion
npm install
npm test          # 74 条自设原理断言
npm run typecheck
```

## 章节目录

| # | 章 | 类型 |
|---|---|---|
| 1 | 两个世界：调试器为什么难做 | principle |
| 2 | 全局钩子：window 上的第一次握手 | build |
| 3 | 事件系统：从原始事件到语义事件 | build |
| 4 | 应用登记处：多应用与实例表 | build |
| 5 | 组件树：走 vnode，不走 DOM | build |
| 6 | 状态快照：分类与清洗 | build |
| 7 | 序列化：循环引用的过桥方案 | build |
| 8 | 编辑回写：把修改写回活实例 | build |
| 9 | 插件 API：第三方库的面板 | build |
| 10 | 双向 RPC 与通道抽象 | build |
| 11 | 宿主形态：Vite、扩展与中继 | principle |

## 终点里程碑

读完本课程，你拥有：

- 一个约 700 行 TypeScript 的最小调试器内核：全局钩子与重放队列、事件系统、应用登记处、组件树遍历、状态快照、循环引用编码、编辑回写、插件与检查器、双向 RPC 与内存通道
- 调试器「能看见、能对话、能修改」三件事的最小原理实现

验证方式：`cd companion && npm install && npm test`——74 条自设原理断言全绿，`pnpm run typecheck` 通过。
