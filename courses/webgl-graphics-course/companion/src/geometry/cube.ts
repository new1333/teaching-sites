import type { Vec3 } from '../math/vec3'

/**
 * 教学立方体——全书的第一个 3D 物体（深度测试与索引绘制的道具）。
 *
 * 单位立方体约定：棱长 2、中心在原点，角点坐标全为 ±1——包围盒恰为
 * [-1,1]³。它不是 NDC 数据：这里是物体自己的局部坐标，画到屏幕要靠
 * 模型/视图/投影三台矩阵搬运（与真实 OpenGL 家族同款约定）。
 *
 * 为什么是 24 顶点而不是 8 个角点：一个角点被三张面共享，而三张面的
 * 法线各不相同（+X 面的角点法线朝 (1,0,0)，+Y 面的同一位角点法线朝
 * (0,1,0)）……法线、UV 都是逐顶点数据，棱两侧取值不同，复用就此到头
 * ——顶点 = 「位置 + 全部逐顶点属性」的整包，不是光秃秃的角点。所以
 * 每面自带 4 个顶点：6 面 × 4 = 24。
 *
 * 交错布局：每顶点 8 个分量挨个排进同一张表——
 *
 * ```text
 * [px,py,pz,  nx,ny,nz,  u,v]   ← 第 v 个顶点占 [8v, 8v+8)
 *  └ position └ normal    └ uv
 * ```
 *
 * 喂 gl.vertexAttribPointer 时：stride = 8 个 float = 32 字节；position
 * 偏移 0、normal 偏移 3 个 float = 12 字节、uv 偏移 6 个 float = 24 字节。
 *
 * 缠绕方向是公开承诺：每面 4 个角点从外面看按「左下→右下→右上→左上」
 * 逆时针排列，默认 frontFace(CCW) 下这就是正面——背面剔除据此判正反。
 * 面数据表驱动：一行 = 一张面（法线 + 4 角点），UV 依次 (0,0)(1,0)(1,1)(0,1)。
 */
export interface CubeGeometry {
  /** 24 顶点 × 8 分量的交错顶点表，布局见上文。 */
  vertices: Float32Array
  /** 36 个三角索引（6 面 × 2 三角 × 3 顶点），值域 [0, 24)。 */
  indices: Uint16Array
  /** 每顶点分量数（= 8）；接 GL 时乘 4 得字节步长 32。 */
  stride: number
}

/** 每顶点分量数：position 3 + normal 3 + uv 2。 */
export const CUBE_STRIDE = 8

/** 每面 4 个角点的 UV：左下 (0,0) → 右下 (1,0) → 右上 (1,1) → 左上 (0,1)。 */
const FACE_UVS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
]

/**
 * 面数据表：一行一张面——法线 + 从外面看逆时针（左下→右下→右上→左上）
 * 的 4 个角点。生成循环只管「摊平」，立体感全部住在这张表里。
 */
const FACES: ReadonlyArray<{
  readonly normal: Vec3
  readonly corners: readonly [Vec3, Vec3, Vec3, Vec3]
}> = [
  { normal: [1, 0, 0], corners: [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]] }, // +X
  { normal: [-1, 0, 0], corners: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]] }, // −X
  { normal: [0, 1, 0], corners: [[1, 1, -1], [-1, 1, -1], [-1, 1, 1], [1, 1, 1]] }, // +Y
  { normal: [0, -1, 0], corners: [[1, -1, 1], [-1, -1, 1], [-1, -1, -1], [1, -1, -1]] }, // −Y
  { normal: [0, 0, 1], corners: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] }, // +Z
  { normal: [0, 0, -1], corners: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]] }, // −Z
]

export function createCube(): CubeGeometry {
  const vertices = new Float32Array(FACES.length * 4 * CUBE_STRIDE) // 24 × 8
  const indices = new Uint16Array(FACES.length * 6) // 6 面 × 2 三角 × 3 顶点
  FACES.forEach((face, f) => {
    face.corners.forEach((corner, i) => {
      const offset = (f * 4 + i) * CUBE_STRIDE
      vertices.set(corner, offset) // position 占 0..2 格
      vertices.set(face.normal, offset + 3) // normal 紧随其后占 3..5 格
      vertices.set(FACE_UVS[i], offset + 6) // uv 收尾占 6..7 格
    })
    const base = f * 4
    // 每面两个三角，共用 0→2 这条对角线（36 个索引引用 24 份顶点）
    indices.set([base, base + 1, base + 2, base, base + 2, base + 3], f * 6)
  })
  return { vertices, indices, stride: CUBE_STRIDE }
}
