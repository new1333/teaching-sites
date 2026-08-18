import { describe, expect, it } from 'vitest'
import { add } from '../src/math/vec3'
import { identity, multiply, rotX, rotY, rotZ, scale, transformPoint, translate } from '../src/math/mat4'
import { SceneNode } from '../src/scene/node'

// 第 11 章里程碑：scene/node——SceneNode（local + children + updateWorld 递归
// 链乘）。局部矩阵描述「相对父级的变换」，世界矩阵是「从根链乘到本节点的
// 总变换」；updateWorld(parent?) 深度优先走一遍树，每个节点的
// world = parent.world · local（乘法从右往左作用，坐标先过 local）。
// 数值全部手算可得：90° 旋转恰好落轴，公转半径 4、月亮轨道半径 1.5。

/** 逐位对账两个矩阵的 16 个数（浮点断言，精度 4 位小数）。 */
function expectSameMat(a: Float32Array, b: Float32Array): void {
  for (let i = 0; i < 16; i++) expect(a[i]).toBeCloseTo(b[i], 4)
}

/** 点过矩阵后的三个分量逐个对账。 */
function expectPoint(
  m: Float32Array,
  p: readonly [number, number, number],
  want: readonly [number, number, number],
): void {
  const got = transformPoint(m, p)
  expect(got[0]).toBeCloseTo(want[0], 4)
  expect(got[1]).toBeCloseTo(want[1], 4)
  expect(got[2]).toBeCloseTo(want[2], 4)
}

/**
 * 太阳系骨架（测试与正文演示同一份结构）：
 *   sun（根，太阳）
 *   └─ earthOrbit：local = rotY(公转角)·translate(4,0,0) —— 地球公转
 *      ├─ earthMesh：local = rotY(自转角) —— 地球网格自转（叶子）
 *      └─ moonOrbit：local = rotY(月亮角)·translate(1.5,0,0) —— 月亮绕地球
 * 月亮挂在地球队列下、不挂在自转网格下：自转不该拖着月亮跑。
 */
function buildSolarSystem(orbitDeg: number, spinDeg: number, moonDeg: number): {
  sun: SceneNode
  earthOrbit: SceneNode
  earthMesh: SceneNode
  moonOrbit: SceneNode
} {
  const rad = (deg: number): number => (deg * Math.PI) / 180
  const sun = new SceneNode(identity())
  const earthOrbit = new SceneNode(multiply(rotY(rad(orbitDeg)), translate(4, 0, 0)))
  const earthMesh = new SceneNode(rotY(rad(spinDeg)))
  const moonOrbit = new SceneNode(multiply(rotY(rad(moonDeg)), translate(1.5, 0, 0)))
  sun.add(earthOrbit)
  earthOrbit.add(earthMesh)
  earthOrbit.add(moonOrbit)
  return { sun, earthOrbit, earthMesh, moonOrbit }
}

describe('根节点：world 是 local 的一次结算快照', () => {
  it('updateWorld() 不传父级：world = local；此后改 local，world 保持到下次结算', () => {
    const root = new SceneNode(translate(1, 0, 0))
    root.updateWorld()
    expectPoint(root.world, [0, 0, 0], [1, 0, 0])
    // world 是结算时算出的数，不是 local 的活引用：local 改了、没重新结算，
    // world 原样——「每帧改 local → updateWorld 一次」的语义由这笔账锁住
    root.local = translate(9, 0, 0)
    expectPoint(root.world, [0, 0, 0], [1, 0, 0])
    root.updateWorld()
    expectPoint(root.world, [0, 0, 0], [9, 0, 0])
  })
})

describe('太阳系两笔账：地球绕太阳、月亮绕地球', () => {
  it('公转 90°：地球世界位置 (0,0,-4)，月亮 (0,0,-5.5) = 地球位置 + 旋转后的局部偏移', () => {
    // 手算（乘法从右往左作用，坐标先过右边的机器）：
    //   地球原点 → translate(4,0,0) → (4,0,0) → rotY(90°) → (0,0,-4)
    //   月亮原点 → translate(1.5,0,0) → (1.5,0,0) → 地球 local：
    //     translate(4,0,0) → (5.5,0,0) → rotY(90°) → (0,0,-5.5)
    // 分两笔记同一笔账：地球位置 (0,0,-4) + rotY(90°)·(1.5,0,0) = (0,0,-1.5)
    const { sun, earthOrbit, moonOrbit } = buildSolarSystem(90, 0, 0)
    sun.updateWorld()
    expectPoint(earthOrbit.world, [0, 0, 0], [0, 0, -4])
    expectPoint(moonOrbit.world, [0, 0, 0], [0, 0, -5.5])
    const earthPos = transformPoint(earthOrbit.world, [0, 0, 0])
    const rotatedOffset = transformPoint(rotY(Math.PI / 2), [1.5, 0, 0])
    const moonWorld = add(earthPos, rotatedOffset)
    expect(moonWorld[0]).toBeCloseTo(0, 4)
    expect(moonWorld[1]).toBeCloseTo(0, 4)
    expect(moonWorld[2]).toBeCloseTo(-5.5, 4)
  })

  it('地球自转 90° 不拖月亮：网格自转是叶子，月亮世界坐标纹丝不动', () => {
    // 自转角 90°：earthMesh.world = rotY(90°)·T(4,0,0)·rotY(90°)，
    // 旋转不搬原点——地球网格自己的原点仍在 (0,0,-4)；
    // 月亮是 earthMesh 的兄弟而非孩子，账面与自转无关：仍是 (0,0,-5.5)
    const { sun, earthMesh, moonOrbit } = buildSolarSystem(90, 90, 0)
    sun.updateWorld()
    expectPoint(earthMesh.world, [0, 0, 0], [0, 0, -4])
    expectPoint(moonOrbit.world, [0, 0, 0], [0, 0, -5.5])
  })

  it('两笔账同时走：公转 90° 且月亮自己绕到地球另一侧（180°），月亮落 (0,0,-2.5)', () => {
    // 手算：月亮角 180° → 局部偏移 rotY(180°)·(1.5,0,0) = (-1.5,0,0)
    //   → 地球 local：translate(4,0,0) → (2.5,0,0) → rotY(90°) → (0,0,-2.5)
    const { sun, moonOrbit } = buildSolarSystem(90, 0, 180)
    sun.updateWorld()
    expectPoint(moonOrbit.world, [0, 0, 0], [0, 0, -2.5])
  })
})

