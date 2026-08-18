import { describe, expect, it } from 'vitest'
import { cross, length } from '../src/math/vec3'
import {
  multiply,
  ortho,
  perspective,
  transformPoint,
  translate,
} from '../src/math/mat4'

// 第 6 章里程碑：mat4 的两台投影机器——perspective(fovYRad, aspect, near,
// far) 与 ortho(l, r, b, t, n, f)。约定与真实 OpenGL 家族一致：右手系眼空间
// （相机在原点朝 -Z 看），near/far 是正值距离，NDC 的 z 在 [-1,1]。
// 数值全部手算可得：fov 取 90°（tan45°=1，比例全变整数）、near=1、far=3。
// 只断言行为（眼空间点 → NDC 落点）；透视除法的来源由「w = -z」一节锁住。

/** 透视样机：fov 90°、aspect 1、near 1、far 3——f = 1/tan45° = 1。 */
const P90 = (): ReturnType<typeof perspective> => perspective(Math.PI / 2, 1, 1, 3)
/** 正交样机：盒 [-2,2]×[-1.5,1.5]×[-3,-1]（near=1、far=3）。 */
const O = (): ReturnType<typeof ortho> => ortho(-2, 2, -1.5, 1.5, 1, 3)

/** 矩阵第 4 行算出的 w（transformPoint 出口除的就是它）。 */
function wOf(m: Float32Array, p: readonly [number, number, number]): number {
  return m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15]
}

