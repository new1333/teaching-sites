---
title: 组装：一个可漫游的 3D 小世界
---

# 组装：一个可漫游的 3D 小世界

零件上周就全验证过了：场景树把层级管顺了，Phong 三件套把明暗管顺了，漫游相机的 WASD 也接上了。周一真动手拼一个「小世界」，第一眼就露馅：相机站在地坪上往前看，远处一片纯黑——草地像被刀切一样断掉，切口的另一边什么纵深都没有。第二眼更糟：画到第三根柱子你开始复制粘贴，每件物体一段几乎一样的「绑缓冲、设矩阵、喂三个颜色参数、drawElements」，十几份代码只有数字不同；想给柱子换个颜色，要在五份文件里找那个写死的色值。**零件合格不等于世界成立**——把零件装配成世界，缺的是一份世界清单：什么东西、什么材质（材质就是颜色、光洁度、反光强度这一组「皮肤参数」）、怎么摆、相机从哪进。这一章把这份清单本身写成代码：一个种子数进，一个可漫游的小世界出。这也是全书的终点站——你会亲手开机，走进自己造的世界。

## 出发前清点：零件全在，缺一份清单

数学侧全员上班。向量一家（向量、点积、叉积、归一化、单位向量）在光照与相机里同时打工：漫反射的 N·L 是点积，相机的右向是叉积，朝向一律先归一化。矩阵家族的模型矩阵今天由场景树代发——每件物体的局部矩阵链乘出世界矩阵，直接当 M 用；视图矩阵照旧 lookAt，把世界搬到相机跟前；透视投影那台 60° 的镜头不动，透视除法与宽高比的账都在它体内。几何与遮挡一套：全世界的物体都是同一份 cube（24 顶点 36 索引，索引绘制），缠绕方向与背面剔除让每个方块只画朝外的面，深度缓冲与深度测试把关「近者遮远者」。纹理一套（UV 坐标、纹素、采样、过滤）给地坪铺程序化格子。光照一套（法线、法线矩阵、环境光、漫反射、高光）给每件物体算明暗——特别提醒：世界里的 cube 全是非均匀缩放（地坪压扁、柱子拉高），法线矩阵（逆转置）今天一刻不能歇。相机一套：偏航角与俯仰角出相机基向量，WASD 沿基向量走，步长用增量时间缩放，渲染循环每帧重画。渲染管线三段接力照旧：顶点着色器定位、光栅化圈格子、片元着色器上色，GPU 吃下这点绘制量毫无压力——十几个 draw call 离掉帧很远，帧率的账付得起。

清点完，空位就一个：以上零件彼此都验证过，唯独「它们拼在一起时长什么样」没有人管。本章进仓一件大模块 world/world，带走四个新词：雾、材质、程序化布局、渲染清单——名字先立此存照，下面四节逐个讲透，最后一节装机。

## 材质：同一形状换一套皮肤

先还最大的一笔装配债。开章的复制粘贴，病根是「形状」与「外观」焊死在同一段绘制代码里：柱子与房子是同一种形状（都是 cube），却各带一段几乎相同的绘制代码，差别只在几个数字——基础色多红一点、高光多强一点。把这些数字从绘制代码里拆出来打包，就是材质（material）：**同一个形状换一套材质，就是另一种东西**——同一颗 cube，配草绿低反光是草地，配石灰弱光洁是石柱，配砖红高光洁是砖房。

```ts
// src/world/world.ts · Material——形状的皮肤参数包
export interface Material {
  readonly baseColor: Vec3
  readonly ambient: number
  readonly diffuseK: number
  readonly specularK: number
  readonly shininess: number
  readonly emissive: number
}
```

六个字段五个是第 10 章的老相识：baseColor 是基础色；ambient、diffuseK、specularK 是三件套各自的强度旋钮（0 到 1）；shininess 是光洁度，反光斑从巴掌大到针尖全靠它。新来的只有一个 emissive——自发光强度：不等光照、自己亮的分量，太阳靠它标记自己（emissive 为 1，其余物体为 0）。材质挂在哪？SceneNode 本章新增了一个可选的 data 字段（「给节点挂任意数据的挂件」，下一节看代码），材质包就挂在那里。它是纯数据，不是新类，同一份材质对象还能挂多个节点：柱廊全体柱子共享同一份石头材质。想给柱子换皮肤，改一处、全体变，开章「翻五份文件」的账就此销掉。

