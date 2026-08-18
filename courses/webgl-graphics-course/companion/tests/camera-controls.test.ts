import { describe, expect, it } from 'vitest'
import { add, dot, length, scale, sub } from '../src/math/vec3'
import { lookAt, transformPoint } from '../src/math/mat4'
import { orbitEye, viewBasis } from '../src/scene/camera'

// 第 12 章里程碑：scene/camera——orbitEye（球坐标→眼位）与 viewBasis
// （yaw/pitch→前/右/上三根相机基向量）。两条约定先立后算：
// - 球坐标：方位角绕 Y 轴（0° 眼在 +Z、90° 眼在 +X，与第 5 章 rotY 同一
//   手性）；极角从 +Y 量起（0°＝正头顶、90°＝贴地平视）。极角越界收拢：
//   离极点至少 1°（极点上 up 与视线平行，lookAt 退化——第 7 章的账），
//   至多 90°（贴地，不钻进地面底下）。
// - viewBasis：yaw/pitch 一律度数；组合顺序固定「先 pitch 后 yaw」——
//   yaw 住世界 Y 轴、pitch 住转身后自己的额头，转多少度点头都跟着走。
// 数值全部手算可得：90° 恰好落轴、30° 出 0.5、1° 的收拢边界逐位对账。

describe('orbitEye：球坐标 → 轨道眼位', () => {
  it('方位角 0°、极角 90°：眼位在 +Z 轴上，贴地平视原点', () => {
    // 手算：eye = r·(sin90°·sin0°, cos90°, sin90°·cos0°) = 5·(0, 0, 1)。
    // 极角 90°＝地平圈：眼与 target 同高；方位角 0°＝站在 +Z 一侧。
    const eye = orbitEye(0, 90, 5)
    expect(eye[0]).toBeCloseTo(0, 4)
    expect(eye[1]).toBeCloseTo(0, 4)
    expect(eye[2]).toBeCloseTo(5, 4)
  })

  it('方位角 90°：眼位落到 +X；极角 60°：y 与 z 各占 cos/sin 一份', () => {
    // 手算一：eye = 5·(sin90°·sin90°, cos90°, sin90°·cos90°) = (5, 0, 0)。
    const x = orbitEye(90, 90, 5)
    expect(x[0]).toBeCloseTo(5, 4)
    expect(x[1]).toBeCloseTo(0, 4)
    expect(x[2]).toBeCloseTo(0, 4)
    // 手算二：orbitEye(0°, 60°, 4)——y = 4·cos60° = 2、z = 4·sin60° = 2√3。
    const slant = orbitEye(0, 60, 4)
    expect(slant[0]).toBeCloseTo(0, 4)
    expect(slant[1]).toBeCloseTo(2, 4)
    expect(slant[2]).toBeCloseTo(3.4641, 4)
  })

  it('target 把整颗球平移：眼位 = target + 球面偏移', () => {
    // 手算：球面偏移 (0,0,3) + target (1,2,3) = (1, 2, 6)。
    const eye = orbitEye(0, 90, 3, [1, 2, 3])
    expect(eye[0]).toBeCloseTo(1, 4)
    expect(eye[1]).toBeCloseTo(2, 4)
    expect(eye[2]).toBeCloseTo(6, 4)
  })

  it('极角越界收拢：0° 收到 1°（不穿极点），135° 收到 90°（贴地不钻地下）', () => {
    // 手算：极角 0° 收拢到 1°——y = 5·cos1° = 4.9992、z = 5·sin1° = 0.0873。
    // 眼位离极点还差 1°，up=(0,1,0) 与视线不平行，lookAt 有救。
    const top = orbitEye(0, 0, 5)
    expect(top[0]).toBeCloseTo(0, 4)
    expect(top[1]).toBeCloseTo(4.9992, 4)
    expect(top[2]).toBeCloseTo(0.0873, 4)
    expect(top[1]).toBeGreaterThan(4.99)
    // 极角 135° 收拢到 90°——眼位贴地 (4, 0, 0)，永远不钻到地面底下。
    const under = orbitEye(90, 135, 4)
    expect(under[0]).toBeCloseTo(4, 4)
    expect(under[1]).toBeCloseTo(0, 4)
    expect(under[2]).toBeCloseTo(0, 4)
    // 负极角同样收拢到 1°——两条边界都由 orbitEye 自己守。
    const neg = orbitEye(0, -30, 5)
    expect(neg[1]).toBeCloseTo(4.9992, 4)
    expect(neg[2]).toBeCloseTo(0.0873, 4)
  })

  it('轨道眼位直接喂第 7 章 lookAt：轨道中心落到正前方 r 格', () => {
    // 轨道相机的全部接线：orbitEye 出眼位，target 当 center，up 照旧——
    // 眼在 (0,0,5) 看原点，原点落视图 (0,0,-5)（第 7 章的手算样例原地复活）。
    const eye = orbitEye(0, 90, 5)
    const V = lookAt(eye, [0, 0, 0], [0, 1, 0])
    const p = transformPoint(V, [0, 0, 0])
    expect(p[0]).toBeCloseTo(0, 4)
    expect(p[1]).toBeCloseTo(0, 4)
    expect(p[2]).toBeCloseTo(-5, 4)
  })
})

