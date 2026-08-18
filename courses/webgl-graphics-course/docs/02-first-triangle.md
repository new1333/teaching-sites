---
title: 第一个三角形：着色器、缓冲区与顶点属性
---

# 第一个三角形：着色器、缓冲区与顶点属性

上一章留了个尾巴：粒子演示右边那块 WebGL 画布是个黑盒，一次 `gl.drawArrays`，两万个粒子就算好、画好了。这一章把它拆开。拆法不是读别人的代码，是自己从零写出 WebGL 的最小可运行单元——画一个三角形，图形学世界的 Hello World。

先说你马上会撞上的墙。跟着教程抄完 100 行，gl.drawArrays 一调，画布一片黑。逐字核对，一个字符都没抄错。黑屏的原因几乎总是两件事叠加。第一件：着色器（shader，写给 GPU 的小函数）的源码是运行时才编译的。编译失败时，WebGL 不抛异常、不弹提示，报错只躺在日志接口的返回值里——**WebGL 从不主动报错，错误信息永远在等你去拿**。第二件：attribute（顶点属性，顶点着色器逐顶点读取的输入口）没绑对时，同样一个报错都没有。没启用的顶点属性读到的是常量默认值，x、y、z 全是 0——三个顶点全叠在画布正中心，三角形退化成一个面积为零、根本盖不住任何像素的点。

这两件事各有一条排查路，黑屏从此不再靠猜：

- 编译失败：`gl.compileShader` 之后立刻查 `gl.getShaderParameter(sh, gl.COMPILE_STATUS)`；是 false，就把 `gl.getShaderInfoLog(sh)` 的原文打出来——第几行、错什么，驱动写得明明白白。
- 属性没绑：画之前 `console.log` 一下 `gl.getAttribLocation(prog, 'a_position')` 的返回值——是 -1，说明着色器里的名字和 JS 里传的字符串对不上，或者这个属性没被着色器用到、被驱动优化掉了；再确认 `enableVertexAttribArray` 那句没漏。

这一章把那 100 行拆成六步：编译、链接、缓冲、attribute、清屏、drawArrays，每步讲清它为什么存在。到章末，你能从空白文件写出这个三角形，说出每个 GL 调用的职责，并且黑屏时知道先查哪两处。

## 着色器：流水线上留给你的两个岗位

第 1 章的渲染管线有三段：顶点段、光栅化段、片元段。中间的光栅化是焊死的固定电路；第一段和第三段是留给你写程序的两个岗位，岗位上的小程序叫着色器。为什么开放这两段？图形效果的需求没有尽头——雾、水波、卡通描边——固定电路永远不够用。而这两段的计算有个共同脾气：对每个顶点、每个片元做的事一模一样，只是喂进去的数不同。这恰好是 GPU 的口味：你写一个只管「一个顶点」的函数，GPU 让几千个通道对全部顶点同时各跑一遍。记一句：**着色器就是给流水线上两个车间各自写的小函数，GPU 对每个顶点、每个像素都调用一遍**。

写这两个函数用的语言叫 GLSL（OpenGL Shading Language）——C 的风味：类型严格、有 main 函数、每句分号结尾；源码在 JS 里就是普通字符串，传给 WebGL 去编译。它为 GPU 而生：几千个硬件通道要直接执行这份代码，语言必须小到能逐条编译进硬件，带不动 JS 那些动态特性——所以是一门极小的语言，不是 JS 方言；它天生只做「一个顶点/一个片元」范围内的计算——你拿不到「所有顶点」这个概念，每次调用互相看不见。起步只需要两个类型：float，GLSL 的浮点数（相当于 TS 的 number，但 GPU 把数分了口径，本课程暂时只用 float）——注意 1 和 1.0 在 GLSL 里不是一个类型，整数喂给 float 会直接编译失败，去 Playground 把那个 1.0 改成 1 试试；vec4，四个 float 打包的向量，类比 TS 里固定长度的元组，另有 vec2、vec3 等档位。

### 顶点着色器：算「东西在哪」

```glsl
// 顶点着色器：位置直通 + 颜色放上传送带
attribute vec3 a_position;
attribute vec3 a_color;
varying vec3 v_color;
void main() {
  v_color = a_color;
  gl_Position = vec4(a_position, 1.0);
}
```

