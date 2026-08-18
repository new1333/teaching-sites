import { describe, expect, it } from 'vitest'
import { transformPoint } from '../src/math/mat4'
import { smoothstep } from '../src/math/interpolate'
import { dot, normalize } from '../src/math/vec3'
import { viewBasis } from '../src/scene/camera'
import type { SceneNode } from '../src/scene/node'
import { collectRenderList, createWorld, materialOf } from '../src/world/world'
import type { Material } from '../src/world/world'

// 第 13 章里程碑：world/world——createWorld(seed) 用种子随机数确定性装配一棵
// 场景树（地面 + 太阳 + 柱廊 + 房子，各挂 Phong 材质参数包），雾参数与相机
// 入口随世界一并交付；collectRenderList 遍历树把 (mesh, world, material)
// 三元组收成渲染清单。两条契约先立后验：
// - 确定性：同 seed 两次调用，节点数、每个节点的 local 矩阵与材质逐元素
//   一致（种子是世界的全部真相——游戏「按种子重建地图」的账）；不同 seed
//   布局不同；
// - 量级声明（JSDoc 同款）：children 顺序＝地面、太阳、柱（7..11 根）、
//   房子（3..6 栋），节点总数 13..20、深度 1（根下一层）；地面是 40×40
//   地坪（顶面 y=0）；雾 near=8、far=28——距眼 20 的混色比例由第 3 章
//   smoothstep 对账 0.648。

interface FlatNode {
  node: SceneNode
  depth: number
  material: Material | undefined
}

/** 深度优先摊平场景树（与遍历绘制同款走法），带深度与材质读数。 */
function flatten(root: SceneNode): FlatNode[] {
  const out: FlatNode[] = []
  const walk = (node: SceneNode, depth: number): void => {
    out.push({ node, depth, material: materialOf(node) })
    for (const child of node.children) walk(child, depth + 1)
  }
  walk(root, 0)
  return out
}

describe('createWorld：确定性——同种子同世界', () => {
  it('同 seed 两次生成：节点数、深度、每个节点的 local 与材质逐元素一致', () => {
    const a = flatten(createWorld(7).root)
    const b = flatten(createWorld(7).root)
    expect(a.length).toBe(b.length)
    for (let i = 0; i < a.length; i++) {
      expect(a[i].depth).toBe(b[i].depth)
      // local 是同一串种子随机数驱动的同一串矩阵乘法——逐元素对账（16 格）。
      for (let k = 0; k < 16; k++) expect(a[i].node.local[k]).toBeCloseTo(b[i].node.local[k], 6)
      const ma = a[i].material
      const mb = b[i].material
      expect(ma === undefined).toBe(mb === undefined)
      if (ma && mb) {
        for (let c = 0; c < 3; c++) expect(ma.baseColor[c]).toBeCloseTo(mb.baseColor[c], 6)
        expect(ma.ambient).toBeCloseTo(mb.ambient, 6)
        expect(ma.diffuseK).toBeCloseTo(mb.diffuseK, 6)
        expect(ma.specularK).toBeCloseTo(mb.specularK, 6)
        expect(ma.shininess).toBeCloseTo(mb.shininess, 6)
        expect(ma.emissive).toBeCloseTo(mb.emissive, 6)
      }
    }
  })

  it('同 seed 的雾参数与相机入口也一致；雾固定 near=8、far=28', () => {
    const a = createWorld(42)
    const b = createWorld(42)
    for (let c = 0; c < 3; c++) expect(a.fog.color[c]).toBeCloseTo(b.fog.color[c], 6)
    expect(a.fog.near).toBe(b.fog.near)
    expect(a.fog.far).toBe(b.fog.far)
    expect(a.entry.eye[0]).toBeCloseTo(b.entry.eye[0], 6)
    expect(a.entry.eye[1]).toBeCloseTo(b.entry.eye[1], 6)
    expect(a.entry.eye[2]).toBeCloseTo(b.entry.eye[2], 6)
    expect(a.entry.yawDeg).toBeCloseTo(b.entry.yawDeg, 6)
    expect(a.entry.pitchDeg).toBeCloseTo(b.entry.pitchDeg, 6)
  })

  it('不同 seed 布局不同：同一顺位的 local 矩阵不再重合', () => {
    const a = flatten(createWorld(7).root)
    const b = flatten(createWorld(8).root)
    // 摊成一行字符串比对：种子换了，柱子的高度/房子的位置至少有一处动过。
    const row = (list: FlatNode[]): string =>
      list.map((f) => Array.from(f.node.local).map((x) => x.toFixed(4)).join(',')).join(';')
    expect(row(a)).not.toBe(row(b))
  })
})

