import { describe, expect, it } from 'vitest'
import { add } from '../src/math/vec3'
import {
  identity,
  multiply,
  rotX,
  rotY,
  rotZ,
  scale,
  transformPoint,
  translate,
} from '../src/math/mat4'

// 第 5 章里程碑：math/mat4——identity / multiply / translate / rotX / rotY /
// rotZ / scale / transformPoint。Mat4 = Float32Array(16)，列主序：数组第
// 0-3 个数是数学矩阵的第 1 列（与 uniformMatrix4fv 的口味一致）。
// 乘法约定：multiply(A, B) = A·B——坐标先过 B、再过 A。
// 数值全部手算可得：90° 旋转恰好落轴，平移走整数对账。
// 只断言行为（输入→输出）；「先过 B 再过 A」的约定由 T·R ≠ R·T 一节锁住。

/** 逐位对账两个矩阵的 16 个数（浮点断言，精度 4 位小数）。 */
function expectSameMat(a: Float32Array, b: Float32Array): void {
  for (let i = 0; i < 16; i++) expect(a[i]).toBeCloseTo(b[i], 4)
}

describe('identity（单位阵：什么都不做的机器）', () => {
  it('乘法单位元：I·M = M 且 M·I = M，16 个数原样', () => {
    const M = multiply(translate(1, 2, 3), rotY(Math.PI / 2))
    expectSameMat(multiply(identity(), M), M)
    expectSameMat(multiply(M, identity()), M)
  })

  it('transformPoint 过单位阵：点原样不动', () => {
    const p = transformPoint(identity(), [1.5, -2, 3])
    expect(p[0]).toBeCloseTo(1.5, 4)
    expect(p[1]).toBeCloseTo(-2, 4)
    expect(p[2]).toBeCloseTo(3, 4)
  })
})

describe('rotY（绕 Y 轴旋转：+X 转到 -Z 的手算对账）', () => {
  it('rotY(90°) 把 (1,0,0) 转到 (0,0,-1)', () => {
    // 手算：cos90°=0、sin90°=1
    // x' = cos·x + sin·z = 0×1 + 1×0 = 0
    // z' = -sin·x + cos·z = -1×1 + 0×0 = -1
    const p = transformPoint(rotY(Math.PI / 2), [1, 0, 0])
    expect(p[0]).toBeCloseTo(0, 4)
    expect(p[1]).toBeCloseTo(0, 4)
    expect(p[2]).toBeCloseTo(-1, 4)
  })

  it('rotY(90°) 把 (0,0,1) 转到 (1,0,0)：绕一圈各就各位', () => {
    // 手算：x' = 0×0 + 1×1 = 1，z' = -1×0 + 0×1 = 0
    const p = transformPoint(rotY(Math.PI / 2), [0, 0, 1])
    expect(p[0]).toBeCloseTo(1, 4)
    expect(p[2]).toBeCloseTo(0, 4)
  })

  it('rotY(-90°) 把 +X 转到 +Z：反着转回去', () => {
    // 手算：cos(-90°)=0、sin(-90°)=-1 → z' = -(-1)×1 + 0×0 = 1
    const p = transformPoint(rotY(-Math.PI / 2), [1, 0, 0])
    expect(p[0]).toBeCloseTo(0, 4)
    expect(p[2]).toBeCloseTo(1, 4)
  })
})

describe('rotX / rotZ（另两根轴）', () => {
  it('rotX(90°) 把 (0,1,0) 转到 (0,0,1)：+Y 落 +Z，右手定则', () => {
    // 手算：y' = cos·y - sin·z = 0×1 - 1×0 = 0
    //       z' = sin·y + cos·z = 1×1 + 0×0 = 1
    const p = transformPoint(rotX(Math.PI / 2), [0, 1, 0])
    expect(p[0]).toBeCloseTo(0, 4)
    expect(p[1]).toBeCloseTo(0, 4)
    expect(p[2]).toBeCloseTo(1, 4)
  })

  it('rotZ(90°) 把 (1,0,0) 转到 (0,1,0)：第 3 章 JS 旋转同款公式装进矩阵', () => {
    // 手算（与第 3 章 x' = x·cos − y·sin、y' = x·sin + y·cos 逐字相同）：
    // x' = 1×0 − 0×1 = 0，y' = 1×1 + 0×0 = 1
    const p = transformPoint(rotZ(Math.PI / 2), [1, 0, 0])
    expect(p[0]).toBeCloseTo(0, 4)
    expect(p[1]).toBeCloseTo(1, 4)
    expect(p[2]).toBeCloseTo(0, 4)
  })
})