逐行看。`attribute vec3 a_position` 声明一个逐顶点输入：名字随便起（a_ 前缀是习惯，提醒你它是 attribute），每个顶点进来时它就是这个顶点的那份数据。`varying vec3 v_color` 声明一条可变变量（varying）——顶点车间发往片元车间的传送带，本章后半段专门讲它。main 里有两条赋值：`v_color = a_color` 把颜色放上传送带；`gl_Position = vec4(a_position, 1.0)` 把坐标补上一个 1 打包成 vec4，写进 gl_Position——顶点着色器的出口，内建变量（语言自带、不用声明的全局），你算好的位置就交在这里。第 4 个分量 w 本章恒为 1，先当占位；w 不等于 1 时的账，到投影一章才算。

### 片元着色器：算「涂什么色」

```glsl
// 片元着色器：涂传送带送来的插值色
precision mediump float;
varying vec3 v_color;
void main() {
  gl_FragColor = vec4(v_color, 1.0);
}
```

第一行 `precision mediump float` 先当每个片元着色器开头的固定开场白照抄——precision 限定符，告诉 GPU 浮点数用哪档精度，第 3 章细讲。`varying vec3 v_color` 是同一条传送带在片元这头的接口，名字必须和顶点那边一字不差，链接时对账。关键在：光栅化圈出几万个片元，每个片元读到的 v_color 都不一样——GPU 按这个片元离三个顶点的远近，把三个顶点的值加权平均后给你，这个动作叫插值。最后 `gl_FragColor = vec4(v_color, 1.0)`：gl_FragColor 是片元着色器的出口，也是内建变量，四个数是红、绿、蓝、不透明度，各取 0 到 1。

两个岗位各一句能复述的话：顶点着色器算「东西在屏幕哪里」，片元着色器算「这个格子涂什么颜色」。第 1 章的粒子演示用的正是这两个函数，只是当时没拆。

## 三条进料通道：attribute、uniform、varying

着色器是个函数，函数总要有输入。GLSL 的进料口一共三种，按「数据变不变」分工：

- attribute：逐顶点变化的数据——坐标、颜色，三个顶点三份。数据来自缓冲区（buffer）——显存里的一块连续存储区，下一节细讲。打个比方：把一整箱原料一次性运进车间，attribute 是车间取料的格子编号。
- uniform（统一变量）：一次绘制里全场统一的只读输入——旋转角度、全局时间。人话：全场统一的公告栏，每个顶点、每个片元读到的都一样。本章画的是静止三角形，还用不上它；让画面动起来的第 3 章，主角就是它。
- varying（可变变量）：顶点车间传给片元车间的值，且沿途自动插值——每个片元拿到的是按位置算出来的新值，不是三份原值。

| 进料口 | 数据从哪来 | 谁读它 | 读到什么 |
| --- | --- | --- | --- |
| attribute | JS 上传进显存的缓冲区 | 只有顶点着色器 | 每个顶点各一份 |
| uniform | JS 每帧写入 | 两个着色器都行 | 全场同一份 |
| varying | 顶点着色器写出 | 只有片元着色器 | 按片元位置插值出的新值 |

注意方向：attribute 只进顶点，varying 只能从顶点流向片元，uniform 两边都能读、谁都改不了它。这张表是全书反复回查的一张表。

## 裁剪坐标系：GPU 只认一座标准操场

顶点坐标的单位是什么？不是像素。屏幕尺寸千差万别——480×480 的演示画布、1920×1080 的外接屏——坐标若直接写像素，换个画布整幅图就错位。所以 GPU 在管线内部规定了一座与屏幕无关的坐标系：x、y、z 全部落在 [-1,1]，中心是 (0,0)，x 朝右、y 朝上、z 朝屏幕深处。这座操场叫 NDC（normalized device coordinates，归一化设备坐标）；它的正式户口是「裁剪坐标系在 w=1 时的特例」——w 是什么账，等投影一章再算，本章 w 恒为 1。**GPU 只认这座 [-1,1] 的标准操场**：顶点着色器交到 gl_Position 的坐标，先按操场规则裁掉出界的部分，最后一步才由 `gl.viewport` 把操场四角对到画布四角。记一句：任何坐标都要先换算成操场坐标——操场中心是原点，四周跑道各到 1 为止。

换算的账，纸笔就能算。设画布 480×480（本章演示同款），像素的行从上往下数：

