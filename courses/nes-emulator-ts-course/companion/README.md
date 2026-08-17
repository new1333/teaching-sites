# 伴生实验场

「用 TypeScript 造一台 NES」课程的全程代码：每章一份源文件、一份测试。

```bash
pnpm install

# 跑全部测试（117 个断言）
pnpm test

# 打开浏览器试机台：canvas 画面 + 音频 + 键盘手柄
pnpm dev
```

试机台开机即插着课程自产的内置试机带（棋盘背景 + 方向键推动的笑脸精灵），也可以拖一张 mapper 0 的 `.nes` 文件到页面上换卡带。按键：方向键 = 十字键，`X` = A，`Z` = B，`Enter` = Start，`Shift` = Select。

文件地图：`src/` 是按章落成的模拟器本体，`src/demoRom.ts` 与 `src/main.ts` 是试机台的卡带与浏览器入口，`tests/` 与章节一一对应。
