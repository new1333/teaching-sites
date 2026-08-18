/**
 * 4×4 矩阵 mat4——装满数字的变换机器。
 *
 * 一台矩阵机器吃进一个坐标、吐出一个新坐标；平移、旋转、缩放三类变换
 * 都造成这个形状，再靠矩阵乘法把多台机器串成一台。顶点着色器里那句
 * 「坐标 × 模型 × 视图 × 投影」，串的正是本章造的机器。
 *
 * 内存布局（教学点，不是随性选择）：Mat4 = Float32Array(16)，列主序——
 * 数组的第 0-3 个数是数学矩阵的第 1 列，第 4-7 个数是第 2 列，依此类推，
 * 与 uniformMatrix4fv 读数据的口味一致。于是 translate 的 (tx,ty,tz)
 * 落在 m[12]、m[13]、m[14]（第 4 列的前三行）。
 *
 * 乘法约定（与主流图形库一致）：multiply(A, B) = A·B——坐标先过 B、
 * 再过 A。顺序不可交换：T·R ≠ R·T（tests 有具体数值差异锁住）；但满足
 * 结合律：(A·B)·C = A·(B·C)。
 *
 * 惯例与 vec3 相同：纯函数返回新矩阵不改入参；角度一律弧度；数学函数
 * 不抛异常。
 */

import { cross, dot, normalize, sub } from './vec3'
import type { Vec3 } from './vec3'

/** 4×4 矩阵：长度 16 的 Float32Array，列主序（数组按列连续存放）。 */
export type Mat4 = Float32Array

/**
 * 单位阵：什么都不做的机器——坐标进去什么样子，出来还是什么样子。
 * 乘法的单位元：I·M = M·I = M。对角线四个 1，其余全是 0。
 */
export function identity(): Mat4 {
  const m = new Float32Array(16)
  m[0] = 1
  m[5] = 1
  m[10] = 1
  m[15] = 1
  return m
}

/**
 * 矩阵乘法 = 机器串联：multiply(A, B) 造出一台新机器，坐标先过 B、再过 A。
 * 新矩阵第 col 列第 row 行的数 = A 的第 row 行与 B 的第 col 列逐项相乘
 * 再求和（第 4 章的点积在这里上班：一行与一列的点积出一个数）。
 * 注意顺序不可交换：multiply(A, B) ≠ multiply(B, A)；
 * 但结合律成立：(A·B)·C = A·(B·C)——多台机器怎么分组，串好的总机器不变。
 */
export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16)
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      out[col * 4 + row] =
        a[0 * 4 + row] * b[col * 4 + 0] +
        a[1 * 4 + row] * b[col * 4 + 1] +
        a[2 * 4 + row] * b[col * 4 + 2] +
        a[3 * 4 + row] * b[col * 4 + 3]
    }
  }
  return out
}

/**
 * 平移机器：把坐标整体挪 (tx, ty, tz)。齐次坐标的收入——w 位的 1 让
 * 「加一个数」写进乘法：m[12..14] 装平移量（列主序下它们是第 4 列）。
 * 手算样例：translate(3,4,5) 作用在 (1,1,1) 得 (4,5,6)。
 */
export function translate(tx: number, ty: number, tz: number): Mat4 {
  const m = identity()
  m[12] = tx
  m[13] = ty
  m[14] = tz
  return m
}

/**
 * 绕 X 轴旋转 rad 弧度（右手定则：从 +X 看向原点，逆时针为正）。
 * 手算样例：rotX(90°) 把 (0,1,0) 转到 (0,0,1)——+Y 落 +Z。
 */
export function rotX(rad: number): Mat4 {
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  const m = identity()
  m[5] = c
  m[6] = s
  m[9] = -s
  m[10] = c
  return m
}

/**
 * 绕 Y 轴旋转 rad 弧度（右手定则：从 +Y 看向原点，逆时针为正）。
 * 手算样例：rotY(90°) 把 (1,0,0) 转到 (0,0,-1)——+X 落 -Z。
 */
