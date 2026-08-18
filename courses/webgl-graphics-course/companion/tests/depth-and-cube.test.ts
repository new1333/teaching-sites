import { describe, expect, it } from 'vitest'
import { cross, dot, length, sub } from '../src/math/vec3'
import { createCube } from '../src/geometry/cube'

// 第 8 章里程碑：geometry/cube——第一个真 3D 物体。
// 单位立方体约定：棱长 2、中心在原点，角点坐标全为 ±1（包围盒恰 [-1,1]³）；
// 每面自带一份法线（单位长度、朝外）与一份 UV（铺满 [0,1]²）——所以是
// 6 面 × 4 顶点 = 24 顶点，不是 8 个角点各一份；顶点数据交错排列
// [px,py,pz, nx,ny,nz, u,v]，每顶点 8 个分量；36 个索引引用这些顶点
// （6 面 × 2 三角 × 3 顶点），从外面看逆时针 = 正面（背面剔除的依据）。
// 数值全部手算可得：坐标 ±1、法线是 ±1/0、UV 是 0/1。

type V3 = readonly [number, number, number]

/** 六个面的期望法线：±X ±Y ±Z（与面数据表同序）。 */
const FACE_NORMALS: readonly V3[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
]

/** 按交错布局取第 v 个顶点：position 在 0..2、normal 在 3..5、uv 在 6..7。 */
function vertexAt(vertices: Float32Array, v: number): {
  pos: V3
  nrm: V3
  uv: readonly [number, number]
} {
  const o = v * 8
  return {
    pos: [vertices[o], vertices[o + 1], vertices[o + 2]],
    nrm: [vertices[o + 3], vertices[o + 4], vertices[o + 5]],
    uv: [vertices[o + 6], vertices[o + 7]],
  }
}

