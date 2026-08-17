---
title: 卡带与总线：内存是一排门牌号
---

# 卡带与总线：内存是一排门牌号

这一章的第一个坑，是我在写示例代码时亲手踩的：解析器读出了正确的 PRG 长度 16KB，测试却报错——`prgRom[0]` 期望 `0xA9`，读到的却是 `0`。调试半天，发现是自造卡带的文件头多写了一个 `0`：头从 16 字节变成 17 字节，整段 PRG 悄悄右移一位，解析器毫不报错，数据全错。第二个坑更诡异：往 `$0800` 写数据，`$0000` 处的变量莫名被改——这段内存没有 bug，是硬件本来就长这样，只是我还不知道。

这两个坑指向同一件事：在 8 位机的世界里，数据放在哪、从哪读，全都由门牌号决定。这一章我们把 ROM 文件解析成卡带，再铺好 CPU 眼里那条 64KB 的门牌街——它是后面所有章节的地基。

## 一、内存映射：把所有设备编进门牌

先想一个问题：CPU 想读手柄、想读显存、想读内存，难道要给每种设备造一套接口吗？1983 年的答案是：不造。CPU 只有一套地址线和一套数据线，统称总线（bus）——全机共享的一条干道，CPU 报一个 16 位门牌号，挂在对应门牌上的设备负责应答。

于是所有设备都被安排在同一个 64KB 门牌空间里，这套分房方案叫内存映射（memory map）——访问地址就等于访问设备。NES 的分房表如下，全书后面所有章节都在这张表里活动：

```text
$0000-$1FFF │ 2KB 内部 RAM（临时草稿纸），三段镜像
$2000-$3FFF │ PPU 的 8 个寄存器窗口（每 8 个门牌重复一次）
$4000-$401F │ APU 寄存器与手柄
$4020-$5FFF │ 卡带扩展区（NROM 不用）
$6000-$7FFF │ 卡带 RAM（存档用，本课程不用）
$8000-$FFFF │ 卡带 PRG（程序本体）
```

「2KB 内存」听起来寒酸得可笑——它就是 NES：整个游戏的所有变量、栈、临时数据都挤在这 2048 个字节里。也正因如此，1983 年的程序员对每一个字节都精打细算，这份约束我们到 CPU 章节会反复感受到。

## 二、镜像：一根没接的地址线

现在解释第二个坑：为什么写 `$0800` 会改到 `$0000`？

2KB RAM 需要 11 根地址线来寻址（2 的 11 次方 = 2048）。但 CPU 报门牌用的是 16 位，那多出来的 5 位怎么办？任天堂的省钱方案：不接。解码电路只看低 13 位门牌，`$0000`、`$0800`、`$1000`、`$1800` 这四段的低 13 位完全相同，全部命中同一块物理内存。这就是镜像（mirroring）——一间房挂了四个门牌，敲任何一个门，开的都是同一扇。

```text
CPU 报的门牌     $0805 = 0000 1000 0000 0101
                          ^^^ 前 3 位 RAM 根本没接线，直接忽略
RAM 收到的      $005 = 000    1000 0000 0101
于是 $0005、$0805、$1005、$1805 是同一格
```

省钱省出来的怪癖，模拟器必须原样复刻——真机程序可能故意利用镜像，比如用 `$1FFF` 读写栈顶，如果你的模拟器把它们当成四块独立内存，程序当场行为分裂。

## 三、iNES：卡带文件的字节布局

再说卡带。游戏本体在卡带的两个 ROM（read-only memory，只读存储器——出厂烧死、断电不丢的数据芯片）里：PRG ROM 装程序（给 CPU 的剧本），CHR ROM 装图形图案（给 PPU 的画册）。网上下载的 `.nes` 文件是卡带的完整拷贝，格式叫 iNES：16 字节文件头 + PRG + CHR，一字节不差地按顺序排。

文件头里本课程用到的字段只有五个：

```text
字节 0-3 │ 4E 45 53 1A —— 固定签名「NES␚」，不对就不是 .nes 文件
字节 4   │ PRG 数量（单位 16KB）
字节 5   │ CHR 数量（单位 8KB）
字节 6   │ bit0：0 水平镜像 / 1 垂直镜像；bit2：含 512 字节 trainer
字节 7   │ 与字节 6 的高 4 位合成 mapper 编号
```

mapper（映射器）——卡带上那块换页电路的编号。大容量游戏 PRG 超过 CPU 直接寻址能力，靠它把不同页轮换到 `$8000-$FFFF` 窗口。本课程只实现 0 号（NROM，无换页、直通），这是超级马里奥兄弟等早期卡带的方案；其他编号的原理留一句在附录，去向不展开。

解析逻辑本身很朴素：验签名、读尺寸、跳过可能的 trainer、切出两段。实现在 `src/cartridge.ts`：

```ts
// src/cartridge.ts · parseINES（节选）
export function parseINES(bytes: Uint8Array): Cartridge {
  for (let i = 0; i < 4; i++) {
    if (bytes[i] !== MAGIC[i]) throw new Error(`not an iNES file: bad magic`)
  }
  const prgBanks = bytes[4]            // 每单位 16KB
  const chrBanks = bytes[5]            // 每单位 8KB
  const flags6 = bytes[6]
  const mapper = (bytes[7] & 0xf0) | (flags6 >> 4)
  const hasTrainer = (flags6 & 0b100) !== 0
  const mirroring = (flags6 & 1) === 1 ? 'vertical' : 'horizontal'

  let offset = 16 + (hasTrainer ? 512 : 0)
  const prgRom = bytes.slice(offset, offset + prgBanks * 0x4000)
  offset += prgBanks * 0x4000
  const chrRom = bytes.slice(offset, offset + chrBanks * 0x2000)
  return { prgRom, chrRom, mapper, mirroring }
}
```