拿石柱与砖房的对账演算一遍「同一形状、两套皮肤」差在哪。两者都对齐到反光方向的一半（dot(R, v) = √½）时：石柱 shininess = 16，高光 = (√½)¹⁶ = 1/256 ≈ 0.004，一片朦胧的微光；砖房 shininess = 32，高光 = (√½)³² = 1/65536 ≈ 0.000015，几乎全黑——只有把视线挪到更正对反光方向的位置它才亮起来，反光斑收得更紧。形状一个字没改，光洁度一个数字，观感就分了家。

一句话收尾：同一个形状，换一套皮肤参数就是另一种东西——材质就是这套皮肤参数。

## 渲染清单：一份清单加一个循环

材质把「皮肤」拆成了数据，还差另一半：绘制代码本身的复制粘贴。十几个物体各带一段绘制代码，加一根柱子就要再抄一段——**「画什么」与「怎么画」也该分家**。做法是把这一帧要画的东西收成一张渲染清单（render list）：遍历场景树，每个挂了材质的节点收一行三元组。一行清单回答三个问题——哪份形状（mesh）、哪台世界矩阵（world）、哪份材质（material）。绘制侧只剩一个通用循环：逐行设置 uniform、drawElements，循环体不认识「柱子」也不认识「房子」，只认清单行。

```text
场景树（updateWorld 结算后）            渲染清单（collectRenderList 收集）
root                                 ┌ mesh: cube  world: 地坪的矩阵   material: 草地材质
├─ ground   ──材质──┐                │ mesh: cube  world: 太阳的矩阵   material: 自发光材质
├─ sun      ──材质──┼──→ 逐节点收行 ─→│ mesh: cube  world: 柱 1 的矩阵  material: 石头材质
├─ column 1 ──材质──┤   （没材质的    │ mesh: cube  world: 柱 2 的矩阵  material: 石头材质（同一份）
├─ column 2 ──材质──┤    节点跳过）   │ …（seed 7 共 17 行）
└─ …                ┘                └ root 不画——它只管层级
```

seed 7 的世界有 18 个节点、17 行清单（根节点不画）。加一根柱子，代码一行不改，清单自动多一行；换个材质，改的是清单行里的一个字段。「遍历收单」与第 11 章的遍历绘制是同一趟深度优先走法，只是把「走到就画」改成「走到先记账、走完统一画」——记账让绘制与场景结构解耦。

一句类比收尾：后厨不看每道菜的故事，只按点菜单出菜；加菜只需多一行单子。

## 雾：把远处的账还了

清单解决了「怎么画」，开章第一个现象还没解决：远处一片纯黑、地坪像被刀切。两笔账：清屏色是深色，far 平面之外的物体又被视锥体裁掉，边界处的物体要么突然消失、要么与深色背景硬接；更根本的是没有任何纵深线索——距离在画面上没有留下痕迹，眼睛判断不了「那片草地到底有多远」。真实世界里这个线索由空气代劳：光线穿过越厚的空气散射越多，远处的东西越发的灰白。雾（fog）就是把这件事画出来的手法——**按距离把远处的景物一点点混进雾色**，像隔着一层越远越厚的毛玻璃。它一举付两笔账：给了纵深线索，也把 far 平面的生硬切口藏进了雾里。

载体极轻：三个参数（雾色、near、far）加片元着色器三行。

```glsl
// 用法示例：片元着色器末尾的距离雾三行
varying vec3 v_worldPos;   // 顶点着色器传来的世界坐标（可变变量沿线插值）
uniform vec3 u_eye;        // 相机眼位
uniform vec3 u_fogColor;
uniform float u_fogNear;   // 本章世界取 8
uniform float u_fogFar;    // 本章世界取 28
// ……Phong 三件套算完，得到这个片元的亮度色 lit……
float dist = distance(v_worldPos, u_eye);
float factor = smoothstep(u_fogNear, u_fogFar, dist);  // 距离 → [0,1] 的混色比例
gl_FragColor = vec4(mix(lit, u_fogColor, factor), 1.0);
```

