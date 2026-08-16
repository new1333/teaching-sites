---
title: PPU 寄存器与地址镜像
---

# PPU 寄存器与地址镜像

例程文档里写着「写 PPUCTRL 用 $2000」,而另一段从老代码里抄来的工具库偏偏写的 是 $2008。你在自己的模拟器上跑,后者毫无反应:背景永远打不开,画面一片黑,也没有任何报错。换到别人的模拟器上,同一个 ROM 却正常显示。差异只有一个——人家的总线把 $2008 当 $2000 处理了。

真机上,$2000-$3FFF 这一段是「同一组 8 字节寄存器重复 512 次」:$2008、$2010、$3FF8,全部都是 PPUCTRL。硬件布线只解码低 3 位,高位地址线根本没接。**模拟器只认「第一个」地址,等于把一半合法程序写进虚空**。这一章把 CPU 侧总线完整立起来——RAM 镜像、寄存器镜像、卡带窗口——再让 PPU 的八个寄存器真正长出硬件语义。

## 总线:一张路由表

第一章的地图在这里兑现。CPU 把地址放上总线,主板按区间应答:

```ts
// src/bus.ts · read
read(addr: number): number {
  if (addr < 0x2000) return this.ram[addr & 0x07ff] // RAM 镜像
  if (addr < 0x4000) return this.ppu.cpuRead(addr & 7) // PPU 寄存器镜像
  if (addr < 0x4020) return this.ioRead(addr) // APU/手柄
  return this.cartRead(addr) // 卡带窗口
}
```

三行代码,三个教学点。第一行:2KB 的 RAM 占着 8KB 的地址段,`& 0x07ff` 就是镜像本身——同一个物理字节出现在 $0000、$0800、$1000、$1800。第二行:PPU 那 8 个寄存器每 8 字节重复,`& 7` 一步归位,这就是开章故事的答案。第三、四行先留接口:手柄第 10 章接上,卡带窗口第 11 章接上——总线从第一天就是「插板子」的形状,后面接东西不用改这里。

## 八个寄存器,各怀心思

PPU 的寄存器不是「存个值」那么简单,几乎每个都有读写副作用,这是显存绕道访问的代价。按语义分三类:

**写配置**:PPUCTRL($2000)选基命名表、地址增量(1 或 32)、图案表、精灵高度、NMI 开关;PPUMASK($2001)开背景、开精灵、裁掉左侧 8 像素。注意 PPUCTRL 的 bit0-1 不是「直接选表」,而是写进滚动暂存寄存器 t 的第 10-11 位——这个奇怪的设计到渲染章会显出道理。

**写地址**:PPUADDR($2006)与 PPUSCROLL($2005)共用一套「双写指针 w」机制:第一次写当高位,第二次写当低位,交替进行。读一次 STATUS 会把 w 复位——很多真机程序在错误时刻读了 $2002,后面的 $2006 就整个错位,这是真实存在的坑,测试里专门有一条。

**读状态**:PPUSTATUS($2002)读一次返回标志并顺手清掉 vblank 位;PPUDATA($2007)读显存数据,但带一拍缓冲——**先返回上一次的内容,同时才去取这次的**。缓冲的存在是显存速度慢的物理事实,CPU 连续读一整块图块数据时,第一次读到的永远是旧的,少实现这一拍,拷图块的程序就会整体错一格。

```ts
// src/ppu.ts · cpuRead 的 $2007 分支
case 7: {
  const a = this.v & 0x3fff
  let out: number
  if (a >= 0x3f00) {
    out = this.palette[this.paletteIndex(a)] // 调色板不走缓冲
    if (this.mask & 1) out &= 0x30 // 灰度模式只留亮度位
  } else {
    out = this.readBuffer
    this.readBuffer = this.ppuRead(a)
  }
  this.v = u16(this.v + this.addrIncrement())
  return out
}
```

## PPU 自己的总线:显存与镜像

