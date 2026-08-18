import { describe, expect, it } from 'vitest'
import {
  add,
  cross,
  distance,
  dot,
  length,
  normalize,
  scale,
  sub,
} from '../src/math/vec3'

// 第 4 章里程碑：math/vec3——add / sub / scale / dot / cross / length /
// normalize / distance。3-4-5 三角形是本章的主教材：length、点积投影、
// 叉积面积全部用它，纸笔可复算。
// 坐标习惯（教材全书的右手坐标系）：x 朝右、y 朝上、z 朝屏幕外。
// 叉积方向按右手定则——四指从 a 弯向 b，大拇指的指向，于是 x×y=z。
// 只断言行为（输入→输出），数值全部手算可得。
describe('add / sub / scale（加减与数乘：分量各自干活）', () => {
  it('add 分量相加：[1,2,3] + [4,5,6] = [5,7,9]', () => {
    const v = add([1, 2, 3], [4, 5, 6])
    expect(v[0]).toBeCloseTo(5, 4)
    expect(v[1]).toBeCloseTo(7, 4)
    expect(v[2]).toBeCloseTo(9, 4)
  })

  it('sub 算方向：目标 [4,5,0] − 飞船 [1,1,0] = 指向目标的 [3,4,0]', () => {
    // 痛点写法的第一步没有错：target − pos 正是「从我指向目标」的向量，
    // 错的是把它未经归一化直接当速度用（见 normalize 一节）。
    const v = sub([4, 5, 0], [1, 1, 0])
    expect(v[0]).toBeCloseTo(3, 4)
    expect(v[1]).toBeCloseTo(4, 4)
    expect(v[2]).toBeCloseTo(0, 4)
  })

  it('scale 数乘拉长：[3,4,0] × 2 = [6,8,0]，负数掉头', () => {
    const v = scale([3, 4, 0], 2)
    expect(v[0]).toBeCloseTo(6, 4)
    expect(v[1]).toBeCloseTo(8, 4)
    expect(v[2]).toBeCloseTo(0, 4)
    const w = scale([3, 4, 0], -1)
    expect(w[0]).toBeCloseTo(-3, 4)
    expect(w[1]).toBeCloseTo(-4, 4)
  })
})

describe('length（长度：勾股定理）', () => {
  it('3-4-5 手算对账：length([3,4,0]) = √(9+16) = 5', () => {
    expect(length([3, 4, 0])).toBeCloseTo(5, 4)
  })

  it('轴上的单位长度：length([0,0,2]) = 2，length([0,0,0]) = 0', () => {
    expect(length([0, 0, 2])).toBeCloseTo(2, 4)
    expect(length([0, 0, 0])).toBeCloseTo(0, 4)
  })
})

describe('dot（点积：方向一致度打分机）', () => {
  it('投影具体值：dot([3,4,0], [1,0,0]) = 3——[3,4,0] 在 x 轴上的影子长 3', () => {
    // 单位向量当「尺子」时，点积直接读出影子长度（向量投影）。
    expect(dot([3, 4, 0], [1, 0, 0])).toBeCloseTo(3, 4)
    expect(dot([3, 4, 0], [0, 1, 0])).toBeCloseTo(4, 4)
  })

  it('交换律：dot(a, b) = dot(b, a)', () => {
    expect(dot([3, 4, 0], [1, 2, 0])).toBeCloseTo(dot([1, 2, 0], [3, 4, 0]), 4)
    // 手算：3×1 + 4×2 + 0×0 = 11，两边都该是这个数
    expect(dot([3, 4, 0], [1, 2, 0])).toBeCloseTo(11, 4)
  })

  it('垂直得 0、反向得负：dot([1,0,0],[0,1,0]) = 0，dot([1,0,0],[-1,0,0]) = -1', () => {
    expect(dot([1, 0, 0], [0, 1, 0])).toBeCloseTo(0, 4)
    expect(dot([1, 0, 0], [-1, 0, 0])).toBeCloseTo(-1, 4)
  })

  it('点自己 = 长度平方：dot([3,4,0], [3,4,0]) = 25', () => {
    expect(dot([3, 4, 0], [3, 4, 0])).toBeCloseTo(25, 4)
  })

  it('夹角读数：cos θ = 3/5 = 0.6（3-4-5 三角形那个角，θ ≈ 53.13°）', () => {
    const cos = dot([3, 4, 0], [1, 0, 0]) / (length([3, 4, 0]) * length([1, 0, 0]))
    expect(cos).toBeCloseTo(0.6, 4)
  })
})