演示组件在这三行上多加了一个细化：自发光分量免雾——factor 再乘 (1 − emissive)。不加的话，挂在 28 格（恰是雾的 far）之外的太阳会被雾完全吃掉；而光源本该穿雾可见，像雾天里仍认得出太阳的亮斑。普通物体 emissive 为 0，公式退化回上面三行原样。

第 3 章埋的账在这里兑：当时说过 lerp 与 GLSL 的 mix 同语义（t 不钳制、越界外推），并约定讲雾的按距离混色时回来对账。今天的 factor 由 smoothstep 出——它对输入钳制，距离超过 far 之后 factor 封顶为 1，远处永远是纯雾色。若改用 t = (dist − near) / (far − near) 线性折比例、又像 lerp 那样不钳制，dist = 32 时 t = (32−8)/20 = 1.2。mix 随之调出比雾色更亮的越界色——第 3 章「lerp 不钳制」这条声明过的差异，在这里显形成一个真 bug 的形状。承重演算跟着算一遍，手算与 GLSL 同账：

```text
一个距眼 20 的片元，near=8、far=28：
  t      = (20 − 8) / (28 − 8) = 0.6          ← 距离折算成比例（smoothstep 内部第一步）
  factor = t² × (3 − 2t) = 0.36 × 1.8 = 0.648 ← S 曲线整形（起步收尾都平缓）
  片元色  = mix(物体色, 雾色, 0.648)            ← 64.8% 是雾色
具体到颜色：草地的 (0.30, 0.55, 0.28) 混雾色 (0.75, 0.82, 0.90)：
  r = 0.30 + (0.75 − 0.30) × 0.648 = 0.592    ← mix 的展开式，逐位可复算
若不用 S 曲线、直接用线性比例：factor = 0.6，差 4.8 个百分点——远近两端
的过渡更生硬，雾「浓起来」的过程不自然
```

这笔 0.648 有测试背书（tests 里 smoothstep(fog.near, fog.far, 20) 与 0.648 对账）。还有一笔接线账：清屏色直接取雾色——地平线以外本来就是「全雾色」的地方，两侧才接得上缝。

## 程序化布局：种子是世界的全部真相

清单与材质解决了「怎么画」，最后一问是「摆什么、摆哪」。手摆当然行——但十几件物体逐个 translate(…) 写坐标，摆完就固化了：想换一个世界，重写一遍；想复现上一个世界，没门。程序化布局（procedural layout）换个思路：**用一段代码加一个种子数决定什么东西摆在哪**——代码是「布局规则」，种子是「这一次的具体掷骰结果」。关键机关是种子随机数：普通随机数每次调用换一个序列；种子随机数发生器把「随机」变成「种子决定的一段固定序列」，同一个种子从头再生成一遍，每个数、每个数出现的顺序都逐位相同。游戏里「按种子重建地图」就是这本账：存档不存几百万个方块，只存一个种子数，重进世界时从种子把地图原样再生成一遍。世界可复现、可分享、可测试——确定性测试（同种子两次生成、逐元素相等）就是它的哨兵。

```ts
// src/world/world.ts · mulberry32——32 位种子随机数发生器（内联实现）
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
```

几行位运算造出 [0, 1) 的均匀序列：imul 是带溢出回绕的 32 位整数乘法，异或与移位把比特搅匀，>>> 0 把符号位当数值读、摁回无符号 32 位，最后除以 2³² 归一。这是业界常用的极小公开写法，选它正因为小到能一眼看完。跟着算 seed 7 的头几个数怎么变成世界：

```text
seed = 7 的头四个随机数：0.0117  0.0620  0.9769  0.6990（逐位可复算）
第 1 个 → 太阳方位角 = 0.0117 × 360 ≈ 4.2°
第 2 个 → 太阳水平距 = 15 + 0.0620 × 8 = 15.50
第 3 个 → 太阳高度   = 10 + 0.9769 × 6 = 15.86
  → 太阳落位 ≈ (sin4.2°×15.50, 15.86, cos4.2°×15.50) = (1.14, 15.86, 15.45)
第 4 个 → 柱子根数   = 7 + floor(0.6990 × 5) = 7 + 3 = 10 根
换成 seed = 8：头四个数整个换掉，太阳与柱廊立刻搬家——同一段代码，不同的种子
```

