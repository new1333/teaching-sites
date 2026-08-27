export default {
  title: "从零基础小白到A股投资入门",
  description: "零基础新手，看懂K线、算清概率、装上风控",
  base: '/',
  themeConfig: {
    nav: [{ text: '首页', link: '/' }, { text: '关于', link: '/about' }],
    sidebar: [
      {
            "text": "第一部分 · 地基：看懂市场这台机器",
            "collapsed": false,
            "items": [
                  {
                        "text": "1. 价格为什么会动：股票、交易所与买卖的拔河",
                        "link": "/01-what-moves-price.md"
                  },
                  {
                        "text": "2. 一笔订单的旅程：竞价、盘口与挡住你的那些规则",
                        "link": "/02-order-journey.md"
                  }
            ]
      },
      {
            "text": "第二部分 · K线的语言：从一根蜡烛到形态字典",
            "collapsed": false,
            "items": [
                  {
                        "text": "3. 一根 K 线的诞生：从逐笔成交到开高低收",
                        "link": "/03-candle-anatomy.md"
                  },
                  {
                        "text": "4. 把开高低收画成图：坐标、缩放与 K 线渲染器",
                        "link": "/04-candle-rendering.md"
                  },
                  {
                        "text": "5. 单根 K 线（上）：大实体与影线家族的攻防剧本",
                        "link": "/05-single-patterns-wicks.md"
                  },
                  {
                        "text": "6. 单根 K 线（下）：十字星家族与「不讲道理」的一字线",
                        "link": "/06-single-patterns-doji.md"
                  },
                  {
                        "text": "7. 双根形态：吞没、乌云盖顶、孕线与平顶平底",
                        "link": "/07-multi-patterns-two.md"
                  },
                  {
                        "text": "8. 三根以上：晨星暮星、三兵三鸦与三法",
                        "link": "/08-multi-patterns-three.md"
                  },
                  {
                        "text": "9. 形态到底灵不灵：用统计给近三十种形态验货",
                        "link": "/09-pattern-stats.md"
                  }
            ]
      },
      {
            "text": "第三部分 · 趋势与量价：给形态装上上下文",
            "collapsed": false,
            "items": [
                  {
                        "text": "10. 趋势的解剖：道氏理论、波峰波谷与画线",
                        "link": "/10-trend-anatomy.md"
                  },
                  {
                        "text": "11. 均线：把噪声抹掉之后剩下的趋势",
                        "link": "/11-moving-averages.md"
                  },
                  {
                        "text": "12. 成交量：价格是舟，量是水",
                        "link": "/12-volume-analysis.md"
                  },
                  {
                        "text": "13. 支撑、阻力与斐波那契：人多的路口，价格会堵车",
                        "link": "/13-support-resistance.md"
                  },
                  {
                        "text": "14. 筹码分布：谁的持仓成本压在哪个价位",
                        "link": "/14-chip-distribution.md"
                  },
                  {
                        "text": "15. 头肩顶与双顶：看懂大型反转结构",
                        "link": "/15-reversal-structures.md"
                  }
            ]
      },
      {
            "text": "第四部分 · 指标与概率：MACD、RSI、KDJ、布林带",
            "collapsed": false,
            "items": [
                  {
                        "text": "16. MACD：两条均线的差值能告诉你什么",
                        "link": "/16-macd.md"
                  },
                  {
                        "text": "17. RSI 与 KDJ：超买超卖的双胞胎",
                        "link": "/17-rsi-kdj.md"
                  },
                  {
                        "text": "18. 布林带与波动率：把概率装进指标",
                        "link": "/18-bollinger.md"
                  }
            ]
      },
      {
            "text": "第五部分 · 从看图到下单：风控、回测与交易系统",
            "collapsed": false,
            "items": [
                  {
                        "text": "19. 下单前的最后一道闸：市盈率、市净率与 ROE",
                        "link": "/19-fundamentals-peek.md"
                  },
                  {
                        "text": "20. 期望值与仓位：胜率六成也可能亏钱的数学",
                        "link": "/20-expectancy-risk.md"
                  },
                  {
                        "text": "21. 最小回测引擎：拿历史数据彩排你的策略",
                        "link": "/21-backtest-engine.md"
                  },
                  {
                        "text": "22. 组装你的交易系统：清单、纪律与防骗",
                        "link": "/22-trading-system.md"
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
                        "text": "K线形态速查表（近三十种）",
                        "link": "/kline-patterns-cheatsheet.md"
                  },
                  {
                        "text": "A股交易规则与费用速查表",
                        "link": "/trading-rules-cheatsheet.md"
                  },
                  {
                        "text": "练习路线：从零重建你的技术分析引擎",
                        "link": "/exercises.md"
                  },
                  {
                        "text": "本课程简化与真实市场的差异清单",
                        "link": "/divergence-list.md"
                  }
            ]
      }
],
    outline: { level: [2, 3] },
    search: { provider: 'local' },
    docFooter: { prev: '上一章', next: '下一章' },
  },
}
