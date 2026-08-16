---
title: iNES 格式:拆开一张卡带
---

# iNES 格式:拆开一张卡带

你从网上下载了一个 .nes 文件,十六进制编辑器打开一看:开头是 `4E 45 53 1A`——嗯,`NES` 加一个怪字符。然后呢?你决定「 pragmatically 猜一下」:程序应该从头往后某处开始,于是把文件按 16KB 切了一刀,把前半段当作 PRG-ROM 灌进模拟器。反汇编出来的第一条指令是非法 opcode,后面全是乱码。

折腾一小时后你才发现:这个文件的第 6 个字节标记着「带 512 字节 trainer」,你的数据区整体错了 512 字节。**文件头里明明每个字段都写得清清楚楚,只是没逐位去读**。这一章就把这 16 个字节彻底拆开——这是整台模拟器里性价比最高的 40 行代码:写对它,任何真机卡带都能被你的程序「看见」。

## 卡带在文件里长什么样

iNES 是模拟器社区的事实标准格式(后来被 NES 2.0 向后兼容地扩展)。一个 .nes 文件就是一张卡带的逐字节转储:

```text
偏移   字节数   含义
0      4        魔数:4E 45 53 1A("NES\x1A")
4      1        PRG-ROM 大小,单位 16KB
5      1        CHR-ROM 大小,单位 8KB;0 表示卡带上没有 CHR(用可写的 CHR-RAM)
6      1        flags6:bit0 镜像方向 / bit2 有 trainer / bit3 四屏镜像 / 高 4 位 mapper 低半
7      1        flags7:高 4 位 mapper 高半 / bit2-3 格式版本
8-15   8        保留(NES 2.0 会用到第 8、9 字节)
---    512      trainer(可选,模拟器直接跳过)
---    N×16KB   PRG-ROM(CPU 读的程序)
---    N×8KB    CHR-ROM(PPU 读的图案)
```

三个容易翻车的点,恰好就是开章故事里的坑:

1. **大小字段是「块数」不是「字节数」**——`data[4] = 2` 意思是 32KB,不是 2 字节。
2. **trainer 是插在头和 PRG 之间的 512 字节**,历史遗留物,模拟器用不到,但必须跳过,否则后面全部错位。
3. **mapper 号被劈成两半**——低 4 位在 flags6 的高 nibble,高 4 位在 flags7 的高 nibble,拼起来才是完整编号。

镜像(mirroring)标志位决定 PPU 命名表怎么折叠:flags6 bit0 为 0 是水平镜像,为 1 是垂直镜像;bit3 置位则表示卡带自带四屏显存,前两位都不用看。这个字段现在只是存进 Cartridge,要到讲 PPU 显存时才会真正用上——但你必须在解析时把它留下,不然到时候得回头重写。

还有一些字段我们读完就丢:flags6 的 bit1 表示卡带带电池供电的存档 RAM,bit4-7 在老 iNES 里属于「街机机台专用」,模拟器一律不碰。解析器的态度应该是「每个位都看一眼,用不上的明确忽略」——静默跳过和错误实现之间,前者只是少个功能,后者会变成查不出来由的错帧。

另外值得理解的是 NES 2.0 为什么存在:老 iNES 把 PRG 大小限制在一个字节,超过 4096KB 的自制卡带、带 PRG-RAM 的特殊板子都塞不下。NES 2.0 用第 9、10 字节扩展了这些字段。本课程只读它的 mapper 位宽,其余字段同样「看过即弃」——这个度,够跑通 NROM 整机,又不至于让解析器膨胀成格式百科。

## 动手:parseINES

实验场的完整实现只有 40 余行,在 `src/ines.ts`。核心结构先定义出来:

```ts
// src/ines.ts · Cartridge
export type Mirroring = 'horizontal' | 'vertical' | 'fourScreen'

export interface Cartridge {
  prgRom: Uint8Array
  /** null 表示卡带上没有图案 ROM,PPU 侧用可写的 CHR-RAM 代替 */
  chrRom: Uint8Array | null
  mapper: number
  mirroring: Mirroring
}
```

