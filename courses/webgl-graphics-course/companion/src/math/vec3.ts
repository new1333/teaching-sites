/**
 * 三维向量 vec3——图形世界的语言。
 *
 * 向量是「带箭头的走法说明：朝哪走、走多远」，三个数各管一根轴
 * （x 朝右、y 朝上、z 朝屏幕外，全书右手系）。位置、方向、速度、
 * 光照的法线——图形学里几乎一切「有方向的数量」都用它装。
 *
 * 八个函数分成三组记：
 * - add / sub / scale：分量各自干活——加法接力走、减法算方向、数乘拉长度；
 * - length / dot / cross：两把量尺——勾股量长度、点积量方向一致度
 *   （同向正、垂直零、反向负）、叉积量撑出的垂直方向（右手定则）；
 * - normalize / distance：两个日常动作——只留方向走一步、量两点间距。
 *
 * 3-4-5 三角形是全模块的主教材：length([3,4,0]) = 5、
 * dot([3,4,0],[1,0,0]) = 3（影子长）、cross([3,4,0],[0,0,1]) 撑出
 * 面积 5——tests/vectors.test.ts 全部可纸笔复算。
 *
 * 惯例（与 interpolate 相同）：纯函数返回新值不改入参；数学函数不抛
 * 异常，normalize 收到零向量返回 [0,0,0]（见其 JSDoc）。
 */

/** 三维向量：x、y、z 三个分量。readonly——拿进来只读，出去给新数组。 */
export type Vec3 = readonly [number, number, number]

/**
 * 加法：两个走法接力——先走 a 再走 b，等效走法就是 a + b。
 * 分量各自相加。手算样例：[1,2,3] + [4,5,6] = [5,7,9]。
 */
export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

/**
 * 减法：b − a 得到「从 a 指向 b」的方向向量——算朝向的第一步。
 * 手算样例：目标 [4,5,0] − 飞船 [1,1,0] = [3,4,0]，指向目标。
 */
export function sub(b: Vec3, a: Vec3): Vec3 {
  return [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
}

/**
 * 数乘：把向量的长度拉成 k 倍，方向不变；k 为负则掉头。
 * 手算样例：[3,4,0] × 2 = [6,8,0]（长度从 5 变 10）。
 */
export function scale(v: Vec3, k: number): Vec3 {
  return [v[0] * k, v[1] * k, v[2] * k]
}

/**
 * 长度：勾股定理——三分量平方和开根。
 * 手算样例：length([3,4,0]) = √(9+16) = 5。
 */
export function length(v: Vec3): number {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
}

/**
 * 点积：两向量方向的一致度——同向正、垂直零、反向负。
 * 分量两两相乘再求和。手算样例：dot([3,4,0],[1,0,0]) = 3+0+0 = 3，
 * 恰是 [3,4,0] 在 x 轴上影子的长度（单位向量当尺子时点积=投影）；
 * 夹角由 cos θ = dot(a,b) / (|a||b|) 读出。
 */
export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

/**
 * 叉积：a × b 得到同时垂直于 a、b 的向量，方向按右手定则——
 * 四指从 a 弯向 b，大拇指的指向（右手系下 x×y=z）。
 * 长度等于 a、b 撑出的平行四边形面积（a、b 共线时为 0 向量）。
 * 手算样例：cross([3,4,0],[0,0,1]) = [4×1−0, 0−3×1, 0] = [4,−3,0]，
 * 长度 5 即两向量撑出的面积。
 */
export function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]
}

/**
 * 归一化：除以自身长度，只留方向、把长度缩成 1——「每帧走固定一步」
 * 的前提。手算样例：normalize([3,4,0]) = [0.6, 0.8, 0]。
 * 零向量没有方向可留：按实验场约定返回 [0,0,0]，不抛异常——
 * 调用方拿到零向量即知「这一帧没有可走的方向」。
 */
export function normalize(v: Vec3): Vec3 {
  const len = length(v)
  if (len === 0) return [0, 0, 0]
  return [v[0] / len, v[1] / len, v[2] / len]
}

/**
 * 距离：两点先减出方向向量、再量它的长度。
 * 手算样例：distance([0,0,0],[3,4,0]) = length([3,4,0]) = 5。
 */
export function distance(a: Vec3, b: Vec3): number {
  return length(sub(b, a))
}
