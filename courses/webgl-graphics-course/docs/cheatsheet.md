---
title: 速查表：GLSL 与 WebGL 调用
---

# 速查表：GLSL 与 WebGL 调用

全书用过的 GLSL 语法与 WebGL 调用集中在一页。条目全部出自课程正文与演示组件——没教过的 API 不列。

## GLSL 速查

### 类型与变量

| 写法 | 是什么 | 首教 |
| --- | --- | --- |
| `float` | 浮点数。注意 `1` 与 `1.0` 不同型——整数喂 float 参数编译失败 | 第 2 章 |
| `vec2` / `vec3` / `vec4` | 2/3/4 个 float 打包的向量，`.xyzw` / `.rgba` / `.st` 分量选择器与 `brg` 这类重排（swizzle）都可用 | 第 2 章 |
| `mat4` | 4×4 矩阵，构造时按列给数 | 第 5 章 |
| `attribute` | 逐顶点输入（坐标、颜色），数据来自缓冲区 | 第 2 章 |
| `uniform` | 整次绘制全场统一的只读输入（矩阵、光源、时间） | 第 3 章 |
| `varying` | 顶点着色器传给片元着色器的值，沿线自动插值 | 第 2 章 |
| `precision mediump float;` | 精度限定符声明。片元着色器必须写；三档 lowp / mediump / highp | 第 3 章 |

### 内建变量

| 写法 | 是什么 |
| --- | --- |
| `gl_Position` | 顶点着色器出口：裁剪坐标（未除 w 的半成品） |
| `gl_FragColor` | 片元着色器出口：颜色 rgba，写入前超量程被摁回 [0,1] |

### 全书用过的内建函数

| 函数 | 语义 | 与实验场对账 |
| --- | --- | --- |
| `mix(a, b, t)` | 线性插值，t 不钳制、越界外推 | `lerp`（第 3 章） |
| `clamp(x, lo, hi)` | 越界收拢 | `clamp`（第 3 章） |
| `smoothstep(e0, e1, x)` | 两端为 0/1 的 S 形整形，输入钳制 | `smoothstep`（第 3 章；第 13 章雾复用） |
| `dot(a, b)` / `cross(a, b)` | 点积 / 叉积 | 第 4 章八件套同名同义 |
| `normalize(v)` | 归一化。零向量结果未定义（实验场定死返回 [0,0,0]，见[简化清单](./divergences)） | 第 4 章 |
| `length(v)` / `distance(a, b)` | 长度 / 距离 | 第 4 章 |
| `reflect(I, N)` | 反射方向：I − 2·dot(N,I)·N，N 必须已归一化 | `reflect`（第 10 章） |
| `max(a, b)` / `pow(x, y)` | 漫反射背面钳 0 / 高光取幂 | 第 10 章 |

## WebGL 调用速查（按接线顺序）

### 上下文与视口

| 调用 | 干什么 | 首教 |
| --- | --- | --- |
| `canvas.getContext('webgl', { antialias, depth })` | 取上下文；depth: true 才有深度缓冲 | 第 2 章 |
| `gl.viewport(x, y, w, h)` | 把 NDC 操场四角对到画布四角 | 第 2 章 |
| `gl.clearColor(r, g, b, a)` / `gl.clearDepth(1)` | 清屏色 / 清深度值（默认 1） | 第 2 / 8 章 |
| `gl.clear(COLOR_BUFFER_BIT \| DEPTH_BUFFER_BIT)` | 清屏 | 第 2 / 8 章 |
| `gl.enable(DEPTH_TEST)` / `gl.enable(CULL_FACE)` | 开深度测试 / 开背面剔除（两者默认关） | 第 8 章 |

### 着色器与程序

| 调用 | 干什么 | 首教 |
| --- | --- | --- |
| `gl.createShader(VERTEX_SHADER / FRAGMENT_SHADER)` | 开一个着色器空壳 | 第 2 章 |
| `gl.shaderSource(sh, src)` → `gl.compileShader(sh)` | 装源码并编译 | 第 2 章 |
| `gl.getShaderParameter(sh, COMPILE_STATUS)` → `gl.getShaderInfoLog(sh)` | 黑屏排查第一路：编译失败不抛异常，报错躺在这里 | 第 2 章 |
| `gl.createProgram()` → `gl.attachShader` × 2 → `gl.linkProgram` | 编译好的两段拼成可执行程序 | 第 2 章 |
| `gl.getProgramParameter / getProgramInfoLog` | 链接错误（varying 名字对不上等）从这里拿 | 第 2 章 |
| `gl.useProgram(prog)` | 换用哪个程序 | 第 2 章 |

