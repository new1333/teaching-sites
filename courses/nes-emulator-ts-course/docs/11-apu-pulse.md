---
title: 方波、包络与节拍器：APU 的旋律声部
---

<script setup>
import dutyUrl from './assets/ch11-duty.wav'
import envelopeUrl from './assets/ch11-envelope.wav'
</script>

# 方波、包络与节拍器：APU 的旋律声部

第一次听到自己模拟器出声的程序员，多半经历过这个失望时刻：写好寄存器、攒出样本流、接上扬声器——出来的声音又闷又平，像隔着一堵墙的蜂鸣器。三个常见病因：把方波（square wave，只在高低两档间跳变的矩形波）想当然当正弦波合成，缺了 8 位机标志性的「棱角」；没做音量衰减，每个音符从满音量直进直出、没有打击感；节拍器没把各单元的步进统一起来，长度计数器永远不归零，一个音从头响到尾。这一章把方波双通道完整实现，三个病因逐一根治。

先补声音的最小背景。声音是空气振动，振动快慢决定音高（赫兹数），振幅大小决定音量。数字世界把连续振动按固定频率「量」成一串数字——这就是采样（sampling，把连续声波每秒量很多次、每次记一个振幅值）。每秒量的次数就是采样率（sample rate，数字音频的密度；CD 音质是每秒 44100 次）。而 NES 不采自然声，它用电路生成最原始的几种波形（waveform——声波随时间变化的形状曲线）：方波那凌厉的「哔哔」声，正是 8 位游戏音乐的标志音色。

## 一、方波通道解剖：三根旋钮

pulse 通道一次只发一个音，三根旋钮各管一件事：

**定时器 → 音高。**11 位定时器按 CPU 周期倒数，每 `(timer+1)×2` 个周期走一步序列，序列 8 步一循环。完整周期 = `8×(timer+1)×2` 个 CPU 周期，除以 CPU 频率 1789773 就是音高。跟着算一遍：想要标准音 A4（440Hz），`timer = 1789773 ÷ (440 × 16) − 1 ≈ 253`——测试卡带写的 `$FD` 就是它。

**占空比（duty cycle——一个周期里高电平占的比例）→ 音色。**同样是方波，高电平占 12.5% 和占 50% 听感完全不同：窄的尖锐、宽的圆润。不必靠想象——下面这段音频就是用实验场的 pulse 通道现场合成的同一音高（A4）依次过三种占空比，音色从「哔」到「呜」一听便知（生成方式见课程 README）。

<audio controls :src="dutyUrl"></audio>

四种波形各是 8 步 0/1 序列，硬编码成一张表：

```ts
// src/apu/pulse.ts · DUTY_TABLE
const DUTY_TABLE = [
  [0, 1, 0, 0, 0, 0, 0, 0], // 12.5%
  [0, 1, 0, 0, 0, 0, 1, 0], // 25%
  [0, 1, 1, 1, 1, 1, 1, 0], // 50%
  [1, 0, 0, 0, 0, 0, 0, 1], // 25%（反相）
]
```

**音量 0-15 → 响度。**$4000 的低 4 位是一格两读的字段。bit4 置 1 时它直接当恒定音量用，「像蜂鸣器」的直进直出音效选它；bit4 置 0 时它是包络分频器的分频值，音量交给那条衰减曲线。

## 二、包络：音量是条曲线，不是一个数

真实乐器没有「音量恒定」这回事：钢琴按下之后声音迅速衰减，鼓声更是一击即溃。方波通道用包络（envelope——随时间变化的音量曲线）模拟这件事：一个 15 级台阶从满音量逐级下行，行走的快慢由 divider（分频器，每 N 拍才走一档）控制。

