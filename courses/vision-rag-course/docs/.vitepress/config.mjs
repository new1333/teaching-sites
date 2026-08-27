export default {
  title: "视觉 RAG 原理课：让 AI 真正看懂 PDF 与视频",
  description: "会写基础 Python、想弄懂视觉 RAG 原理的入门者",
  base: '/',
  ignoreDeadLinks: true,
  themeConfig: {
    nav: [
      { text: '首页', link: '/' },
      { text: '关于', link: '/about' },
    ],
    sidebar: [
          {
                "text": "第一部 · 全景与地基",
                "collapsed": false,
                "items": [
                      {
                            "text": "1. 先通读做笔记，再按笔记翻书：两阶段架构与成本漏斗",
                            "link": "/01-two-phase-funnel.md"
                      },
                      {
                            "text": "2. 一个靠得住的视觉模型客户端：重试、宽容解析与密钥纪律",
                            "link": "/02-vision-client.md"
                      }
                ]
          },
          {
                "text": "第二部 · PDF 问答主线",
                "collapsed": false,
                "items": [
                      {
                            "text": "3. 把页面变成图：渲染分辨率与文字层",
                            "link": "/03-page-rendering.md"
                      },
                      {
                            "text": "4. 每页一张读书卡：批量打标与拆批重试",
                            "link": "/04-batch-page-cards.md"
                      },
                      {
                            "text": "5. 免费的第一道筛：中文 TF-IDF 粗筛",
                            "link": "/05-local-tfidf.md"
                      },
                      {
                            "text": "6. 让模型看图把关：视觉精排",
                            "link": "/06-vision-rerank.md"
                      },
                      {
                            "text": "7. 只在刀刃上花力气：深读与引用诚实",
                            "link": "/07-deep-read.md"
                      },
                      {
                            "text": "8. 把证据递到手上：引用回收与自包含预览",
                            "link": "/08-verifiable-delivery.md"
                      }
                ]
          },
          {
                "text": "第三部 · 视频问答",
                "collapsed": false,
                "items": [
                      {
                            "text": "9. 按时长定密度：视频宏观抽帧",
                            "link": "/09-adaptive-sampling.md"
                      },
                      {
                            "text": "10. 帧卡片与段聚合：把几百帧收进抽屉",
                            "link": "/10-frame-segments.md"
                      },
                      {
                            "text": "11. 漏斗迁移：带时间戳的视频问答",
                            "link": "/11-video-qa.md"
                      },
                      {
                            "text": "12. 再拉近一点：微观放大层",
                            "link": "/12-micro-zoom.md"
                      }
                ]
          },
          {
                "text": "第四部 · 走向工程",
                "collapsed": false,
                "items": [
                      {
                            "text": "13. 换一台引擎：移植差异与双引擎互验",
                            "link": "/13-engine-porting.md"
                      },
                      {
                            "text": "14. 从脚本到 skill：让 AI 知道何时调用你",
                            "link": "/14-package-as-skill.md"
                      }
                ]
          },
          {
                "text": "附录",
                "collapsed": false,
                "items": [
                      {
                            "text": "术语表",
                            "link": "/glossary.md"
                      },
                      {
                            "text": "差异清单：本课程的简化与真实世界",
                            "link": "/divergence.md"
                      },
                      {
                            "text": "练习路线：清空 src，从红到绿",
                            "link": "/exercises.md"
                      }
                ]
          }
    ],
    outline: { level: [2, 3] },
    search: { provider: 'local' },
    docFooter: { prev: '上一章', next: '下一章' },
  },
}