开头那个「多写一个 0」的坑，教训就在这张表里：`字节 4` 的 PRG 数量说 1，但头部真实长度只有代码说了算。结构化数据从来不会自己报错，它只是安静地错下去——所以我们的测试不只测长度，还测「PRG 首字节原样落到 `$8000`」这种内容级断言。

## 四、总线：一分发就完事

有了卡带，剩下的就是那条门牌街。`Bus`（总线）的 `read`/`write` 只做一件事：按门牌段分发。

```ts
// src/bus.ts · read（节选）
read(addr: number): number {
  addr &= 0xffff
  if (addr < 0x2000) {
    return this.ram[addr & 0x7ff]        // 2KB RAM：& 0x7ff 一刀切出镜像
  }
  if (addr < 0x4020) return 0            // PPU/APU 窗口：后续章接通
  if (addr < 0x8000) return 0            // 卡带扩展区：NROM 不用
  if (this.cartridge) {
    return this.cartridge.prgRom[addr & (this.cartridge.prgRom.length - 1)]
  }
  return 0
}
```

两处位运算是本章代码的精华，都来自第 1 章的套路：

- `addr & 0x7ff`：保留低 11 位，等于把没接线的高位直接扔掉——四段镜像一行代码复刻。
- `addr & (prgRom.length - 1)`：16KB PRG 长度是 2 的幂，减一得 `0x3fff` 恰好是低 14 位掩码。于是 `$8000-$BFFF` 读前半段，`$C000-$FFFF` 自动绕回前半段——NROM-128 卡带在真机上 `$C000` 段看到的就是同一块芯片，又是镜像，这次是卡带级镜像。

没插卡带或访问无人区时返回 0，这是开放总线（open bus）——真机上读无人认领的门牌，数据线上残留的通常是 0，我们按 0 约定。

## 五、造一张自己的卡带

真实 ROM 有版权，本课程从头到尾不碰。我们的做法：用代码现场拼一张最小 NROM 卡带——16 字节头 + 程序字节 + 图案字节，想要什么内容就写什么内容。

```ts
// src/fixtures/index.ts · makeNromCartridge
export function makeNromCartridge(opts: {
  prg: number[]
  chr?: number[]
  mirroring?: 'horizontal' | 'vertical'
}): Uint8Array {
  const { prg, chr = [], mirroring = 'horizontal' } = opts
  const header = [
    0x4e, 0x45, 0x53, 0x1a,             // 签名
    prg.length / 0x4000,                // PRG 单位数
    Math.ceil(chr.length / 0x2000),     // CHR 单位数
    mirroring === 'vertical' ? 0b0001 : 0b0000,
    0, 0, 0, 0, 0, 0, 0, 0, 0,          // 补齐 16 字节头
  ]
  return Uint8Array.from([...header, ...prg, ...chr])
}
```

「亲手造卡带」不只是规避版权：从这一章起，每个测试都是「我自己写一段程序字节 → 插进自己的模拟器 → 断言读回预期」，出题人和考生都是你。这比任何现成 ROM 都更能暴露理解盲区。

顺手还落了 `prgWithReset`：把程序放进 16KB PRG 并在末两格写好 `$FFFC/$FFFD`——这对门牌叫复位向量，CPU 开机第一件事就是来这读入口地址。它是谁、为什么在卡带末尾，下一章 CPU 开机的瞬间你会看得清清楚楚。

## 六、验证

跑起来看：

```text
$ pnpm test
 ✓ tests/03-cartridge-and-bus.test.ts (10)
   · PRG/CHR 尺寸、mapper 0、镜像方向解析正确
   · 坏签名抛错
   · RAM 四段镜像：写 $0005，$0805/$1005/$1805 同步可见
   · $8000 读到 PRG 首字节；$C000 段镜像一致
   · 开放总线：无人区读 0、写不炸
```

10 个断言全绿，其中最值钱的是内容级的两条：PRG 首字节原样落在 `$8000`、`$FFF0` 对应 PRG 末区——正是开头那个「多写一个 0」的坑逼出来的。

## 小结

- 总线是全机共享的干道，内存映射把 PPU、APU、卡带统统编进 CPU 的 64KB 门牌空间，访问地址即访问设备。
- 镜像是没接满的地址线省钱的副产品：RAM 四段共享 2KB、NROM-128 的 `$C000` 段共享 PRG 前半——模拟器必须原样复刻，一行位掩码就是全部实现。
- iNES 文件 = 16 字节头 + PRG + CHR；本课程 mapper 只做 0 号 NROM。
- 测试卡带全部自产：`makeNromCartridge` 现场拼字节流，出题人和考生都是自己。

自查：`addr & 0x7ff` 为什么恰好复刻镜像？16KB PRG 为什么天然镜像到 `$C000`？字节 4 写 1、头却实际 17 字节，解析器为什么不报错？下一章，CPU 开机——从复位向量起飞，第一次取指执行。

