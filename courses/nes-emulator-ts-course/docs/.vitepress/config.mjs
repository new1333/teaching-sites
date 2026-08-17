// 由 .course/outline.json 渲染生成：nav/sidebar 与大纲一一对应。
export default {
  title: '用 TypeScript 造一台 NES：从比特到第一声开机音',
  description: '会 TS 的前端工程师，二进制与汇编零基础',
  base: '/',
  ignoreDeadLinks: true,
  themeConfig: {
    nav: [
      { text: '首页', link: '/' },
      { text: '关于', link: '/about' },
    ],
    sidebar: [
      {
        text: '地基：机器的语言',
        collapsed: false,
        items: [
          { text: '1. 从 0 和 1 说起：8 位机的世界观', link: '/01-binary-foundations.md' },
          { text: '2. 模拟器是一台「假机器」：整机地图与施工路线', link: '/02-emulator-big-picture.md' },
        ],
      },
      {
        text: '让 CPU 活起来',
        collapsed: false,
        items: [
          { text: '3. 卡带与总线：内存是一排门牌号', link: '/03-cartridge-and-bus.md' },
          { text: '4. CPU 心跳：寄存器（register）与取指（fetch）执行循环', link: '/04-cpu-heartbeat.md' },
          { text: '5. 寻址模式：同一个动作的十三种说法', link: '/05-addressing-modes.md' },
          { text: '6. 指令集全家福：五十六条官方指令', link: '/06-instruction-set.md' },
        ],
      },
      {
        text: '画面：一帧的诞生',
        collapsed: false,
        items: [
          { text: '7. PPU 的记忆：图块、拼贴与颜料盒', link: '/07-ppu-memory.md' },
          { text: '8. 背景渲染：从图块编号到一整屏像素', link: '/08-background-rendering.md' },
          { text: '9. 精灵：会动的一切', link: '/09-sprites.md' },
          { text: '10. 帧时序与中断：CPU 与 PPU 的双人舞', link: '/10-frame-timing.md' },
        ],
      },
      {
        text: '声音与合体：第一次开机',
        collapsed: false,
        items: [
          { text: '11. 方波、包络与节拍器：APU 的旋律声部', link: '/11-apu-pulse.md' },
          { text: '12. APU 下与整机合体：三角波、噪声与第一次开机', link: '/12-apu-triangle-noise-and-boot.md' },
        ],
      },
      {
        text: '附录',
        collapsed: false,
        items: [
          { text: '术语表', link: '/glossary.md' },
          { text: '6502 指令与寻址速查表', link: '/6502-opcodes.md' },
          { text: 'PPU / APU 寄存器速查表', link: '/ppu-apu-registers.md' },
          { text: '练习路线：把实验场亲手再写一遍', link: '/exercises.md' },
        ],
      },
    ],
    outline: { level: [2, 3] },
    search: { provider: 'local' },
    docFooter: { prev: '上一章', next: '下一章' },
  },
}
