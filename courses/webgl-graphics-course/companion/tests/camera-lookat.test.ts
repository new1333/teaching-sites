import { describe, expect, it } from 'vitest'
import { dot, length } from '../src/math/vec3'
import {
  lookAt,
  multiply,
  perspective,
  rotY,
  transformPoint,
  translate,
} from '../src/math/mat4'

// 第 7 章里程碑：mat4.lookAt(eye, center, up)——视图矩阵：把整个世界平移
// 旋转到「相机站在原点、朝 -Z 看」的标准姿势跟前。约定与真实 OpenGL
// 家族一致：右手系、视线朝 -Z（第 6 章的投影机器吃的就是这套坐标）。
// 数值全部手算可得：eye 取轴上整点、绕 Y 转 90° 恰好落轴。
// 只断言行为（世界点 → 视图空间落位）；旋转部分的正交性用「基向量过机器
// 后点积与长度不变」验证，不引入逆矩阵、行列式这类本章还不认识的概念。

/** 逐位对账两个矩阵的 16 个数（浮点断言，精度 4 位小数）。 */
function expectSameMat(a: Float32Array, b: Float32Array): void {
  for (let i = 0; i < 16; i++) expect(a[i]).toBeCloseTo(b[i], 4)
}

/** 方向过机器的线性部分：两点读数相减，平移量在差里抵消。 */
function dirThrough(
  m: Float32Array,
  d: readonly [number, number, number],
): [number, number, number] {
  const o = transformPoint(m, [0, 0, 0])
  const p = transformPoint(m, d)
  return [p[0] - o[0], p[1] - o[1], p[2] - o[2]]
}

