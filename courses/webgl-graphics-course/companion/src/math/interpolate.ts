/**
 * 插值三件套——lerp / clamp / smoothstep。
 *
 * 三个函数与 GLSL ES 1.00 的同名内建（mix / clamp / smoothstep）语义对齐，
 * 这是刻意选择：实验场在 JS 里算出的数，要能和着色器里同一公式算出的数
 * 互相对账（正文「渐进实验」一节的对照点）。
 *
 * 两条语义差异记牢（GLSL 规范原文行为，tests/uniforms-and-animation.test.ts
 * 各有断言锁住）：
 * - lerp 对 t 不钳制：t 超出 [0,1] 时沿同一条直线外推（mix 同）；
 * - smoothstep 对 x 钳制：x 小于 e0 得 0、大于 e1 得 1，中间走
 *   t²(3−2t) 的 S 形曲线——两端斜率为 0，起步和收尾都不生硬。
 *
 * 惯例：数学函数不抛异常。e0 等于 e1 时 smoothstep 内部除以零，结果未定
 * 义（GLSL 规范对 e0 ≥ e1 同样声明结果未定义），由调用方保证区间有效。
 */

/**
 * 线性插值：按比例 t 取 a 到 b 之间的值。
 * t = 0 得 a，t = 1 得 b，t = 0.5 得中点；t 越界按直线外推，不钳制。
 * 手算样例：lerp(0, 10, 0.5) = 0 + (10 − 0) × 0.5 = 5。
 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/**
 * 把 v 收拢进 [min, max]：小于 min 得 min，大于 max 得 max，界内原样返回。
 */
export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}

/**
 * 平滑阶梯：x 在 e0 之前得 0，在 e1 之后得 1，中间用 t²(3−2t) 过渡。
 * 与 GLSL smoothstep 同公式同语义——先归一化并钳制 t，再套 S 曲线。
 * 手算样例：中点 0.5² × (3 − 1) = 0.5；t = 0.25 得 0.0625 × 2.5 = 0.15625。
 */
export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1)
  return t * t * (3 - 2 * t)
}