describe('translate / scale（平移与缩放：齐次坐标的收入）', () => {
  it('translate(3,4,5) 作用在 (1,1,1)：加法搬进乘法，得 (4,5,6)', () => {
    const p = transformPoint(translate(3, 4, 5), [1, 1, 1])
    expect(p[0]).toBeCloseTo(4, 4)
    expect(p[1]).toBeCloseTo(5, 4)
    expect(p[2]).toBeCloseTo(6, 4)
  })

  it('齐次坐标平移等价：T·R 一次算 = 先 R 转、再用向量加法补平移', () => {
    // 手算：R = rotZ(90°) 把 [2,0,0] 转到 [0,2,0]；T 再加 (1,2,0) → [1,4,0]。
    // 一台机器一口气算出的，与「旋转机器 + 第 4 章向量加法」分步算的账相同。
    const viaMatrix = transformPoint(
      multiply(translate(1, 2, 0), rotZ(Math.PI / 2)),
      [2, 0, 0],
    )
    const stepwise = add(transformPoint(rotZ(Math.PI / 2), [2, 0, 0]), [1, 2, 0])
    expect(viaMatrix[0]).toBeCloseTo(1, 4)
    expect(viaMatrix[1]).toBeCloseTo(4, 4)
    expect(viaMatrix[0]).toBeCloseTo(stepwise[0], 4)
    expect(viaMatrix[1]).toBeCloseTo(stepwise[1], 4)
  })

  it('scale(2,3,4) 作用在 (1,1,1)：各轴各自拉，得 (2,3,4)', () => {
    const p = transformPoint(scale(2, 3, 4), [1, 1, 1])
    expect(p[0]).toBeCloseTo(2, 4)
    expect(p[1]).toBeCloseTo(3, 4)
    expect(p[2]).toBeCloseTo(4, 4)
  })

  it('scale(-1,1,1) 把 (2,0,0) 翻到 (-2,0,0)：负比例 = 镜像', () => {
    const p = transformPoint(scale(-1, 1, 1), [2, 0, 0])
    expect(p[0]).toBeCloseTo(-2, 4)
    expect(p[1]).toBeCloseTo(0, 4)
  })
})

describe('multiply 顺序不可交换：T·R ≠ R·T', () => {
  it('同一台 T、同一台 R，先过谁结果就不同：原点分别落到 (1,0,0) 与 (0,1,0)', () => {
    const T = translate(1, 0, 0)
    const R = rotZ(Math.PI / 2)
    // 手算（乘积从右往左作用，坐标先过右边的机器）：
    // (T·R)·原点：原点过 R 还是原点，再过 T 右移 1 → (1,0,0)
    // (R·T)·原点：原点先过 T 右移 1 到 (1,0,0)，再过 R 转 90° 落 (0,1,0)
    const tr = transformPoint(multiply(T, R), [0, 0, 0])
    const rt = transformPoint(multiply(R, T), [0, 0, 0])
    expect(tr[0]).toBeCloseTo(1, 4)
    expect(tr[1]).toBeCloseTo(0, 4)
    expect(rt[0]).toBeCloseTo(0, 4)
    expect(rt[1]).toBeCloseTo(1, 4)
  })

  it('差异写在矩阵里：两个乘积的平移列一个是 (1,0,0)、一个是 (0,1,0)', () => {
    const T = translate(1, 0, 0)
    const R = rotZ(Math.PI / 2)
    // 列主序：m[12]、m[13]、m[14] 是数学矩阵第 4 列（平移列）
    const tr = multiply(T, R)
    const rt = multiply(R, T)
    expect(tr[12]).toBeCloseTo(1, 4)
    expect(tr[13]).toBeCloseTo(0, 4)
    expect(rt[12]).toBeCloseTo(0, 4)
    expect(rt[13]).toBeCloseTo(1, 4)
  })
})

describe('multiply 结合律：先串哪两台，结果不变', () => {
  it('(A·B)·C = A·(B·C)：三台机器怎么分组都行', () => {
    const A = translate(1, 2, 3)
    const B = rotY(Math.PI / 2)
    const C = scale(2, 1, 1)
    expectSameMat(multiply(multiply(A, B), C), multiply(A, multiply(B, C)))
  })
})

describe('transformPoint 除以 w：透视除法的钩子', () => {
  it('手造 w=2 的机器：(1,0,0) 出来是 (0.5,0,0)——出口统一除以 w', () => {
    // 单位阵里 m[3]（第 1 列第 4 行）从 0 改成 1：
    // 出口四元组的 w = 1×1（m[3] 那份）+ 1×1（m[15] 那份）= 2，x 仍是 1，
    // 前三项除以 w=2 → (0.5, 0, 0)。
    // 本章的平移/旋转/缩放矩阵 w 恒为 1（除 1 原样）；投影矩阵登场后
    // 这里就是「近大远小」的落点。
    const m = identity()
    m[3] = 1
    const p = transformPoint(m, [1, 0, 0])
    expect(p[0]).toBeCloseTo(0.5, 4)
    expect(p[1]).toBeCloseTo(0, 4)
    expect(p[2]).toBeCloseTo(0, 4)
  })
})
