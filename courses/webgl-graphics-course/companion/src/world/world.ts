/**
 * 世界装配——把十二章攒下的零件拼成一个可漫游的 3D 小世界。
 *
 * 「零件全验证过了，真要拼一个世界时却无从下手」——缺的不是零件，是一份
 * 世界清单：什么东西（什么形状、摆哪）、什么材质（什么颜色、多光洁）、
 * 相机从哪进、雾从哪算起。本模块把这份清单写成一次函数调用：
 * createWorld(seed) 吃一个种子数，吐一棵结算就绪的场景树。
 *
 * 确定性是本模块的第一承诺：种子随机数（mulberry32）保证同一个 seed 两次
 * 调用生成结构完全一致的世界——节点数、每个节点的局部矩阵、每份材质逐
 * 元素相等。种子是世界的全部真相，「按种子重建地图」的账就在这里：游戏
 * 存档不存地图、只存种子，重进游戏从种子把地图原样再生成一遍。
 *
 * 第二个承诺是量级（tests/build-3d-world.test.ts 锁住）：children 顺序固定
 * 「地面、太阳、柱廊、房子」；柱 7..11 根、房子 3..6 栋，节点总数 13..20、
 * 深度 1（根下一层）——几十个物体的量级，一份渲染清单一帧画得完。
 *
 * 材质挂在节点的 data 字段上（SceneNode 的可选挂件，第 13 章加的）：
 * 材质是纯数据包，不新建任何类；同一份材质对象可以挂多个节点——柱廊
 * 全体柱子共享一份石头材质，改一处全体变，这正是「材质从绘制代码里拆
 * 出来」的全部意义。雾参数与相机入口不挂节点：雾是全场景气氛（一份
 * uniform 的事），入口是相机的账，都随世界一并交付。
 *
 * 惯例：角度内部换算（deg 常量），布局数值全部来自种子随机数；本模块
 * 不做碰撞检查（柱子与房子可能相邻很近）——教学世界的诚实简化。
 */

import { multiply, scale, translate } from '../math/mat4'
import type { Mat4 } from '../math/mat4'
import type { Vec3 } from '../math/vec3'
import { SceneNode } from '../scene/node'

/**
 * 材质——形状的皮肤参数包：同一个立方体换一份材质，就是草皮、石柱、
 * 砖房三种东西。五个字段全部喂给 Phong 光照（第 10 章）：
 * - baseColor：基础色 RGB，各分量 [0,1]；
 * - ambient / diffuseK / specularK：三件套的强度旋钮，各 [0,1]；
 * - shininess：光洁度（高光取幂的指数），≥ 1——越大反光斑越小越亮；
 * - emissive：自发光强度 [0,1]，1 = 不等光照、自己亮（太阳的标记）。
 */
export interface Material {
  readonly baseColor: Vec3
  readonly ambient: number
  readonly diffuseK: number
  readonly specularK: number
  readonly shininess: number
  readonly emissive: number
}

/** 雾参数：near 之内不混雾色、far 之外全雾色，中间 smoothstep 过渡。 */
export interface FogParams {
  readonly color: Vec3
  readonly near: number
  readonly far: number
}

/** 相机入口：世界交付时一并告诉相机「从哪进、朝哪看」。yaw/pitch 是度数（第 12 章约定）。 */
export interface WorldEntry {
  readonly eye: Vec3
  readonly yawDeg: number
  readonly pitchDeg: number
}

/** 一个装配完成的世界：树根 + 雾 + 光源位置 + 相机入口。 */
export interface World {
  /** 场景树根：children 顺序＝地面、太阳、柱廊、房子；调用方 updateWorld() 后可画。 */
  readonly root: SceneNode
  readonly fog: FogParams
  /** 太阳（点光源）的世界坐标——喂片元着色器当 uniform。 */
  readonly sunPosition: Vec3
  readonly entry: WorldEntry
}

/** 渲染清单的一行：一件可画的东西＝哪份形状、哪台世界矩阵、哪份材质。 */
export interface RenderItem {
  /** 形状来源：本世界全部物体都是 cube 的各种缩放（createCube 的调用方账）。 */
  readonly mesh: 'cube'
  /** 结算快照：收集时刻的 node.world，直接当模型矩阵。 */
  readonly world: Mat4
  readonly material: Material
}