describe('lookAt：把世界搬到相机眼前', () => {
  it('eye=(0,0,5) 看原点：16 个数手算对账，恰等于 translate(0,0,-5)', () => {
    // 手算：f = normalize(原点 − eye) = (0,0,-1)；s = cross(f, up) = (1,0,0)；
    //       u = cross(s, f) = (0,1,0)。三根正交基排进前三行，第 4 列装
    //       −R·eye：m[14] = f·eye = (0,0,-1)·(0,0,5) = -5。
    // 「相机站在 (0,0,5) 看原点」的视图矩阵 = 「把世界往 -Z 挪 5 格」——
    // 搬世界的直觉在数字上兑现。
    const want = new Float32Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, -5, 1,
    ])
    const V = lookAt([0, 0, 5], [0, 0, 0], [0, 1, 0])
    expectSameMat(V, want)
    expectSameMat(V, translate(0, 0, -5))
  })

  it('原点在视图空间落 (0,0,-5)：进了相机正前方，看得见了', () => {
    // 痛点主角：物体摆在原点，默认相机站在原点朝 -Z 看——物体在自己身上，
    // 什么也看不到；相机退到 (0,0,5) 再看，原点落到正前方 5 格 (0,0,-5)。
    const V = lookAt([0, 0, 5], [0, 0, 0], [0, 1, 0])
    const p = transformPoint(V, [0, 0, 0])
    expect(p[0]).toBeCloseTo(0, 4)
    expect(p[1]).toBeCloseTo(0, 4)
    expect(p[2]).toBeCloseTo(-5, 4)
    // 世界 z 轴负半轴上的点，退得更深 2 格：z' = 1×(-2) - 5 = -7。
    const q = transformPoint(V, [0, 0, -2])
    expect(q[2]).toBeCloseTo(-7, 4)
  })

  it('up=(0,1,0) 时 x 轴不翻转：世界 +X 的东西仍在视图 +X（相机右手边）', () => {
    // 手算：s = cross(f, up) = cross((0,0,-1),(0,1,0)) = (1,0,0)——世界 +X
    // 恰是相机的右手边。若把 s 误算成 cross(up, f)，x 会镜像翻转，
    // 相机左右装反，整个画面水平翻个面。
    const V = lookAt([0, 0, 5], [0, 0, 0], [0, 1, 0])
    const right = transformPoint(V, [3, 0, 0])
    expect(right[0]).toBeCloseTo(3, 4)
    expect(right[1]).toBeCloseTo(0, 4)
    expect(right[2]).toBeCloseTo(-5, 4)
    const left = transformPoint(V, [-2, 1, 0])
    expect(left[0]).toBeCloseTo(-2, 4)
    expect(left[1]).toBeCloseTo(1, 4)
    expect(left[2]).toBeCloseTo(-5, 4)
  })

  it('相机绕 Y 转 90°（从 (0,0,5) 转到 (5,0,0) 仍看原点）：世界点落位手算对账', () => {
    // 手算：f = normalize(原点 − (5,0,0)) = (-1,0,0)；s = cross(f, up) = (0,0,-1)；
    //       u = (0,1,0)。世界 x 轴成了深度轴、世界 z 轴成了左右轴（+Z 在左手边）。
    //  (0,0, 5)：x' = s.z×5 = -5（左手 5 格）、z' = (-f.x)×0 - 5 = -5（前方 5 格）
    //  (1,0, 0)：x' = 0、z' = 1×1 - 5 = -4（正前方的视线本线上）
    //  (0,0,-5)：x' = +5（右手 5 格）、z' = -5
    const V = lookAt([5, 0, 0], [0, 0, 0], [0, 1, 0])
    const a = transformPoint(V, [0, 0, 5])
    expect(a[0]).toBeCloseTo(-5, 4)
    expect(a[1]).toBeCloseTo(0, 4)
    expect(a[2]).toBeCloseTo(-5, 4)
    const b = transformPoint(V, [1, 0, 0])
    expect(b[0]).toBeCloseTo(0, 4)
    expect(b[1]).toBeCloseTo(0, 4)
    expect(b[2]).toBeCloseTo(-4, 4)
    const c = transformPoint(V, [0, 0, -5])
    expect(c[0]).toBeCloseTo(5, 4)
    expect(c[2]).toBeCloseTo(-5, 4)
  })

  it('同一台机器的另一种写法：lookAt(5,0,0) = rotY(-90°)·translate(-5,0,0)', () => {
    // 搬世界的两步走：先把世界往 -X 挪 5 格（相机随世界回到原点），再绕 Y
    // 转 -90°（把视线对回 -Z）——与第 5 章的老机器逐位相等。视图矩阵 =
    // 相机自身变换的逆过程，这里用旋转+平移亲手拼出来对账。
    expectSameMat(
      lookAt([5, 0, 0], [0, 0, 0], [0, 1, 0]),
      multiply(rotY(-Math.PI / 2), translate(-5, 0, 0)),
    )
  })

  it('旋转部分是正交阵：方向过机器后点积不变、长度不变', () => {
    // 取一台斜着的相机（眼不在轴上、也不朝轴看），验证三根正交基的出厂
    // 性质：任意两个方向的点积、各自的长度，过机器后原样保持——旋转不
    // 掰弯角度、不拉长短的代数形态。
    const V = lookAt([2, 1, 3], [-1, 0, -2], [0, 1, 0])
    const a: readonly [number, number, number] = [1, 2, 3]
    const b: readonly [number, number, number] = [-2, 0.5, 1]
    // 手算：dot(a,b) = -2 + 1 + 3 = 2；length(a) = √(1+4+9) = √14。
    const a2 = dirThrough(V, a)
    const b2 = dirThrough(V, b)
    expect(dot(a2, b2)).toBeCloseTo(2, 4)
    expect(length(a2)).toBeCloseTo(length(a), 4)
    // 三根世界基向量过机器后互相垂直、各自单位长。
    const e1 = dirThrough(V, [1, 0, 0])
    const e2 = dirThrough(V, [0, 1, 0])
    const e3 = dirThrough(V, [0, 0, 1])
    expect(dot(e1, e2)).toBeCloseTo(0, 4)
    expect(dot(e2, e3)).toBeCloseTo(0, 4)
    expect(dot(e3, e1)).toBeCloseTo(0, 4)
    expect(length(e1)).toBeCloseTo(1, 4)
    expect(length(e2)).toBeCloseTo(1, 4)
    expect(length(e3)).toBeCloseTo(1, 4)
  })

  it('multiply(V, M)：模型点先过 M 再过 V——「世界→视图」全链路', () => {
    // M = translate(2,0,0) 把模型原点摆到世界 (2,0,0)；V = lookAt((0,0,5),
    // 原点, (0,1,0))。手算：模型点 (0,0,0) 过 M → 世界 (2,0,0)；过 V →
    // 视图 (2,0,-5)（右手 2 格、前方 5 格）。两台机器串成一台，一次乘法到位。
    const VM = multiply(
      lookAt([0, 0, 5], [0, 0, 0], [0, 1, 0]),
      translate(2, 0, 0),
    )
    const p = transformPoint(VM, [0, 0, 0])
    expect(p[0]).toBeCloseTo(2, 4)
    expect(p[1]).toBeCloseTo(0, 4)
    expect(p[2]).toBeCloseTo(-5, 4)
    const q = transformPoint(VM, [0, 1, 0])
    expect(q[0]).toBeCloseTo(2, 4)
    expect(q[1]).toBeCloseTo(1, 4)
    expect(q[2]).toBeCloseTo(-5, 4)
  })

  it('P·V·M 三台机器凑齐：模型点 (0,0,0) 落 NDC (0.5, 0, 0.5)', () => {
    // M = translate(1,0,3)（模型原点摆到世界 (1,0,3)）；V = lookAt((0,0,5),
    // 原点, (0,1,0))；P = perspective(90°,1,1,3)（第 6 章样机）。
    // 手算：世界 (1,0,3) → 视图 (1,0,-2)（x' = 1×1、z' = 1×3-5 = -2）
    //       → 裁剪 (1, 0, -2×(-2)-3 = 1, w = 2) → NDC (0.5, 0, 0.5)。
    const mvp = multiply(
      perspective(Math.PI / 2, 1, 1, 3),
      multiply(
        lookAt([0, 0, 5], [0, 0, 0], [0, 1, 0]),
        translate(1, 0, 3),
      ),
    )
    const p = transformPoint(mvp, [0, 0, 0])
    expect(p[0]).toBeCloseTo(0.5, 4)
    expect(p[1]).toBeCloseTo(0, 4)
    expect(p[2]).toBeCloseTo(0.5, 4)
  })

  it('up 与视线平行时：不抛异常，产出退化矩阵（声明的差异，测试锁住）', () => {
    // up=(0,0,1) 与 f=(0,0,-1) 平行：cross(f, up) = 零向量，normalize 按第 4 章
    // 约定返回 [0,0,0]——s、u 两根基全零，x/y 两行失效，只剩深度行还活着。
    // 调用方的责任：给一个不与视线平行的 up（正头顶俯视时 up=(0,1,0) 就会踩中）。
    const V = lookAt([0, 0, 5], [0, 0, 0], [0, 0, 1])
    expect(V[0]).toBeCloseTo(0, 4)
    expect(V[5]).toBeCloseTo(0, 4)
    expect(V[10]).toBeCloseTo(1, 4)
    expect(V[15]).toBeCloseTo(1, 4)
  })
})
