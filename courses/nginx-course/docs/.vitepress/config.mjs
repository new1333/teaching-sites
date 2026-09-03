export default {
  title: 'Nginx 前端实战课',
  description: '会打包部署前端应用、但遇到 Nginx 配置只会复制粘贴的前端工程师',
  created: '2026-08-15',
  base: '/',
  ignoreDeadLinks: true,
  themeConfig: {
    nav: [
      { text: '首页', link: '/' },
      { text: '关于', link: '/about' },
    ],
    sidebar: [
      {
        text: '地基：从一份 dist 说起',
        collapsed: false,
        items: [
          { text: '1. Nginx 心智模型：一个请求到底被谁处理了', link: '/01-nginx-mental-model' },
          { text: '2. 静态文件服务：root、index 与 MIME', link: '/02-serve-static' },
          { text: '3. location 匹配：一个 URI 命中哪条规则', link: '/03-location-matching' },
          { text: '4. try_files 与 SPA History 路由回退', link: '/04-spa-fallback' },
        ],
      },
      {
        text: '代理：前端与后端之间的桥',
        collapsed: false,
        items: [
          { text: '5. 反向代理 proxy_pass：本地联调与同源部署', link: '/05-reverse-proxy' },
          { text: '6. 请求头透传与 WebSocket：X-Forwarded-For 和 Upgrade', link: '/06-proxy-headers' },
          { text: '7. upstream 负载均衡：发版不再 502', link: '/07-load-balancing' },
        ],
      },
      {
        text: '上线：性能、缓存与排障',
        collapsed: false,
        items: [
          { text: '8. gzip 压缩：把 2.3MB 的 vendor.js 降到 600KB', link: '/08-gzip' },
          { text: '9. 缓存控制：一半用户新一半用户旧的怪事', link: '/09-cache-control' },
          { text: '10. CORS 与 add_header：跨域资源共享在网关层怎么做', link: '/10-cors-headers' },
          { text: '11. HTTPS 与安全头：上线 TLS 前前端要懂的常识', link: '/11-https-and-security' },
          { text: '12. mini-nginx vs 真实 Nginx：差异地图与 502/504 排障手册', link: '/12-troubleshooting-map' },
        ],
      },
    ],
    outline: { level: [2, 3] },
    search: { provider: 'local' },
    docFooter: { prev: '上一章', next: '下一章' },
  },
}
