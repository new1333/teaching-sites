---
title: 整机组装:从 .nes 字节到第一帧画面
---

# 整机组装:从 .nes 字节到第一帧画面

零件全对,整机黑屏——集成期的故障全长一个样。CPU 从 $8000 取不到指令,因为总线还没接卡带窗口;$4014 写进了虚空,因为 DMA 没在指令间隙执行;CHR-RAM 卡带的游戏写图案没生效,因为图案存储还挂在默认后端上。集成层的每一条断线都是「画面全黑」,而且没有任何报错告诉你断在哪一根。

这一章把这些线全部接通,做一次全链路的验收:从一段 .nes 字节流,到程序自己装填显存、画出画面、响应按键——以及一个能在浏览器里玩真 ROM 的 demo 页。

## NROM:最简单也最经典的映射器

第 2 章解析出的 Cartridge,现在要挂上总线。NROM 的映射规则只有三条:

- PRG 16KB:$8000-$BFFF 与 $C000-$FFFF 是同一块的两次出现(复位向量在 $FFFC,卡带必须出现在那个地址);
- PRG 32KB:$8000-$FFFF 直通;
- CHR:有 CHR-ROM 就直通给 PPU 的图案总线(只读);没有(块数为 0)就装一块可写的 CHR-RAM,游戏运行时自己写图案。

```ts
// src/nes.ts · loadRom(节选)
const mask = cart.prgRom.length === 0x4000 ? 0x3fff : 0x7fff
const prg = cart.prgRom
this.bus.cartRead = (a) => prg[a & mask]
if (cart.chrRom) {
  const chr = cart.chrRom // CHR-ROM:只读
  this.ppu.chr = { read: (a) => chr[a & 0x1fff], write: () => {} }
} else {
  this.ppu.chr = new ChrRam() // CHR-RAM:程序自己写图案
}
this.ppu.mirroring = cart.mirroring
this.cpu.reset()
```

第 6 章的总线委托、第 7 章的图案后端接口,全是为这一刻预留的接缝——`loadRom` 只是往缝隙里插板子,一行总线代码都不用改。装载非 NROM 卡带时明确抛错:「解析得了」和「跑得动」从此有了清晰的边界。

## 一张自制的测试卡带

端到端测试不用任何外部文件,程序是手写的机器码,iNES 头是测试里现拼的十六字节。程序的形状就是一篇微型「真机游戏开发指南」:

```ts
// tests/assemble-machine.test.ts · buildRom(节选)
p(0x0000, [0x78, 0xd8, 0xa2, 0xff, 0x9a]) // SEI CLD LDX #$FF TXS
p(0x0005, [0x2c, 0x02, 0x20, 0x10, 0xfb]) // w1: BIT $2002; BPL w1 —— 等 vblank 预热
// ……
p(0x0028, [0xa9, 0x00, 0x8d, 0x06, 0x20, 0xa9, 0x10, 0x8d, 0x06, 0x20]) // PPUADDR $0010
for (let i = 0; i < 8; i++) p(0x0032 + i * 5, [0xa9, 0xf0, 0x8d, 0x07, 0x20]) // 写 CHR-RAM 瓦片
// ……
p(0x1000, [0xa9, 0x01, 0x8d, 0x16, 0x40]) // NMI:strobe on
p(0x100a, [0xad, 0x16, 0x40]) // LDA $4016 —— 读 A 键
p(0x3ffa, [0x00, 0x90, 0x00, 0x80, 0x29, 0x90]) // 向量:NMI/复位/IRQ
```

它等两次 vblank、上传调色板、往 CHR-RAM 里写两块瓦片、往命名表写一格、开 NMI 与背景,然后主循环空转;NMI 例程每个 vblank 读一次手柄,按住 A 就把格 (2,0) 换成瓦片 2。这五十来行字节覆盖了真机游戏初始化的全部套路:预热等待、显存绕道写入、中断使能、主循环与中断分工。验收断言的是像素:`runFrame()` 三帧后 (0,0) 是程序写入的蓝色;按住 A 再跑两帧,(20,0) 亮起——**从 iNES 字节到 6502 执行到 PPU 渲染到手柄回读,一条不缺**。

写这张卡带时还踩到一个值得记一辈子的坑:第一版 NMI 例程写完显存就返回,画面却整体向上竖移了一格。原因是 $2006 的写入改了滚动暂存寄存器 t,下一帧预渲染行把被污染的 t 抄进了 v——**$2006 与 $2005 是同一套位,写显存的地址残留就是滚动量残留**。真机游戏每个 vblank 结尾都要重写一遍滚动,不是仪式,是止血。修正后的例程末尾补了两条指令把 PPUADDR 拉回 $2000。

## demo 页:浏览器里的整机

`demo/index.html` 加三十行 `demo/app.ts`:文件选择器读 .nes 字节流喂给 `loadRom`,`requestAnimationFrame` 每帧调 `runFrame()`,`putImageData` 上画布,键盘事件映射到 `setButton`。没有别的依赖——模拟器本来就是纯 TypeScript。

```ts
// demo/app.ts(节选)
const fb = machine.runFrame()
const d = image.data
for (let i = 0, j = 0; i < fb.length; i += 3, j += 4) {
  d[j] = fb[i]
  d[j + 1] = fb[i + 1]
  d[j + 2] = fb[i + 2]
  d[j + 3] = 255
}
ctx.putImageData(image, 0, 0)
```

实测:浏览器里打开页面、选一张 NROM 测试卡带,画布立刻出现逐帧渲染的画面(本课程仓库的验证记录里有一张 demo 页运行调色板演示的截图)。键位:方向键、Z = A、X = B、Enter = Start、右 Shift = Select。

demo 页虽小,架构上却完整:文件读取是宿主能力,帧循环是宿主调度,而模拟器本体——解析、执行、渲染、输入——全部来自课程代码,一行浏览器专用逻辑都没进 `src/`。这也是开头「CPU 不认识内存,内存是注入的」那刀分层的红利:**核心是纯函数式的黑盒,宿主随便换**——今天挂在浏览器的 rAF 上,明天可以挂到 Node 的测试循环或 RN 的 Surface 上。

## 验证

`tests/assemble-machine.test.ts` 五个用例:16K PRG 到 $C000 的镜像与复位向量、非 NROM 卡带拒绝装载、端到端渲染(CHR-RAM 上传→像素断言)、按键驱动画面变化、CHR-ROM 只读性。累计 102 个用例全绿。

对外部世界再交一次底:第 9 章起跑的那批真实测试卡带,在整机形态下同样成立——CPU 指令与周期(nestest、instr_test、cpu_timing_test 全过)、vbl_basics、sprite hit 的 basics 与 flip;而四张逐 dot 精度的卡带继续失败,留给下一章当目录。你手上这台机器的全部能力与全部边界,至此都有机械证据背书——这也是本课程对「代码完整可运行」四个字的兑现方式。

## 小结

总线缝隙插上 NROM 卡带,整机从 `new Nes()` 变成 `loadRom(bytes).runFrame()`;一张手写机器码的测试卡带把全链路钉死,浏览器 demo 把它交到任何人手里。课程的主线到此走完:三块芯片各就各位,一块 .nes 文件真正跑了起来。最后一章站在「能跑」的终点,往「像素级正确」的方向看。

### 章末地图

- [精度阶梯](./12-accuracy-ladder)——APU、mapper、逐周期精度:往哪走、怎么走
- 课程 README——demo 页的启动命令与键位