```ts
// src/apu/pulse.ts · clockQuarter（包络每 quarter 节拍走一格，全文）
clockQuarter(): void {
  if (this.envelopeStart) {
    this.envelopeStart = false
    this.decay = 15
    this.envelopeDivider = this.volumeOrDiv
  } else if (this.envelopeDivider > 0) {
    this.envelopeDivider--
  } else {
    this.envelopeDivider = this.volumeOrDiv
    if (this.decay > 0) this.decay-- // 台阶下行，到 0 停住（halt 时循环重启不实现）
  }
}
```

包络的「重启」不在 quarter 拍上，而在写侧。每写一次 $4003（发新音符），通道立刻回到满音量、divider 重载，再交给 quarter 节拍往下走——新音符永远从最响起跑。

```ts
// src/apu/pulse.ts · writeReg 的 $4003 分支（节选）
case 3:
  this.length = LENGTH_TABLE[(val >> 3) & 0x1f]
  this.timerReload = (this.timerReload & 0xff) | ((val & 7) << 8)
  this.timer = this.timerReload
  this.dutyIndex = 0
  // 包络从头开始：立即满音量，之后按 quarter 节拍衰减
  this.decay = 15
  this.envelopeDivider = this.volumeOrDiv
  this.envelopeStart = false
  break
```

`divider = 0` 是最快档：每个 quarter 节拍掉一档，16 拍从 15 衰到 0——打击乐的短促感；`divider = 10` 则慢十倍，像风琴的尾音。两种设置各听一遍——同一通道、同一段合成代码，只有低 4 位不同。

<audio controls :src="envelopeUrl"></audio>

（前一段 divider=0，后一段 divider=10。）

## 三、长度与 sweep：两个自动机关

**长度计数器**：写 $4003 时从一张 32 档的硬编码表载入（10、254、20、2……这些别扭的数字是当年工程师选的，照抄；全表在[附录的寄存器速查表](./ppu-apu-registers)），此后每个 half 节拍倒数一次，到 0 静音。音符自动收声，程序不必回头关通道——「打一下就跑」的音效全靠它。halt 位（$4000 bit5）能挂住倒数：需要循环长音（背景音乐的主旋律）时挂住，写新音符时重载。

**sweep（弯音单元）**：按周期自动推拉定时器，音高就会滑——激光枪的「咻」、马里奥吃蘑菇的上扬音都是它。机制三件套：period（几拍弯一次）、shift（每拍弯多少）、negate（方向）。它跑在帧序列器的 half 节拍上：

```ts
// src/apu/pulse.ts · clockHalf 的 sweep 分支（节选）
if (this.sweepReload) {
  this.sweepDivider = this.sweepPeriod // 写 $4001 后的第一拍只重载
  this.sweepReload = false
  return
}
this.sweepDivider--
if (this.sweepDivider <= 0) {
  this.sweepDivider = this.sweepPeriod
  if (this.sweepEnabled && this.sweepShift > 0) {
    const delta = this.timerReload >> this.sweepShift
    const target = this.sweepNegate
      ? this.timerReload - delta - 1
      : this.timerReload + delta
    if (target >= 8 && target <= 0x7ff) this.timerReload = target
  }
}
```

跟着算一遍：`timerReload = $FD`（253，即 A4）、period=1、shift=1、negate=0。写完 $4001 的第一个 half 拍只重载分频器、音高不动；从下一拍起每拍 `delta = 253 >> 1 = 126`，`target = 253 + 126 = 379`——查第 1 节的公式，379 对应约 294Hz，正好是从 A4 滑到 D4。两拍滑一个大二度，「咻」就是这么来的。若 negate=1：`target = 253 - 126 - 1 = 126`，对应约 881Hz（A5）——减方向多减的那个 1 是硬件怪癖，照抄。target 落进禁区（低于 8 或高于 $7FF）时不更新并静音通道——sweep 把自己滑出硬件边界时的保险丝。

## 四、帧序列器：全 APU 的节拍器