export function rotY(rad: number): Mat4 {
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  const m = identity()
  m[0] = c
  m[2] = -s
  m[8] = s
  m[10] = c
  return m
}

/**
 * 绕 Z 轴旋转 rad 弧度（右手定则：从 +Z（屏幕外）看向原点，逆时针为正）。
 * 公式与第 3 章的 JS 旋转逐字相同：x' = x·cos − y·sin、y' = x·sin + y·cos
 * ——本章只是把它装进了矩阵。
 * 手算样例：rotZ(90°) 把 (1,0,0) 转到 (0,1,0)。
 */
export function rotZ(rad: number): Mat4 {
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  const m = identity()
  m[0] = c
  m[1] = s
  m[4] = -s
  m[5] = c
  return m
}

/**
 * 缩放机器：三根轴各自拉 (sx, sy, sz) 倍。负数 = 该轴镜像翻转。
 * 手算样例：scale(2,3,4) 作用在 (1,1,1) 得 (2,3,4)。
 */
export function scale(sx: number, sy: number, sz: number): Mat4 {
  const m = identity()
  m[0] = sx
  m[5] = sy
  m[10] = sz
  return m
}

/**
 * 透视投影机器：把相机前方那顶「帐篷」（视锥体）里的点送进 [-1,1] 标准
 * 操场。fovYRad 是上下方向的视野角、以弧度计（fov 拉大 = 广角镜头）；
 * aspect 是画布宽高比（宽/高）；near、far 是到两刀平面的正值距离。
 *
 * 第 4 行不是 (0,0,0,1) 而是 (0,0,-1,0)——出口的 w = -z（深度）：点离眼睛
 * 越远，w 越大，transformPoint 出口除以 w 之后落点越向中心收。这就是
 * 「近大远小」的全部机关：透视除法除的是这台机器亲手写下的深度。
 * z 方向的映射不是线性的：深度中点不落在 NDC 中点（tests 有 0.5 的对账）。
 *
 * 手算样例：perspective(90°, 1, 1, 3) 的数组（列主序）是
 *   [1,0,0,0,  0,1,0,0,  0,0,-2,-1,  0,0,-3,0]
 * 眼空间 (0,1,-1)（near 平面上边缘）→ w = 1 → NDC (0,1,-1)：边缘对边缘。
 * 眼空间 (0,0,-2)（视锥深度中点）→ w = 2、z_clip = -2×(-2)-3 = 1 →
 * NDC (0,0,0.5)。视点本身（z=0）w=0，除零未定义、不抛异常（由 near 平面
 * 挡住，调用方保证）。
 */
export function perspective(
  fovYRad: number,
  aspect: number,
  near: number,
  far: number,
): Mat4 {
  const f = 1 / Math.tan(fovYRad / 2)
  const m = new Float32Array(16)
  m[0] = f / aspect
  m[5] = f
  m[10] = (far + near) / (near - far)
  m[11] = -1
  m[14] = (2 * far * near) / (near - far)
  return m
}

/**
 * 正交投影机器：把一个轴对齐的盒子 [l,r]×[b,t]×[-f,-n]（眼空间、右手系、
 * 相机朝 -Z 看，n/f 为正值距离）平移加缩放进 [-1,1] 操场——平行投影仪：
 * 光线全平行，远近不影响大小。
 *
 * 第 4 行仍是 (0,0,0,1)：w 恒 1，transformPoint 出口的除法除 1 原样——
 * 透视除法的机关在正交机器里刻意关着。
 *
 * 手算样例：ortho(-2,2,-1.5,1.5,1,3) 里 m[0]=2/(2-(-2))=0.5、
 * m[5]=2/3、m[10]=-2/(3-1)=-1、m[14]=-(3+1)/(3-1)=-2；
 * 盒中心 (0,0,-2) → z' = -1×(-2)+(-2) = 0，落回操场原点。
 */
