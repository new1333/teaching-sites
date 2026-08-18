/**
 * 相机控制——把「开相机」从手填三要素升级成拖拽与键盘。
 *
 * 第 7 章解决了「眼在哪、看哪、头正不正」怎么变成一台视图矩阵（lookAt），
 * 但三要素当时靠滑杆手填。真实交互里它们来自两套习惯：
 * - 轨道相机（orbit camera）——绕着目标点沿球面转圈的查看方式：像绕着
 *   雕塑走一圈看它，眼位用球坐标（方位角/极角/半径）描述，target 固定
 *   交给 lookAt；
 * - 漫游相机（walk camera）——站在场景里走的查看方式：yaw/pitch 只管
 *   转头点头（朝向），移动沿相机自己的前/右基向量，不沿世界轴。
 *
 * 两种相机共用同一条纪律：角度是唯一的状态，眼位与基向量每帧从角度现
 * 造——拖拽只改角度，姿态随改随建，不存在「上一帧的姿态」被累积，方
 * 向永不翻车。极角与俯仰角各有收拢边界，躲开退化位（up 与视线平行时
 * lookAt/基向量归零，第 7 章算过这笔账）。
 *
 * 本模块纯函数，角度一律用度数——拖拽增量与读数都是度数，弧度只住在
 * 函数体内（喂 Math.sin/cos 前换算一次）。
 */

import { clamp } from '../math/interpolate'
import { cross, normalize } from '../math/vec3'
import type { Vec3 } from '../math/vec3'

/** 轨道极角下界：离正头顶的「极点」至少留 1°——极点上 up=(0,1,0) 与视线平行，lookAt 退化。 */
export const ORBIT_POLAR_MIN_DEG = 1
/** 轨道极角上界：90°＝贴地平视——地面底下没有可看的东西，拖过头就贴着地滑。 */
export const ORBIT_POLAR_MAX_DEG = 90
/** 俯仰角界限：±89°，离正头顶/正脚下各留 1°——forward 竖直时 cross(forward, 上) 归零、基向量退化。 */
export const PITCH_LIMIT_DEG = 89

/**
 * 球坐标 → 轨道眼位：给定方位角、极角、半径与轨道中心（target），算出
 * 相机站在球面上哪一点。target 原样交给 lookAt 当 center，up 照旧
 * (0,1,0)——第 7 章的机器一行不用改。
 *
 * 角度用度数，约定（手性与第 5 章 rotY 一致）：
 * - 方位角 azimuthDeg 绕 Y 轴：0°＝站在 +Z 一侧，90°＝转到 +X——
 *   eye = target + r·(sin p·sin a, cos p, sin p·cos a)；
 * - 极角 polarDeg 从 +Y 量起：0°＝正头顶，90°＝贴地平视，180°＝正脚下。
 *
 * 极角越界收拢进 [1°, 90°]（clamp 的活）：下界离极点留 1°——极点上
 * up 与视线平行，lookAt 退化；上界 90°＝贴地，轨道场景的地面底下没有
 * 可看的东西。方位角不收拢：绕一圈回到原地，三角函数天然周期。半径
 * 不收拢：缩放边界（最小/最大距离）是场景设计决定，由调用方负责。
 *
 * 手算样例（tests/camera-controls.test.ts 逐位对账）：
 *   orbitEye(0°, 90°, 5)  = (0, 0, 5)        贴地站在 +Z，平视原点
 *   orbitEye(90°, 90°, 5) = (5, 0, 0)        方位角转到 +X
 *   orbitEye(0°, 60°, 4)  = (0, 2, 3.464)    y=4·cos60°、z=4·sin60°
 *   orbitEye(0°, 0°, 5)   = (0, 4.9992, 0.0873)  极角收拢到 1°
 *   orbitEye(0°, 90°, 3, [1,2,3]) = (1, 2, 6)  target 平移整颗球
 */