```text
像素 → NDC：          NDC → 像素：
x' = px ÷ 480 × 2 − 1   px = (x' + 1) ÷ 2 × 480
y' = 1 − py ÷ 480 × 2   py = (1 − y') ÷ 2 × 480

跟着算：像素 (120, 360) → x' = 0.25×2 − 1 = −0.5，y' = 1 − 0.75×2 = −0.5
顶点 C (0, 0.8) → 列 (0+1)÷2×480 = 240，行 (1−0.8)÷2×480 = 48
```

y 的公式多一道翻转，因为像素行从上往下数、操场 y 朝上。拿顶点 C 的落点去演示里对：它应该在画布正中偏上——列 240、行 48 的位置。纸上算得出的，屏幕上就该看得到。

## 缓冲区与顶点属性：把数据喂进显存

着色器声明了 attribute，数据从哪来？JS 数组住在内存里，归 CPU 管；GPU 的几千个通道要并行取数，若每个数都从 JS 内存隔着总线现取，并行就退化成排队。所以 WebGL 的规矩是：先把整块数据一次性搬进显存，之后 GPU 在自家仓库里随便读。这块显存里的连续存储区就是缓冲区，教程里常见的正式名字是 VBO（vertex buffer object，顶点缓冲对象）——同一件事。搬运三连：`createBuffer` 开箱、`bindBuffer` 把箱子挂上传送轨道、`bufferData` 把数据倒进去。回到那句比方：一整箱原料一次性运进车间，而不是一颗一颗从门缝递。

数据进了显存，attribute 怎么知道按什么规则取？`vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0)` 这句就是取料规则：从当前绑定缓冲的第 0 字节起，每 3 个 float 算一组，组与组紧挨着（第一个 0：组间不隔字节），每组就是下一个顶点的这份 attribute。加上 `enableVertexAttribArray(loc)` 启用，链条就通了：缓冲（数据在显存哪里）→ attribute 格子（按什么规则分组）→ 着色器（读去干嘛）。

```text
Float32Array 9 个数（4 字节/个）        顶点着色器的三次调用
[-0.6][-0.5][ 0.0][ 0.6][-0.5][ 0.0][ 0.0][ 0.8][ 0.0]
 └──── 顶点 A ────┘└──── 顶点 B ────┘└──── 顶点 C ────┘
    第 1 次调用         第 2 次调用         第 3 次调用
```

跟着算一遍 `drawArrays(gl.TRIANGLES, 0, 3)`（从第 0 个顶点起、取 3 个顶点拼一个三角形）：GPU 对每个顶点各调用一次顶点着色器——第 1 次调用里 a_position 是 (-0.6, -0.5, 0)，第 2 次 (0.6, -0.5, 0)，第 3 次 (0, 0.8, 0)。三次调用各自把一份颜色放上传送带，然后光栅化圈格子，片元着色器对每个格子再各调用一次。

黑屏成因二在这里现形：**漏了 enableVertexAttribArray 的顶点属性，读到的是常量默认值 (0,0,0,1)**。三次调用的 a_position 全是 0，三个顶点叠在操场中心，面积零，光栅化圈不出任何格子。不报错、不警告，画布干干净净地黑着。这就是为什么排查第二条是「打一下 getAttribLocation、数一下 enable」。

### 插值：传送带怎么铺出渐变

三个顶点只有三份颜色，屏幕上却是几万个格子的平滑渐变。中间发生的事：**每个片元读到的 varying，都是按它离三个顶点的远近加权算出来的新值**，不是三份原值中的任何一份。拿演示的默认配色算：A 红 (1,0,0)、B 绿 (0,1,0)、C 蓝 (0,0,1)，位置就是上面那三个。

- 边 AB 的中点 (0, -0.5)：离 A、B 一样近、离 C 最远，权重各半——颜色 (0.5, 0.5, 0)，半红半绿的暗黄。
- 三角形重心：三个权重各 1/3——颜色 (1/3, 1/3, 1/3)，灰。

这个加权平均不用你写一行代码：光栅化硬件按片元位置直接算好。你在片元着色器里写的只是「拿到手之后怎么用」。

## 渐进实验：从 9 个数到第一个三角形

