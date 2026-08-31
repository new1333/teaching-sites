---
layout: home
hero:
  name: 复刻沉浸式翻译：双语对照引擎的原理与实现
  text: 会写 TS 与原生 DOM、想复刻双语翻译工具的开发者
  tagline: 读完本课程，约 600 行的双语对照引擎 + 可装进 Chrome 的扩展壳，离线可演示
  actions:
    - theme: brand
      text: 开始阅读
      link: ./01-panorama
    - theme: alt
      text: 课程介绍
      link: ./about
features:
  - icon: 🌐
    title: 1. 整页替换 vs 双语对照：两种翻译世界观
    details: 建立全书世界观：翻译网页不是字符串替换，而是在活的对象树上做增量；拆出引擎的四个部件
    link: ./01-panorama
    linkText: 进入本章
  - icon: 🔧
    title: 2. 可译块：找到直接持有文字的节点
    details: 实现可译块抽取：递归遍历 DOM、按块级/内联分类、只取直接持有文本的块、套用跳过规则
    link: ./02-extract-blocks
    linkText: 进入本章
  - icon: 🔧
    title: 3. 双语渲染：原文纹丝不动，译文插到下面
    details: 实现双语渲染：在可译块后插入带标记的译文节点，不改原文一个字；幂等，重复调用不产生重复译文
    link: ./03-render-bilingual
    linkText: 进入本章
  - icon: 🔧
    title: 4. 翻译服务抽象：引擎不认识任何 API
    details: 定义 Translator 接口与确定性假翻译器，组装「抽取→翻译→渲染」最小管线：一次调用整页变双语，且全程离线可测
    link: ./04-pipeline-service
    linkText: 进入本章
  - icon: 🔧
    title: 5. 内联格式保留：译文里的加粗和链接
    details: 解决「翻译往返碾平格式」：让译文里的 strong/a/code 结构与原文一一对应（内联切分与占位标记两方案的取舍在此展开）
    link: ./05-inline-format
    linkText: 进入本章
  - icon: 🔧
    title: 6. 主内容识别：别把额度花在导航栏上
    details: 实现主内容区启发式：用文字密度/链接密度给候选容器打分，从全页可译块里筛出正文，跳过导航、侧栏、页脚
    link: ./06-main-content
    linkText: 进入本章
  - icon: 🔧
    title: 7. 批量、去重与缓存：翻译的经济学
    details: 实现按字符预算分块、并发上限队列、内容寻址缓存：同样的话只翻一次、同时在飞的请求有上限、二次渲染零请求
    link: ./07-batch-cache
    linkText: 进入本章
  - icon: 🔧
    title: 8. 动态内容：别让译文生译文
    details: 用 MutationObserver 适配动态页面：懒加载内容增量翻译；标记过滤防自触发循环；断开重连语义
    link: ./08-dynamic-observer
    linkText: 进入本章
  - icon: 🔧
    title: 9. 装进浏览器：从 jsdom 到真实页面
    details: 给引擎一个身体：manifest + content script 最小扩展壳，开发者模式加载，离线假翻译器在真实页面演示双语对照；收束全书主线问题
    link: ./09-browser-shell
    linkText: 进入本章
---
