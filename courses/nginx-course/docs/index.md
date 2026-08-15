---
layout: home
hero:
  name: Nginx 前端实战课
  text: 会打包部署前端应用、但遇到 Nginx 配置只会复制粘贴的前端工程师
  tagline: 读完本课程，你将拥有一个 ~700 行、零依赖的 mini-nginx（TypeScript）——配置键与 nginx.conf 指令一一对应，覆盖静态服务、location 匹配、SPA 回退、反向代理、请求头透传、WebSocket、负载均衡、gzip、缓存控制、CORS 十大前端场景
  actions:
    - theme: brand
      text: 从心智模型开始 →
      link: ./01-nginx-mental-model
    - theme: alt
      text: 先看看终点产物
      link: ./12-troubleshooting-map
features:
  - icon: 🧠
    title: Nginx 心智模型：一个请求到底被谁处理了
    details: master/worker 进程模型与请求五步旅程，把「前端构建产物」和「线上服务」连接起来的那张地图。
    link: ./01-nginx-mental-model
    linkText: 进入本章
  - icon: 📄
    title: 静态文件服务：root、index 与 MIME
    details: MIME 声明错误导致的白屏、root 与 alias 的拼接差异、403 与 404 的分工语义。
    link: ./02-serve-static
    linkText: 进入本章
  - icon: 🎯
    title: location 匹配：一个 URI 命中哪条规则
    details: 精确、前缀、^~、正则的五步判定算法，以及 /api 误伤 /api-docs 的事故复盘。
    link: ./03-location-matching
    linkText: 进入本章
  - icon: 🔀
    title: try_files 与 SPA History 路由回退
    details: 刷新 404 的根因、内部重定向循环、资源块不回退防「200 伪 HTML」的生产两层结构。
    link: ./04-spa-fallback
    linkText: 进入本章
  - icon: 🌉
    title: 反向代理 proxy_pass：本地联调与同源部署
    details: 同源代理根治 CORS、带尾斜杠与不带尾斜杠的路径改写语义、上游 500 透传与拒连 502。
    link: ./05-reverse-proxy
    linkText: 进入本章
  - icon: 🏷️
    title: 请求头透传与 WebSocket
    details: X-Forwarded-For 链式追加与防伪造、逐跳头、101 握手穿透代理与隧道拆除语义。
    link: ./06-proxy-headers
    linkText: 进入本章
  - icon: ⚖️
    title: upstream 负载均衡：发版不再 502
    details: 轮询与权重、故障摘除与失败重试、ip_hash 的 session 亲和取舍、两台轮发 SOP。
    link: ./07-load-balancing
    linkText: 进入本章
  - icon: 🗜️
    title: gzip 压缩：把 2.3MB 的 vendor.js 降到 600KB
    details: Accept-Encoding 协商、类型白名单默认值的大坑、图片与小文件不压的经济学。
    link: ./08-gzip
    linkText: 进入本章
  - icon: ⏳
    title: 缓存控制：一半用户新一半用户旧的怪事
    details: 强缓存与协商缓存两级机制、ETag 指纹、hash 产物一年 + 入口 no-cache 的标准答案。
    link: ./09-cache-control
    linkText: 进入本章
  - icon: 🌍
    title: CORS 与 add_header
    details: 预检请求的网关应答、add_header 全有全无的继承陷阱、同源代理与 CORS 放行的取舍。
    link: ./10-cors-headers
    linkText: 进入本章
  - icon: 🔒
    title: HTTPS 与安全头
    details: 证书链与 fullchain、301 跳转加 HSTS、混合内容拆除清单、CSP 的 Report-Only 起步法。
    link: ./11-https-and-security
    linkText: 进入本章
  - icon: 🗺️
    title: 差异地图与 502/504 排障手册
    details: mini-nginx 与真实 Nginx 的十二条差异分档地图，从 upstream 日志字段出发的排障决策树。
    link: ./12-troubleshooting-map
    linkText: 进入本章
---
