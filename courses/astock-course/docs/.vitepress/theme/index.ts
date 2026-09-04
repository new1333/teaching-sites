// docs/.vitepress/theme/index.ts · 课程主题入口：注册全书共用组件
// 各章图表组件在 enhanceApp 中追加注册；聚合站构建经 portal-sync 串联各课程主题。
import type { Theme } from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import ChartCanvas from './components/ChartCanvas.vue'
import KLineChart from './components/KLineChart.vue'
import MaCrossChart from './components/MaCrossChart.vue'
import DrawdownChart from './components/DrawdownChart.vue'
import PortfolioMixChart from './components/PortfolioMixChart.vue'
import './custom.css'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('ChartCanvas', ChartCanvas)
    app.component('KLineChart', KLineChart)
    app.component('MaCrossChart', MaCrossChart)
    app.component('DrawdownChart', DrawdownChart)
    app.component('PortfolioMixChart', PortfolioMixChart)
  },
} satisfies Theme
