import type { Theme } from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import KLineChart from './components/KLineChart.vue'
import LineChart from './components/LineChart.vue'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('KLineChart', KLineChart)
    app.component('LineChart', LineChart)
  },
} satisfies Theme