CPU 总线之外,PPU 还有第二条 14 位总线($0000-$3FFF),三段式:$0000-$1FFF 是卡带上的图块表(本章用可写的 CHR-RAM 占位,第 11 章换成真卡带);$2000-$3EFF 是命名表;$3F00-$3FFF 是调色板。

命名表段的镜像由卡带布线决定,parseINES 存下的 mirroring 字段在这里兑现。逻辑上有四块命名表,物理上只有两块(或四屏卡带的四块):

```ts
// src/ppu.ts · ntIndex
private ntIndex(addr: number): number {
  const offset = addr & 0x03ff
  if (this.mirroring === 'fourScreen') return offset | (addr & 0x0c00)
  const table = (addr >> 10) & 3
  // 垂直:table 0/2 → 物理 0,table 1/3 → 物理 1;水平:0/1 → 0,2/3 → 1
  const phys = this.mirroring === 'vertical' ? table & 1 : table >> 1
  return (phys << 10) | offset
}
```

水平镜像下 $2400 与 $2000 是同一块物理内存,垂直镜像下 $2800 折回 $2000——测试里两种镜像各写一格,断言字节落在正确的物理槽位。调色板段同样有镜像:$3F10/14/18/1C 四个「精灵透明色」槽位折回 $3F00/04/08/0C,一行位运算 `(i & 0x13) === 0x10 ? i & 0x0f : i` 完成折叠。

## Loopy 寄存器:v、t、x、w

PPU 内部有一组著名的滚动寄存器,社区按发现者统称 Loopy 寄存器:

- v(当前视频地址,15 位有效):渲染时真正的取数指针;
- t(暂存地址):$2005/$2006 写入的目标,复制到 v 才生效;
- x(fine-X):像素级水平滚动,0-7;
- w:上面说过的双写指针。

t 的 15 位被切成六段,每一格对应滚动语义的一个维度:基命名表 2 位、fine-Y 3 位、命名表行(coarse-Y)5 位、fine-X 在 x 里、coarse-X 5 位。$2005 两次写就是把像素坐标拆进这些格子:

```ts
// src/ppu.ts · $2005 分支
if (this.w === 0) {
  this.x = val & 7
  this.t = (this.t & 0x7fe0) | (val >> 3)
} else {
  this.t = (this.t & 0x0c1f) | ((val & 7) << 12) | ((val & 0xf8) << 2)
}
```

现在它们只是一堆被正确写入的位;下一章渲染流水线会让 v 一个格子一个格子地走起来,t 的「暂存」语义(vblank 结束时整体复制回 v)也会到位。

## 验证

`tests/ppu-bus-registers.test.ts` 十四个用例:RAM 四段镜像、寄存器每 8 字节镜像(连 $3FF8 都验)、STATUS 读清与残影字节、读 STATUS 复位 w 的连锁效应、$2006/$2007 双写与步进 32、水平/垂直两种命名表镜像的落点、调色板透明色折回与直读、$2005 与 $2000 对 t/x 的位级断言。累计 66 个用例全绿。

值得一提的是测试的组织:它不再直接构造 Ppu,而是先 `new Ppu(mirroring)` 再 `new Bus(ppu)`,所有断言都从 `bus.read/write` 进——**从这一章起,测试走的就是 CPU 眼中的地址空间**,和真机程序看到的完全一致。

## 小结

CPU 总线的三行路由解释了所有镜像;PPU 八个寄存器的副作用(读清、双写、一拍缓冲)是显存绕道访问的全部代价;Loopy 寄存器把滚动拆成位段存进了 t。画面还一笔未画,但「CPU 能正确地改写 PPU 的一切状态」已经机械成立。下一章让这些状态变成像素。

### 章末地图

- [背景渲染](./07-background-rendering)——v/t/x 走起来,显存变像素
- [精灵、OAM DMA 与 sprite 0 hit](./08-sprite-rendering)——$2003/$2004 与 OAM
- [整机组装](./11-assemble-machine)——chr 后端换成真卡带