一句类比收尾：种子像一场掷骰的录像——看着随机，其实每一把都能原样重放。

## 渐进实验：world/world 进仓

老规矩，测试先行。tests/build-3d-world.test.ts 写好 10 条断言，此刻 world/world 还不存在。跑 pnpm test 一片红：Failed to load url ../src/world/world——渐进语义的机械证明。先看两条承重断言的真身。第一条，确定性（同种子同世界）：

```ts
// tests/build-3d-world.test.ts · 同 seed 两次生成：结构与材质逐元素一致
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
```

第二条，雾的承重演算锁进测试（0.648 的账）：

```ts
// tests/build-3d-world.test.ts · 雾按距离混色的承重演算
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
```

进代码前先交代 SceneNode 那处兼容性扩展——给节点加一个可选挂件，三本主账一页不改：

```ts
// src/scene/node.ts · 新增可选挂件（第 13 章唯一动到字段结构的旧文件改动，index.ts 另有一行 re-export 追加）
  /**
   * 可选挂件：给节点挂的任意数据（第 13 章起挂 Phong 材质参数包）。
   * 场景树本身不解读它——local/children/world 三本账一页不改，data 只是
   * 随节点旅行的纯数据，遍历收集的一方（如渲染清单）自行认领。可选字段，
   * 旧代码不写它、行为不变。
   */
  data?: unknown
```

然后是模块本体。createWorld 全貌——本章的承重函数，完整形态如下：

```ts
// src/world/world.ts · createWorld——一个种子进、一棵结算就绪的场景树出
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
```

随机数的消费顺序就是世界的生成顺序：太阳三笔、柱廊三笔加每柱两笔、房子一笔根数加每房六笔（方位、距离、宽、深、高、选色）、入口三笔——顺序即承诺，同种子逐位复现。每件物体都是「一台 T·S 局部矩阵加一份材质」。先缩放定形、再平移落位（multiply(translate, scale)，坐标先过右边的缩放、再过平移，第 5 章的顺序账）。柱子是拉高的 cube、房子是矮胖的 cube、地坪是压扁的 cube、太阳是缩小的自发光 cube。雾不挂节点——它是全场景气氛，一份 uniform 的事；入口也不挂节点——那是相机的账，都随世界一并交付。

渲染清单的收集器全貌：

```ts
// src/world/world.ts · collectRenderList——遍历收单，(mesh, world, material) 三元组
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
```

注意它收的是 node.world——结算时刻的快照。用法示例（渲染循环里的完整接线）：

```ts
// 用法示例：一帧三步——结算、收单、按单开画
const world = createWorld(7)
world.root.updateWorld()                       // 1. 从根结算全树的世界矩阵
const list = collectRenderList(world.root)     // 2. 收 17 行清单（seed 7）
for (const item of list) {                     // 3. 通用循环：不认识物体，只认清单行
  setUniform('u_model', item.world)
  setUniform('u_normalMat', normalFromMat4(item.world))  // 非均匀缩放，法线矩阵必上
  setMaterialUniforms(item.material)
  gl.drawElements(gl.TRIANGLES, 36, gl.UNSIGNED_SHORT, 0)
}
```

src/index.ts 照例追加。

```ts
// src/index.ts · 追加 world/world 的 re-export（上一行是第 12 章的 CameraBasis）
export type { CameraBasis } from './scene/camera'
export { collectRenderList, createWorld, materialOf } from './world/world'
export type { FogParams, Material, RenderItem, World, WorldEntry } from './world/world'
```

一处诚实声明：世界不查碰撞——柱廊与房子可能贴得很近甚至重叠；种子只管「摆哪」，不管「摆得体面」。这是教学世界的简化，真实引擎在这里要上碰撞检测。

## 演示：亲手开机，走进你的世界

<DemoWorld />