describe('viewBasis：yaw/pitch → 相机基向量', () => {
  it('yaw=0、pitch=0：forward 指向 -Z（画面深处），right=+X，up=+Y', () => {
    const b = viewBasis(0, 0)
    expect(b.forward[0]).toBeCloseTo(0, 4)
    expect(b.forward[1]).toBeCloseTo(0, 4)
    expect(b.forward[2]).toBeCloseTo(-1, 4)
    expect(b.right[0]).toBeCloseTo(1, 4)
    expect(b.right[1]).toBeCloseTo(0, 4)
    expect(b.right[2]).toBeCloseTo(0, 4)
    expect(b.up[1]).toBeCloseTo(1, 4)
  })

  it('yaw 90°：forward 落 -X——第 5 章 rotY(90°) 把 -Z 转到 -X，同一手性', () => {
    // 手算：forward = R_y(90°)·(0,0,-1)。第 5 章账本：rotY(90°) 把 +X 转到
    // -Z、把 -Z 转到 -X——forward 落 (-1,0,0)（初始姿势向左转 90° 后面朝
    // -X）。right = normalize(cross(forward, (0,1,0)))：(-1,0,0)×(0,1,0)
    // = (0·0-0·1, 0·0-(-1)·0, (-1)·1-0·0) = (0,0,-1)——面朝 -X 时右手边
    // 是 -Z。up = cross(right, forward) = (0,1,0)，头还正着。
    const b = viewBasis(90, 0)
    expect(b.forward[0]).toBeCloseTo(-1, 4)
    expect(b.forward[1]).toBeCloseTo(0, 4)
    expect(b.forward[2]).toBeCloseTo(0, 4)
    expect(b.right[0]).toBeCloseTo(0, 4)
    expect(b.right[1]).toBeCloseTo(0, 4)
    expect(b.right[2]).toBeCloseTo(-1, 4)
    expect(b.up[0]).toBeCloseTo(0, 4)
    expect(b.up[1]).toBeCloseTo(1, 4)
    expect(b.up[2]).toBeCloseTo(0, 4)
  })

  it('pitch 上抬为正：30° 时 forward.y = 0.5；低头为负时 y 翻号', () => {
    // 手算：viewBasis(0°, 30°) 的 forward = (0, sin30°, -cos30°)
    // = (0, 0.5, -0.8660)——y 分量为正＝抬头。
    const up30 = viewBasis(0, 30)
    expect(up30.forward[0]).toBeCloseTo(0, 4)
    expect(up30.forward[1]).toBeCloseTo(0.5, 4)
    expect(up30.forward[2]).toBeCloseTo(-0.866, 4)
    const down30 = viewBasis(0, -30)
    expect(down30.forward[1]).toBeCloseTo(-0.5, 4)
  })

  it('三根基向量的出厂性质：两两点积为 0、各自长度 1（斜着也一样）', () => {
    // 与第 7 章 lookAt 的 f/s/u 同一套出厂标准：两两垂直、各自单位长。
    const b = viewBasis(37, -23)
    expect(dot(b.forward, b.right)).toBeCloseTo(0, 4)
    expect(dot(b.right, b.up)).toBeCloseTo(0, 4)
    expect(dot(b.up, b.forward)).toBeCloseTo(0, 4)
    expect(length(b.forward)).toBeCloseTo(1, 4)
    expect(length(b.right)).toBeCloseTo(1, 4)
    expect(length(b.up)).toBeCloseTo(1, 4)
  })

  it('pitch 越界收拢到 ±89°：离正头顶留 1°，基向量不退化', () => {
    // 手算：135° 收拢到 89°——forward = (0, sin89°, -cos89°)
    // = (0, 0.9998, -0.0175)；cross(forward, (0,1,0)) 还有 1° 的水平分量
    // 可用，right = (1,0,0) 照常出厂（正头顶时它会是零向量）。
    const b = viewBasis(0, 135)
    expect(b.forward[0]).toBeCloseTo(0, 4)
    expect(b.forward[1]).toBeCloseTo(0.9998, 4)
    expect(b.forward[2]).toBeCloseTo(-0.0175, 4)
    expect(b.right[0]).toBeCloseTo(1, 4)
    expect(dot(b.right, b.up)).toBeCloseTo(0, 4)
  })
})

