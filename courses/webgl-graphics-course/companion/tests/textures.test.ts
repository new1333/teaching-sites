import { describe, expect, it } from 'vitest'
import { checkerboard } from '../src/texture/procedural'
import { createCube } from '../src/geometry/cube'

// 第 9 章里程碑：texture/procedural——程序化纹理数据（代码即图案）。
// checkerboard(size, cells) 返回 RGBA 逐像素的 Uint8Array，长度 = size²×4。
// 原点约定（承重，正是「上下颠倒」痛点的账）：数组第 0 行 = UV 的 v=0 行
// = 纹理的底边——UV 原点在左下角，下标 (0,0) 是左下角像素。图片文件的
// 存储习惯正相反（第 0 行是顶行），所以直接上传图片文件而不开
// UNPACK_FLIP_Y_WEBGL 时顶行落到底边、整张贴图上下颠倒；本函数按 UV
// 约定生成，直接上传即正立。
// 颜色约定：格 (0,0)（左下角）为黑 (0,0,0,255)，相邻格互反——
// (cx+cy) 偶为黑、奇为白；黑白格数沿每条边都是 cells。
// 数值全部手算可得：格边 = size/cells，颜色只有 0/255 两档。

const BLACK = [0, 0, 0, 255] as const
const WHITE = [255, 255, 255, 255] as const

/** 按约定取像素：x 向右、y 向上，(0,0) 是左下角（数组第 0 行 = 底行）。 */
function px(
  data: Uint8Array,
  size: number,
  x: number,
  y: number,
): readonly [number, number, number, number] {
  const o = (y * size + x) * 4
  return [data[o], data[o + 1], data[o + 2], data[o + 3]]
}

/** 像素落在第几格：格边 = size / cells，整除取格号。 */
function cellOf(x: number, y: number, size: number, cells: number): number {
  return Math.floor(x / (size / cells))
}

/** 按交错布局取第 v 个顶点的 uv（偏移 6..7，见第 8 章 cube 约定）。 */
function uvAt(vertices: Float32Array, v: number): readonly [number, number] {
  return [vertices[v * 8 + 6], vertices[v * 8 + 7]]
}

describe('checkerboard（程序化棋盘格纹理数据）', () => {
  it('总字节数 = size²×4：多组尺寸对账，且是 Uint8Array', () => {
    expect(checkerboard(8, 4)).toBeInstanceOf(Uint8Array)
    expect(checkerboard(8, 4)).toHaveLength(8 * 8 * 4)
    expect(checkerboard(64, 8)).toHaveLength(64 * 64 * 4)
    expect(checkerboard(12, 3)).toHaveLength(12 * 12 * 4)
  })

  it('像素 (0,0) 为黑 (0,0,0,255)——左下角原点约定；全图 alpha 恒 255', () => {
    const data = checkerboard(8, 4)
    expect(px(data, 8, 0, 0)).toEqual(BLACK)
    for (let i = 3; i < data.length; i += 4) expect(data[i]).toBe(255)
  })

  it('黑白格数与 cells 一致：沿底边一行数颜色段、沿左边一列数颜色段，段数都是 cells', () => {
    for (const [size, cells] of [
      [8, 4],
      [4, 2],
      [12, 3],
    ] as const) {
      const data = checkerboard(size, cells)
      // 底行（y=0）从左到右数颜色段：相邻像素颜色变了就开一段
      let runsRow = 1
      for (let x = 1; x < size; x++) {
        if (px(data, size, x, 0)[0] !== px(data, size, x - 1, 0)[0]) runsRow++
      }
      // 左列（x=0）从下到上数颜色段
      let runsCol = 1
      for (let y = 1; y < size; y++) {
        if (px(data, size, 0, y)[0] !== px(data, size, 0, y - 1)[0]) runsCol++
      }
      expect(runsRow).toBe(cells)
      expect(runsCol).toBe(cells)
    }
  })

  it('相邻格颜色互反：取每格中心像素对账，右邻与上邻都黑白翻转', () => {
    const size = 8
    const cells = 4
    const data = checkerboard(size, cells)
    const center = (cx: number, cy: number): readonly [number, number, number, number] => {
      const edge = size / cells
      return px(data, size, Math.floor((cx + 0.5) * edge), Math.floor((cy + 0.5) * edge))
    }
    for (let cy = 0; cy < cells; cy++) {
      for (let cx = 0; cx < cells; cx++) {
        const here = center(cx, cy)
        const opposite = here[0] === 0 ? WHITE : BLACK // 黑白两档，互反即取另一档
        if (cx + 1 < cells) expect(center(cx + 1, cy)).toEqual(opposite)
        if (cy + 1 < cells) expect(center(cx, cy + 1)).toEqual(opposite)
      }
    }
  })

  it('颜色只有黑白两档；手算样例：4 格纹理里 (1,1) 黑、(3,5) 白', () => {
    const size = 8
    const cells = 4
    const data = checkerboard(size, cells)
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const p = px(data, size, x, y)
        const isBlack = p.every((c, i) => c === BLACK[i])
        const isWhite = p.every((c, i) => c === WHITE[i])
        expect(isBlack || isWhite).toBe(true)
      }
    }
    // (1,1)：格 (0,0)，偶 → 黑；(3,5)：格 (1,2)，奇 → 白——纸上可算
    expect(px(data, size, 1, 1)).toEqual(BLACK)
    expect(px(data, size, 3, 5)).toEqual(WHITE)
    expect(cellOf(1, 1, size, cells)).toBe(0)
    expect(cellOf(3, 5, size, cells)).toBe(1)
  })

  it('cells=1 整张黑：格子数的下限（一维只有一段）', () => {
    const data = checkerboard(8, 1)
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) expect(px(data, 8, x, y)).toEqual(BLACK)
    }
  })
})

describe('cube 的 UV 与纹理对账', () => {
  it('24 个顶点的 UV 全在 [0,1]，遍历六面每面铺满一张完整贴图', () => {
    const { vertices } = createCube()
    for (let v = 0; v < 24; v++) {
      const [u, vCoord] = uvAt(vertices, v)
      expect(u).toBeGreaterThanOrEqual(0)
      expect(u).toBeLessThanOrEqual(1)
      expect(vCoord).toBeGreaterThanOrEqual(0)
      expect(vCoord).toBeLessThanOrEqual(1)
    }
    // 每面 min=0、max=1：一张 [0,1] 的贴图恰好铺满，不多不少
    for (let f = 0; f < 6; f++) {
      for (const c of [0, 1]) {
        let lo = Infinity
        let hi = -Infinity
        for (let i = 0; i < 4; i++) {
          const uv = uvAt(vertices, f * 4 + i)
          lo = Math.min(lo, uv[c])
          hi = Math.max(hi, uv[c])
        }
        expect(lo).toBeCloseTo(0, 6)
        expect(hi).toBeCloseTo(1, 6)
      }
    }
  })

  it('每面四个 UV 按左下→右下→右上→左上依次 (0,0)(1,0)(1,1)(0,1)，贴图无需旋转', () => {
    const { vertices } = createCube()
    const want: readonly (readonly [number, number])[] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]
    for (let f = 0; f < 6; f++) {
      for (let i = 0; i < 4; i++) {
        const uv = uvAt(vertices, f * 4 + i)
        expect(uv[0]).toBeCloseTo(want[i][0], 6)
        expect(uv[1]).toBeCloseTo(want[i][1], 6)
      }
    }
  })
})