实验场的演进思路：先把几何数据本身做成可断言的对象，再谈 GL 接线——接线六步每一步都依赖「有 9 个正确的数」，数据错了，接线再对也是黑屏。GL 调用在 Node 里没法机械验证（没有 WebGL），由正文内嵌的实时演示承担；能进测试的，是数据的数学承诺。于是本章的模块是全课程最朴素的一个：

```ts
// src/geometry/triangle.ts · createTriangle
export function createTriangle(): Float32Array {
  return new Float32Array([
    -0.6, -0.5, 0.0, // 顶点 A：左下
    0.6, -0.5, 0.0, // 顶点 B：右下
    0.0, 0.8, 0.0, // 顶点 C：顶部
  ])
}
```

坐标是挑过的：三个数都能手算——底 1.2、高 1.3，面积 = 1.2 × 1.3 ÷ 2 = 0.78；三顶点按逆时针排列（A→B→C），这是写进承诺的缠绕方向，之后讲背面剔除时，「从正面看顶点是否逆时针」就是判别正反面的规则。返回裸的 Float32Array 是刻意的最简形态：9 个数原样进显存，正好喂 bufferData；等后续立方体带上法线和 UV，返回值才升级成对象。

测试先写、先看它红，再补实现转绿——这是实验场每章的节奏。断言只盯行为：9 个分量、都在操场内、三个顶点不共线：

```ts
// tests/first-triangle.test.ts · 「三顶点不共线」断言
it('三顶点不共线：鞋带公式有向面积 > 0（顶点逆时针）', () => {
  const tri = createTriangle()
  const ax = tri[0]
  const ay = tri[1]
  const bx = tri[3]
  const by = tri[4]
  const cx = tri[6]
  const cy = tri[7]
  // 鞋带公式（shoelace）：面积 = |x_A(y_B−y_C) + x_B(y_C−y_A) + x_C(y_A−y_B)| / 2
  // 先不取绝对值：和为正 = 三顶点按逆时针排列（缠绕方向是公开承诺，
  // 后续背面剔除按它判正反面）。向量工具第 4 章才建，这里用坐标展开式。
  const doubleArea = ax * (by - cy) + bx * (cy - ay) + cx * (ay - by)
  // 手算对账：底 1.2 × 高 1.3 ÷ 2 = 0.78，加倍面积 1.56——读者可在纸上复算
  expect(doubleArea).toBeCloseTo(1.56, 4)
  expect(doubleArea).toBeGreaterThan(0)
})
```

### 六步接线

数据就位，接线上场。六步各一句职责：

1. 编译：`createShader` 造壳、`shaderSource` 装源码、`compileShader` 交给驱动；失败不抛异常，查 `COMPILE_STATUS`、拿 InfoLog。
2. 链接：两段着色器分开编译，`linkProgram` 把它们拼成一个可执行程序，传送带（varying 名字）在这一步接通——名字对不上是链接错误，日志同样从 `getProgramInfoLog` 拿。
3. 缓冲：`createBuffer` + `bufferData` 把 9 个数一次性搬进显存；`STATIC_DRAW` 是「这份数据基本不动」的用途提示。
4. attribute：`getAttribLocation` 拿名字对应的格子号，`enableVertexAttribArray` 启用它，`vertexAttribPointer` 登记取料规则。
5. 清屏：`clearColor` 定底色、`clear` 真擦——规范不保证画布自动清空，每帧先清是纪律。
6. 画：`drawArrays(gl.TRIANGLES, 0, 3)`，一次调用，顶点着色器被并行调用 3 次，然后光栅化、片元上色。

```js
// 用法示例：第一个三角形的完整接线（六步全景）
const gl = canvas.getContext('webgl')

// 第 1 步 编译：失败不抛异常，自己查状态、拿日志
function compile(type, source) {
  const sh = gl.createShader(type)
  gl.shaderSource(sh, source)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS))
    throw new Error(gl.getShaderInfoLog(sh) ?? '着色器编译失败（驱动未给出日志）')
  return sh
}
const vs = compile(gl.VERTEX_SHADER, VERT_SRC) // 上面那段顶点着色器，存成字符串
const fs = compile(gl.FRAGMENT_SHADER, FRAG_SRC) // 片元着色器源码字符串

// 第 2 步 链接：两段拼成一个程序，接通 varying 传送带
const prog = gl.createProgram()
gl.attachShader(prog, vs)
gl.attachShader(prog, fs)
gl.linkProgram(prog)
if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
  throw new Error(gl.getProgramInfoLog(prog) ?? '链接失败（驱动未给出日志）')
gl.useProgram(prog)

// 第 3+4 步 缓冲与 attribute：一块数据一条流水线（位置、颜色各来一次）
function feedAttribute(name, data) {
  const buf = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)
  const loc = gl.getAttribLocation(prog, name)
  gl.enableVertexAttribArray(loc)
  gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0) // 每 3 个 float 一组，紧挨着，从第 0 字节起
}
const colors = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]) // A 红、B 绿、C 蓝
feedAttribute('a_position', createTriangle()) // 实验场那个教学三角形
feedAttribute('a_color', colors)

// 第 5 步 清屏 + 第 6 步 画
gl.clearColor(0.05, 0.067, 0.09, 1)
gl.clear(gl.COLOR_BUFFER_BIT)
gl.drawArrays(gl.TRIANGLES, 0, 3)
```

