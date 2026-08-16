---
title: 指令集与标志位:补全官方 151 条
---

# 指令集与标志位:补全官方 151 条

你从一份老帖子里移植了一段现成的初始化代码,内容是循环算坐标:ADC 加偏移,然后 BCC 判断有没有进位。代码逻辑一目了然,跑起来却总往错误分支走。逐位排查后发现:你按无符号进位实现了 C,又随手把 V(溢出)实现成了「结果超过 255」——可 $7F + $01 时,无符号看是 $80(没进位,C=0),有符号看是从 +127 溢出到 -128(V=1)。**同一个加法,C 和 V 是两套世界观,标志位错一个,整棵分支树全错**,程序会走进从未被设计过的路径,而且每次现象还不一样。

这一章把官方 151 条指令全部补进表里,重点是让 N/V/Z/C 四个标志位的语义一个不错,再把每条指令的周期数挂上——周期不是学术细节,它就是下一部分 PPU 时序的推进燃料。

## 四个标志位,两套世界观

N 和 Z 很朴素:结果的第 7 位、结果是否为零。C 和 V 才是事故高发区:

- **C(进位)**:无符号世界的「第九位」。加法超过 $FF 置位;减法里语义反转——C=1 表示「没有借位」。CMP 的 C 就是「寄存器 ≥ 操作数」。
- **V(溢出)**:有符号世界(补码)的越界。只在 ADC/SBC 里有意义,判断式是「两个同号操作数相加,结果变号」。

V 的电路实现有一个所有 6502 文档都会给的位技巧,实验场原样采用:

```ts
// src/cpu.ts · adc
adc(m: number): void {
  // 2A03 砍掉了 BCD,SED 置位也不影响——始终按二进制算
  const sum = this.A + m + (this.P & FLAG_C ? 1 : 0)
  this.P = (this.P & ~(FLAG_C | FLAG_V)) | (sum > 0xff ? FLAG_C : 0)
  if (~(this.A ^ m) & (this.A ^ sum) & 0x80) this.P |= FLAG_V
  this.loadA(u8(sum))
}
```

`~(A ^ m) & (A ^ sum) & 0x80`——「操作数同号,且结果与 A 异号」时 V=1,一次与或就出结果。减法则完全不用另写:SBC 等于「加操作数的取反」,借位与进位共用同一套电路,真机也是如此:

```ts
// src/cpu.ts · sbc
sbc(m: number): void {
  // 减法 = 加「取反的操作数」,借位进位共用一套逻辑
  this.adc(m ^ 0xff)
}
```

顺带一个真机冷知识:NES 的 CPU(2A03)物理上砍掉了十进制模式,SED 置了位 ADC 也按二进制算。模拟器照抄这个行为,否则某些故意利用 BCD 缺陷的程序会算错。

## 151 条指令,四张工厂

上一章定下了「一个 opcode = {mn, mode, cycles, run}」的形状。151 条全写显式条目会淹没重点,实验场按寻址排布的规律分了四组工厂,放在独立的 `src/opcodes.ts`:

- `readFamily`:ADC/AND/CMP/EOR/ORA/SBC/LDA 共用「imm, zp, zpX, abs, absX, absY, indX, indY」八连排布,只是操作码基址不同——传进来一个「拿到内存值怎么办」的函数,八条记录一次生成;
- `writeFamily`:STA 一族,纯地址写;
- `rmwFamily`:ASL/LSR/ROL/ROR/INC/DEC 的读-改-写,「读内存、变换并置标志、写回」三步一样,变换函数注入;
- 剩下的单例(分支、栈、跳转、标志位、传送)显式一条条写。

```ts
// src/opcodes.ts · readFamily(节选)
function readFamily(codes: number[], mn: string, fn: (c: Cpu, v: number) => void): Row {
  const out: Row = {}
  out[codes[0]] = entry(mn, 'imm', 2, (c, v) => fn(c, v))
  READ_MODES.forEach(([mode, cycles, pc], i) => {
    out[codes[i + 1]] = entry(mn, mode, cycles, (c, a) => fn(c, c.mem.read(a)), pc)
  })
  return out
}
```

