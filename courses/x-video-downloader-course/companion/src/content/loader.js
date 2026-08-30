// src/content/loader.js —— 第 5 章装配层入口：content_scripts 声明的经典脚本，只干一件事——
// 动态 import 把真正的装配模块拉进来。content script 不支持静态 import 声明，模块要用
// chrome.runtime.getURL 拿到 chrome-extension:// 绝对地址再 import()，被 import 的模块
// 必须在 manifest 的 web_accessible_resources 里报备过（相对地址不行：它会按页面源解析）
;(async () => {
  await import(chrome.runtime.getURL('src/content/main.js'))
})().catch((err) => {
  console.log('[xvd] 装配模块加载失败：', err instanceof Error ? err.message : err)
})