export function ortho(
  left: number,
  right: number,
  bottom: number,
  top: number,
  near: number,
  far: number,
): Mat4 {
  const m = new Float32Array(16)
  m[0] = 2 / (right - left)
  m[5] = 2 / (top - bottom)
  m[10] = -2 / (far - near)
  m[12] = -(right + left) / (right - left)
  m[13] = -(top + bottom) / (top - bottom)
  m[14] = -(far + near) / (far - near)
  m[15] = 1
  return m
}

/**
 * 视图机器 lookAt：把整个世界平移旋转到「相机站在原点、朝 -Z 看」的标准
 * 姿势跟前——搬世界而不是造相机（WebGL 没有相机这个岗位）。
 *
 * 三要素各管一件事：eye——眼在哪（世界坐标）；center——看哪（视线落点，
 * 世界里的任意一点）；up——头正不正（大致的头顶方向，定画面的哪边是左
 * 右，不必精确、更不必垂直——内部会扶正）。
 *
 * 三根正交基现场现造（第 4 章的家伙什复工）：f = normalize(center − eye)
 * 是视线；s = normalize(cross(f, up)) 是相机的右手边——叉积给垂直方向；
 * u = cross(s, f) 是扶正后的头顶。f、s、u 两两垂直、各自单位长，按「基
 * 向量的世界读数住矩阵的行」装进旋转部分（列主序下 s.x 住 m[0]、u.x 住
 * m[1]、-f.x 住 m[2]，依此类推——负号把「朝目标看」翻成「朝 -Z 看」）；
 * 第 4 列装 -R·eye：m[12] = -s·eye、m[13] = -u·eye、m[14] = f·eye。
 * 合起来 V = R·T(−eye)：坐标先被平移（相机随差值回到原点）、再被旋转
 * （视线对回 -Z）——恰好是相机自身变换的逆过程。
 *
 * up 与视线平行时（含反向；正头顶俯视配 up=(0,1,0) 是常踩的坑）：
 * cross(f, up) 是零向量，normalize 按第 4 章约定返回 [0,0,0]，s、u 两根
 * 基全零——产出退化矩阵、不抛异常，画面通常直接消失。调用方保证 up
 * 不与视线平行。
 *
 * 手算样例：lookAt((0,0,5), 原点, (0,1,0)) 的数组（列主序）是
 *   [1,0,0,0,  0,1,0,0,  0,0,1,0,  0,0,-5,1]
 * 恰等于 translate(0,0,-5)——把世界往 -Z 挪 5 格，原点就到了正前方
 * (0,0,-5)。再看轨道位 lookAt((5,0,0), 原点, (0,1,0))：f=(-1,0,0)、
 * s=(0,0,-1)、u=(0,1,0)，世界点 (0,0,5) 落视图 (-5,0,-5)——左手 5 格、
 * 前方 5 格；整台机器 = rotY(-90°)·translate(-5,0,0)。
 */
export function lookAt(eye: Vec3, center: Vec3, up: Vec3): Mat4 {
  const f = normalize(sub(center, eye))
  const s = normalize(cross(f, up))
  const u = cross(s, f)
  const m = new Float32Array(16)
  m[0] = s[0]
  m[1] = u[0]
  m[2] = -f[0]
  m[4] = s[1]
  m[5] = u[1]
  m[6] = -f[1]
  m[8] = s[2]
  m[9] = u[2]
  m[10] = -f[2]
  m[12] = -dot(s, eye)
  m[13] = -dot(u, eye)
  m[14] = dot(f, eye)
  m[15] = 1
  return m
}

