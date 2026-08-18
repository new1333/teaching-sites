---
title: 练习路线：把 minigl 再写一遍
---

# 练习路线：把 minigl 再写一遍

读完了，手上要真功夫。`companion/` 的测试是一架现成的梯子：每个 build 章一套测试、按章 append-only、先红后绿——把它当作业本，把 minigl 从空目录再写一遍。

## 玩法三句

1. 复制整个 `companion/` 目录，删空 `src/`（`tests/` 全部保留，它们是判卷官）。
2. 进入目录 `pnpm install`，按章序开写：第 2 章的测试现在全红，写出 `src/geometry/triangle.ts` 让它转绿。
3. 每过一章跑 `pnpm test`——**旧章测试持续全绿**就是你自己版本的 API 兼容哨兵：哪一步把前章的导出面改坏了，红给你看。

## 测试梯子（12 站 · 126 条断言）

| 站 | 测试文件 | 锁什么 | 覆盖章 |
| --- | --- | --- | --- |
| 1 | `first-triangle.test.ts` | 教学三角形：9 分量、[-1,1]、非退化 | [第 2 章](./02-first-triangle) |
| 2 | `uniforms-and-animation.test.ts` | lerp/clamp/smoothstep 与 GLSL 同语义（钳制与外推的差异账） | [第 3 章](./03-uniforms-and-animation) |
| 3 | `vectors.test.ts` | vec3 八件套：3-4-5 手算、点积交换律、右手定则、零向量约定 | [第 4 章](./04-vectors) |
| 4 | `transform-matrices.test.ts` | mat4 八件套：rotY(90°) 落轴、T·R ≠ R·T、齐次平移 | [第 5 章](./05-transform-matrices) |
| 5 | `projection.test.ts` | perspective/ortho：视锥映射、w = −z、平行线保持 | [第 6 章](./06-projection) |
| 6 | `camera-lookat.test.ts` | lookAt：原点落位、轴不翻转、16 数对账 | [第 7 章](./07-camera-lookAt) |
| 7 | `depth-and-cube.test.ts` | 立方体几何：24 顶点 36 索引、法线朝外、UV 铺满 | [第 8 章](./08-depth-and-cube) |
| 8 | `textures.test.ts` | checkerboard：字节数、(0,0) 黑、格数 = cells | [第 9 章](./09-textures) |
| 9 | `lighting.test.ts` | 法线矩阵逆转置、Phong 三件套与 GLSL 同形 | [第 10 章](./10-lighting) |
| 10 | `scene-graph.test.ts` | SceneNode 链乘：公转 90° 月亮世界 (0,0,−5.5) | [第 11 章](./11-scene-graph) |
| 11 | `camera-controls.test.ts` | orbitEye/viewBasis：球坐标落位、基向量手算 | [第 12 章](./12-camera-controls) |
| 12 | `build-3d-world.test.ts` | createWorld 确定性：seed 7 = 18 节点 17 行清单逐位复现 | [第 13 章](./13-build-3d-world) |

## 终态结构（写完该长这样）

```text
companion/src/
├── index.ts              # 根入口：全部 re-export（见下）
├── math/
│   ├── interpolate.ts    # lerp / clamp / smoothstep
│   ├── vec3.ts           # 八件套 + Vec3 类型
│   └── mat4.ts           # 变换/投影/lookAt/法线矩阵 + Mat4 类型
├── geometry/
│   ├── triangle.ts       # createTriangle
│   └── cube.ts           # createCube（交错 pos3+normal3+uv2）
├── texture/procedural.ts # checkerboard
├── light/phong.ts        # reflect/diffuse/specular/computePhong
├── scene/
│   ├── node.ts           # SceneNode（local/children/world/data）
│   └── camera.ts         # orbitEye/viewBasis + 收拢常数
└── world/world.ts        # createWorld/collectRenderList/materialOf
```

根入口的仓库终态（第 5/6/7 章正文里的 index.ts 代码块是各章时点的拼版，全貌在这里对齐）：

```ts
// src/index.ts · minigl 根入口（仓库终态）
export { createTriangle } from './geometry/triangle'
export { createCube, CUBE_STRIDE } from './geometry/cube'
export type { CubeGeometry } from './geometry/cube'
export { checkerboard } from './texture/procedural'
export { clamp, lerp, smoothstep } from './math/interpolate'
export {
  add,
  cross,
  distance,
  dot,
  length,
  normalize,
  scale,
  sub,
} from './math/vec3'
export type { Vec3 } from './math/vec3'
export { computePhong, diffuse, reflect, specular } from './light/phong'
export type { PhongComponents } from './light/phong'
export {
  identity,
  lookAt,
  multiply,
  normalFromMat4,
  ortho,
  perspective,
  rotX,
  rotY,
  rotZ,
  transformPoint,
  translate,
} from './math/mat4'
// mat4 的 scale 与 vec3 的 scale 同名：根入口里矩阵版化名 scaleMat4，
// 模块内本名仍是 scale（tests 与正文都从 './math/mat4' 直接导入）。
export { scale as scaleMat4 } from './math/mat4'
export type { Mat4 } from './math/mat4'
export { SceneNode } from './scene/node'
export {
  ORBIT_POLAR_MAX_DEG,
  ORBIT_POLAR_MIN_DEG,
  PITCH_LIMIT_DEG,
  orbitEye,
  viewBasis,
} from './scene/camera'
export type { CameraBasis } from './scene/camera'
export { collectRenderList, createWorld, materialOf } from './world/world'
export type { FogParams, Material, RenderItem, World, WorldEntry } from './world/world'
```

## 梯子之外的加练

正文里留过口的习题，做完梯子可以接着加：

- **贴地行走**（[第 12 章](./12-camera-controls) 边界说明）：把漫游相机的 forward 压平（y 清零再归一化）再归位——向量投影的活，第 4 章的账够用。
- **UV 越界推演**（[第 9 章](./09-textures) 章末自查）：REPEAT 下 UV (1.3, 0.55) 落哪格？在纸面推完，去 DemoTextureCube 把 UV 拉到 [0,3] 验证。
- **先红复刻**：各章「验证」节都留了一处「改哪一行会红」——删掉那行跑 `pnpm test`，看断言怎么把错误逮住，再改回来。
- **给世界加一件东西**（[第 13 章](./13-build-3d-world)）：在 `world.ts` 里加一类物体（比如一排路灯），消费随机数的笔数要自己记账——顺序即承诺，多一笔少一笔整个世界换脸。