/**
 * mulberry32：32 位种子随机数发生器——几行算术造出的 [0,1) 均匀序列。
 * 为什么不用 Math.random：它每次调用换一个序列，世界无法重建；种子随机
 * 数把「随机」变成「种子决定的一段固定序列」——同种子同序列，这才有
 * 「按种子重建」。imul 是 32 位整数乘法（带上溢出回绕），>>> 0 把结果
 * 摁回无符号 32 位再除以 2³² 归一到 [0,1)。mulberry32 是业界常见的
 * 极小实现（Tommy Ettinger 公开发布的写法），此处内联并注明来历。
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 地坪半宽：地面是 cube 压扁成的 40×40 地坪，顶面恰在 y=0。 */
const GROUND_HALF = 20
/** 雾的过渡带：near 之内清清楚楚、far 之外全雾色（固定值——雾是气氛不是布局，不随种子变）。 */
const FOG_NEAR = 8
const FOG_FAR = 28

const GROUND_MATERIAL: Material = {
  baseColor: [0.3, 0.55, 0.28],
  ambient: 0.35,
  diffuseK: 0.8,
  specularK: 0.05,
  shininess: 8,
  emissive: 0,
}

const STONE_MATERIAL: Material = {
  baseColor: [0.62, 0.6, 0.57],
  ambient: 0.3,
  diffuseK: 0.85,
  specularK: 0.1,
  shininess: 16,
  emissive: 0,
}

const SUN_MATERIAL: Material = {
  baseColor: [1.0, 0.85, 0.45],
  ambient: 0,
  diffuseK: 0,
  specularK: 0,
  shininess: 1,
  emissive: 1,
}

/** 房子的皮肤选色表：四份现成材质，种子随机数挑着挂（不同房子可同款）。 */
const HOUSE_PALETTE: readonly Material[] = [
  { baseColor: [0.82, 0.42, 0.32], ambient: 0.3, diffuseK: 0.7, specularK: 0.25, shininess: 32, emissive: 0 },
  { baseColor: [0.36, 0.55, 0.78], ambient: 0.3, diffuseK: 0.7, specularK: 0.25, shininess: 32, emissive: 0 },
  { baseColor: [0.8, 0.72, 0.4], ambient: 0.3, diffuseK: 0.7, specularK: 0.2, shininess: 24, emissive: 0 },
  { baseColor: [0.55, 0.42, 0.66], ambient: 0.3, diffuseK: 0.7, specularK: 0.3, shininess: 48, emissive: 0 },
]

const DEG = Math.PI / 180

/**
 * 读节点挂的材质：挂了返回材质包，没挂返回 undefined（根节点这类
 * 「只管层级不画画」的节点就没有）。渲染清单与测试都从它取货。
 */
export function materialOf(node: SceneNode): Material | undefined {
  return node.data as Material | undefined
}

/**
 * 装配一个世界：一个种子数进、一棵结算就绪的场景树出。
 *
 * 布局的全部随机性来自种子序列，依次消费（顺序即承诺，同种子逐位复现）：
 * 太阳方位/距离/高度 → 柱廊根数/朝向/半径 → 每根柱的半径微差与高度 →
 * 每栋房的方位/距离/宽深高与选色 → 入口方位/距离/高度。
 *
 * 各件物体都是 cube（[-1,1]³）配一台局部矩阵：先缩放定形、再平移落位
 * （multiply(translate, scale)：坐标先过缩放、再过平移，第 5 章的顺序账）
 * ——柱子是拉高的 cube、房子是矮胖的 cube、地面是压扁成 40×40 的 cube、
 * 太阳是缩小的自发光 cube。每件挂一份材质（data 字段），柱廊全体共享
 * 同一份石头材质对象。
 */
