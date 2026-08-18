# 术语表

全书按首教顺序出现的术语与概念，一句大白话定义——忘了哪个词，回这里查。

| 术语 | 英文 | 一句话定义 |
| --- | --- | --- |
| 顶点 | vertex | 构成形状的角点，GPU 一切绘制的原料单位。 |
| 片元 | fragment | 候选像素：光栅化切出来的每个小格子，涂上颜色后才成为屏幕像素。 |
| 着色器 | shader | 写给 GPU 的小函数，决定每个顶点落在哪、每个格子涂什么色。 |
| GLSL | OpenGL Shading Language | 写着色器用的小语言：C 的风味、类型严格，源码在运行时编译到 GPU。 |
| 顶点着色器 | vertex shader | 管线第一段的可编程岗位：对每个顶点算位置，结果写入 gl_Position。 |
| 片元着色器 | fragment shader | 管线第三段的可编程岗位：对每个片元算颜色，结果写入 gl_FragColor。 |
| 光栅化 | rasterization | 把顶点连成的形状翻译成『哪些格子要涂色』的过程。 |
| 缓冲区 | buffer | 一次性运进显存的二进制数据块，装顶点坐标等原料。 |
| 顶点属性 | attribute | 顶点着色器的逐顶点输入，如每个顶点的坐标、颜色。 |
| 统一变量 | uniform | 整次绘制里全场统一的只读输入，如当前旋转角度、光源位置。 |
| 可变变量 | varying | 顶点着色器传给片元着色器的值，沿线自动渐变（插值）。 |
| 裁剪坐标系 | clip coordinates | 顶点着色器写进 gl_Position 的半成品坐标（还没除以 w）；GPU 在此按 x、y、z 不超过 w 裁掉视野外的点。w=1 时与 NDC 重合。 |
| NDC | normalized device coordinates | GPU 的标准操场：透视除法之后 x/y/z 都在 [-1,1]，任何坐标先换算成它才有效。 |
| 视口 | viewport | NDC 操场映射到屏幕上的那块矩形区域。 |
| 渲染循环 | render loop | 每帧清屏→更新→重画的循环，动画的心跳。 |
| 增量时间 | delta time | 与上一帧的时间差，用它缩放动画量，帧率不匀也等速。 |
| 线性插值 | linear interpolation, lerp | 按比例 t 取 A 到 B 之间的值，动画与渐变的基本砖。 |
| 缓动 | easing | 先把比例 t 整形（如 smoothstep 的 S 曲线）再插值的手法，消除匀速动画的机械感。 |
| 精度限定符 | precision qualifier | 声明浮点数按哪一档精度算的前缀：lowp/mediump/highp 三档；片元着色器必须显式声明 float 精度。 |
| 向量 | vector | 带方向的走法说明：朝哪走、走多远。 |
| 点积 | dot product | 两向量方向的一致度：同向为正、垂直为零、反向为负。 |
| 叉积 | cross product | 两向量撑出的垂直方向，右手定则定指向。 |
| 归一化 | normalization | 把向量长度缩成 1，只留方向。 |
| 单位向量 | unit vector | 长度为 1 的向量，只留方向的标准形态；「只要方向」的场合一律先归一化成它。 |
| 向量投影 | projection | 一个向量沿另一方向压平后剩下的长度；用单位向量当尺子点积，读数即投影。 |
| 矩阵 | matrix | 装满数字的变换机器：坐标进去、变换后的坐标出来。 |
| 列主序 | column-major | 数组按列连续存放矩阵元素，WebGL 读数据的约定。 |
| 齐次坐标 | homogeneous coordinates | 给 3D 坐标补第 4 个数，让平移/旋转/缩放统一成矩阵乘法。 |
| 矩阵乘法 | matrix multiplication | 两台变换机器串联成一台的算法：新矩阵每格 = 左矩阵一行与右矩阵一列的点积；乘积从右往左作用。 |
| 变换顺序不可交换 | non-commutativity of transforms | 交换两台变换机器的先后，结果不同（T·R ≠ R·T）；写变换组合时顺序是设计决定，不是细节。 |
| 模型矩阵 | model matrix | 把物体从自家局部位置摆到世界里的矩阵。 |
| 投影 | projection | 把眼前的三维场景压进 [-1,1] 标准操场的那一步变换；与第 4 章的向量投影同名不同义。 |
| 透视投影 | perspective projection | 学人眼的投影：近大远小，透视除法把远处的落点向中心收。 |
| 正交投影 | orthographic projection | 平行投影：光线全平行，远近不影响大小，平行线保持平行。 |
| 宽高比 | aspect ratio | 画布宽除以高；透视矩阵用它预压 x，画布非正方形时圆不变椭圆。 |
| 视图矩阵 | view matrix | 把世界搬进相机眼前（相机坐回原点朝 -Z）的矩阵。 |
| 投影矩阵 | projection matrix | 把相机前方的三维场景压进 [-1,1] 标准操场的矩阵。 |
| 视锥体 | view frustum | 相机可见的空间：从眼睛出发被屏幕四边削出的一顶帐篷。 |
| 透视除法 | perspective divide | 坐标除以自身深度 w，近大远小的数学来源。 |
| 相机 | camera | 虚构的取景机器：眼在哪、看哪、头正不正三问的答案，全部由视图矩阵代办——WebGL 的 API 里没有相机这个岗位。 |
| 上向量 | up vector | lookAt 三要素之一，管「头正不正」：大致的头顶方向，内部扶正成严格垂直；与视线平行时 lookAt 退化。 |
| 正交基 | orthogonal basis | 两两垂直、各自单位长的向量组；lookAt 现造 f/s/u 三根正交基装出视图矩阵的旋转部分。 |
| MVP | model-view-projection | 模型、视图、投影三台矩阵的串联 P·V·M：坐标先过 M（摆进世界）、再过 V（搬到相机眼前）、最后过 P（压进操场）。 |
| 深度缓冲 | depth buffer | 每像素记录当前最近深度的清单，遮挡判断的账本。 |
| 深度测试 | depth test | 新片元与账本比远近，更近才许上屏的规则。 |
| 画家算法 | painter's algorithm | 按远近从后往前画、近者覆盖远者的整体排序画法；互相穿插或自翻折的面会失效，逐像素的深度测试才是完备解。 |
| 索引绘制 | indexed drawing | 顶点存一份、面用编号清单引用的复用画法（drawElements）。 |
| 缠绕方向 | winding order | 顶点连成面的时针方向，用于判定面的正反。 |
| 背面剔除 | backface culling | 背对相机的面直接不画的省事规则。 |
| 交错缓冲 | interleaved buffer | 把 position/normal/uv 等逐顶点属性按顶点挨个排进同一张表；取数按固定步长跳格，各属性按偏移对号。 |
| 纹理 | texture | 贴在表面的图片数据，由 GPU 按坐标取样。 |
| UV 坐标 | texture coordinates | 纹理上的归一化寻址坐标，左下角 (0,0) 到右上角 (1,1)。 |
| 纹素 | texel | 纹理里的一个像素。 |
| 采样 | sampling | 按 UV 从纹理取颜色的动作。 |
| 过滤 | filtering | UV 落在纹素之间时的取色策略：NEAREST 取最近块，LINEAR 调匀。 |
| 包裹方式 | texture wrapping | UV 越出 [0,1] 时的处理规则：REPEAT 取小数部分平铺贴图；CLAMP_TO_EDGE 摁在边缘，最后一排纹素被拉伸。 |
| 程序化纹理 | procedural texture | 用代码算出纹素数据的纹理——不读图片文件，图案即函数；零外部资源、可确定性重生成。 |
| 法线 | normal | 垂直于表面的单位向量，表面接光的姿势。 |
| 法线矩阵 | normal matrix | 模型矩阵的逆转置，把法线的垂直关系变换正确的专用矩阵。 |
| 环境光 | ambient light | 无方向兜底光，让背光面不至于纯黑。 |
| 漫反射 | diffuse reflection | 粗糙面把光向四面八方弹开的分量，正对光最亮。 |
| 高光 | specular highlight | 光滑面朝相机弹出的反光斑，光洁度越高越集中。 |
| Phong 光照模型 | Phong reflection model | 把表面亮度拆成环境光 + 漫反射 + 高光三个分量的经典光照模型（Bui Tuong Phong，1975）；不是物理精确，但便宜、直觉、效果像样。 |
| 场景图 | scene graph | 父子上级的层级结构，子物体坐标跟随父链组合。 |
| 局部矩阵 | local matrix | 节点相对父级的变换。 |
| 世界矩阵 | world matrix | 从根链乘到本节点的总变换，物体在世界里的最终姿势。 |
| 层级动画 | hierarchical animation | 每帧只改各节点的局部矩阵（自转角、公转角），世界坐标由 updateWorld 链乘自动结算的动画写法——父级一动，整棵子树跟着动。 |
| 遍历绘制 | traversal rendering | 深度优先走一遍场景树、每个节点用它当时的世界矩阵当模型矩阵画一次的绘制方式。 |
| 轨道相机 | orbit camera | 相机绕目标点沿球面转圈的查看方式。 |
| 偏航角 | yaw | 左右转头的角度。 |
| 俯仰角 | pitch | 上下点头的角度。 |
| 球坐标 | spherical coordinates | 用「转到哪边、抬多高、离多远」——两个角加一个半径——定位一个点的坐标法；轨道相机的眼位账本。 |
| 相机基向量 | camera basis | 相机自己的前、右、上三根两两垂直的单位向量；朝向与移动都沿它们走，不沿世界轴。 |
| 雾 | fog | 按距离把远处景物混入雾色的纵深手法；factor = smoothstep(near, far, 距离)，片元色 = mix(物体色, 雾色, factor)。 |
| 材质 | material | 形状的皮肤参数包：基础色、三件套强度、光洁度、自发光；纯数据可共享，挂在节点的 data 挂件上。 |
| 自发光 | emissive | 材质里不等光照、自己亮的分量 [0,1]；太阳靠它标记光源，演示里自发光免雾（光源穿雾可见）。 |
| 程序化布局 | procedural layout | 用一段代码加一个种子数决定什么东西摆在哪——代码是布局规则，种子是这一次的掷骰结果；同种子同世界。 |
| 渲染清单 | render list | 遍历场景树收集出的「这一帧画什么」数组：每行一个 (形状, 世界矩阵, 材质) 三元组，绘制只剩一个通用循环。 |
| 种子随机数 | seeded random number generator | 由种子数决定的固定随机序列：同种子从头再生成，每个数与顺序逐位相同——「按种子重建地图」的机关。 |
| GPU | graphics processing unit | 几千个简单计算单元并联的芯片，靠同时干活取胜，专吃图形这类重复计算。 |
| 渲染管线 | rendering pipeline | 从坐标到像素的三段流水线：顶点定位置、光栅化圈格子、片元上颜色。 |
| 帧率 | frame rate | 每秒画出的完整画面数；60fps 意味着每帧只有约 16.7ms 预算。 |
| 掉帧 | frame drop | 一帧没赶上屏幕刷新节拍，那一拍只能重复旧画面，看起来就是卡顿。 |
| 视锥剔除 | frustum culling | 收单前在 CPU 上用包围球判断物体整件在不在视锥（帐篷）内，帐外的不进渲染清单——省的是整次绘制调用；判定宁可错画、不可错删。 |
| 实例化渲染 | instanced rendering | 一份几何加一张实例表、一次绘制调用画 N 件同样物体的画法；每实例的顶点属性每件前进一步，省的是 CPU 侧逐件发单的固定开销——不是少画，是少跑腿。 |
| WebGL2 | WebGL 2.0 | WebGL 1 的下一代规范，基于 OpenGL ES 3.0 的严格超集（旧代码照跑）：实例化绘制转正、多渲染目标、非 2 幂纹理放开、GLSL ES 3.00、变换反馈、深度纹理原生。 |
| WebGPU | WebGPU API | WebGL 的继任者，架构对齐 Vulkan/Metal/Direct3D 12 一代本地图形 API：计算着色器一等公民、显式管线对象（创建时验证）、CPU 侧逐物体开销更低；着色语言为 WGSL。概念换名不换账。 |