上面这块画布就是终点成果：seed 7 的世界，18 个节点、17 行渲染清单，每行一个 draw call。演示内联了 createWorld 的同款布局代码与同一颗种子——数字与实验场逐位一致。两处结构差异声明在先。其一：这个世界全树深度 1（所有物体直接挂根下），没有层级时 collectRenderList 的遍历退化为顺序枚举，演示的清单因此直接收行、不建树也不跑 updateWorld。其二：滚轮没有做缩放而是调移动速度——漫游相机上调速比缩放更贴身。实验场的 collectRenderList 与相机语义不受这两处影响。开机指引，一步一步来：

- 开机第一眼：相机站在入口 (−10.3, 3.1, −9.4)，正对世界中心。视线里应该有——脚下 40×40 的草绿地坪（铺着程序化格子纹理，采样与过滤在第 9 章验收过的那套）、中景一段 10 根石柱的弧形柱廊。再往外，四周散着 5 栋红蓝黄紫的方块房子。高远处还有一个暖黄色的发亮方块——太阳，全场景唯一的光源（演示右上角的角标显示当前昼夜）。
- 漫游：鼠标悬停画布（边框变亮即接管键盘），W 前进、S 后退、A/D 左右平移，方向键同义；移动沿相机自己的前/右基向量，步长按增量时间与速度缩放。抬着头按 W 会离地——沿基向量走的约定，第 12 章立过。
- 转头与速度：按住拖拽转头（先俯仰后偏航的固定顺序住在 viewBasis 里，拖过 180° 也不会翻车）；滚轮调移动速度，1 到 12 格/秒，读数第三行实时显示。
- 看雾：朝柱廊反方向走到 20 格开外再回头看——地坪与房子溶进灰蓝的雾色，28 格以外与清屏色完全接上，地平线没有刀切边界。走近再走近，雾色比例按刚才手算的 0.648 那条曲线退去。
- 看材质：贴近石柱侧身看，弱光洁（shininess 16）的高光是一片朦胧；再去看房子，光洁度高（24 到 48）的只有正对反光方向才亮一个亮斑。转身找到太阳：背光面只吃环境光，正光面漫反射最亮——第 10 章三件套的现场。
- 白天/夜晚：点「切到夜晚」——太阳光强降到 12%、环境光压到 45%、雾色与清屏色一起沉成深蓝、太阳块的自发光也暗到三成半；所有量沿 lerp 渐变约一秒过渡，不是硬切。夜里再漫游一圈，世界像换了一副面孔，但清单还是那 17 行。
- 换种子：点「换个种子」——种子加一，同一份布局代码重建整个世界：柱子根数、房子位置、太阳挂哪、入口站位全部换掉，相机自动回到新入口。连按几次，亲眼看到「同种子同世界、换种子换世界」；按满一圈（一百次）回到种子 7，世界与你离开时分毫不差。

## 验证：手算对账，门槛背书

两道门槛在 companion/ 下跑：pnpm run typecheck 与 pnpm test——12 个测试文件 126 条断言全绿，旧 116 条一字未动，新 10 条是本章里程碑。先红的账如实交代：测试写好先跑，报错 Failed to load url ../src/world/world——模块不存在，唯一的红；实现之后一次全绿，本轮没有改回测试的反复。

手算挑几笔。确定性：createWorld(7) 两次生成，节点数、每个节点的 16 格 local、材质六字段逐元素相等；换 seed 8，同一顺位的矩阵不再重合。地面：cube 顶面角点 (1,1,1) 过世界矩阵落 (20, 0, 20)——40×40 地坪、顶面 y=0 逐位可复算。太阳：seed 7 落 (1.14, 15.86, 15.45)，与「头四个随机数」那笔演算同账；高度与水平距离都落在声明的量级内。入口：(−10.3, 3.1, −9.4)，yaw = −132.4°，viewBasis 出的 forward 与「指向原点」的方向点积为 1——站在外圈、正对中心。材质：全部强度在 [0,1]、shininess ≥ 1（多个种子遍历断言）。节点量级：13 到 20 个、深度 1，四个种子都在带内。雾：smoothstep(8, 28, 20) = 0.648，距眼 20 的片元 64.8% 是雾色。

