---
title: 帧时序与中断：CPU 与 PPU 的双人舞
---

# 帧时序与中断：CPU 与 PPU 的双人舞

整机合练前的最后一块骨头，也是最典型的两个「合体即翻车」现场。第一个：CPU 跑得飞快、PPU 一动不动，游戏画面全黑——反汇编看，程序在一个 `BIT $2002; BPL` 循环里打转，它在等 VBlank 标志，而 PPU 没走时钟、标志永远不会置位，整机「假死」。第二个反过来：CPU 全速写画面数据、完全不看窗口，画面撕裂、色块乱闪——正在显示的半帧被拦腰改写。两个症状一静一动，病因是同一个：**两颗芯片没有按节拍共舞。**

这一章把第 2 章图景里的节拍器真正装上：主时钟（master clock，全机共享的节拍源）驱动 CPU 与 PPU 按 1:3 走、扫描线状态机走完一帧、VBlank 拉响收工铃、CPU 学会接电话。

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
  if (this.scanline === 240) {
    this.renderBackground()  // 一帧画完：帧缓冲定格有效
    this.renderSprites()
    this.vblank = true
    if ((this.ctrl & 0x80) !== 0) this.onNmi?.() // 收工铃
  } else if (this.scanline === 261) {
    this.vblank = false // 预取线：余音散去
    this.sprite0Hit = false
  } else if (this.scanline === 262) {
    this.scanline = 0
    this.frameCount++
  }
}
```

三处时序决策需要交代。其一，`262 × 341 = 89342`——细心的读者查资料会看到 NTSC 一帧是 89341.5 个 PPU 周期：真机奇数帧的预取线短半拍，我们不做奇偶帧区分，按定值 89342 走，对教学与游戏兼容性都无伤。其二，渲染在扫描线 240 整帧一次性完成，而不是真机的逐线实时取图——我们的渲染是离线函数，挂在「一帧刚画完」这个语义点上，帧缓冲内容与逐线渲染等价。其三，`sprite0Hit` 在预取线与 VBlank 一起复位：哨兵是每帧一次性用品。

## 三、NMI：收工铃的完整电路

第 2 章说 VBlank 开始时 PPU「拉响收工铃」，现在补全电路。铃声有两个串联开关：扫描线到达 240（`vblank` 置位），且 PPUCTRL bit7 是 1（程序明确订阅了这个通知）。两个条件同时满足，PPU 调用 `onNmi` 回调；NES 总装时把它接到 CPU 的 `nmi()`：

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

跑 `runFrame()`（从当前帧推到帧尾），六步全部发生。②的等待循环在扫描线 240 处解冻：BIT 读到 `$2002` 的 bit7 为 1，BPL 不再跳转。同拍的收工铃让 ⑤⑥ 抢在 ③ 之前执行。断言 `$0200 = 0x42`、`$0201 = 0x07`、`frameCount` 恰好 +1——等待、来电、干活、挂机，一条不缺。

回头看开篇两个症状的解法也就清楚了：假死，是因为只跑 CPU 不跑 PPU，`$2002` 的 bit7 永远不变，等铃循环转成了死循环——1:3 心跳就是解药；撕裂，是因为没等窗口就写画面数据——「改在 VBlank」这条纪律由游戏自己遵守（或用 sprite 0 hit 做更精细的时机判断），模拟器只需把窗口的时间点摆对。

## 五、验证

```text
$ pnpm test
 ✓ tests/10-frame-timing.test.ts (8)
   · 一帧 89342 拍整（262 × 341），frameCount 前进一格
   · VBlank：240 线置位、261 线清零
   · NMI 回调：bit7 开着一帧一响、关着不响
   · 中断序列：跳 $FFFA 向量、现场三字节入栈、耗 7 拍
   · RTI 完整恢复（含 handler 里改坏的标志）
   · 整机闭环：等 NMI → 窗口干活 → 处理程序留痕，一帧内全发生
   · 1:3 配比：2 拍指令推进 PPU 6 拍
```

88 个断言全绿（累计）。整机第一次按帧运转——大脑、画师、节拍器在同一时间轴上工作，这是全书承重最大的一章。

## 小结

- 1:3 心跳六行实现：指令返回的周期数 × 3 就是 PPU 的推进量。
- 一帧 262 线 × 341 拍 = 89342（我们不分奇偶帧，真机均值为 89341.5）；渲染挂在 240 线「帧刚画完」处。
- 收工铃两个串联开关：扫描线 240 + PPUCTRL bit7；铃声挂起，下条指令前执行中断序列。
- 中断序列：PC 与 P 入栈、i 置位、查 $FFFA 向量；RTI 逆序完整恢复。
- 「等 NMI → 窗口干活」闭环跑通，开篇的假死与撕裂两个症状都有了对应解。

自查：为什么 `runFrame` 结束时 frameCount 恰好 +1？NMI 处理程序里为什么还要 `RTI` 而不是 `RTS`？若程序从不开 bit7，VBlank 标志还会置位吗？下一章进入声音的世界：方波、包络与那个统管节奏的帧序列器——乐手登场。