describe('perspective：视锥体到标准操场', () => {
  it('16 个数的手算对账：fov90°/aspect1/near1/far3 的数组逐位锁定', () => {
    // 手算：f = 1/tan(45°) = 1
    //   m[0]=f/aspect=1、m[5]=f=1
    //   m[10]=(far+near)/(near-far)=(3+1)/(1-3)=-2、m[11]=-1
    //   m[14]=2·far·near/(near-far)=6/(-2)=-3、m[15]=0
    // 列主序排队：第 3 列的 -1 在下标 11（第 4 行）、第 4 列的 -3 在下标 14。
    const want = new Float32Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, -2, -1,
      0, 0, -3, 0,
    ])
    const m = P90()
    for (let i = 0; i < 16; i++) expect(m[i]).toBeCloseTo(want[i], 4)
  })

  it('视锥中心点 (0,0,-2) 落 NDC (0,0,0.5)：手算 z_clip = -2×(-2)-3 = 1、w = 2', () => {
    // 手算：z_clip = m[10]·z + m[14] = (-2)×(-2) + (-3) = 4 - 3 = 1
    //       w = -z = 2 → z_ndc = 1/2 = 0.5
    // 注意 0.5 ≠ 0：深度中点不落在 NDC 中点（z 的映射不是线性的）。
    const p = transformPoint(P90(), [0, 0, -2])
    expect(p[0]).toBeCloseTo(0, 4)
    expect(p[1]).toBeCloseTo(0, 4)
    expect(p[2]).toBeCloseTo(0.5, 4)
  })

  it('near 平面的点 z 映射到 -1：轴上点与边缘点各一笔', () => {
    // 手算：z=-1 → w=1，z_clip = (-2)×(-1) + (-3) = -1 → z_ndc = -1
    // fov90°、near=1 处半高 = tan45°×1 = 1：边缘点 (0,1,-1) 恰落 NDC 边缘。
    const axis = transformPoint(P90(), [0, 0, -1])
    expect(axis[2]).toBeCloseTo(-1, 4)
    const edge = transformPoint(P90(), [0, 1, -1])
    expect(edge[1]).toBeCloseTo(1, 4)
    expect(edge[2]).toBeCloseTo(-1, 4)
  })

  it('far 平面的点 z 映射到 +1：远处边缘同样恰落 NDC 边缘', () => {
    // 手算：z=-3 → w=3，z_clip = (-2)×(-3) + (-3) = 3 → z_ndc = 3/3 = 1
    // far=3 处半高 = tan45°×3 = 3：边缘点 (0,3,-3) 落 NDC (0,1,1)。
    const axis = transformPoint(P90(), [0, 0, -3])
    expect(axis[2]).toBeCloseTo(1, 4)
    const edge = transformPoint(P90(), [0, 3, -3])
    expect(edge[1]).toBeCloseTo(1, 4)
    expect(edge[2]).toBeCloseTo(1, 4)
  })

  it('透视矩阵产出的 w = -z：透视除法除的正是深度（来源一节）', () => {
    // 第 4 行住在下标 3、7、11、15（每列的第 4 个）：perspective 里是
    // (0, 0, -1, 0)——于是 w = -z_eye，跟 x、y 的值无关。
    const m = P90()
    for (const e of [
      [0.3, -0.7, -2.5],
      [0, 0, -1],
      [0, 0, -3],
    ] as const) {
      expect(wOf(m, e)).toBeCloseTo(-e[2], 4)
    }
    // 对账：transformPoint 的输出 = 手工「行值 / w」——出口真的除了这个 w。
    const e = [0.3, -0.7, -2.5] as const
    const w = wOf(m, e)
    const xClip = m[0] * e[0] + m[4] * e[1] + m[8] * e[2] + m[12]
    const yClip = m[1] * e[0] + m[5] * e[1] + m[9] * e[2] + m[13]
    const p = transformPoint(m, e)
    expect(p[0]).toBeCloseTo(xClip / w, 4)
    expect(p[1]).toBeCloseTo(yClip / w, 4)
  })

  it('fov 增大 → 同一眼空间点 NDC 偏向中心：广角把落点往里收', () => {
    // 同一点 (0, 0.5, -2)：
    //   fov 90°  → y_ndc = 1×0.5/2 = 0.25
    //   fov 120° → f = 1/tan60° = 1/√3 ≈ 0.5774 → y_ndc ≈ 0.1443（更靠中心）
    //   fov 减到 f = 2（fov = 2·atan0.5 ≈ 53.13°）→ y_ndc = 2×0.5/2 = 0.5
    const e = [0, 0.5, -2] as const
    expect(transformPoint(P90(), e)[1]).toBeCloseTo(0.25, 4)
    const wide = transformPoint(perspective((2 * Math.PI) / 3, 1, 1, 3), e)
    expect(wide[1]).toBeCloseTo((1 / Math.sqrt(3)) * 0.5 * 0.5, 4)
    const narrow = transformPoint(
      perspective(2 * Math.atan(0.5), 1, 1, 3),
      e,
    )
    expect(narrow[1]).toBeCloseTo(0.5, 4)
  })

  it('近大远小：同高 2 的竖线段，z=-2 落 NDC 高 1、z=-3 落 NDC 高 2/3', () => {
    // 手算：段端点 (0,±1,-2) → y_ndc = ±1/2，高 1；(0,±1,-3) → ±1/3，高 2/3。
    const h = (z: number): number =>
      Math.abs(
        transformPoint(P90(), [0, 1, z])[1] -
          transformPoint(P90(), [0, -1, z])[1],
      )
    expect(h(-2)).toBeCloseTo(1, 4)
    expect(h(-3)).toBeCloseTo(2 / 3, 4)
  })

  it('aspect 分量：m[0] = f/aspect，near 横向边缘恰落 NDC 边缘', () => {
    // aspect=2、fov90°：m[0] = 1/2 = 0.5。near=1 处半宽 = aspect×tan45° = 2。
    // 边缘点 (2,0,-1)：x_ndc = 0.5×2/1 = 1（边缘对边缘）。
    // 同一个点忘带 aspect（aspect=1）：x_ndc = 2——被推出操场，圆就是这么
    // 被拉成椭圆的。
    const wide = perspective(Math.PI / 2, 2, 1, 3)
    expect(wide[0]).toBeCloseTo(wide[5] / 2, 4)
    expect(transformPoint(wide, [2, 0, -1])[0]).toBeCloseTo(1, 4)
    expect(transformPoint(P90(), [2, 0, -1])[0]).toBeCloseTo(2, 4)
  })

  it('完整链路：模型矩阵串投影一次过，模型点 (0,0,0) 落 NDC (0,0,0.8)', () => {
    // 手算：M = translate(0,0,-2.5) 把模型原点摆到眼空间 z=-2.5；
    // z_clip = (-2)×(-2.5) + (-3) = 2、w = 2.5 → z_ndc = 0.8。
    // 模型点 (0.5,0,0) → 眼 (0.5,0,-2.5) → x_ndc = 0.5/2.5 = 0.2。
    const mvp = multiply(P90(), translate(0, 0, -2.5))
    const c = transformPoint(mvp, [0, 0, 0])
    expect(c[0]).toBeCloseTo(0, 4)
    expect(c[2]).toBeCloseTo(0.8, 4)
    expect(transformPoint(mvp, [0.5, 0, 0])[0]).toBeCloseTo(0.2, 4)
  })
})

