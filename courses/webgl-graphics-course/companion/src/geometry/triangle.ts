/**
 * 教学三角形——全书第一个几何模块。
 *
 * 坐标写在裁剪坐标系（NDC，normalized device coordinates）下：x/y/z 全部
 * 落在 [-1,1]——GPU 只认这座「标准操场」：中心是 (0,0)，x 朝右、y 朝上、
 * z 朝屏幕深处。任何要画的坐标，都要先换算成操场坐标才有效。
 *
 * 三个顶点按逆时针排列（缠绕方向是公开承诺，背面剔除按它判正反面）：
 *
 * ```text
 *        C (0.0, 0.8)
 *        /\
 *       /  \
 *      /    \
 * A(-0.6,-0.5)----B (0.6,-0.5)
 * ```
 *
 * 手算对账：底 1.2 × 高 1.3 ÷ 2 = 面积 0.78——tests/first-triangle.test.ts
 * 用鞋带公式断言同一笔账。
 *
 * 为什么返回裸 Float32Array 而不是对象：这是喂给 gl.bufferData 的最简形态，
 * 9 个数原样进显存；后续几何（立方体）带法线/UV，才升级成
 * { vertices, indices, stride } 形状的对象（顶点数据交错排列）。
 */
export function createTriangle(): Float32Array {
  return new Float32Array([
    -0.6, -0.5, 0.0, // 顶点 A：左下
    0.6, -0.5, 0.0, // 顶点 B：右下
    0.0, 0.8, 0.0, // 顶点 C：顶部
  ])
}
