---
layout: home
hero:
  name: 手写 mini-clash：代理软件的原理与实现
  text: 会写 TypeScript、网络与密码学从零起步的开发者
  tagline: 读完本课程，mini-clash：SOCKS5 入口、规则分流、AEAD 隧道，端到端跑通
  actions:
    - theme: brand
      text: 开始阅读
      link: ./01-panorama
    - theme: alt
      text: 课程介绍
      link: ./about
features:
  - icon: 🗺️
    title: 1. 打开 Clash 之后，流量经历了什么
    details: 三角色全景图（入口/分流/隧道）+ socket、TCP 连接、端口、回环地址的最小人话地基
    link: ./01-panorama
    linkText: 进入本章
  - icon: 📮
    title: 2. HTTP 正向代理：两种把流量交出来的方式
    details: 从字节层面认识 HTTP 报文；实现 absolute-form 改写转发与 CONNECT 隧道
    link: ./02-http-proxy
    linkText: 进入本章
  - icon: 🔢
    title: 3. SOCKS5：一个字节级的入口协议
    details: 字节协议、大端序、累积缓冲状态机；实现 SOCKS5 服务端并中继到目标
    link: ./03-socks5-server
    linkText: 进入本章
  - icon: 🚚
    title: 4. 两跳链路：本地代理与远端中继
    details: 把「直连目标」升级为「入口→远端→目标」；设计长度前缀帧，两端双向中继
    link: ./04-two-hop-relay
    linkText: 进入本章
  - icon: 🔒
    title: 5. 加密在防谁：机密性、完整性与 AEAD
    details: 零基础建立加密三目标与 AEAD 语义；加密、篡改、验拒三个自包含实验
    link: ./05-crypto-basics
    linkText: 进入本章
  - icon: 🧱
    title: 6. 加密隧道：Shadowsocks 风格 AEAD 帧
    details: 盐 + HKDF 子密钥 + 长度前缀 AEAD 块替换明文载荷；篡改与换序用例验证
    link: ./06-aead-tunnel
    linkText: 进入本章
  - icon: 🚦
    title: 7. 规则引擎：流量的调度台
    details: 五种规则形态按序首中即停；CIDR 按位与；入口按判决走直连或加密隧道
    link: ./07-rule-engine
    linkText: 进入本章
  - icon: ☎️
    title: 8. DNS 与 fake-ip：先把名字这一关接管
    details: DNS 污染与泄露的账；最小 UDP 应答器 + fake-ip 池的分配、还原与回收
    link: ./08-fake-ip
    linkText: 进入本章
  - icon: 🕸️
    title: 9. TUN 模式：虚拟网卡与全系统流量
    details: 系统代理罩不住全部应用的原因；IP/TCP 报文字节解析与五元组「包→连接」还原
    link: ./09-tun-lab
    linkText: 进入本章
  - icon: 📋
    title: 10. 配置与代理组：从硬编码到声明式
    details: JSON 声明式配置驱动端口、密码与规则；select/url-test 组与延迟探测
    link: ./10-config-groups
    linkText: 进入本章
  - icon: 🏗️
    title: 11. 总装：跑起来的 mini-clash
    details: 入口、DNS、规则、组、隧道、远端串成端到端链路，一条命令可演示
    link: ./11-assemble
    linkText: 进入本章
  - icon: 🧭
    title: 12. 回望：从 mini 到真实 Clash
    details: 主线问题的完整答案、概念对账、mini 与真实 Clash 的差异地图
    link: ./12-review-vs-real
    linkText: 进入本章
---

> 边界说明：代理与隧道技术在不同司法辖区受不同法规约束。本课程仅用于网络协议原理学习，全部实验在本机回环完成、不含任何真实节点信息——请在遵守当地法律法规的前提下学习。
