# 关于本课程

这是一门「从零造一台 NES」的实现课：输入是一句主题——**使用 TypeScript 实现 NES 模拟器**，产物是你亲手写下的一台约 1400 行的最小模拟器，以及它跑起来的第一声开机音。

全书 12 章（12/12 完成无降级），从二进制地基一路走到整机合体：CPU 五十六条指令、PPU 的图块渲染与精灵、四通道 APU、手柄与中断时序。每一章先写测试（先红）、再实现（转绿）、最后成文——`companion/` 里的 117 个用例就是全书的机械目录。

本课程不使用任何有版权的 ROM：所有测试卡带由课程自产的 fixture 代码现场拼出，「亲手造卡带验证自己的模拟器」本身是教学设计的一部分。

## 怎么跑

```bash
# 聚合站预览（推荐）：在项目根目录
pnpm dev

# 单独预览本课程
cd courses/nes-emulator-ts-course
pnpm install && pnpm docs:dev

# 跑伴生实验场的全部测试
cd courses/nes-emulator-ts-course/companion
pnpm install && pnpm test

# 浏览器试机台：canvas 画面 + 声音 + 键盘手柄，内置试机带开机即玩
cd courses/nes-emulator-ts-course/companion
pnpm dev
```

## 读法建议

- 按章序读：每章依赖前面的成果，滚动摘要在每章小结里自然衔接。
- 动手派读者：先读附录的练习路线，清空 `companion/src/` 自己从红到绿写一遍。
- 卡住时翻两张速查表：6502 指令表、PPU/APU 寄存器表。
