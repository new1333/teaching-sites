# Pinia 从零实现 —— VitePress 教学站点

以 [vuejs/pinia](https://github.com/vuejs/pinia)（v4）为源的教学课程：12 章带读者从零写出自己的 pinia-mini（约 680 行 TypeScript，40 个测试全绿），质量标准是**读完能从零重新实现 Pinia 的核心**，而不是源码解读。

## 怎么跑

```bash
# 方式一：项目根的聚合入口（和其他课程一起预览）
pnpm dev             # 项目根执行，本课挂载在 /pinia-course/

# 方式二：只跑本课程（站点）
pnpm install
pnpm docs:dev        # 开发预览
pnpm docs:build      # 构建

# 伴生实现（pinia-mini）
cd companion
npm install
npm test             # vitest run，40 个测试
npm run typecheck    # tsc --noEmit
```

## 章节目录

### 第一部分 · 地基与容器

1. 状态管理的四种尝试与它们的极限（原理）
2. Vue 响应式工具箱：pinia 的六块地基（原理）
3. createPinia：一个挂在 app 上的容器（实现）
4. defineStore 与 store 的单例身份（实现）

### 第二部分 · store 的血肉

5. 选项式 store：state、getters、actions 三件套（实现）
6. 组合式 store 与运行时分类（实现）
7. $patch 深合并与 $reset（实现）
8. 订阅系统：$subscribe 与 $onAction（实现）
9. storeToRefs：解构不丢响应性的秘密（实现）

### 第三部分 · 扩展与生产

10. 插件系统：pinia.use 与 store 扩展（实现）
11. activePinia：一个应用一个容器（原理）
12. pinia-mini vs pinia：差异地图（源码对照）

## 终点里程碑

读者课程结束拥有：一个约 400 行 src（含类型共约 680 行）、API 与真 pinia 同构的 pinia-mini——`createPinia` / `defineStore` / 选项式与组合式两种 store 语法 / `$patch` / `$reset` / `$subscribe` / `$onAction` / `storeToRefs` / 插件系统。验证方式：`cd companion && npm install && npm test`——通过改编自官方 `__tests__` 核心场景的 8 个测试文件（40 个测试）。

## 目录结构

```text
pinia-course/
├── docs/          # VitePress 站点（12 章 + 首页 + 关于）
├── companion/     # 伴生实现 pinia-mini（TypeScript + vitest，逐章演进）
└── .course/       # 生成管线状态（outline / bible / rolling / repo 浅克隆）
```
