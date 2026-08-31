export default {
  title: '手写 mini-clash：代理软件的原理与实现',
  description: '会写 TypeScript、网络与密码学从零起步的开发者',
  base: '/',
  ignoreDeadLinks: true,
  themeConfig: {
    nav: [
      { text: '首页', link: '/' },
      { text: '关于', link: '/about' },
    ],
    sidebar: [
      {
        text: '第一部分 · 入口：把流量从应用手里接过来',
        collapsed: false,
        items: [
          { text: '1. 打开 Clash 之后，流量经历了什么', link: '/01-panorama.md' },
          { text: '2. HTTP 正向代理：两种把流量交出来的方式', link: '/02-http-proxy.md' },
          { text: '3. SOCKS5：一个字节级的入口协议', link: '/03-socks5-server.md' },
          { text: '4. 两跳链路：本地代理与远端中继', link: '/04-two-hop-relay.md' },
        ],
      },
      {
        text: '第二部分 · 加密：本地到远端这一跳',
        collapsed: false,
        items: [
          { text: '5. 加密在防谁：机密性、完整性与 AEAD', link: '/05-crypto-basics.md' },
          { text: '6. 加密隧道：Shadowsocks 风格 AEAD 帧', link: '/06-aead-tunnel.md' },
        ],
      },
      {
        text: '第三部分 · 分流与接管：谁走哪条线',
        collapsed: false,
        items: [
          { text: '7. 规则引擎：流量的调度台', link: '/07-rule-engine.md' },
          { text: '8. DNS 与 fake-ip：先把名字这一关接管', link: '/08-fake-ip.md' },
          { text: '9. TUN 模式：虚拟网卡与全系统流量', link: '/09-tun-lab.md' },
        ],
      },
      {
        text: '第四部分 · 成品：mini-clash',
        collapsed: false,
        items: [
          { text: '10. 配置与代理组：从硬编码到声明式', link: '/10-config-groups.md' },
          { text: '11. 总装：跑起来的 mini-clash', link: '/11-assemble.md' },
          { text: '12. 回望：从 mini 到真实 Clash', link: '/12-review-vs-real.md' },
        ],
      },
      {
        text: '附录',
        collapsed: false,
        items: [
          { text: '术语表', link: '/glossary.md' },
          { text: '字节协议速查表', link: '/wire-protocol-cheatsheet.md' },
          { text: '与真实 Clash 的差异清单', link: '/divergence.md' },
        ],
      },
    ],
    outline: { level: [2, 3] },
    search: { provider: 'local' },
    docFooter: { prev: '上一章', next: '下一章' },
  },
}
