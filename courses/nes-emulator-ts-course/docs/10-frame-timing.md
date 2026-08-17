---
title: 帧时序与中断：CPU 与 PPU 的双人舞
---

# 帧时序与中断：CPU 与 PPU 的双人舞

整机合练前的最后一块骨头，也是最典型的两个「合体即翻车」现场。第一个：CPU 跑得飞快、PPU 一动不动，游戏画面全黑——反汇编看，程序在一个 `BIT $2002; BPL` 循环里打转，它在等 VBlank 标志，而 PPU 没走时钟、标志永远不会置位，整机「假死」。第二个反过来：CPU 全速写画面数据、完全不看窗口，画面撕裂、色块乱闪——正在显示的半帧被拦腰改写。两个症状一静一动，病因是同一个：**两颗芯片没有按节拍共舞。**

这一章把第 2 章图景里的节拍器真正装上。主时钟（master clock，全机共享的节拍源）驱动 CPU 与 PPU 按 1:3 走；扫描线状态机走完一帧；VBlank 拉响收工铃；CPU 学会接电话。

## 一、心跳落地：一条指令配三倍拍数

主时钟（master clock——全机共享的节拍源）在真机上是那块每秒振动两千多万次的石英；在模拟器里不需要真振动，只需要保住比例。CPU 每执行一条指令，`step()` 从第 4 章起就返回了它花的拍数——伏笔在此兑现：

```ts
// src/nes.ts · stepInstruction（1:3 心跳的全部实现）
stepInstruction(): void {
  const cycles = this.cpu.step()
  for (let i = 0; i < cycles * 3; i++) this.ppu.tick()
}
```

六行代码，是整机的心脏。CPU 动一步，PPU 动三步，每一条指令的执行时间都自动换算成 PPU 的推进量。从这一刻起，读 `$2002` 的值、sprite 0 hit 的时机、VBlank 的窗口，全部和 CPU 的指令流锁在同一个时间轴上。

## 二、扫描线状态机：一帧的账本

PPU 的 `tick()` 从第 7 章的「只计数」长成状态机。每 341 拍走完一条扫描线，一帧 262 条线，账本如下：

```ts
// src/ppu/index.ts · tick 的状态机（节选）
if (this.cycle === 341) {
  this.cycle = 0
  this.scanline++
  if (this.scanline === 241) {
    // 第 241 线起进 VBlank 窗口（真机时序：240 是收尾空行）：帧缓冲此刻定格有效
    this.renderBackground()
    this.renderSprites()
    this.vblank = true
    if ((this.ctrl & 0x80) !== 0) this.onNmi?.() // 收工铃
  } else if (this.scanline === 261) {
    this.vblank = false // 预取线：余音散去
    this.sprite0Hit = false
    // 滚动装载：暂存指针整体抄进 v，定格为本帧渲染起点（第 7 章 t/v 的伏笔在此兑现）
    this.v = this.t
    this.renderV = this.v
    this.renderFineX = this.fineX
  } else if (this.scanline === 262) {
    this.scanline = 0
    this.frameCount++
  }
}
```

四处时序决策需要交代。其一，`262 × 341 = 89342`——细心的读者查资料会看到 NTSC 一帧是 89341.5 个 PPU 周期：真机奇数帧的预取线短半拍，我们不做奇偶帧区分，按定值 89342 走，对教学与游戏兼容性都无伤。其二，VBlank 与渲染挂在第 241 线，与真机时序一致——可见区画完（0-239）、第 240 线收尾歇一拍、241 线拉铃，前几章文档里「扫完可见区进窗口」说的就是这件事。其三，渲染在窗口起点整帧一次性完成，而不是真机的逐线实时取图——我们的渲染是离线函数，挂在「一帧刚画完」这个语义点上，帧缓冲内容与逐线渲染等价；`sprite0Hit` 在预取线与 VBlank 一起复位，哨兵是每帧一次性用品。其四，预取线里那三行「滚动装载」：`$2005/$2006` 平时只写暂存指针 `t`，每帧预取线才把 `t` 整体抄进工作指针 `v`——装填与生效分离，滚动参数不会弄脏正在画的这一帧（第 7 章末埋的问题至此有了答案）。

## 三、NMI：收工铃的完整电路

第 2 章说 VBlank 开始时 PPU「拉响收工铃」，现在补全电路。铃声有两个串联开关：扫描线到达 241（`vblank` 置位），且 PPUCTRL bit7 是 1（程序明确订阅了这个通知）。两个条件同时满足，PPU 调用 `onNmi` 回调；NES 总装时把它接到 CPU 的 `nmi()`：

```ts
// src/nes.ts · 构造函数里的接线（节选）
this.ppu.onNmi = () => this.cpu.nmi() // 收工铃接线
```

CPU 侧，`nmi()` 只是记下「电话响了」。真正的中断序列（interrupt sequence——CPU 响应硬件电话的标准动作）发生在下一条指令执行之前。

```ts
// src/cpu/index.ts · step 开头（节选）
if (this.nmiPending) {
  this.nmiPending = false
  this.push(hi(this.pc))        // 现场一：回程门牌
  this.push(lo(this.pc))
  this.push(this.getP(false))   // 现场二：六张便签打包
  this.i = true                 // 通话中免打扰（屏蔽后续可屏蔽中断）
  this.pc = word(this.bus.read(0xfffa), this.bus.read(0xfffb)) // 查 $FFFA 向量表
  return 7
}
```