亲手开机（全书的终点开机）：cd companion && pnpm test，看到 12 个文件 126 条全绿——这是你从第一个三角形一路攒下的全部原理断言；然后回到上面的演示，悬停、按住 W，走进去。柱廊、房子、太阳、雾，每一件都能在前面十二章里找到它的账。

## 小结：从第一个三角形到一个世界

装配世界的四件新工具：材质——形状的皮肤参数包（baseColor、三件套强度、光洁度、自发光），挂在节点上、可共享、改一处全体变；渲染清单——遍历场景树收 (mesh, world, material) 三元组，绘制只剩一个通用循环；雾——按距离把远处景物混进雾色，factor = smoothstep(near, far, dist)，与第 3 章的 mix 兑账（0.648 有测试背书）；程序化布局——种子随机数把布局变成「同一段代码、一个种子」，同种子同世界。实验场进账一件：world/world 的 createWorld、collectRenderList、materialOf 与 Material 等类型，测试总数 126。回望全书，这个世界每一处都有出处：

| 章 | 进仓零件 | 在这个世界里干的活 |
| --- | --- | --- |
| 1 · GPU 与渲染管线 | GPU、渲染管线、顶点、光栅化、片元、帧率、掉帧 | 十几个 draw call 远在每帧预算之内 |
| 2 · 第一个三角形 | 着色器、缓冲区、顶点属性、可变变量、裁剪坐标系 | 顶点数据进缓冲区一次，片元逐格上色 |
| 3 · uniform 与渲染循环 | 统一变量、渲染循环、增量时间、线性插值、缓动、精度限定符 | 每帧只改 uniform；步长按增量时间；昼夜沿 lerp 渐变 |
| 4 · 向量 | 向量、点积、叉积、归一化、单位向量、向量投影 | 漫反射 N·L、基向量叉积、朝向归一化 |
| 5 · 矩阵变换 | 矩阵、矩阵乘法、列主序、齐次坐标、模型矩阵 | 每件物体一台 T·S 模型矩阵 |
| 6 · 投影 | 投影、透视投影、正交投影、视锥体、透视除法、宽高比 | 60° 镜头把 40×40 的地坪压进屏幕 |
| 7 · 相机 lookAt | 视图矩阵、相机 | 把世界搬到漫游相机跟前 |
| 8 · 深度与立方体 | 深度缓冲、深度测试、索引绘制、缠绕方向、背面剔除 | drawElements 画 cube，遮挡由深度测试把关 |
| 9 · 纹理 | 纹理、UV 坐标、纹素、采样、过滤 | 地坪的程序化格子 |
| 10 · 光照 | 法线、法线矩阵、环境光、漫反射、高光 | Phong 三件套逐片元算，压扁拉高的法线靠逆转置搬正 |
| 11 · 场景树 | 场景图、局部矩阵、世界矩阵 | 世界清单住在树上，updateWorld 一次结算 |
| 12 · 相机操控 | 轨道相机、球坐标、偏航角、俯仰角、相机基向量 | WASD 沿基向量走，拖拽改 yaw/pitch |
| 13 · 本章 | 雾、材质、程序化布局、渲染清单 | 17 行清单一个循环画完；种子重建世界 |
| 14 · 下一站 | 视锥剔除、实例化渲染、WebGL2、WebGPU | 更大的世界由它们接棒 |

概念去向：视锥剔除（帐篷外的物体直接不收单）、实例化渲染（一次 draw call 画一排柱子）这些「世界再大一点就要用」的工具，第 14 章清点。

读完本章，下面几问应该能脱口而出：

- 距眼 20 的片元在 near=8、far=28 的雾里混了百分之多少？手算 t 与 factor 两步，再说说为什么用 smoothstep 而不用线性比例、也不用 lerp 直接折比例。
- 材质解决的是哪两样东西的耦合？给柱子换皮肤为什么要改的只有一处？
- 渲染清单的一行是什么？加一根柱子，绘制循环为什么一行不用改？
- 同一个种子生成两次世界，哪些东西逐位相等？「游戏按种子重建地图」省下的是什么？
- 这个世界里每件物体都能追到哪一章的账？挑太阳、地坪格子、柱子的高光各追一笔。
