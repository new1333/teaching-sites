import type { Theme } from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import KLineChart from './components/KLineChart.vue'
import LineChart from './components/LineChart.vue'
import IndicatorChart from './components/IndicatorChart.vue'
import ChipDistChart from './components/ChipDistChart.vue'
import BacktestChart from './components/BacktestChart.vue'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('KLineChart', KLineChart)
    app.component('LineChart', LineChart)
    app.component('IndicatorChart', IndicatorChart)
    app.component('ChipDistChart', ChipDistChart)
    app.component('BacktestChart', BacktestChart)
  },
} satisfies Theme
