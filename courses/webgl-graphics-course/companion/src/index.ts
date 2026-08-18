/**
 * minigl——WebGL 图形学入门课程的伴生实验场。
 *
 * 一个纯 TypeScript 的图形数学与场景库：插值、向量、矩阵（变换/投影/
 * lookAt/法线矩阵）、几何生成、程序化纹理、Phong 参考、场景树、相机
 * 控制、世界装配。它不包含任何 GL 调用——GL 接线由课程正文内嵌的实时
 * 演示承担；本库只装「可在 Node 里被机械验证的图形学原理」。
 *
 * 随章演进，测试先行（tests/ 按章 append-only）。
 */
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
