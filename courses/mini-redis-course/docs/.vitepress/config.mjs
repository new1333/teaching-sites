export default {
  title: 'Redis 原理与最小实现：亲手写一个迷你 Redis',
  description: '会 TypeScript、用过数据库，没读过存储内部的开发者',
  base: '/',
  ignoreDeadLinks: true,
  themeConfig: {
    nav: [
      { text: '首页', link: '/' },
      { text: '关于', link: '/about' },
    ],
    sidebar: [
      {
        text: '它为什么存在：问题与对话',
        collapsed: false,
        items: [
          { text: '1. 磁盘太慢了：Redis 到底解决什么问题', link: '/01-why-in-memory.md' },
          { text: '2. RESP：两个进程怎么对话', link: '/02-resp-protocol.md' },
          { text: '3. 单线程的事件循环：一个线程照看一千个连接', link: '/03-single-thread-event-loop.md' },
        ],
      },
      {
        text: '数据住进什么结构',
        collapsed: false,
        items: [
          { text: '4. 全局哈希表：所有键的家', link: '/04-hash-table-rehash.md' },
          { text: '5. 跳表：能二分查找的链表', link: '/05-skiplist-zset.md' },
        ],
      },
      {
        text: '内存是有限的',
        collapsed: false,
        items: [
          { text: '6. 过期删除：惰性与定期', link: '/06-ttl-expire.md' },
          { text: '7. 内存满了：不精确的 LRU', link: '/07-eviction-lru.md' },
        ],
      },
      {
        text: '内存会断电',
        collapsed: false,
        items: [
          { text: '8. AOF：把每一步写下来重放', link: '/08-aof.md' },
          { text: '9. RDB 快照：fork 与写时复制', link: '/09-rdb-snapshot.md' },
        ],
      },
      {
        text: '一台是不够的',
        collapsed: false,
        items: [
          { text: '10. 一台是不够的：复制、哨兵与集群', link: '/10-replication-ha.md' },
          { text: '11. 终章对账：你写了一个迷你 Redis', link: '/11-review-and-beyond.md' },
        ],
      },
      {
        text: '附录',
        collapsed: false,
        items: [
          { text: '术语表', link: '/glossary.md' },
          { text: '练习路线：从红到绿重写一遍', link: '/exercises.md' },
          { text: '与真 Redis 的差异清单', link: '/divergence.md' },
        ],
      },
    ],
    outline: { level: [2, 3] },
    search: { provider: 'local' },
    docFooter: { prev: '上一章', next: '下一章' },
  },
}