/**
 * 法线矩阵：模型矩阵左上 3×3 的逆转置——专门把法线搬对的机器。
 *
 * 为什么法线不能直接吃模型矩阵？法线要的不是「跟着表面动」，而是
 * 「变换之后仍然垂直于变换后的表面」。均匀缩放与旋转不碍事（方向不变
 * 或整体转过去）；非均匀缩放会拉歪表面，垂直关系跟着歪——X 拉伸 2 倍
 * 时 45° 斜面的法线 (1,1,0)/√2 直接吃模型矩阵得 (2,1,0)/√5，而拉伸后
 * 平面 x/2+y=1 的真值法线是 (1,2,0)/√5（tests 有 4/5 夹角的对账）。
 * 数学上可以证明：想让「垂直」搬过去仍垂直，唯一的选择是左乘
 * (M₃⁻¹)ᵀ——逆是「把搬歪的表面搬回去」，转置再把方向对回新表面。
 *
 * 算法一步到位（教学点）：逆转置 (A⁻¹)ᵀ = 余子式矩阵 C ÷ 行列式——
 * 因为 A⁻¹ = adj(A)/det 而 adj(A) = Cᵀ，两边取转置，转置对角阵与
 * 转置伴随正好把「转置」吃掉。所以九个余子式各除一次 det 就是答案，
 * 不必先造完整逆再转置。平移列（第 4 列）不参与：法线是方向不是位置，
 * 搬桌子不转姿势（齐次坐标里方向补 w=0，平移那列对它无效）。
 *
 * 出口是 Mat4（左上 3×3 装法线矩阵、右下角 1、其余 0），可直接喂
 * uniformMatrix4fv。两个约定：出口各列不必是单位长度（均匀缩放会
 * 整体乘一个常数），着色器里照例 normalize；det 为 0 的退化矩阵
 * （某轴缩放为 0）会除零、产出废数值，不抛异常——调用方保证可逆。
 *
 * 手算样例：scale(2,1,1) 的法线矩阵 = diag(0.5, 1, 1)——被拉伸 2 倍的
 * 那根轴，法线分量反而减半；n = (1,1,0)/√2 过它得 (0.5,1,0)/√2，归一化
 * 后是 (1,2,0)/√5，与拉伸后平面 x/2+y=1 的真值法线重合。
 */
export function normalFromMat4(m: Mat4): Mat4 {
  // 左上 3×3 按数学习惯命名：a_{row}{col}，列主序下 a_{rc} = m[c*4+r]
  const a11 = m[0]
  const a12 = m[4]
  const a13 = m[8]
  const a21 = m[1]
  const a22 = m[5]
  const a23 = m[9]
  const a31 = m[2]
  const a32 = m[6]
  const a33 = m[10]
  // 行列式（按第一行展开）
  const det =
    a11 * (a22 * a33 - a23 * a32) -
    a12 * (a21 * a33 - a23 * a31) +
    a13 * (a21 * a32 - a22 * a31)
  // 逆转置 = 余子式矩阵 ÷ det：out[c*4+r] = C_{rc}/det
  const out = new Float32Array(16)
  out[0] = (a22 * a33 - a23 * a32) / det
  out[4] = -(a21 * a33 - a23 * a31) / det
  out[8] = (a21 * a32 - a22 * a31) / det
  out[1] = -(a12 * a33 - a13 * a32) / det
  out[5] = (a11 * a33 - a13 * a31) / det
  out[9] = -(a11 * a32 - a12 * a31) / det
  out[2] = (a12 * a23 - a13 * a22) / det
  out[6] = -(a11 * a23 - a13 * a21) / det
  out[10] = (a11 * a22 - a12 * a21) / det
  out[15] = 1
  return out
}

/**
 * 把点 p（w 补 1）喂进矩阵机器，取回新坐标。
 * 出口统一除以第四个数 w：本章的平移/旋转/缩放矩阵 w 恒为 1——除 1 原样；
 * 等投影矩阵登场（第 6 章），w 会变成深度，这个除法就是「近大远小」的
 * 落点（透视除法）。钩子现在就位，测试里用一台手造的 w=2 机器锁住它。
 * w 为 0 时除以零，结果未定义、不抛异常（同实验场惯例，由调用方保证）。
 */
export function transformPoint(
  m: Mat4,
  p: readonly [number, number, number],
): [number, number, number] {
  const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15]
  return [
    (m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12]) / w,
    (m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13]) / w,
    (m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]) / w,
  ]
}