两处细节值得多看一眼。`compile` 里那两行检查，就是本章程财的第一条排查路——**错误信息拿到手，黑屏就只剩第二种可能**。`feedAttribute` 把第 3、4 步打包成函数，是因为位置和颜色走的是完全相同的流水线，只是数据不同——这份重复不是巧合，是「缓冲 + attribute」这对搭档的通用形状。

下面这个 Playground 就是同一套接线做成的可玩版：三角形实时渲染，片元着色器源码直接在线改，防抖半秒重编译；编译或链接失败，InfoLog 原文亮在画布下方的红面板里，画布保持上一次成功的画面。

<ShaderPlayground />

## 验证：两侧都亲手跑一遍

实验场这一侧，在伴生仓 companion/ 里跑。

```text
cd companion
pnpm test            # 3 条断言：9 个分量、全部在 [-1,1]、鞋带面积 1.56 > 0
pnpm run typecheck   # 另一道门：tsc --noEmit
```

先红后绿的节奏你可以自己复刻。把 createTriangle 里的 0.8 改成 -0.5（三点共线），跑 pnpm test 看它红，改回来再看它绿——面积断言抓的正是「退化成看不见的点」这种错。

演示侧，按这个清单玩 Playground：

- 默认画面对照插值演算：A 红、B 绿、C 蓝，边 AB 中点应是暗黄，重心偏灰。
- 换顶点 A 的颜色：渐变立刻重铺——颜色走的是缓冲区这条通道，改数据重传即可，着色器不用重编译。
- 点「注入编译错误」：源码里少一个逗号，红面板亮出驱动的报错原文（第几行、什么错），画布停在上一帧。把面板遮住，你看到的就是当初那片黑——错误一直都在，只是当初没有地方看到它。
- 修复它：补回逗号，或点「恢复默认」，重编译通过，画面恢复。
- 改片元着色器玩：把 `gl_FragColor = vec4(v_color, 1.0)` 改成 `gl_FragColor = vec4(1.0, 0.5, 0.2, 1.0)`，渐变没了——varying 没被用上，整个三角形一种颜色。

## 小结

管线第一段和第三段是可编程岗位：顶点着色器算「东西在哪」（出口 gl_Position），片元着色器算「格子涂什么色」（出口 gl_FragColor）。GLSL 是写它们的小语言，float 与 vec4 起步够用。进料口三选一：attribute 逐顶点、来自缓冲区；uniform 全场统一、第 3 章主角；varying 从顶点流向片元、按位置插值。GPU 只认 [-1,1] 的标准操场，viewport 负责把操场铺上画布；像素与操场坐标互算，两条公式纸上就能对账。接线六步：编译、链接、缓冲、attribute、清屏、drawArrays；每一步失败都静默，所以那两条排查路（查 COMPILE_STATUS 拿 InfoLog、对 getAttribLocation 数 enable）值得记成肌肉记忆。实验场新增 geometry/triangle：createTriangle() 返回 9 个 NDC 分量的教学三角形，逆时针缠绕，鞋带面积 0.78 有测试背书。

读完本章，下面几问应该能脱口而出：

- 片元着色器读到的 v_color 是三份原值里的哪一份？为什么不是？
- 顶点属性漏了 enable 会发生什么？为什么画布是黑的而不是报错的？
- 画布 640×480 上，NDC 坐标 (0.5, 0.5) 落在哪个像素？
- attribute、uniform、varying 各服务什么数据？谁只能从顶点流向片元？
