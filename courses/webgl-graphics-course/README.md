# WebGL 图形学入门：从第一个三角形到 3D 世界

一门 VitePress 交互式教学课程：从 WebGL 的第一个三角形讲起，逐层讲清图形学核心概念——着色器、变换、投影、相机、深度、纹理、光照、场景树——终点是亲手组装一个可漫游的 3D 小世界。

- 14 章（12 章动手 + 2 章原理）+ 4 个附录
- 伴生实验场 `companion/`：minigl——纯 TypeScript 图形数学与场景库（约 1200 行），126 条原理断言（`tsc` + `vitest` 双门槛）
- 每章正文内嵌实时演示组件（13 个）：Canvas 2D vs WebGL 粒子对比、可在线编辑 GLSL 即时重编译的 Playground、深度测试开关、Phong 光照、太阳系层级动画、轨道+漫游相机……全部程序化生成、零外部资源
- 目标读者：会写 TypeScript、但没碰过图形学的 Web 开发者（数学从「向量是什么」讲起）

## 怎么跑

- 聚合站（推荐）：项目根 `pnpm dev`，从课程中心进入本课程
- 单独预览：`cd courses/webgl-graphics-course && pnpm install && pnpm docs:dev`
- 实验场测试：`cd companion && pnpm install && pnpm test`（12 个测试文件、126 条断言，先红后绿逐章解锁）

## 章节目录

| # | 章 | 里程碑 |
| --- | --- | --- |
| 1 | 为什么你的画布卡成幻灯片：GPU 与渲染管线 | 粒子数滑杆的 Canvas 2D vs WebGL 同屏对比 |
| 2 | 第一个三角形：着色器、缓冲区与顶点属性 | 渐变三角形 + 在线编辑 GLSL 的 Playground |
| 3 | 动起来：uniform 与渲染循环 | lerp/clamp/smoothstep（与 GLSL 同语义） |
| 4 | 向量：图形世界的语言 | vec3 八件套，3-4-5 手算对账 |
| 5 | 矩阵变换：平移、旋转、缩放与顺序陷阱 | mat4 基础 + 实时 4×4 矩阵面板 |
| 6 | 投影：把三维压进屏幕 | perspective/ortho + 透视 vs 正交对比 |
| 7 | 相机：lookAt 与搬世界 | lookAt + MVP 三矩阵面板 |
| 8 | 深度缓冲与第一个 3D 物体 | 立方体几何 + 深度开关看幽灵方块 |
| 9 | 纹理：给世界穿上皮肤 | 程序化棋盘格 + 过滤/包裹切换 |
| 10 | 光照：法线与 Phong 三件套 | 法线矩阵 + Phong CPU 参考实现 |
| 11 | 场景树：坐标跟着上级走 | SceneNode 递归链乘 + 太阳系 |
| 12 | 可操控的相机：轨道与漫游 | orbitEye/viewBasis + 拖拽滚轮 WASD |
| 13 | 组装：一个可漫游的 3D 小世界 | createWorld(seed) + 可漫游最终世界 |
| 14 | 写完了 WebGL：Three.js、WebGL2 与 WebGPU | 手写 vs 上库决策清单 |

附录：[术语表](docs/glossary.md) · [GLSL/WebGL 速查表](docs/cheatsheet.md) · [简化清单](docs/divergences.md) · [练习路线](docs/exercises.md)

## 终点里程碑

读完课程你拥有：minigl 图形库 + 一个可漫游的 3D 小世界（WASD 移动、拖拽转头、昼夜切换、按种子重建），全部 126 条原理断言测试通过。第 13 章正文的 `<DemoWorld />` 就是这个世界的在线版。
