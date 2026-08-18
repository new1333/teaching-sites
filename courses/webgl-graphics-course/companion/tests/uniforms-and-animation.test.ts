import { describe, expect, it } from 'vitest'
import { clamp, lerp, smoothstep } from '../src/math/interpolate'

// 第 3 章里程碑：math/interpolate——lerp / clamp / smoothstep。
// 三个函数与 GLSL ES 1.00 的同名内建（mix / clamp / smoothstep）同语义，
// 这层一致性是教学对账点：实验场算的数要能和着色器算的数对上。
// 只断言行为（输入→输出），数值全部纸笔可复算。
describe('lerp（线性插值，与 GLSL mix 同语义）', () => {
  it('中点取半：lerp(0, 10, 0.5) = 5', () => {
    expect(lerp(0, 10, 0.5)).toBeCloseTo(5, 4)
  })

  it('端点各归其位：t = 0 得 a，t = 1 得 b', () => {
    expect(lerp(2, 6, 0)).toBeCloseTo(2, 4)
    expect(lerp(2, 6, 1)).toBeCloseTo(6, 4)
  })

  it('t 越界不钳制（沿直线外推）：lerp(0, 10, 1.5) = 15，lerp(0, 10, -0.5) = -5', () => {
    // GLSL 的 mix(x, y, a) = x(1-a) + ya 对 a 不做钳制——超出 [0,1] 原样外推。
    // 「lerp 不钳制、smoothstep 钳制」是本章的教学点之一，测试锁住差异。
    expect(lerp(0, 10, 1.5)).toBeCloseTo(15, 4)
    expect(lerp(0, 10, -0.5)).toBeCloseTo(-5, 4)
  })
})

describe('clamp（把值收拢进边界）', () => {
  it('界内原样通过', () => {
    expect(clamp(5, 0, 10)).toBeCloseTo(5, 4)
    expect(clamp(-0.2, -1, 1)).toBeCloseTo(-0.2, 4)
  })

  it('越界收拢到边界', () => {
    expect(clamp(-3, 0, 10)).toBeCloseTo(0, 4)
    expect(clamp(42, 0, 10)).toBeCloseTo(10, 4)
  })
})

describe('smoothstep（平滑阶梯，与 GLSL 同名内建同语义）', () => {
  it('端点外收拢：x < e0 得 0，x > e1 得 1', () => {
    // GLSL 规范：smoothstep 对归一化 t 先 clamp 到 [0,1] 再套曲线——
    // 与 mix 的「不钳制」恰好相反，差异同样被测试锁住。
    expect(smoothstep(0, 1, -0.2)).toBeCloseTo(0, 4)
    expect(smoothstep(0, 1, 1.3)).toBeCloseTo(1, 4)
  })

  it('中点恰为 0.5：t²(3 - 2t) 在 t = 0.5 处 = 0.25 × 2', () => {
    expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5, 4)
  })

  it('曲线形状手算：t = 0.25 → 0.0625 × 2.5 = 0.15625（起步比直线慢）', () => {
    expect(smoothstep(0, 1, 0.25)).toBeCloseTo(0.15625, 4)
  })

  it('区间可平移缩放：smoothstep(10, 20, 15) 的中点也是 0.5', () => {
    expect(smoothstep(10, 20, 15)).toBeCloseTo(0.5, 4)
  })
})
