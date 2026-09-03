export default {
  title: '代理软件实现原理：从一条 TCP 隧道到 mini-proxy',
  description: '会 TypeScript、用过代理工具的开发者',
  created: '2026-08-31',
  base: '/',
  themeConfig: {
    nav: [
      { text: '首页', link: '/' },
      { text: '关于', link: '/about' },
    ],
    sidebar: [
      {
        text: '第一部分 · 流量如何进入代理',
        collapsed: false,
        items: [
          { text: '1. 代理不是魔法：先画清一条连接', link: '/01-proxy-mental-model.md' },
          { text: '2. HTTP 正向代理：改写请求与打通 CONNECT', link: '/02-http-forward-proxy.md' },
          { text: '3. SOCKS5：把目标地址装进二进制握手', link: '/03-socks5-protocol.md' },
          { text: '4. 双向搬运：背压、半关闭与清理', link: '/04-relay-lifecycle.md' },
        ],
      },
      {
        text: '第二部分 · 代理如何做决定',
        collapsed: false,
        items: [
          { text: '5. 规则引擎：第一条命中为什么决定一切', link: '/05-rule-engine.md' },
          { text: '6. DNS 在哪里发生：域名规则与 IP 规则的拉扯', link: '/06-dns-strategy.md' },
          { text: '7. 出站适配器：直连、拒绝与再套一层 SOCKS5', link: '/07-outbound-adapters.md' },
        ],
      },
      {
        text: '第三部分 · 把积木组装成程序',
        collapsed: false,
        items: [
          { text: '8. 配置先失败：不要让错误规则静默上线', link: '/08-runtime-config.md' },
          { text: '9. 组装运行时：两个入口，共用一条决策管线', link: '/09-runtime-assembly.md' },
          { text: '10. 收官：验证整条链，也看清离 Clash 还有多远', link: '/10-end-to-end-boundary.md' },
        ],
      },
      {
        text: '附录',
        collapsed: false,
        items: [
          { text: '术语表', link: '/glossary.md' },
          { text: '协议字节与响应码速查', link: '/protocol-reference.md' },
          { text: '从配置词到代码模块', link: '/implementation-map.md' },
          { text: 'mini-proxy 与生产代理的差异', link: '/divergence.md' },
          { text: '练习路线：从红到绿重写一遍', link: '/exercises.md' },
        ],
      },
    ],
    outline: { level: [2, 3] },
    search: { provider: 'local' },
    docFooter: { prev: '上一章', next: '下一章' },
  },
}