describe('地面与结构量级', () => {
  it('地面是 40×40 的地坪：cube 顶面角点 (±1,1,±1) 落到 (±20, 0, ±20)', () => {
    const world = createWorld(7)
    world.root.updateWorld()
    // children 顺序是声明：第 0 个是地面（cube 压扁：S(20,0.5,20) 再压到顶面 y=0）。
    const ground = world.root.children[0]
    const corner = transformPoint(ground.world, [1, 1, 1])
    expect(corner[0]).toBeCloseTo(20, 4)
    expect(corner[1]).toBeCloseTo(0, 4)
    expect(corner[2]).toBeCloseTo(20, 4)
    const far = transformPoint(ground.world, [-1, 1, -1])
    expect(far[0]).toBeCloseTo(-20, 4)
    expect(far[1]).toBeCloseTo(0, 4)
    expect(far[2]).toBeCloseTo(-20, 4)
  })

  it('节点总数 13..20、最大深度 1（根下一层）——多个种子都在量级内', () => {
    for (const seed of [1, 7, 42, 2026]) {
      const flat = flatten(createWorld(seed).root)
      expect(flat.length).toBeGreaterThanOrEqual(13)
      expect(flat.length).toBeLessThanOrEqual(20)
      expect(Math.max(...flat.map((f) => f.depth))).toBe(1)
    }
  })

  it('太阳节点：自发光材质（emissive=1），位置在地面上空、水平距离合理', () => {
    const world = createWorld(7)
    world.root.updateWorld()
    const sun = flatten(world.root).find((f) => (f.material?.emissive ?? 0) > 0.99)
    expect(sun).toBeDefined()
    const pos = transformPoint(sun!.node.world, [0, 0, 0])
    // 声明的量级：高度 10..16、水平距离 15..23——挂在天上，也在 40×40 地坪上方。
    expect(pos[1]).toBeGreaterThan(10)
    expect(pos[1]).toBeLessThan(16)
    const horizontal = Math.sqrt(pos[0] * pos[0] + pos[2] * pos[2])
    expect(horizontal).toBeGreaterThan(14)
    expect(horizontal).toBeLessThan(24)
  })
})

describe('材质与雾', () => {
  it('所有材质强度在 [0,1]、颜色分量在 [0,1]、shininess ≥ 1', () => {
    for (const seed of [1, 7, 42]) {
      for (const f of flatten(createWorld(seed).root)) {
        const m = f.material
        if (!m) continue
        for (const c of m.baseColor) {
          expect(c).toBeGreaterThanOrEqual(0)
          expect(c).toBeLessThanOrEqual(1)
        }
        for (const k of [m.ambient, m.diffuseK, m.specularK, m.emissive]) {
          expect(k).toBeGreaterThanOrEqual(0)
          expect(k).toBeLessThanOrEqual(1)
        }
        expect(m.shininess).toBeGreaterThanOrEqual(1)
      }
    }
  })

  it('雾按距离混色的承重演算：距眼 20 在 near=8/far=28 里混 64.8%', () => {
    // 手算（与 GLSL 的 smoothstep(near, far, dist) 同一条公式）：
    //   t = (20 − 8) / (28 − 8) = 0.6
    //   factor = t²·(3 − 2t) = 0.36 × 1.8 = 0.648
    // 片元着色器里 mix(color, fogColor, factor) 的 factor 就是它。
    const fog = createWorld(7).fog
    expect(fog.near).toBe(8)
    expect(fog.far).toBe(28)
    expect(smoothstep(fog.near, fog.far, 20)).toBeCloseTo(0.648, 3)
  })
})

describe('相机入口与渲染清单', () => {
  it('入口眼位在场景外圈（水平距 13..16、高 3..4.5），yaw 朝向场景中心', () => {
    const entry = createWorld(7).entry
    const horizontal = Math.sqrt(entry.eye[0] ** 2 + entry.eye[2] ** 2)
    expect(horizontal).toBeGreaterThan(12)
    expect(horizontal).toBeLessThan(17)
    expect(entry.eye[1]).toBeGreaterThan(2.5)
    expect(entry.eye[1]).toBeLessThan(5)
    // 朝向账（第 12 章 viewBasis 复工）：yaw 配平视的 forward 应指向原点。
    const basis = viewBasis(entry.yawDeg, 0)
    const toCenter = normalize([-entry.eye[0], 0, -entry.eye[2]])
    expect(dot(basis.forward, toCenter)).toBeCloseTo(1, 3)
  })

  it('渲染清单：长度 = 挂材质的节点数，首件是地面，mesh 一律是 cube', () => {
    const world = createWorld(7)
    world.root.updateWorld()
    const flat = flatten(world.root)
    const withMaterial = flat.filter((f) => f.material !== undefined)
    const list = collectRenderList(world.root)
    expect(list.length).toBe(withMaterial.length)
    expect(list.length).toBe(flat.length - 1) // 只有根节点不画
    for (const item of list) expect(item.mesh).toBe('cube')
    // 首件＝地面：清单里拿到的 world 就是结算快照，角点对账同前。
    const corner = transformPoint(list[0].world, [1, 1, 1])
    expect(corner[0]).toBeCloseTo(20, 4)
    expect(corner[1]).toBeCloseTo(0, 4)
    expect(corner[2]).toBeCloseTo(20, 4)
    // 清单是收集时刻的快照：再收一次得到同样的一份（只读不改树）。
    const again = collectRenderList(world.root)
    expect(again.length).toBe(list.length)
    expect(transformPoint(again[0].world, [1, 1, 1])[0]).toBeCloseTo(20, 4)
  })
})
