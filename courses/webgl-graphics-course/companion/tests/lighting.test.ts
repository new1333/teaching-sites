import { describe, expect, it } from 'vitest'
import { dot, length, normalize } from '../src/math/vec3'
import {
  multiply,
  normalFromMat4,
  rotX,
  rotY,
  scale,
  transformPoint,
  translate,
} from '../src/math/mat4'
import { computePhong, diffuse, reflect, specular } from '../src/light/phong'

// 第 10 章里程碑：光照——法线矩阵（逆转置）与 Phong 三件套的 CPU 参考。
// 全部数值手算可得：45° 的 cos = √2/2 ≈ 0.7071、0.7071² = 0.5（幂次全是
// 2 的整数次幂）、X 拉伸 2 倍下 45° 斜面法线的两个候选 (2,1)/√5 与
// (1,2)/√5——夹角余弦恰是 4/5（3-4-5 三角形的那个角）。

/** 45° 斜入射的光方向：从表面指向光源，与 +Z 法线夹角 45°。 */
const L45: readonly [number, number, number] = normalize([1, 0, 1])
const N_Z: readonly [number, number, number] = [0, 0, 1]

describe('diffuse / specular / reflect（Phong 三件套的零件）', () => {
  it('漫反射 = max(N·L, 0)：正对光 1、45° 入射 ≈ 0.707（cos45° 手算）、背面 0', () => {
    // 正对光：N 与 L 同向，N·L = 1
    expect(diffuse(N_Z, [0, 0, 1])).toBeCloseTo(1, 4)
    // 45° 入射：dot((0,0,1), (√½,0,√½)) = √½ ≈ 0.7071
    expect(dot(N_Z, L45)).toBeCloseTo(Math.SQRT1_2, 4)
    expect(diffuse(N_Z, L45)).toBeCloseTo(Math.SQRT1_2, 4)
    // 光在背面：N·L = −1，负值全部钳成 0——背面不发光
    expect(diffuse(N_Z, [0, 0, -1])).toBe(0)
    // 斜背面同理：L 沿 −45° 打来，N·L = −0.707 → 0
    expect(diffuse(N_Z, [-Math.SQRT1_2, 0, -Math.SQRT1_2])).toBe(0)
  })

  it('reflect 与 GLSL 同公式：reflect(−L, N) = 2(N·L)N − L，45° 入射反射方向手算对账', () => {
    // N=(0,0,1)、L45=(√½,0,√½)：R = 2·√½·N − L = (−√½, 0, √½)
    const r = reflect([-L45[0], -L45[1], -L45[2]], N_Z)
    expect(r[0]).toBeCloseTo(-Math.SQRT1_2, 4)
    expect(r[1]).toBeCloseTo(0, 4)
    expect(r[2]).toBeCloseTo(Math.SQRT1_2, 4)
  })

  it('高光：视线与反射方向对齐时峰值 1；偏离后 shininess 越大衰减越狠（更尖）', () => {
    const r = reflect([-L45[0], -L45[1], -L45[2]], N_Z)
    // 对齐：dot(R, V) = 1，任何幂次都还是 1——反光斑的中心
    expect(specular(N_Z, L45, r, 8)).toBeCloseTo(1, 4)
    expect(specular(N_Z, L45, r, 128)).toBeCloseTo(1, 4)
    // 偏到正对视线 V=(0,0,1)：dot(R, V) = √½。幂次全是 2 的整次幂，可手算：
    // shininess=8 → (√½)^8 = 1/16；shininess=64 → (√½)^64 = 2^-32 ≈ 0
    expect(specular(N_Z, L45, N_Z, 8)).toBeCloseTo(1 / 16, 4)
    expect(specular(N_Z, L45, N_Z, 64)).toBeCloseTo(Math.pow(2, -32), 12)
    // 同样的偏离角，大 shininess 的值更小——高光从巴掌大到针尖
    expect(specular(N_Z, L45, N_Z, 64)).toBeLessThan(specular(N_Z, L45, N_Z, 8))
  })
})

