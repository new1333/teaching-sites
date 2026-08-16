# 用 TypeScript 从零写一台 NES:NES 模拟器原理与实现

一门 12 章的动手课程:从解析 .nes 文件起步,经 6502 指令集、总线与镜像、PPU 渲染流水线、帧时序,最终组装成一台**能加载真实 ROM、可在浏览器游玩**的 NES 整机——约 2900 行 TypeScript(核心 1200 行 + 测试 1450 行 + demo),每一步都有单元测试与社区测试卡带背书。

## 怎么跑

```bash
# 方式一:项目根聚合站(推荐)——首页是全部课程的卡片列表
pnpm install
pnpm dev          # 根目录执行,浏览器打开提示的地址

# 方式二:只看本课程
cd courses/nes-emulator-course
pnpm install
pnpm docs:dev
```

### 伴生实验场(课程的最终产物)

```bash
cd courses/nes-emulator-course/companion
npm install        # 或 pnpm install
npm test           # 102 个用例:vitest run
npm run typecheck  # tsc --noEmit

# 浏览器 demo:加载本地 .nes(NROM),键盘当手柄
npm run demo:build
npx serve .        # 打开 http://localhost:3000/demo/
# 键位:方向键 = 十字键;Z = A;X = B;Enter = Start;右 Shift = Select
```

### 对真实测试卡带复跑(作者侧验证)

nesdev 社区公开的测试 ROM 放在 `.course/roms/`(不入库,可自行下载),配套脚本:

```bash
cd companion
npx tsx verify/list-roms.ts                        # 解析所有 ROM 的头字段
npx tsx verify/run-rom.ts ../.course/roms/nestest.nes   # CPU 级(自动化入口:C000)
npx tsx verify/run-rom.ts ../.course/roms/cpu_timing_test.nes 1100  # 周期精确性(16 秒)
npx tsx verify/dump-frame.ts <rom> 300 out.png     # 把画面导出成 PNG 看结果
```

已验证通过:nestest(官方指令段)、instr_test 八个单项、cpu_timing_test(全部官方指令周期)、vbl_basics、sprite hit basics/flip;vbl_set_time 等 4 张逐 dot 精度卡带未通过——那是第 12 章「精度阶梯」的内容。

## 章节目录

| # | 章 | 内容 |
|---|---|---|
| 1 | 三块芯片的合奏 | 硬件全景、3:1 时钟、模块边界 |
| 2 | iNES 格式 | 把 .nes 拆成 Cartridge |
| 3 | 6502 最小核心 | 寄存器、复位向量、取指循环 |
| 4 | 寻址模式 | 13 种取数路径与硬件 bug |
| 5 | 指令集与标志位 | 官方 151 条、N/V/Z/C、周期表 |
| 6 | PPU 寄存器与地址镜像 | 总线路由、$2000-$2007 副作用、Loopy 寄存器 |
| 7 | 背景渲染 | 8 dot fetch 流水线、移位寄存器、滚动 |
| 8 | 精灵、OAM DMA 与 sprite 0 hit | 每线 8 个、优先级、$4014 |
| 9 | 帧时序 | VBlank/NMI/奇偶帧、catch-up 主循环 |
| 10 | 手柄 | strobe 与移位寄存器 |
| 11 | 整机组装 | NROM、端到端测试卡带、浏览器 demo |
| 12 | 精度阶梯 | 从能跑到像素级正确的路线图 |

## 终点里程碑

读完你拥有一台完整可运行的最小 NES:`Nes.loadRom(bytes).runFrame()` 输出 256×240 RGB 帧缓冲,demo 页能加载本地 .nes 用键盘实际游玩;验证方式是 102 个单元断言 + 「自制 .nes 测试卡带从解析到渲染出可断言像素」的端到端测试 + 真实社区测试卡带。