export function orbitEye(
  azimuthDeg: number,
  polarDeg: number,
  radius: number,
  target: Vec3 = [0, 0, 0],
): Vec3 {
  const azimuth = (azimuthDeg * Math.PI) / 180
  const polar = (clamp(polarDeg, ORBIT_POLAR_MIN_DEG, ORBIT_POLAR_MAX_DEG) * Math.PI) / 180
  return [
    target[0] + radius * Math.sin(polar) * Math.sin(azimuth),
    target[1] + radius * Math.cos(polar),
    target[2] + radius * Math.sin(polar) * Math.cos(azimuth),
  ]
}

/** 相机基向量：两两垂直、各自单位长的前/右/上——相机的三根轴在世界里的读数。 */
export interface CameraBasis {
  /** 画面深处的方向（视线）：W/S 沿它走，lookAt 的 center 由 eye+forward 得到。 */
  forward: Vec3
  /** 相机右手边的方向：D/A 沿它走。 */
  right: Vec3
  /** 相机头顶的方向：喂给 lookAt 当 up（已经扶正，与 forward 严格垂直）。 */
  up: Vec3
}

/**
 * yaw/pitch → 相机基向量：forward（画面深处）、right（右手边）、up（头顶）
 * 三根两两垂直的单位向量。漫游相机的朝向与移动全从它们出发：
 * lookAt(eye, eye+forward, up) 出视图矩阵，W/S 沿 forward、D/A 沿 right。
 *
 * 角度用度数，两个角各管一个动作：
 * - 偏航角 yawDeg——左右转头：绕世界 Y 轴，正方向与第 5 章 rotY 一致
 *   （右手定则，俯视时逆时针；yaw=90° 后 forward 从 -Z 转到 -X）；
 * - 俯仰角 pitchDeg——上下点头：抬头为正、低头为负。
 *
 * 组合顺序固定「先 pitch 后 yaw」：forward = R_y(yaw)·R_x(pitch)·(0,0,-1)
 * ——坐标先过 R_x（在初始朝向 -Z 上点头），再过 R_y（整体转头）；等价
 * 的读法是 yaw 住世界 Y 轴、pitch 住转身之后自己的额头。顺序换了结果
 * 就变（R_y·R_x ≠ R_x·R_y）：把 pitch 放到外层＝点头住世界 X 轴，转身
 * 180° 后再「抬头」画面反而朝下——拖拽翻车的账就在这一步。固定顺序、
 * 每帧从 (yaw, pitch) 现造 forward，两个角就永远不会互相搅局。
 *
 * right = normalize(cross(forward, (0,1,0)))、up = cross(right, forward)
 * ——与第 7 章 lookAt 造 f/s/u 同一套手艺，只是这里从角度出发、lookAt
 * 从目标点出发。俯仰角收拢进 ±89°（clamp 的活）：离正头顶/正脚下各留
 * 1°，否则 forward 竖直、cross 归零，基向量退化——与 orbitEye 的极角
 * 收拢同理。yaw 不收拢：绕一圈回原方向。
 *
 * 手算样例（tests/camera-controls.test.ts 逐位对账）：
 *   viewBasis(0°, 0°)   forward=(0,0,-1)、right=(1,0,0)、up=(0,1,0)
 *   viewBasis(90°, 0°)  forward=(-1,0,0)、right=(0,0,-1)、up=(0,1,0)
 *   viewBasis(0°, 30°)  forward=(0, 0.5, -0.866)——pitch 上抬、y 分量为正
 */
export function viewBasis(yawDeg: number, pitchDeg: number): CameraBasis {
  const yaw = (yawDeg * Math.PI) / 180
  const pitch = (clamp(pitchDeg, -PITCH_LIMIT_DEG, PITCH_LIMIT_DEG) * Math.PI) / 180
  // 先 pitch 后 yaw 的固定顺序（见 JSDoc）：yaw 住世界 Y、pitch 住额头。
  const forward: Vec3 = [
    -Math.cos(pitch) * Math.sin(yaw),
    Math.sin(pitch),
    -Math.cos(pitch) * Math.cos(yaw),
  ]
  const right = normalize(cross(forward, [0, 1, 0]))
  const up = cross(right, forward)
  return { forward, right, up }
}
