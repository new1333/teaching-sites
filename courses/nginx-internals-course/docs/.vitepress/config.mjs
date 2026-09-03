// 由 .course/outline.json 渲染生成（阶段 4 组装）；改大纲请重跑管线，勿手改
export default {
  title: 'nginx 实现原理：亲手写一个事件驱动 HTTP 服务器',
  description: '配过 nginx、懂 HTTP 的 Web 开发者，未接触过 socket 编程',
  created: '2026-08-17',
  base: '/',
  ignoreDeadLinks: true,
  themeConfig: {
    nav: [
      { text: '首页', link: '/' },
      { text: '关于', link: '/about' },
    ],
    sidebar: [
      {
        text: '第一部分 · 单线程的极限艺术：事件驱动',
        collapsed: false,
        items: [
          { text: '1. C10K：一万个连接怎么把老牌服务器打爆', link: '/01-c10k-and-event-driven.md' },
          { text: '2. 连接注册表：把连接当成一等公民管理', link: '/02-connection-registry.md' },
          { text: '3. HTTP 解析状态机：半个请求也能接', link: '/03-http-parser-state-machine.md' },
          { text: '4. keep-alive：说完别挂电话', link: '/04-keepalive-reuse.md' },
        ],
      },
      {
        text: '第二部分 · 工程支柱：内存、配置与进程',
        collapsed: false,
        items: [
          { text: '5. 请求内存池：整批进货，整仓清退', link: '/05-memory-pool.md' },
          { text: '6. 配置继承：你写过的那些花括号', link: '/06-config-inheritance.md' },
          { text: '7. master 与 worker：一个老板一队员工', link: '/07-master-workers.md' },
        ],
      },
      {
        text: '第三部分 · 流量主场：代理、均衡与限流',
        collapsed: false,
        items: [
          { text: '8. 反向代理：前台接待员的艺术', link: '/08-reverse-proxy.md' },
          { text: '9. 负载均衡与故障转移：三台坏一台，用户看不见', link: '/09-load-balance.md' },
          { text: '10. 漏桶限流：你抄过的 rate 和 burst 到底是什么', link: '/10-rate-limit-leaky-bucket.md' },
          { text: '11. 写回路径：少搬一次是一次', link: '/11-zero-copy-write-path.md' },
        ],
      },
      {
        text: '附录',
        collapsed: false,
        items: [
          { text: '术语表', link: '/glossary.md' },
          { text: '信号与进程控制速查', link: '/signals-reference.md' },
          { text: '你配过的指令 → 课程实现的机制', link: '/directives-map.md' },
          { text: '练习路线：清空 src，自己写一遍', link: '/exercises.md' },
        ],
      },
    ],
    outline: { level: [2, 3] },
    search: { provider: 'local' },
    docFooter: { prev: '上一章', next: '下一章' },
  },
}