describe('createCube（单位立方体：24 顶点交错 + 36 索引）', () => {
  it('24 顶点 × 8 分量 = 192；步长 8（position 3 + normal 3 + uv 2）；36 索引', () => {
    const cube = createCube()
    expect(cube.vertices).toBeInstanceOf(Float32Array)
    expect(cube.vertices).toHaveLength(24 * 8)
    expect(cube.stride).toBe(8)
    expect(cube.indices).toBeInstanceOf(Uint16Array)
    expect(cube.indices).toHaveLength(36)
  })

  it('索引全部落在 [0, 24) 且无空洞：24 个顶点每个都被引用', () => {
    const { indices } = createCube()
    const seen = new Set<number>()
    for (const i of indices) {
      expect(Number.isInteger(i)).toBe(true)
      expect(i).toBeGreaterThanOrEqual(0)
      expect(i).toBeLessThan(24)
      seen.add(i)
    }
    // 36 个索引是 12 个三角 × 3 顶点；每个顶点都该被至少一个三角用到
    expect(seen.size).toBe(24)
  })

  it('每面法线是单位向量且朝外：±X ±Y ±Z 六个面代表点对账', () => {
    const { vertices } = createCube()
    for (let f = 0; f < 6; f++) {
      const { nrm, pos } = vertexAt(vertices, f * 4) // 每面第一个顶点当代表
      expect(length(nrm)).toBeCloseTo(1, 4) // 单位向量
      for (let a = 0; a < 3; a++) expect(nrm[a]).toBeCloseTo(FACE_NORMALS[f][a], 4)
      // 朝外：法线与面上任意一点（减去中心=原点）的点积为正
      expect(dot(nrm, pos)).toBeGreaterThan(0)
    }
  })

  it('24 顶点按 6 面 × 4 顶点分组可对账：面内法线一致、都贴在面平面上', () => {
    const { vertices } = createCube()
    for (let f = 0; f < 6; f++) {
      const n = FACE_NORMALS[f]
      const axis = n.findIndex((c) => c !== 0)
      for (let i = 0; i < 4; i++) {
        const { pos, nrm } = vertexAt(vertices, f * 4 + i)
        for (let a = 0; a < 3; a++) expect(nrm[a]).toBeCloseTo(n[a], 4)
        // 贴在面平面上：沿法线那根轴的坐标恰为 ±1（其余两轴在包围盒测试里查）
        expect(pos[axis]).toBeCloseTo(n[axis], 4)
      }
    }
  })

  it('每面的 4 个顶点恰是该面的 4 个角（集合对账，不依赖排列顺序）', () => {
    const { vertices } = createCube()
    for (let f = 0; f < 6; f++) {
      const n = FACE_NORMALS[f]
      const axis = n.findIndex((c) => c !== 0)
      // 期望的 4 个角：法线轴坐标固定 ±1，另外两轴取遍 ±1 的四种组合
      const want = new Set<string>()
      for (const a of [-1, 1])
        for (const b of [-1, 1]) {
          const p = [0, 0, 0]
          p[axis] = n[axis]
          p[(axis + 1) % 3] = a
          p[(axis + 2) % 3] = b
          want.add(p.join(','))
        }
      for (let i = 0; i < 4; i++) {
        const { pos } = vertexAt(vertices, f * 4 + i)
        expect(want.has([...pos].join(','))).toBe(true)
      }
    }
  })

  it('缠绕方向：每面前三个顶点两邻边的叉积指向面外（从外面看逆时针 = 正面）', () => {
    const { vertices } = createCube()
    for (let f = 0; f < 6; f++) {
      const c0 = vertexAt(vertices, f * 4).pos
      const c1 = vertexAt(vertices, f * 4 + 1).pos
      const c2 = vertexAt(vertices, f * 4 + 2).pos
      // 几何法线 = (c1−c0) × (c2−c1)，与面法线同向则顶点从外面看逆时针
      const geom = cross(sub(c1, c0), sub(c2, c1))
      expect(dot(geom, FACE_NORMALS[f])).toBeGreaterThan(0)
    }
  })

  it('索引按面分组：第 f 张面的 6 个索引全落在 [4f, 4f+4)，不跨面串顶点', () => {
    const { indices } = createCube()
    for (let f = 0; f < 6; f++) {
      for (let t = 0; t < 6; t++) {
        const i = indices[f * 6 + t]
        expect(i).toBeGreaterThanOrEqual(f * 4)
        expect(i).toBeLessThan(f * 4 + 4)
      }
    }
  })

  it('包围盒恰为 [-1,1]³：三根轴各自 min=-1、max=1', () => {
    const { vertices } = createCube()
    const min = [Infinity, Infinity, Infinity]
    const max = [-Infinity, -Infinity, -Infinity]
    for (let v = 0; v < 24; v++) {
      const { pos } = vertexAt(vertices, v)
      for (let a = 0; a < 3; a++) {
        min[a] = Math.min(min[a], pos[a])
        max[a] = Math.max(max[a], pos[a])
      }
    }
    for (let a = 0; a < 3; a++) {
      expect(min[a]).toBeCloseTo(-1, 4)
      expect(max[a]).toBeCloseTo(1, 4)
    }
  })

  it('UV 每面铺满 [0,1]：面内 4 个 UV 的 u、v 各自 min=0、max=1', () => {
    const { vertices } = createCube()
    for (let f = 0; f < 6; f++) {
      for (const c of [0, 1]) {
        let lo = Infinity
        let hi = -Infinity
        for (let i = 0; i < 4; i++) {
          const uv = vertexAt(vertices, f * 4 + i).uv
          lo = Math.min(lo, uv[c])
          hi = Math.max(hi, uv[c])
          expect(uv[c]).toBeGreaterThanOrEqual(0)
          expect(uv[c]).toBeLessThanOrEqual(1)
        }
        expect(lo).toBeCloseTo(0, 4)
        expect(hi).toBeCloseTo(1, 4)
      }
    }
  })
})