### 缓冲与顶点属性

| 调用 | 干什么 | 首教 |
| --- | --- | --- |
| `gl.createBuffer()` → `gl.bindBuffer(ARRAY_BUFFER, buf)` → `gl.bufferData(ARRAY_BUFFER, data, STATIC_DRAW)` | 开箱、挂轨道、整箱倒数据（一次性上传） | 第 2 章 |
| `gl.getAttribLocation(prog, 'a_position')` | 名字换格子号；返回 -1 = 名字对不上或被优化掉（黑屏排查第二路） | 第 2 章 |
| `gl.enableVertexAttribArray(loc)` | 启用取料口；漏了就读常量默认值 (0,0,0,1)——三角形缩成看不见的点 | 第 2 章 |
| `gl.vertexAttribPointer(loc, size, FLOAT, false, stride, offset)` | 登记取料规则：几个分量一组、每行跨多少字节、从第几字节起 | 第 2 章；交错布局对账第 8 章（32/0/12） |
| `gl.bindBuffer(ELEMENT_ARRAY_BUFFER, ibo)` | 索引缓冲挂另一条轨道 | 第 8 章 |

### 绘制

| 调用 | 干什么 | 首教 |
| --- | --- | --- |
| `gl.drawArrays(TRIANGLES / POINTS, first, count)` | 顺序画 count 个顶点 | 第 1 / 2 章 |
| `gl.drawElements(TRIANGLES, count, UNSIGNED_SHORT, 0)` | 按索引清单画，顶点复用 | 第 8 章 |
| `gl.drawArrays(LINES, …)` | 画线（线框、轨道圈）；**背面剔除对线不生效** | 第 8 章 |

### uniform

| 调用 | 干什么 | 首教 |
| --- | --- | --- |
| `gl.getUniformLocation(prog, 'u_x')` | 名字换地址 | 第 3 章 |
| `gl.uniform1f / uniform3f / uniform1i` | 逐帧喂标量与向量；纹理单元号用 uniform1i | 第 3 / 9 章 |
| `gl.uniformMatrix4fv(loc, false, mat4)` | 传矩阵；数据必须列主序，transpose 必须 false | 第 5 章 |

### 纹理

| 调用 | 干什么 | 首教 |
| --- | --- | --- |
| `gl.createTexture()` → `gl.bindTexture(TEXTURE_2D, tex)` | 开纹理并挂轨道 | 第 9 章 |
| `gl.pixelStorei(UNPACK_FLIP_Y_WEBGL, 1)` | 上传时行序倒转——图片顶行落 v=1 顶边；不开则上下颠倒 | 第 9 章 |
| `gl.texImage2D(TEXTURE_2D, 0, RGBA, w, h, 0, RGBA, UNSIGNED_BYTE, data)` | 逐像素字节表上传 | 第 9 章 |
| `gl.texParameteri(MIN_FILTER / MAG_FILTER, NEAREST / LINEAR)` | 过滤：马赛克块 / 调匀。**MIN 默认值要求 mipmap——只传第 0 级不改参数会采样全黑**，本课程 MIN/MAG 同档绕开 | 第 9 章 |
| `gl.texParameteri(WRAP_S / WRAP_T, REPEAT / CLAMP_TO_EDGE)` | 包裹：平铺 / 拉边。WebGL1 非 2 幂尺寸只许后者 | 第 9 章 |
| `gl.activeTexture(TEXTURE0)` + `gl.uniform1i(loc, 0)` | 纹理单元与采样器对接 | 第 9 章 |

## 坐标变换链（MVP 流水线）

```text
局部坐标 --(模型矩阵 M，场景树链乘)--> 世界坐标
        --(视图矩阵 V，lookAt)--> 眼空间
        --(投影矩阵 P)--> 裁剪坐标（w 装着深度）
        --(÷w 透视除法)--> NDC [-1,1]³
        --(viewport)--> 屏幕像素
```

矩阵乘法从右往左作用、顺序不可交换（第 5 章）；MVP 在 JS 侧预乘成一台再上传是常见习惯（第 6 章起演示的做法）。
