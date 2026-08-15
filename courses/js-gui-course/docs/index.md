---
layout: home
hero:
  name: JS 接入原生 GUI 的原理——从零理解 Electron 式桌面端
  text: 会用 Electron/Tauri 调 API，但说不清「JS 一行代码怎么变成屏幕上的一个窗口」的开发者
  tagline: 读完本课程，你拥有一个约 500-600 行、可测试的 mini-Electron 内核（模拟原生层 + 嵌入运行时 + binding 桥 + 异步队列 + IPC 通道 + 事件回路），并能讲清从 JS 调用到窗口出现、从用户点击到状态更新的完整链路
  actions:
    - theme: brand
      text: 开始阅读
      link: ./01-gui-skeleton
    - theme: alt
      text: 课程介绍
      link: ./about
features:
  - icon: 🪟
    title: 桌面 GUI 程序的骨架：窗口与消息循环
    details: 窗口本体在 OS、消息进队列、程序靠循环活着——所有桌面端的公共地基
    link: ./01-gui-skeleton
    linkText: 进入本章
  - icon: 🔁
    title: 手写最小消息循环
    details: 在模拟原生层实现事件队列与 runLoop，机械验证「取消息-分发」模型
    link: ./02-message-loop
    linkText: 进入本章
  - icon: 🧩
    title: JS 没有 GUI：运行时是被嵌入的
    details: 引擎提供计算，宿主提供世界——window/process 都是宿主注入的
    link: ./03-embedded-runtime
    linkText: 进入本章
  - icon: 🌉
    title: binding 层：JS 怎么调用「另一个语言」
    details: 注册表 + 序列化通关，亲手实现跨语言调用边界
    link: ./04-binding-layer
    linkText: 进入本章
  - icon: 🎛️
    title: 窗口对象：宿主给你的遥控器
    details: 句柄与本体分离，失效句柄为什么报 unknown window
    link: ./05-window-handle
    linkText: 进入本章
  - icon: ⏳
    title: 单线程遇多线程：异步桥
    details: 任务队列 + Promise 回投，让 JS 单线程不被原生耗时调用锁死
    link: ./06-async-bridge
    linkText: 进入本章
  - icon: 🧱
    title: 为什么是两个进程
    details: 崩溃隔离、权限收缴、能力外借——多进程模型的三步逻辑
    link: ./07-process-model
    linkText: 进入本章
  - icon: 📮
    title: IPC：invoke/handle 与 send/on
    details: 带编号的信件往来：请求-响应与事件推送两种语义
    link: ./08-ipc-channel
    linkText: 进入本章
  - icon: 🖱️
    title: 反方向：native 事件进 JS
    details: 用户点击如何变成 JS 回调：订阅表 + 泵驱动分发
    link: ./09-native-events-to-js
    linkText: 进入本章
  - icon: 🚀
    title: 组装 mini-Electron
    details: 把全部零件缝成 createApp，计数器 App 全程走桥跑通
    link: ./10-assemble-mini-electron
    linkText: 进入本章
  - icon: ⚖️
    title: 回望：Electron、Tauri 与原生绑定的同一原理
    details: 同一内核的三组参数：一致性、轻量、性能各付什么账
    link: ./11-ecosystem-tradeoffs
    linkText: 进入本章
---