describe('ortho：平行投影仪', () => {
  it('盒中心回原点、near 面 z=-1、far 面 z=+1', () => {
    // 手算：m[0]=2/(2-(-2))=0.5、m[5]=2/(1.5-(-1.5))=2/3、
    //       m[10]=-2/(3-1)=-1、m[14]=-(3+1)/(3-1)=-2。
    // 中心 (0,0,-2)：z' = -1×(-2) + (-2) = 0；z=-1 → 1-2 = -1；z=-3 → 3-2 = 1。
    const center = transformPoint(O(), [0, 0, -2])
    expect(center[0]).toBeCloseTo(0, 4)
    expect(center[1]).toBeCloseTo(0, 4)
    expect(center[2]).toBeCloseTo(0, 4)
    expect(transformPoint(O(), [0, 0, -1])[2]).toBeCloseTo(-1, 4)
    expect(transformPoint(O(), [0, 0, -3])[2]).toBeCloseTo(1, 4)
  })

  it('平行线保持平行：两个眼空间平行方向变换后叉积为零（透视侧不为零）', () => {
    // 两条平行线：A=(0,0,-2) 与 B=(0.6,-0.8,-1.6)，方向同为 d=(1,0.5,-0.5)。
    // 正交是纯「乘系数+加常数」，方向只吃线性部分：两个 v' 都是
    // (0.5×1, (2/3)×0.5, (-1)×(-0.5))——完全相同，叉积为零。
    const d = [1, 0.5, -0.5] as const
    const A = [0, 0, -2] as const
    const B = [0.6, -0.8, -1.6] as const
    const dir = (
      m: Float32Array,
      base: readonly [number, number, number],
    ): [number, number, number] => {
      const p1 = transformPoint(m, base)
      const p2 = transformPoint(m, [
        base[0] + d[0],
        base[1] + d[1],
        base[2] + d[2],
      ])
      return [p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]]
    }
    const v1 = dir(O(), A)
    const v2 = dir(O(), B)
    const cOrtho = cross(v1, v2)
    expect(cOrtho[0]).toBeCloseTo(0, 4)
    expect(cOrtho[1]).toBeCloseTo(0, 4)
    expect(cOrtho[2]).toBeCloseTo(0, 4)
    // 对照：同样的两条线过透视机器，方向落点随深度各缩各的——不再平行。
    const cPersp = cross(dir(P90(), A), dir(P90(), B))
    expect(length(cPersp)).toBeGreaterThan(0.01)
  })

  it('远处不缩：同高 2 的竖线段在 z=-1 与 z=-3 的 NDC 高度相同', () => {
    // 手算：m[5]=2/3 对两个深度一视同仁——高度都是 2×2/3 = 4/3。
    // 透视侧同款线段：z=-1 高 2、z=-3 高 2/3（近大远小）。
    const h = (m: Float32Array, z: number): number =>
      Math.abs(
        transformPoint(m, [0, 1, z])[1] - transformPoint(m, [0, -1, z])[1],
      )
    expect(h(O(), -1)).toBeCloseTo(h(O(), -3), 4)
    expect(h(O(), -1)).toBeCloseTo(4 / 3, 4)
    expect(h(P90(), -1)).toBeCloseTo(2, 4)
    expect(h(P90(), -3)).toBeCloseTo(2 / 3, 4)
  })

  it('ortho 的 w 恒 1：透视除法照走，但除 1 原样', () => {
    // 第 4 行是 (0,0,0,1)——第 5 章所有矩阵的老世界，正交机器仍住在里面。
    for (const e of [
      [1.9, -1.4, -1.1],
      [0, 0, -2],
      [-0.5, 0.7, -2.9],
    ] as const) {
      expect(wOf(O(), e)).toBeCloseTo(1, 4)
    }
  })
})