describe('computePhong（CPU 参考：环境光 + 漫反射 + 高光，与 GLSL 着色器同形）', () => {
  it('45° 全链路手算对账：0.1 + 0.7071 + 2^-16 一项项核得上', () => {
    // N=(0,0,1)、L45 打来、视线正对 V=(0,0,1)、shininess=32、环境光 0.1
    // 漫反射 √½；高光 (√½)^32 = 2^-16 ≈ 0.0000153；总和收拢前 0.8071…
    const p = computePhong(N_Z, L45, N_Z, 32, 0.1)
    expect(p.ambient).toBeCloseTo(0.1, 4)
    expect(p.diffuse).toBeCloseTo(Math.SQRT1_2, 4)
    expect(p.specular).toBeCloseTo(Math.pow(2, -16), 8)
    expect(p.intensity).toBeCloseTo(0.1 + Math.SQRT1_2 + Math.pow(2, -16), 5)
  })

  it('三件套叠加的量程收拢 [0,1]：正对光 0.2+1+1=2.2 收到 1；全背光只剩环境光', () => {
    // 正对光 + 视线对准反射方向：0.2 + 1 + 1 = 2.2，收拢到 1
    const hot = computePhong(N_Z, [0, 0, 1], [0, 0, 1], 32, 0.2)
    expect(hot.intensity).toBeCloseTo(1, 4)
    // 光在背面：漫反射与高光都吃 0，只剩环境光兜底
    const back = computePhong(N_Z, [0, 0, -1], [0, 0, 1], 32, 0.2)
    expect(back.diffuse).toBe(0)
    expect(back.specular).toBe(0)
    expect(back.intensity).toBeCloseTo(0.2, 4)
    // 扫一圈入射角，intensity 永远不出 [0,1]
    for (let a = 0; a < 360; a += 15) {
      const rad = (a * Math.PI) / 180
      const p = computePhong(
        N_Z,
        [Math.sin(rad), 0, Math.cos(rad)],
        N_Z,
        16,
        0.15,
      )
      expect(p.intensity).toBeGreaterThanOrEqual(0)
      expect(p.intensity).toBeLessThanOrEqual(1)
    }
  })
})

describe('normalFromMat4（法线矩阵 = 模型矩阵左上 3×3 的逆转置）', () => {
  it('纯旋转下法线矩阵就是旋转本身：rotY(90°) 把 +X 法线转到 −Z', () => {
    const n = normalFromMat4(rotY(Math.PI / 2))
    const out = transformPoint(n, [1, 0, 0])
    expect(out[0]).toBeCloseTo(0, 4)
    expect(out[1]).toBeCloseTo(0, 4)
    expect(out[2]).toBeCloseTo(-1, 4)
  })

  it('平移不吃进法线矩阵：法线是方向，搬桌子不转姿势', () => {
    const m = multiply(translate(3, -2, 5), multiply(rotX(0.7), scale(2, 2, 2)))
    const noT = multiply(rotX(0.7), scale(2, 2, 2))
    const a = normalFromMat4(m)
    const b = normalFromMat4(noT)
    for (let i = 0; i < 16; i++) expect(a[i]).toBeCloseTo(b[i], 4)
  })

  it('均匀缩放：法线矩阵各列归一化后 = 模型矩阵旋转部分归一化后（方向没变）', () => {
    const R = rotY(0.6)
    const m = multiply(scale(2.5, 2.5, 2.5), R)
    const n = normalFromMat4(m)
    // 逐列比方向：均匀缩放不改变方向，逆转置后归一化应与模型矩阵殊途同归
    for (let c = 0; c < 3; c++) {
      const mcol = normalize([m[c * 4], m[c * 4 + 1], m[c * 4 + 2]])
      const ncol = normalize([n[c * 4], n[c * 4 + 1], n[c * 4 + 2]])
      for (let a = 0; a < 3; a++) expect(ncol[a]).toBeCloseTo(mcol[a], 4)
    }
  })

  it('非均匀缩放的必要性：X 拉伸 2 倍，45° 斜面法线手算对账', () => {
    // 原平面 x + y = 1 的法线 n = (1,1,0)/√2；模型矩阵 X 拉伸 2 倍后
    // 平面变成 x/2 + y = 1，几何真值法线 = normalize(0.5, 1, 0) = (1,2,0)/√5
    const M = scale(2, 1, 1)
    const n: readonly [number, number, number] = normalize([1, 1, 0])
    // 错路：直接拿模型矩阵变换法线再归一化 → (2,1,0)/√5——偏了
    const wrong = normalize(transformPoint(M, n))
    expect(wrong[0]).toBeCloseTo(2 / Math.sqrt(5), 4)
    expect(wrong[1]).toBeCloseTo(1 / Math.sqrt(5), 4)
    // 对路：逆转置 = diag(0.5, 1, 1) 变换再归一化 → (1,2,0)/√5——与真值一致
    const right = normalize(transformPoint(normalFromMat4(M), n))
    expect(right[0]).toBeCloseTo(1 / Math.sqrt(5), 4)
    expect(right[1]).toBeCloseTo(2 / Math.sqrt(5), 4)
    const truth = normalize([0.5, 1, 0])
    expect(dot(right, truth)).toBeCloseTo(1, 4) // 逆转置与几何真值重合
    expect(dot(wrong, truth)).toBeCloseTo(0.8, 4) // 错路与真值夹角 cos=4/5（≈36.87°，3-4-5 的角）
    expect(length(transformPoint(normalFromMat4(M), n))).toBeCloseTo(
      Math.sqrt(0.625),
      4,
    ) // 逆转置出口长度 √(1/8+1/2)——没归一化，着色器里还要 normalize
  })
})
