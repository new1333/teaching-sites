// 由 .course/render-docs.mjs 从 outline.json 生成,勿手改。
export default {
  title: "用 TypeScript 从零写一台 NES:NES 模拟器原理与实现",
  description: "会写 TypeScript、玩过红白机、想搞懂「一个 .nes 文件怎么变成屏幕上 60fps 的游戏画面」的开发者;不需要汇编或硬件基础,6502 汇编在课程内从零教起。",
  created: '2026-08-16',
  base: '/',
  ignoreDeadLinks: true,
  themeConfig: {
    nav: [{ text: '首页', link: '/' }, { text: '关于', link: '/about' }],
    sidebar: [
      {"text":"起步:卡带与 CPU 的最小闭环","collapsed":false,"items":[{"text":"1. 三块芯片的合奏:NES 硬件全景与时钟同步","link":"/01-nes-overview.md"},{"text":"2. iNES 格式:拆开一张卡带","link":"/02-ines-cartridge.md"},{"text":"3. 6502 最小核心:寄存器、复位与取指循环","link":"/03-cpu-core.md"}]},
      {"text":"CPU:把指令跑对","collapsed":false,"items":[{"text":"4. 寻址模式:操作数从哪里来","link":"/04-addressing-modes.md"},{"text":"5. 指令集与标志位:补全官方 151 条","link":"/05-instruction-set.md"}]},
      {"text":"PPU:画面从哪里来","collapsed":false,"items":[{"text":"6. PPU 寄存器与地址镜像","link":"/06-ppu-bus-registers.md"},{"text":"7. 背景渲染:8 个点画一块瓦片","link":"/07-background-rendering.md"},{"text":"8. 精灵、OAM DMA 与 sprite 0 hit","link":"/08-sprite-rendering.md"},{"text":"9. 帧时序:NMI 与主循环","link":"/09-frame-timing.md"}]},
      {"text":"整机:跑起来","collapsed":false,"items":[{"text":"10. 手柄:一次移一位的串行输入","link":"/10-controller-input.md"},{"text":"11. 整机组装:从 .nes 字节到第一帧画面","link":"/11-assemble-machine.md"},{"text":"12. 精度阶梯:从「能跑」到「像素级正确」","link":"/12-accuracy-ladder.md"}]},
    ],
    outline: { level: [2, 3] },
    search: { provider: 'local' },
    docFooter: { prev: '上一章', next: '下一章' },
  },
}
