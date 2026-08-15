---
layout: home
hero:
  name: Pinia 从零实现
  text: 会用 Vue 3 组合式 API、想真正吃透状态管理而非只会调 API 的开发者
  tagline: 读完本课程，你拥有一个约 400 行、API 与真 pinia 同构的 pinia-mini——createPinia、defineStore、两种 store 语法、$patch、$reset、$subscribe、$onAction、storeToRefs、插件系统
features:
  - icon: 🧭
    title: 状态管理的四种尝试与它们的极限
    details: props 钻孔、模块级共享 ref、事件总线、Vuex 各自翻车的现场，提炼出 store 必须回答的四问。
  - icon: 🔧
    title: Vue 响应式工具箱：pinia 的六块地基
    details: ref、reactive、computed、watch、effectScope、provide/inject 的非显然用法——pinia 每一行都建在它们之上。
  - icon: 📦
    title: createPinia：一个挂在 app 上的容器
    details: 根 state、store 注册表、effectScope、install 与 provide——治「两个测试用例共享模块级 store」的病。
  - icon: 🪪
    title: defineStore 与 store 的单例身份
    details: 返回函数的三个刚性理由：惰性创建、依赖时机、每应用一个实例；三级回退找到家。
  - icon: 🧩
    title: 选项式 store：三件套
    details: state 工厂、toRefs 摊平、getters 编译成 computed——「选项式只是组合式的语法糖」。
  - icon: 🛃
    title: 组合式 store 与运行时分类
    details: 海关安检式的三通道分类（状态/getter/action），hydration 铁律：旧数据赢。
  - icon: 🔀
    title: $patch 深合并与 $reset
    details: 合并而非替换、原地改保连接；物理变更任意多，逻辑事件恰好一次。
  - icon: 🔭
    title: 订阅系统：$subscribe 与 $onAction
    details: action 外壳的 before/after/onError 全时序；watcher 与手动触发的静音和解；作用域自动托管。
  - icon: 🪢
    title: storeToRefs：解构不丢响应性的秘密
    details: 数据会断、函数免疫的不对称；toRaw 看穿分类信息，toRef 建立双向活引用。
  - icon: 🔌
    title: 插件系统：pinia.use 与 store 扩展
    details: context 四件套、返回值合并、创建时一次性；一个完整的 localStorage 持久化插件。
  - icon: 🌐
    title: activePinia：一个应用一个容器
    details: SSR 串号事故的完整时序推演，三道防线与使用者纪律的边界。
  - icon: 🗺️
    title: pinia-mini vs pinia：差异地图
    details: 678 行 mini 与 2933 行真 pinia 的三类增量：开发体验、生态兼容、类型表达。
---