export function createWorld(seed: number): World {
  const rng = mulberry32(seed)
  const root = new SceneNode()

  // 地面：S(20, 0.5, 20) 把 cube 压成 40×40×1 的地坪，T(0,-0.5,0) 把
  // 顶面摁到 y=0——世界里的「地面高度」从此有个共同的零点。
  const ground = new SceneNode(
    multiply(translate(0, -0.5, 0), scale(GROUND_HALF, 0.5, GROUND_HALF)),
  )
  ground.data = GROUND_MATERIAL
  root.add(ground)

  // 太阳：位置由种子定（高度 10..16、水平距离 15..23），材质自发光——
  // 它不靠光照亮，它自己亮；世界坐标另存一份（sunPosition）喂光源 uniform。
  const sunAzimuthDeg = rng() * 360
  const sunDistance = 15 + rng() * 8
  const sunHeight = 10 + rng() * 6
  const sunAz = sunAzimuthDeg * DEG
  const sunPosition: Vec3 = [
    Math.sin(sunAz) * sunDistance,
    sunHeight,
    Math.cos(sunAz) * sunDistance,
  ]
  const sun = new SceneNode(multiply(translate(sunPosition[0], sunPosition[1], sunPosition[2]), scale(1.4, 1.4, 1.4)))
  sun.data = SUN_MATERIAL
  root.add(sun)

  // 柱廊：7..11 根石柱排成一段圆弧——弧心朝向与半径由种子定，柱距 6°，
  // 每根柱沿半径有 ±0.4 的微差、高度 2.5..4.5，避免一排柱子像复制的一张面。
  const columnCount = 7 + Math.floor(rng() * 5)
  const arcadeAzimuthDeg = rng() * 360
  const arcadeRadius = 6 + rng() * 4
  for (let i = 0; i < columnCount; i++) {
    const angleDeg = arcadeAzimuthDeg + (i - (columnCount - 1) / 2) * 6
    const angle = angleDeg * DEG
    const radius = arcadeRadius + (rng() - 0.5) * 0.8
    const height = 2.5 + rng() * 2
    const x = Math.sin(angle) * radius
    const z = Math.cos(angle) * radius
    // cube 高 2，缩放 height/2 得高 height；平移 height/2 让柱脚落地（y=0）。
    const column = new SceneNode(multiply(translate(x, height / 2, z), scale(0.55, height / 2, 0.55)))
    column.data = STONE_MATERIAL
    root.add(column)
  }

  // 房子：3..6 栋散在外圈（距离 9..16、方位由种子定），宽深 3..6、高
  // 2.4..6，从四份现成材质里挑一份挂上。
  const houseCount = 3 + Math.floor(rng() * 4)
  for (let i = 0; i < houseCount; i++) {
    const angle = rng() * 360 * DEG
    const radius = 9 + rng() * 7
    const halfW = 1.5 + rng() * 1.5
    const halfD = 1.5 + rng() * 1.5
    const height = 2.4 + rng() * 3.6
    const x = Math.sin(angle) * radius
    const z = Math.cos(angle) * radius
    const house = new SceneNode(multiply(translate(x, height / 2, z), scale(halfW, height / 2, halfD)))
    house.data = HOUSE_PALETTE[Math.floor(rng() * HOUSE_PALETTE.length)]
    root.add(house)
  }

  // 相机入口：站在外圈（水平距 13..16、高 3..4.5）朝世界中心看——
  // yaw 由眼位反推（forward = (-sin yaw, 0, -cos yaw) 指向原点解出 yaw）。
  const entryAz = rng() * 360 * DEG
  const entryRadius = 13 + rng() * 3
  const entryEye: Vec3 = [
    Math.sin(entryAz) * entryRadius,
    3 + rng() * 1.5,
    Math.cos(entryAz) * entryRadius,
  ]
  const yawDeg = (Math.atan2(entryEye[0], entryEye[2]) * 180) / Math.PI

  return {
    root,
    fog: { color: [0.75, 0.82, 0.9], near: FOG_NEAR, far: FOG_FAR },
    sunPosition,
    entry: { eye: entryEye, yawDeg, pitchDeg: 0 },
  }
}

/**
 * 渲染清单：深度优先走一遍场景树，把挂了材质的节点收成
 * (mesh, world, material) 三元组数组——「每帧画什么」的全部答案。
 *
 * 与「每个物体一段绘制代码」的差别就在这里：绘制循环只认清单行，不认
 * 具体物体；加一根柱子不需要新写一段绘制代码，只要世界清单里多一行。
 * world 收集的是结算时刻的快照（node.world 的引用）——先 root.updateWorld()
 * 再收清单，一帧一结算；清单本身只读不改树。
 */
export function collectRenderList(root: SceneNode): RenderItem[] {
  const items: RenderItem[] = []
  const walk = (node: SceneNode): void => {
    const material = materialOf(node)
    if (material) items.push({ mesh: 'cube', world: node.world, material })
    for (const child of node.children) walk(child)
  }
  walk(root)
  return items
}
