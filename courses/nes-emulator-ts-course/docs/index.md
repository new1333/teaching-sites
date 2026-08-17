---
layout: home
hero:
  name: 用 TypeScript 造一台 NES：从比特到第一声开机音
  text: 会 TS 的前端工程师，二进制与汇编零基础
  tagline: 读完本课程，约 1400 行的 TS 版 NES 模拟器，跑通自产测试卡带：出画面、出声音
  actions:
    - theme: brand
      text: 开始阅读
      link: ./01-binary-foundations
    - theme: alt
      text: 课程介绍
      link: ./about
features:
  - icon: 0️⃣
    title: 从 0 和 1 说起：8 位机的世界观
    details: 建立二进制/十六进制/位运算/补码的读写能力，从此看懂 NES 文档里的每一个数字
    link: ./01-binary-foundations
    linkText: 进入本章
  - icon: 🗺️
    title: 模拟器是一台「假机器」：整机地图与施工路线
    details: 看清 NES 五大部件、它们靠什么节拍协作，以及这门课每一步在盖哪块砖
    link: ./02-emulator-big-picture
    linkText: 进入本章
  - icon: 📼
    title: 卡带与总线：内存是一排门牌号
    details: 解析 iNES 卡带文件，实现 64KB 总线，让 CPU 的每个地址都找得到对应设备
    link: ./03-cartridge-and-bus
    linkText: 进入本章
  - icon: 💓
    title: CPU 心跳：寄存器（register）与取指（fetch）执行循环
    details: 实现 6502 的七个寄存器与 fetch-decode-execute 心跳，让 CPU 跑起第一段程序
    link: ./04-cpu-heartbeat
    linkText: 进入本章
  - icon: 🧭
    title: 寻址模式：同一个动作的十三种说法
    details: 实现全部 13 种寻址模式的地址计算，含零页回绕与页边界陷阱
    link: ./05-addressing-modes
    linkText: 进入本章
  - icon: 🧮
    title: 指令集全家福：五十六条官方指令
    details: 实现全部官方指令——算术、逻辑、移位、比较分支、跳转与栈
    link: ./06-instruction-set
    linkText: 进入本章
  - icon: 🎨
    title: PPU 的记忆：图块、拼贴与颜料盒
    details: 搭起 PPU 的三块记忆（nametable/调色板/OAM）与 $2000-$2007 八个寄存器的读写语义
    link: ./07-ppu-memory
    linkText: 进入本章
  - icon: 🖼️
    title: 背景渲染：从图块编号到一整屏像素
    details: 走通 tile→pattern 双位平面→调色板间接→帧缓冲的整条渲染管线
    link: ./08-background-rendering
    linkText: 进入本章
  - icon: 🕹️
    title: 精灵：会动的一切
    details: 把 OAM 的 64 个精灵按扫描线合成到背景上，并实现 sprite 0 hit
    link: ./09-sprites
    linkText: 进入本章
  - icon: 🥁
    title: 帧时序与中断：CPU 与 PPU 的双人舞
    details: 用一个主时钟按 1:3 驱动两颗芯片，实现扫描线状态机与 NMI，点亮第一幅静态画面
    link: ./10-frame-timing
    linkText: 进入本章
  - icon: 🎵
    title: 方波、包络与节拍器：APU 的旋律声部
    details: 实现两条方波通道（定时器/占空比/包络/sweep/长度）与统一节拍的帧序列器，输出采样流
    link: ./11-apu-pulse
    linkText: 进入本章
  - icon: 🔊
    title: APU 下与整机合体：三角波、噪声与第一次开机
    details: 补齐三角波与噪声通道、接上手柄，组装 NES 整机，用自产测试卡带完成第一次开机
    link: ./12-apu-triangle-noise-and-boot
    linkText: 进入本章
---
