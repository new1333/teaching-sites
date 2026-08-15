# 关于本课程

《Pinia 从零实现》是一座动手教学站点：以 [vuejs/pinia](https://github.com/vuejs/pinia)（v4）为源，蒸馏出状态管理库的核心特性，带读者从零写出自己的 pinia-mini。

- **章节**：12 章（3 分部：地基与容器 / store 的血肉 / 扩展与生产），全部完成，无降级章。
- **质量标准**：读者读完能从零重新实现一个 pinia——不是源码解读。每个动手章先演进伴生实现并通过双硬门槛（`tsc --noEmit` + `vitest run`），再写正文。
- **伴生实现**：`companion/` 目录下的 pinia-mini，约 680 行 TypeScript，40 个测试全部通过（改编自官方 `__tests__` 核心场景）。
- **输入**：GitHub 仓库 `vuejs/pinia@v4`（浅克隆于生成期，作为溯源语料）。

## 怎么跑

```bash
# 站点
pnpm install && pnpm docs:dev

# 伴生实现（pinia-mini）
cd companion && npm install && npm test
```