包络按 quarter 节拍走、长度和 sweep 按 half 节拍走——节拍从哪来？帧序列器（frame counter，APU 里统管各单元步进节奏的计数器）每帧打四拍：第 1、3 拍是 quarter（快拍，包络），第 2、4 拍再加 half（慢拍，长度与 sweep）。四步模式下一帧 4 个 quarter、2 个 half，换算成 CPU 周期：quarter 每 7457 拍、half 每 14914 拍。$4017 写寄存器可以换五步模式与中断开关，本课程固定四步、不开中断，[附录速查表](./ppu-apu-registers)里留了它的位置。

```ts
// src/apu/index.ts · tick 的节拍核心（节选）
if (this.cycleInFrame % QUARTER === 0) {
  this.pulse1.clockQuarter()
  this.pulse2.clockQuarter()
  if ((this.cycleInFrame / QUARTER) % 2 === 0) { // 第 2、4 拍
    this.pulse1.clockHalf()
    this.pulse2.clockHalf()
  }
}
```

采样输出也在 tick 里：每 40 个 CPU 周期把两路方波的当前电平加起来推一个样本（1789773 ÷ 40 ≈ 44.7kHz，常用的音频采样率量级）。两通道电平各自 0-15，线性相加除以 30 归一——真机的混音是一条非线性公式，听感更好，教学上线性版足够把「非静音、会衰减、会收声」这些行为讲干净。

## 五、位打包的现世报

这一章的调试留下一个绝妙的回旋镖。第 1 章讲过「一个字节的 8 个格子当 8 个开关用」，本章 $4000 就是活例：bit7-6 占空比、bit5 halt、bit4 恒定音量、bit3-0 音量。结果我在测试里亲手踩了两次同一类坑：`0b10111111` 本想写「duty 2 + 满音量」，bit5 那个 1 把 halt 也顺手打开了，长度永不耗尽；`0b11110000` 本想写「duty 3 + 包络模式」，bit4 的 1 又把恒定音量打开、音量位全 0——通道静音。**打包位里多写一个 1，语义就悄悄偏移一格**，这正是位打包的日常：第 1 章的开关比喻不是铺垫知识，是每章都在生效的肌肉记忆。防呆手段也简单：测试里给每个位段加注释（`// duty 2(50%)、halt=0、恒定音量=15`），写错时第一眼就能对上。

## 六、验证

```text
$ pnpm test
 ✓ tests/11-apu-pulse.test.ts (10)
   · 四种占空比的 8 步序列逐位断言
   · 定时器 → A4：装载 $FD 出非静音样本流
   · 长度计数器按 half 节拍倒数归零；halt 位挂住不走
   · 包络从 15 逐级衰减；帧序列器 quarter 节拍驱动衰减可闻
   · sweep 两拍节奏：重载拍不动、次拍弯音（negate 多减 1）
   · $4015 状态位随长度同步；未启用通道全静音
```

累计 98 个用例全绿（本章 10 个；`pnpm typecheck` 同轮通过）。总线上 $4000-$4017 段已经接通，整机心跳里 APU 与 CPU 同拍前进。想实时听自己的成果：`cd companion && pnpm dev` 打开试机台，写寄存器、出声音，全在浏览器里。乐手的旋律组到齐，低音与打击乐在下一章入场，手柄、混音收尾、整机开机也在那里等你。

## 小结

- 方波三旋钮：定时器定音高（A4 ≈ 253）、占空比定音色（四种 8 步序列）、音量 0-15。
- 包络是 15 级下行台阶，divider 控制步速；恒定音量位可绕过。
- 长度计数器查表 32 档、half 节拍倒数、halt 挂住；sweep 按周期推拉定时器，禁区静音。
- 帧序列器每帧 4 quarter + 2 half，是全 APU 的节拍器；每 40 CPU 周期出一样本（≈44.7kHz）。
- 位打包一个 1 都不能多写——注释位段是最便宜的防呆。

自查：$FD 为什么是 A4？divider=0 与 divider=10 的包络听感差在哪？为什么主旋律通常挂 halt 而音效不挂？下一章三角波低音、噪声打击乐、手柄入岗，整机第一次开机出画面出声音。