describe('漫游移动：沿相机基向量走', () => {
  it('W 前进 = eye + forward·step，S 后退 = eye - forward·step，两者互为反向', () => {
    // 手算：eye (1,2,3)、step 0.5、viewBasis(0,0) 的 forward (0,0,-1)：
    //   W → (1, 2, 3-0.5) = (1, 2, 2.5)   S → (1, 2, 3.5)
    // 一帧一账：移动量 = forward·step，W 与 S 只差一个正负号。
    const b = viewBasis(0, 0)
    const eye = [1, 2, 3] as const
    const step = 0.5
    const w = add(eye, scale(b.forward, step))
    const s = add(eye, scale(b.forward, -step))
    expect(w[2]).toBeCloseTo(2.5, 4)
    expect(s[2]).toBeCloseTo(3.5, 4)
    // 互为反向：w - s = 2·step·forward = (0,0,-1)。
    const diff = sub(w, s)
    expect(diff[0]).toBeCloseTo(0, 4)
    expect(diff[1]).toBeCloseTo(0, 4)
    expect(diff[2]).toBeCloseTo(-1, 4)
    // 转身 90° 后同一双键：forward 变 (-1,0,0)，W 朝 -X 走——
    // 键盘没换意思，换的是相机的朝向。
    const b90 = viewBasis(90, 0)
    const w90 = add([0, 0, 0], scale(b90.forward, 2))
    expect(w90[0]).toBeCloseTo(-2, 4)
    expect(w90[1]).toBeCloseTo(0, 4)
    expect(w90[2]).toBeCloseTo(0, 4)
  })

  it('D 右移 = eye + right·step；right 与 forward 严格垂直（点积为 0）', () => {
    // 手算：viewBasis(90,0) 的 right (0,0,-1)——面朝 -X 时右手边是 -Z；
    // eye (1,1,1) 右移半步 → (1, 1, 1-0.5) = (1, 1, 0.5)。
    const b = viewBasis(90, 0)
    const d = add([1, 1, 1], scale(b.right, 0.5))
    expect(d[0]).toBeCloseTo(1, 4)
    expect(d[1]).toBeCloseTo(1, 4)
    expect(d[2]).toBeCloseTo(0.5, 4)
    // 垂直账：forward·right = 0——抬着头走也一样（斜位 (37°,-23°) 复核）。
    expect(dot(b.forward, b.right)).toBeCloseTo(0, 4)
    const slant = viewBasis(37, -23)
    expect(dot(slant.forward, slant.right)).toBeCloseTo(0, 4)
  })

  it('组合移动沿基向量叠加：W 两步 + D 一步 = eye + forward·2s + right·s', () => {
    // 手算（斜着走）：yaw=0、s=1——forward·2 = (0,0,-2)、right·1 = (1,0,0)，
    // 从原点出发落 (1, 0, -2)。两个基向量各迈各的步、加法接力（第 4 章），
    // 不是沿世界 x/z 轴各爬一段。
    const b = viewBasis(0, 0)
    const moved = add(add([0, 0, 0], scale(b.forward, 2)), scale(b.right, 1))
    expect(moved[0]).toBeCloseTo(1, 4)
    expect(moved[1]).toBeCloseTo(0, 4)
    expect(moved[2]).toBeCloseTo(-2, 4)
    // 转身 90° 后同一串键：forward·2 = (-2,0,0)、right·1 = (0,0,-1)，
    // 落 (-2, 0, -1)——步数不变，基向量换了，走的对角线跟着转。
    const b90 = viewBasis(90, 0)
    const moved90 = add(add([0, 0, 0], scale(b90.forward, 2)), scale(b90.right, 1))
    expect(moved90[0]).toBeCloseTo(-2, 4)
    expect(moved90[1]).toBeCloseTo(0, 4)
    expect(moved90[2]).toBeCloseTo(-1, 4)
  })

  it('漫游相机接线：lookAt(eye, eye+forward, up)——正前方 3 格的点落到视图 z=-3', () => {
    // 漫游相机的全部接线：eye 自己管、center = eye + forward（沿视线前方
    // 随便一个点）、up 用基向量里的 up。眼在 (0,2,8) 平视：正前方 3 格的
    // 世界点 (0,2,5) 落视图 (0, 0, -3)。
    const b = viewBasis(0, 0)
    const eye = [0, 2, 8] as const
    const center = add(eye, b.forward)
    const V = lookAt(eye, center, b.up)
    const p = transformPoint(V, [0, 2, 5])
    expect(p[0]).toBeCloseTo(0, 4)
    expect(p[1]).toBeCloseTo(0, 4)
    expect(p[2]).toBeCloseTo(-3, 4)
  })
})