这样整张表缩到两百行以内,而每条指令的行为仍然是显式的。非法 opcode 一律不进表——`step()` 查不到就抛错,和「本课程只做官方指令」的边界一致。

## BRK、RTI 与 B 标志位

中断序列值得单独一节,因为它的细节最容易错。BRK 是一条一字节指令,行为却像两字节(后面跟一个被忽略的「签名字节」),压栈的返回点是「操作码地址 + 2」;硬件中断(NMI/IRQ)压栈的返回点是当前 PC。压栈的 P 里 B 标志的位置由来源决定:BRK 与 PHP 置位,硬件中断清零——这就是「怎么看栈上数据判断中断来源」的依据:

```ts
// src/cpu.ts · interrupt
interrupt(vector: number, isBrk: boolean): void {
  // BRK 的返回点是「操作码后第 2 字节」;硬件中断的返回点是当前 PC
  this.push16(isBrk ? u16(this.PC + 1) : this.PC)
  this.push8(this.P | (isBrk ? FLAG_B : 0))
  this.setFlag(FLAG_I, true)
  this.PC = this.read16(vector)
}
```

RTI 是对称的另一头:先弹 P(B 位丢弃、U 恒置位),再弹 PC,不加一。JSR/RTS 这对则差一个「压栈地址是 JSR 最后一字节的地址,RTS 弹出后加一」——四个字节的细节,错一处子程序返回就整体漂移。

## 周期表:跳转与跨页的账单

每条指令的周期数直接抄官方表格,实验场把「可变部分」压缩成两个开关:`pageCross`(读类指令跨页 +1)和 `branch`(跳转成功 +1,再跨页 +1)。上一章的 `branch()` 已经把这两个事实记在实例字段里,`step()` 统一结算:

```ts
// src/cpu.ts · cyclesOf
private cyclesOf(op: OpInfo): number {
  let cycles = op.cycles
  if (op.pageCross && this.pageCrossed) cycles++
  if (op.branch && this.branchTaken) {
    cycles++
    if (this.pageCrossed) cycles++
  }
  return cycles
}
```

注意写类指令(STA absX 固定 5 周期)不做跨页加成——硬件上写操作无论跨不跨页都要那个修正周期,账单在基础值里付过了。

## 验证

第一层是 `tests/instruction-set.test.ts` 的十九个用例:V 的正负溢出各一例、C 的借位语义、BIT 的三位来源、移位/旋转的进出位、BRK 压栈 P 带 B、RTI 后现场与返回点、JSR/RTS 往返、以及「不跨页 4 周期 / 跨页 5 周期」「分支不跳 2 / 同页跳 3 / 跨页跳 4」的周期账单。连同前几章累计 52 个用例全绿。

第二层拿出真家伙——nesdev 社区公开的测试 ROM 直接跑:

- **nestest**(自动化入口 $C000):跑完官方指令段约 5000 条指令,结果单元 $02/$03 双零(零失败),最后按设计停在非官方 opcode $04 上——我们的 CPU 对非法指令抛错,恰好成了官方段通过的证据。
- **instr_test 单项测试**(隐含/立即/零页/变址/绝对/间接八个 NROM 卡带):每个都完整跑完几十万条指令的全部官方子测试,状态字节 $0201 始终为 0(运行中无失败),同样停在「非法指令」子测试门口。

一块周期精确性测试卡带(cpu_timing_test)依赖真实 PPU 时序做同步,留到帧时序章有了真 PPU 再回来跑。

## 小结

官方 151 条指令补全,标志位语义与周期账单都有机械背书:N/V/Z/C 真值表用例、跨页与分支的周期差,以及两张真实测试 ROM 的零失败通过。CPU 这台「主唱」至此词全曲备,只欠节拍——下一部分进入 PPU,先从它挂在 CPU 总线上的那几个寄存器开始。

### 章末地图

- [PPU 寄存器与地址镜像](./06-ppu-bus-registers)——CPU 总线的另一半:$2000-$3FFF
- [帧时序:NMI 与主循环](./09-frame-timing)——interrupt() 迎来真正的调用者 NMI
- [精度阶梯](./12-accuracy-ladder)——非官方 opcode 要不要支持,是精度阶梯上的一个决策点
