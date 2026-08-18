/**
 * 场景树节点——把「层级」装进数据结构，坐标跟着上级走。
 *
 * 前十章每件物体都直接领一台模型矩阵；两件物体一旦有层级关系（月亮绕
 * 地球、地球绕太阳），每帧手算世界坐标就开始打架。SceneNode 把层级写
 * 成父子链：每个节点只描述自己相对父级的变换，世界坐标交给链乘结算。
 *
 * 三本主账各管一摊（另有第 13 章加的可选挂件 data，见字段注释）：
 * - local（局部矩阵）——节点相对父级的变换：月亮的 local 只写「绕地球
 *   转多少、离地球多远」，对太阳公转一无所知；
 * - children——子节点列表，层级关系的全部存储；
 * - world（世界矩阵）——从根链乘到本节点的总变换：world = 父.world ·
 *   local，逐级乘上去（乘法从右往左作用，坐标先过自己的 local、再过
 *   各级父级）。「物体在世界里的最终姿势」读它，直接当模型矩阵用。
 *
 * local 与 world 的分工是本章的核心契约：动画只改 local（每帧重建一台
 * 小矩阵），updateWorld() 一次结算全树（从调用节点起深度优先递归），
 * 之后每个节点的 world 即刻可用——transformPoint 直接对账。
 *
 * 为什么是 class：本库惯例是纯函数，SceneNode 是声明的例外——children
 * 的递归语义（节点持有节点）用 class 表达最直白；除 updateWorld 就地
 * 写 world 外不做隐藏魔法，字段全部公开。
 */

import { identity, multiply } from '../math/mat4'
import type { Mat4 } from '../math/mat4'

/**
 * 场景树节点：local 描述相对父级的变换，children 装下级，world 是
 * updateWorld 结算出的总变换。构造时 world 先垫单位阵——没结算过的
 * 节点至少「站在原地」，不会拿旧账当新账。
 */
export class SceneNode {
  /** 局部矩阵：节点相对父级的变换（动画每帧改的就是它）。 */
  local: Mat4
  /** 子节点：层级关系的全部存储，顺序即遍历绘制顺序。 */
  children: SceneNode[] = []
  /** 世界矩阵：从根链乘到本节点的总变换，updateWorld 的结算结果。 */
  world: Mat4
  /**
   * 可选挂件：给节点挂的任意数据（第 13 章起挂 Phong 材质参数包）。
   * 场景树本身不解读它——local/children/world 三本账一页不改，data 只是
   * 随节点旅行的纯数据，遍历收集的一方（如渲染清单）自行认领。可选字段，
   * 旧代码不写它、行为不变。
   */
  data?: unknown

  /**
   * @param local 初始局部矩阵，缺省为单位阵（「什么都不做」地挂在父级上）。
   */
  constructor(local: Mat4 = identity()) {
    this.local = local
    this.world = identity()
  }

  /**
   * 挂一个子节点并原样返回它（返回子节点便于链式搭建）：
   * sun.add(orbit).add(mesh) 一句话搭三层。同一子节点挂两处不受支持
   * ——树就是树，一个节点只有一个父。
   */
  add(child: SceneNode): SceneNode {
    this.children.push(child)
    return child
  }

  /**
   * 结算世界矩阵：world = (parent ?? 单位阵) · local，随后深度优先递归
   * 子节点（把自己刚算出的 world 喂给它们当 parent）。从根调用
   * root.updateWorld() 即全树结算；从中间节点调用则只刷新该子树。
   *
   * world 是结算时刻的快照，不是 local 的活引用：之后改 local，world
   * 保持原样，直到下一次 updateWorld——「每帧改 local → 结算一次」的
   * 语义由这笔账锁住（tests 有对账）。
   */
  updateWorld(parent?: Mat4): void {
    this.world = multiply(parent ?? identity(), this.local)
    for (const child of this.children) {
      child.updateWorld(this.world)
    }
  }
}