`chrRom: Uint8Array | null` 这个类型是故意的:CHR-ROM 缺席(块数为 0)在真机上意味着卡带给了 PPU 一块可写的 CHR-RAM,游戏在运行时自己把图案写进去。类型上区分「有只读图案」和「无图案」,后面组装整机时就不会混淆。

解析主流程,注意每一步都在「校验后前进」:

```ts
// src/ines.ts · parseINES(节选)
if (data[0] !== 0x4e || data[1] !== 0x45 || data[2] !== 0x53 || data[3] !== 0x1a) {
  throw new Error('iNES:magic 错误,不是 .nes 文件')
}
const isNes20 = (flags7 & 0x0c) === 0x08

let mapper = (flags7 & 0xf0) | (flags6 >> 4)
if (isNes20) mapper |= (data[8] & 0x0f) << 8

const mirroring: Mirroring =
  flags6 & 0x08 ? 'fourScreen' : flags6 & 0x01 ? 'vertical' : 'horizontal'

let off = 16
if (flags6 & 0x04) off += 512 // trainer,整体跳过
```

版本判定值得多说一句:flags7 的 bit2-3,`00` 是老 iNES,`10` 是 NES 2.0。NES 2.0 把 mapper 号扩到 12 位,多出的 4 位在文件头第 8 字节的低 nibble。真实世界里还存在 bit2-3 = `01` 或 `11` 的脏文件——那是早期工具的乱写,一律按老 iNES 对待,别抛错。解析器的美德是宽容地接收、精确地报告。

最后是截断校验和切片:

```ts
// src/ines.ts · parseINES(节选)
const prgSize = prgBanks * 16384
const chrSize = chrBanks * 8192
if (off + prgSize + chrSize > data.length) {
  throw new Error(`iNES:文件被截断,声明 ${prgSize} 字节 PRG + ${chrSize} 字节 CHR,实际读不满`)
}
const prgRom = data.slice(off, off + prgSize)
off += prgSize
const chrRom = chrBanks > 0 ? data.slice(off, off + chrSize) : null
```

## 验证

两层验证。第一层是单元测试(`tests/ines-cartridge.test.ts`,10 个断言):自构字节串覆盖了块数换算、镜像标志、trainer 平移、mapper 双 nibble 拼接、NES 2.0 十二位 mapper、CHR-RAM 判空、魔数与截断报错。跑 `npx vitest run`,全绿。

第二层更有说服力:拿真实测试 ROM 喂给它。nesdev 社区维护着一批公认可自由分发的测试卡带,下载二十个,每个都过一遍 `parseINES`:

```text
nestest.nes          mapper=0  horizontal  prg=16384  chr=8192
01.basics.nes        mapper=0  horizontal  prg=16384  chr=RAM
cpu_timing_test.nes  mapper=0  horizontal  prg=16384  chr=RAM
02-vbl_set_time.nes  mapper=0  vertical    prg=32768  chr=8192
official_only.nes    mapper=1  horizontal  prg=262144 chr=RAM
```

头字段逐个核对无误。这一步验证顺带回答了一个常见疑问:不同来源的 .nes 文件头布局并不完全干净,但只要核心字段位次不变,解析结果就稳定可信。注意最后那个 mapper=1 的:解析器如实报告了它,但本课程的整机只实现 NROM(mapper 0),装载时会拒绝它——**「解析得了」和「跑得动」是两件事**,这个边界到组装一章会正式处理。

## 小结

iNES 头是模拟器与真实卡带的契约:块数要乘单位、trainer 要跳过、mapper 要拼两半、版本位决定位宽。40 行代码换来的是「任何 .nes 文件都能变成结构化的 Cartridge」——从这一章起,你手上有了第一个能对真实文件工作的组件,后面每章的验证也都会比「自测自证」更硬。

卡带已经有了,下一章让主唱登场——把 6502 的最小核心跑起来。

### 章末地图

- [6502 最小核心](./03-cpu-core)——卡带里的 PRG 终将被它执行
- [整机组装](./11-assemble-machine)——Cartridge 挂上总线,parseINES 的产出在这里兑现
- [精度阶梯](./12-accuracy-ladder)——mapper=1 及之后的映射器世界