describe('子节点 local 不变，世界矩阵随父动', () => {
  it('父级公转角从 0° 转到 180°：moon.local 平移列原封 (1.5,0,0)，世界从 (5.5,0,0) 到 (-5.5,0,0)', () => {
    const { sun, earthOrbit, moonOrbit } = buildSolarSystem(0, 0, 0)
    sun.updateWorld()
    expectPoint(moonOrbit.world, [0, 0, 0], [5.5, 0, 0])
    // 手算 180°：地球 (4,0,0) → (-4,0,0)；月亮 (5.5,0,0) → (-5.5,0,0)
    earthOrbit.local = multiply(rotY(Math.PI), translate(4, 0, 0))
    sun.updateWorld()
    // 列主序：m[12..14] 是第 4 列（平移列）——local 一步没动
    expect(moonOrbit.local[12]).toBeCloseTo(1.5, 4)
    expect(moonOrbit.local[13]).toBeCloseTo(0, 4)
    expect(moonOrbit.local[14]).toBeCloseTo(0, 4)
    expectPoint(earthOrbit.world, [0, 0, 0], [-4, 0, 0])
    expectPoint(moonOrbit.world, [0, 0, 0], [-5.5, 0, 0])
  })
})

describe('深层嵌套：三层链乘 = 逐级矩阵连乘', () => {
  it('rotZ(90°) → translate(2,1,0) → scale(2,2,1)：叶子 world 与手乘三连积逐元素相等', () => {
    // 手算点 (1,1,0) 过三层链：
    //   scale(2,2,1) → (2,2,0) → translate(2,1,0) → (4,3,0)
    //   → rotZ(90°)：x' = -y = -3、y' = x = 4 → (-3,4,0)，长度恰 5（3-4-5 复活）
    const a = new SceneNode(rotZ(Math.PI / 2))
    const b = new SceneNode(translate(2, 1, 0))
    const c = new SceneNode(scale(2, 2, 1))
    a.add(b)
    b.add(c)
    a.updateWorld()
    const manual = multiply(multiply(rotZ(Math.PI / 2), translate(2, 1, 0)), scale(2, 2, 1))
    expectSameMat(c.world, manual)
    expectSameMat(b.world, multiply(rotZ(Math.PI / 2), translate(2, 1, 0)))
    expectPoint(c.world, [1, 1, 0], [-3, 4, 0])
  })

  it('换轴链也成立：rotX(90°) → rotY(90°)，+X 点过两台机器落 +Y', () => {
    // 手算：(1,0,0) 过 rotY(90°) → (0,0,-1)；再过 rotX(90°)——rotX 只混
    // y、z 两根轴：y' = cos·y − sin·z = 0 − (-1) = 1、z' = sin·y + cos·z
    // = 0 → (0,1,0)。坐标先过子级 local（rotY）、再过父级（rotX）
    const a = new SceneNode(rotX(Math.PI / 2))
    const b = new SceneNode(rotY(Math.PI / 2))
    a.add(b)
    a.updateWorld()
    expectSameMat(b.world, multiply(rotX(Math.PI / 2), rotY(Math.PI / 2)))
    expectPoint(b.world, [1, 0, 0], [0, 1, 0])
  })
})

describe('逐帧动画的用法：每帧只改 local，updateWorld 一次结算', () => {
  it('公转 0°/90°/180° 三帧对账：地球与月亮的世界坐标一路手算可得', () => {
    const { sun, earthOrbit, earthMesh, moonOrbit } = buildSolarSystem(0, 0, 0)
    // 第 1 帧：公转 0°
    sun.updateWorld()
    expectPoint(earthMesh.world, [0, 0, 0], [4, 0, 0])
    expectPoint(moonOrbit.world, [0, 0, 0], [5.5, 0, 0])
    // 第 2 帧：公转 90°（每帧重建 earthOrbit.local，其余 local 不碰）
    earthOrbit.local = multiply(rotY(Math.PI / 2), translate(4, 0, 0))
    sun.updateWorld()
    expectPoint(earthOrbit.world, [0, 0, 0], [0, 0, -4])
    expectPoint(moonOrbit.world, [0, 0, 0], [0, 0, -5.5])
    // 第 3 帧：公转 180°
    earthOrbit.local = multiply(rotY(Math.PI), translate(4, 0, 0))
    sun.updateWorld()
    expectPoint(earthOrbit.world, [0, 0, 0], [-4, 0, 0])
    expectPoint(moonOrbit.world, [0, 0, 0], [-5.5, 0, 0])
  })
})
