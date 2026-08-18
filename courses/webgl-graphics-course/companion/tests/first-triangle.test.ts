import { describe, expect, it } from 'vitest'
import { createTriangle } from '../src/geometry/triangle'

// 第 2 章里程碑：教学三角形的 NDC 顶点数据。
// 只断言行为（长度、取值范围、非退化），不断言内部布局。
describe('createTriangle（教学三角形，NDC 坐标）', () => {
  it('返回 3 个顶点 × x/y/z = 9 个 float 分量', () => {
    const tri = createTriangle()
    expect(tri).toBeInstanceOf(Float32Array)
    expect(tri).toHaveLength(9)
  })

  it('所有分量都落在 NDC 范围 [-1, 1] 内（无 NaN）', () => {
    const tri = createTriangle()
    for (const v of tri) {
      expect(Number.isNaN(v)).toBe(false)
      expect(v).toBeGreaterThanOrEqual(-1)
      expect(v).toBeLessThanOrEqual(1)
    }
  })

  it('三顶点不共线：鞋带公式有向面积 > 0（顶点逆时针）', () => {
    const tri = createTriangle()
    const ax = tri[0]
    const ay = tri[1]
    const bx = tri[3]
    const by = tri[4]
    const cx = tri[6]
    const cy = tri[7]
    // 鞋带公式（shoelace）：面积 = |x_A(y_B−y_C) + x_B(y_C−y_A) + x_C(y_A−y_B)| / 2
    // 先不取绝对值：和为正 = 三顶点按逆时针排列（缠绕方向是公开承诺，
    // 后续背面剔除按它判正反面）。向量工具第 4 章才建，这里用坐标展开式。
    const doubleArea = ax * (by - cy) + bx * (cy - ay) + cx * (ay - by)
    // 手算对账：底 1.2 × 高 1.3 ÷ 2 = 0.78，加倍面积 1.56——读者可在纸上复算
    expect(doubleArea).toBeCloseTo(1.56, 4)
    expect(doubleArea).toBeGreaterThan(0)
  })
})
