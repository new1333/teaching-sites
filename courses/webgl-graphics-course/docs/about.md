# 关于本课程

本课程从 WebGL 的第一个三角形讲起，逐层讲清图形学核心概念——着色器、变换、投影、相机、深度、纹理、光照、场景树——终点是亲手组装一个可漫游的 3D 小世界。

- 共 14 章（12 章动手 + 2 章原理）+ 4 个附录
- 输入：主题句「webgl 图形学入门：从 WebGL 讲起，讲清图形学概念，到能构建 3D 世界；每章带可在 VitePress 内实时预览/在线编辑的示例」
- 每章正文内嵌可实时运行的 WebGL 演示：着色器类章节可在线编辑 GLSL、即时重编译；全部演示零外部资源
- 伴生实验场 `companion/` 是一个纯 TypeScript 的图形数学库 minigl，随章演进、测试先行

## 怎么跑

- 项目根 `pnpm dev`：从聚合站进入本课程
- 本课程单独预览：`cd courses/webgl-graphics-course && pnpm install && pnpm docs:dev`
- 实验场测试：`cd companion && pnpm install && pnpm test`
