---
layout: home
hero:
  name: Redis 原理与最小实现：亲手写一个迷你 Redis
  text: 会 TypeScript、用过数据库，没读过存储内部的开发者
  tagline: 读完本课程，亲手写一个迷你 Redis：RESP、哈希表、TTL、淘汰、AOF 全实现，测试全绿
  actions:
    - theme: brand
      text: 开始阅读
      link: ./01-why-in-memory
    - theme: alt
      text: 课程介绍
      link: ./about
features:
  - icon: 🧮
    title: 磁盘太慢了：Redis 到底解决什么问题
    details: 用延迟数量级算清内存与磁盘的差距，讲明缓存是刚需、Redis 是住在内存里的数据结构服务器。
    link: ./01-why-in-memory
    linkText: 进入本章
  - icon: 📡
    title: RESP：两个进程怎么对话
    details: 理解 TCP 字节流无边界，实现 RESP 解析器与应答编码，跑起第一个能被真 redis-cli 连上的服务器。
    link: ./02-resp-protocol
    linkText: 进入本章
  - icon: 🎡
    title: 单线程的事件循环：一个线程照看一千个连接
    details: 先亲手复现「一个不敲字的客户端冻结全场」，再用 IO 多路复用与事件驱动解掉它，管道压轴。
    link: ./03-single-thread-event-loop
    linkText: 进入本章
  - icon: 🗃️
    title: 全局哈希表：所有键的家
    details: 从数组加链表手写哈希表，再解决扩容卡顿——渐进式 rehash：双表同场，每次操作搬一个桶。
    link: ./04-hash-table-rehash
    linkText: 进入本章
  - icon: 🪜
    title: 跳表：能二分查找的链表
    details: 多层索引加抛硬币定层数，插得快还能按分数切前一百；ZSET 与对象编码概览。
    link: ./05-skiplist-zset
    linkText: 进入本章
  - icon: ⏳
    title: 过期删除：惰性与定期
    details: 过期字典加两只手：访问时顺带查（惰性）、周期抽样补刀（定期）——CPU 与内存的账。
    link: ./06-ttl-expire
    linkText: 进入本章
  - icon: 🧹
    title: 内存满了：不精确的 LRU
    details: 键数上限加随机抽 5 踢最久未用——为什么精确 LRU 太贵、LFU 纠什么偏，亲手复现 OOM。
    link: ./07-eviction-lru
    linkText: 进入本章
  - icon: 📒
    title: AOF：把每一步写下来重放
    details: 写后日志、重启重放、重写瘦身；fsync 三档是稳与快的档位——重启后数据真的回来了。
    link: ./08-aof
    linkText: 进入本章
  - icon: 📷
    title: RDB 快照：fork 与写时复制
    details: 全量照片的恢复账、页表复制的 COW 图解——拍照那几秒数据还在写入，怎么拍出不花的照片。
    link: ./09-rdb-snapshot
    linkText: 进入本章
  - icon: 🛰️
    title: 一台是不够的：复制、哨兵与集群
    details: 全量同步时序、quorum 与多数授权、16384 哈希槽——单机的三道天花板与各自的解法（视野章）。
    link: ./10-replication-ha
    linkText: 进入本章
  - icon: 🗺️
    title: 终章对账：你写了一个迷你 Redis
    details: 四问回收全书：快从哪来、内存怎么管、数据怎么不丢、一台挂了怎么办——能力对账与继续路线。
    link: ./11-review-and-beyond
    linkText: 进入本章
---