describe('cross（叉积：右手定则的垂直方向）', () => {
  it('x × y = z：[1,0,0] × [0,1,0] = [0,0,1]（右手系的家规）', () => {
    const v = cross([1, 0, 0], [0, 1, 0])
    expect(v[0]).toBeCloseTo(0, 4)
    expect(v[1]).toBeCloseTo(0, 4)
    expect(v[2]).toBeCloseTo(1, 4)
  })

  it('z × x = y：[0,0,1] × [1,0,0] = [0,1,0]（轮换位置，大拇指仍朝外）', () => {
    const v = cross([0, 0, 1], [1, 0, 0])
    expect(v[0]).toBeCloseTo(0, 4)
    expect(v[1]).toBeCloseTo(1, 4)
    expect(v[2]).toBeCloseTo(0, 4)
  })

  it('反交换：a × b = −(b × a)——交换顺序，结果掉头', () => {
    const ab = cross([1, 0, 0], [0, 1, 0])
    const ba = cross([0, 1, 0], [1, 0, 0])
    expect(ab[2]).toBeCloseTo(1, 4)
    expect(ba[2]).toBeCloseTo(-1, 4)
  })

  it('3-4-5 面积对账：[3,4,0] × [0,0,1] = [4,−3,0]，长度 5 = 撑出平行四边形的面积', () => {
    const v = cross([3, 4, 0], [0, 0, 1])
    expect(v[0]).toBeCloseTo(4, 4)
    expect(v[1]).toBeCloseTo(-3, 4)
    expect(v[2]).toBeCloseTo(0, 4)
    expect(length(v)).toBeCloseTo(5, 4)
  })
})

describe('normalize（归一化：只留方向，扔掉长度）', () => {
  it('normalize([3,4,0]) = [0.6, 0.8, 0]，结果长度恰为 1', () => {
    const v = normalize([3, 4, 0])
    expect(v[0]).toBeCloseTo(0.6, 4)
    expect(v[1]).toBeCloseTo(0.8, 4)
    expect(v[2]).toBeCloseTo(0, 4)
    expect(length(v)).toBeCloseTo(1, 4)
  })

  it('零向量约定：normalize([0,0,0]) 返回 [0,0,0]，不抛异常', () => {
    // 实验场约定（JSDoc 已声明）：数学函数不抛异常，零向量没有方向可留，
    // 返回零向量交由调用方处理。
    const v = normalize([0, 0, 0])
    expect(v[0]).toBeCloseTo(0, 4)
    expect(v[1]).toBeCloseTo(0, 4)
    expect(v[2]).toBeCloseTo(0, 4)
  })

  it('方向相同、长度不同 → 归一化后相同：[30,40,0] 与 [3,4,0] 都归到 [0.6,0.8,0]', () => {
    // 痛点的修复：远近两个飞船各自算方向，归一化后每帧都走同样一步——
    // 速度里不再混着距离。
    const a = normalize([30, 40, 0])
    const b = normalize([3, 4, 0])
    expect(a[0]).toBeCloseTo(b[0], 4)
    expect(a[1]).toBeCloseTo(b[1], 4)
    expect(a[2]).toBeCloseTo(b[2], 4)
  })
})

describe('distance（两点距离：先减后量）', () => {
  it('3-4-5 对账：distance([0,0,0], [3,4,0]) = 5', () => {
    expect(distance([0, 0, 0], [3, 4, 0])).toBeCloseTo(5, 4)
  })

  it('等于方向向量的长度：飞船 [1,1,0] 到目标 [4,5,0] 距离 5', () => {
    expect(distance([1, 1, 0], [4, 5, 0])).toBeCloseTo(5, 4)
    expect(distance([1, 1, 0], [4, 5, 0])).toBeCloseTo(length(sub([4, 5, 0], [1, 1, 0])), 4)
  })
})
