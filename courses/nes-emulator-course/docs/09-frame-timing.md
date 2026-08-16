---
title: 帧时序:NMI 与主循环
---

# 帧时序:NMI 与主循环

CPU 和 PPU 各自独立全速跑——这是第六种让画面黑掉的方式,也是最难排查的一种。游戏在 VBlank 里轮询 $2002 等标志位,你的置位时机差了半条扫描线,轮询窗口就永远错过;更隐蔽的是 NMI 从不触发的情形:VBlank 里上传显存的中断处理例程一次都没执行,画面永远停在第一帧,CPU 侧看不到任何异常,程序「正常地」死循环着。

这一章补全 PPU 时间轴的最后一段——VBlank 起止、NMI 拉线、奇偶帧跳点——然后用一个三行的主循环把 CPU 与 PPU 按 3:1 焊死。至此,第一章那张「三块芯片合奏」的图,全部落地成代码。

## VBlank 与 NMI:一帧里的两个时刻

前两章的 `tick()` 只管「画」;现在把「报时」补上。第一章说过,一帧以「扫描线与点」计量,而整个游戏世界的呼吸挂在垂直消隐(VBlank)与不可屏蔽中断(NMI)这对搭档上。一帧里有两个关键时刻:

- **(241, 1)**:VBlank 开始。vblank 标志置位;若 PPUCTRL 的 bit7 开着,NMI 线拉起。
- **(261, 1)**:预渲染行开始。vblank 标志清零,sprite 0 hit 与溢出标志也在这里清零。

```ts
// src/ppu.ts · tick 的时序段
if (this.scanline === 241 && this.dot === 1) {
  this.vblank = 1
  if (this.ctrl & 0x80) this.nmiAsserted = true
}
if (preRender && this.dot === 1) {
  this.vblank = 0
  this.sprite0Hit = 0
  this.spriteOverflow = 0
}
```

NMI 的「拉线」用软件的边沿语义表达:`takeNmi()` 取走请求,取走即回落——这正是整机主循环的粘合点。还有一个著名的边沿要在 PPUCTRL 的写入处理里补上:**vblank 期间才把 NMI 使能打开(0→1),线也要立刻拉起**。游戏世界里这不是冷知识,「先轮询标志、再补开 NMI」的初始化写法到处都是,少了这个使能沿,这类程序就少一次 NMI。

奇偶帧跳点也在这一章兑现:渲染开启时,奇数帧的预渲染行少走最后一个 dot,帧长在 89342 与 89341 之间交替——这个每帧一个 dot 的微小偏差,是 NTSC 制式下拉平整数行的历史遗产。第 7 章按下不表的「每帧 89342」在此修正——测试分别断言了渲染开/关两种情形下的偶奇交替。

还有一个实现上的简化要坦白:读 $2002 与 vblank 置位发生在同一个 dot 时的「抑制」行为(读到 0 且 NMI 被吞),真机有精确的仲裁规则,本课程按指令粒度无法复现,直接让读操作照常清标志。它的后果就是本章末尾成绩单里 suppression 那张卡带的失败——这类取舍都会在精度阶梯一章对号入座。

## CPU 侧:nmi() 与中断序列

指令集一章写的 `interrupt()` 在这里迎来真正的调用者:

```ts
// src/cpu.ts
nmi(): void {
  this.interrupt(0xfffa, false)
}
irq(): void {
  if (!(this.P & FLAG_I)) this.interrupt(0xfffe, false)
}
```

NMI 不可屏蔽(I 标志拦不住它),向量在 $FFFA;IRQ 受 I 屏蔽,向量在 $FFFE——本课程的整机没有 IRQ 中断源,但序列先备好。压栈的 P 里 B 位为 0,这正是 BRK 与硬件中断在栈上的唯一区别,测试里顺带验证了 RTI 之后栈指针复原。

## 主循环:三行 catch-up

整机外壳 `src/nes.ts` 是全课程最短、也最核心的一段:

```ts
// src/nes.ts · runFrame
while (!frameDone) {
  catchUp(this.cpu.step() * 3) // CPU 1 周期 = PPU 3 dot
  if (this.bus.runPendingDma()) {
    catchUp(513 * 3) // OAM DMA 偷走 513 个 CPU 周期
  }
  if (this.ppu.takeNmi()) this.cpu.nmi()
}
return this.ppu.frameBuffer
```

CPU 每执行一条指令,PPU 立刻补走三倍的 dot;指令若触发了 OAM DMA,补 513×3 个 dot;每条指令之间检查一次 NMI 线。这就是「指令级追赶」的全部——不做逐周期的交叉模拟,精度取舍留到最后一章算账。

## 验证

单元层:`tests/frame-timing.test.ts` 十一个用例——偶奇帧交替的 dot 数(渲染开 89342/89341,渲染关恒 89342)、(241,1) 置位与读清、(261,1) 硬件清零、每帧恰一次 NMI 且处理例程执行(INC 计数到 3)、不开 NMI 不触发、vblank 中段才使能也能触发、NMI 后栈复原、runFrame 返回帧缓冲、DMA 经主循环执行并完成搬运。累计 91 个用例全绿。

然后是这一章的硬菜——把第 5 章欠下的周期精确性测试卡带(cpu_timing_test)放到完整整机上跑。它用真实画面输出结果,跑满模拟时间的十六秒后,屏幕上先出现了这样的字样:

```text
FAIL OP :$11 WITH PAGE CROSS
EMULATOR: 5      CORRECT: 6
```

opcode $11 是 `ORA (zp),Y`。跨页时正确周期是 6,我们只算了 5——回查代码,`(zp),Y` 的寻址路径没有像 `absX/absY` 那样记录跨页标志,周期加成丢失。**三个月里所有单元测试都没抓到的 bug,被一张 1999 年风格的测试卡带一句话点名**。补上三行跨页判断,重跑:

```text
6502 TIMING TEST (16 SECONDS)
OFFICIAL INSTRUCTIONS ONLY
PASSED
```

全部官方指令的周期精度通过。同一批还跑了 PPU 时序类卡带:vbl_basics 与 sprite hit 的 basics/flip 通过;vbl_set_time、nmi_control、suppression、left_clip 失败——它们考察的是「标志在哪一个 dot 置位」「读 $2002 与 NMI 同拍谁赢」这类逐 PPU 周期的精度,指令级追赶天然给不出。这份成绩单就是最后一章精度阶梯的开场白:失败清单不是耻辱柱,是地图。

## 小结

时间轴补全:VBlank 起止、NMI 边沿、奇偶帧跳点;三行主循环把三块芯片焊成整机;周期精确性卡带从 FAIL 到 PASSED 的过程,顺带修掉了一个真实 bug。机器已经会画、会计时、会中断——还差两件事:手柄,和把真卡带插上去。

### 章末地图

- [手柄:一次移一位的串行输入](./10-controller-input)——$4016 接进总线的 ioRead/ioWrite
- [整机组装](./11-assemble-machine)——cartRead 缝隙换成真 NROM 卡带
- [精度阶梯](./12-accuracy-ladder)——本章失败的四张卡带,是那一章的目录