第 3 章埋的另一条伏笔在此揭晓：`$FFFC/$FFFD` 是复位向量，而 `$FFFA/$FFFB` 是 NMI 向量——卡带末尾那张向量表，`$FFFA` NMI、`$FFFC` 复位、`$FFFE` IRQ，三对门牌各管一种「开机或来电」。处理程序末尾一条 `RTI` 逆序弹回 P 和 PC，CPU 若无其事地继续——测试里专门断言了「handler 里把 C 改成 0，RTI 后 C 照样回到 1」：现场保存与恢复是完整闭环。

## 四、闭环：等窗口、接电话、改画面

所有部件就位，「等 NMI → 在 VBlank 里改画面」——几乎所有 NES 游戏主循环的形状——可以真正跑起来了。测试卡带里的完整程序：

```text
main:
  LDA #$80; STA $2000   ① 订阅收工铃（PPUCTRL bit7 = 1）
wait:
  BIT $2002; BPL wait   ② 死等：读状态字，bit7 = 0 就原地打转
  LDA #$42; STA $0200   ③ 铃响了 = 进窗口：抓紧干活（此处以写 $0200 为记号）
  JMP wait              ④ 回去等下一帧
nmi（$9000，登记在 $FFFA 向量）:
  LDA #$07; STA $0201   ⑤ 接电话：处理程序做自己的记号
  RTI                   ⑥ 挂电话，回到被打断处
```

跑 `runFrame()`（从当前帧推到帧尾），六步全部发生。把②解冻的那一拍放大成账本，「⑤⑥ 为什么抢在 ③ 之前」就有了逐拍的答案：

```text
某条指令执行完毕，随后那批 PPU tick 把扫描线推过 241：
  vblank 置位 → PPUCTRL bit7=1 → onNmi() → cpu.nmiPending = true
下一条 step() 开门第一件事：先查电话——
  nmiPending 在手 → 中断序列：压 PC/P、跳 $FFFA → $9000
    ⑤ LDA #$07; STA $0201   处理程序留痕
    ⑥ RTI                   弹回被打断处，继续原指令流
这才轮到主循环自己的下一轮：
  ② BIT $2002 读到 0x80（bit7=1 → N=1），BPL 不再跳转
    ③ LDA #$42; STA $0200   窗口里干活
    ④ JMP wait              回去等下一帧
```

「先查电话、再取指令」就是 ⑤⑥ 抢先的全部原因——不是魔法，是 `step()` 开头那四行的顺序。断言 `$0200 = 0x42`、`$0201 = 0x07`、`frameCount` 恰好 +1——等待、来电、干活、挂机，一条不缺。

一个刻意的省略要说破：本章闭环里「窗口里干的活」用写 `$0200` 记号字节代替，真正改 nametable、点亮第一幅画面，留到第 12 章整机开机。先把「窗口确实开了、电话确实通了」这两环各自验死，最后一步合体才不会满屏嫌疑。

回头看开篇两个症状的解法也就清楚了：假死，是因为只跑 CPU 不跑 PPU，`$2002` 的 bit7 永远不变，等铃循环转成了死循环——1:3 心跳就是解药；撕裂，是因为没等窗口就写画面数据——「改在 VBlank」这条纪律由游戏自己遵守（或用 sprite 0 hit 做更精细的时机判断），模拟器只需把窗口的时间点摆对。

## 五、验证

```text
$ pnpm test
 ✓ tests/10-frame-timing.test.ts (8)
   · 一帧 89342 拍整（262 × 341），frameCount 前进一格
   · VBlank：241 线置位、261 线清零（240 是收尾空行）
   · NMI 回调：bit7 开着一帧一响、关着不响
   · 中断序列：跳 $FFFA 向量、现场三字节入栈、耗 7 拍
   · RTI 完整恢复（含 handler 里改坏的标志）
   · 整机闭环：等 NMI → 窗口干活 → 处理程序留痕，一帧内全发生
   · 1:3 配比：2 拍指令推进 PPU 6 拍
```

累计 88 个用例全绿（本章 8 个；`pnpm typecheck` 同轮通过）。整机第一次按帧运转——大脑、画师、节拍器在同一时间轴上工作，这是全书承重最大的一章。

## 小结

- 1:3 心跳六行实现：指令返回的周期数 × 3 就是 PPU 的推进量。
- 一帧 262 线 × 341 拍 = 89342（我们不分奇偶帧，真机均值为 89341.5）；VBlank 与渲染挂在 241 线（240 是收尾空行）；预取线把暂存指针 t 抄进 v——装填与生效分离。
- 收工铃两个串联开关：扫描线 241 + PPUCTRL bit7；铃声挂起，下条指令前执行中断序列（先查电话、再取指令）。
- 中断序列：PC 与 P 入栈、i 置位、查 $FFFA 向量；RTI 逆序完整恢复。
- 「等 NMI → 窗口干活」闭环跑通，开篇的假死与撕裂两个症状都有了对应解。

自查：为什么 `runFrame` 结束时 frameCount 恰好 +1？NMI 处理程序里为什么还要 `RTI` 而不是 `RTS`？若程序从不开 bit7，VBlank 标志还会置位吗？下一章进入声音的世界：方波、包络与那个统管节奏的帧序列器——乐手登场。

