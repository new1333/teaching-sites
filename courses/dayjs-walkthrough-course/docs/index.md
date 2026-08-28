---
layout: home
hero:
  name: dayjs 源码走读：一个日期库的最小内核
  text: 看得懂 JavaScript、想读一个真实开源库的工程师
  tagline: 读完本课程，一张可复走的源码地图，8 组探针在锁定 ref 全绿
  actions:
    - theme: brand
      text: 开始阅读
      link: ./01-factory-and-instance
    - theme: alt
      text: 课程介绍
      link: ./about
features:
  - icon: 🏭
    title: dayjs() 是个工厂：入口与实例
    details: 四行入口逻辑、克隆防御与鸭子类型标记——每个行为的实现行号你都能指出
    link: ./01-factory-and-instance
    linkText: 进入本章
  - icon: 🔍
    title: parseDate：四类输入，一条路径
    details: null 为何显式判无效、那条分水岭正则怎么读、Invalid Date 的错误哲学
    link: ./02-parse-date
    linkText: 进入本章
  - icon: 💾
    title: init：为什么实例上挂满了 $ 变量
    details: 九个字段的全景图、预计算缓存与 $ 私有约定、getter 注册表
    link: ./03-init-cache
    linkText: 进入本章
  - icon: 🧊
    title: 不可变性：add/set 为什么返回新对象
    details: clone().$set 的完整路径、月末夹持、wrapper 的「新值+旧上下文」
    link: ./04-immutability
    linkText: 进入本章
  - icon: 📐
    title: startOf/endOf：单位对齐的两个工厂
    details: 一个 switch 吃下八个单位；week 的答案为什么随语言包翻转
    link: ./05-startof-endof
    linkText: 进入本章
  - icon: 🔄
    title: format：一次正则替换的全文翻译器
    details: 字面量逃逸、查表、default 兜底的三级短路；meridiem 的 12 点陷阱
    link: ./06-format
    linkText: 进入本章
  - icon: 🌐
    title: locale：L 与 Ls 的一张注册表
    details: 全局与实例两档切换、split 回退链、静默回落为什么是设计
    link: ./07-locale-registry
    linkText: 进入本章
  - icon: 🧩
    title: extend：三十多个插件共用的三个参数
    details: 六行安装器、$i 幂等、weekOfYear 插件全源码——插件只用公开面
    link: ./08-plugin-system
    linkText: 进入本章
  - icon: ✅
    title: 复盘：这张源码地图你现在走完了
    details: 八行能力对账表与八问自查，确认每项能力真的建立
    link: ./09-review
    linkText: 进入本章
---

本课程为基于锁定提交（MIT 许可）的独立教学解读，非官方文档。
