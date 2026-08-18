/**
 * Phong 光照三件套——CPU 参考实现，与片元着色器里的公式逐行同形。
 *
 * 为什么 CPU 上再写一遍光照？着色器跑在 GPU 里，断言和纸笔都够不着；
 * 把同一组公式搬到 TypeScript 里，每个数都能手算对账（45° 入射的
 * 漫反射 = √½ ≈ 0.7071，tests/lighting.test.ts 全程可复算），正文与
 * GLSL 着色器的对账就有了地面。演示组件与第 13 章的世界装配也都拿
 * 它当「原理基准」。
 *
 * 约定（与 GLSL 着色器完全一致）：n、l、v 一律传单位向量——n 是表面
 * 法线；l 从表面指向光源；v 从表面指向相机（眼睛）。全部纯函数、返回
 * 新值；输入是否归一化由调用方保证（着色器里也是先 normalize 再算）。
 */

import { add, dot, scale } from '../math/vec3'
import type { Vec3 } from '../math/vec3'

/** Phong 三件套的分量读数与总和（都已是 [0,1] 量程）。 */
export interface PhongComponents {
  /** 环境光分量：无方向兜底，恒为 ambientStrength。 */
  ambient: number
  /** 漫反射分量：max(N·L, 0)，正对光最亮、背面为 0。 */
  diffuse: number
  /** 高光分量：max(R·V, 0)^shininess，反光斑。 */
  specular: number
  /** 三件套之和，收拢进 [0,1]——与 gl_FragColor 写入帧缓冲时被摁回
   * [0,1] 的规范行为对齐（普通 8 位帧缓冲收不下超界的亮度）。 */
  intensity: number
}

/**
 * 镜面反射方向——与 GLSL 内建 reflect(I, N) 同公式：I − 2(N·I)N。
 * I 是指向表面的入射方向，N 是单位法线；结果是弹出去的方向。
 * 光照里喂 reflect(−L, N)：−L 是「光射向表面」的方向，弹出去就是
 * 光打到表面上再弹走的方向 R = 2(N·L)N − L。
 * 手算样例：N=(0,0,1)、L=(√½,0,√½) 时 R = (−√½, 0, √½)。
 */
export function reflect(i: Vec3, n: Vec3): Vec3 {
  return add(i, scale(n, -2 * dot(n, i)))
}

/**
 * 漫反射分量：哑光墙面把光向四面八方弹开，亮度只看「正对光的程度」
 * ——第 4 章点积打分机 N·L。max(·, 0) 把背面钳成 0：光从背面打来，
 * 这一面一丁点漫反射都不该有（负数不是「负亮度」，是「没有光」）。
 * 手算样例：45° 入射 = cos45° = √½ ≈ 0.7071——面转过去 45°，
 * 亮度从 1 掉到七成。
 */
export function diffuse(n: Vec3, l: Vec3): number {
  return Math.max(dot(n, l), 0)
}

/**
 * 高光分量：光滑表面朝相机方向弹出的反光斑。只有「反射方向 R 与视线
 * v 对齐」的那一小片才亮；pow(·, shininess) 把对齐度取幂压尖——
 * shininess 越大斑越小越亮，从巴掌大到针尖全靠它调。
 * 手算样例：dot(R, v) = √½ 时，shininess=8 得 (√½)^8 = 1/16，
 * shininess=64 得 2^-32 ≈ 0——同一个偏离角，幂一高就暗掉。
 */
export function specular(n: Vec3, l: Vec3, v: Vec3, shininess: number): number {
  const r = reflect([-l[0], -l[1], -l[2]], n)
  return Math.pow(Math.max(dot(r, v), 0), shininess)
}

/**
 * 三件套合流：环境光（阴天兜底）+ 漫反射（哑光墙面）+ 高光（反光斑），
 * 加起来收拢进 [0,1]——与 GLSL 着色器逐行同形：
 *
 *   ambient  = ambientStrength
 *   diffuse  = max(dot(N, L), 0)
 *   specular = pow(max(dot(reflect(-L, N), V), 0), shininess)
 *   color    = clamp(ambient + diffuse + specular, 0, 1)
 *
 * 手算样例：N=(0,0,1)、L=(√½,0,√½)、V=(0,0,1)、shininess=32、
 * ambientStrength=0.1 时：漫反射 √½、高光 (√½)^32 = 2^-16 ≈ 0.0000153，
 * 总和 ≈ 0.8071。
 */
export function computePhong(
  n: Vec3,
  l: Vec3,
  v: Vec3,
  shininess: number,
  ambientStrength: number,
): PhongComponents {
  const amb = Math.max(ambientStrength, 0)
  const dif = diffuse(n, l)
  const spe = specular(n, l, v, shininess)
  return {
    ambient: amb,
    diffuse: dif,
    specular: spe,
    intensity: Math.min(Math.max(amb + dif + spe, 0), 1),
  }
}
