// docs/.vitepress/theme/echarts-theme.ts · 全课程统一 echarts 主题（一次注册，全书一致配色）
// 配色遵循 A 股行情惯例：红涨绿跌。

export const ASTOCK_COLORS = {
  up: '#c0392b', // 涨/阳线·红
  down: '#1e8e5a', // 跌/阴线·绿
  primary: '#b02a1e', // 主线·深红
  secondary: '#1f5fa8', // 副线·蓝
  accent: '#c98a12', // 强调·琥珀
  gray: '#8a8f99',
  grid: '#e6e8ec',
  text: '#3d4148',
} as const

export const astockEChartsTheme = {
  color: [ASTOCK_COLORS.primary, ASTOCK_COLORS.secondary, ASTOCK_COLORS.accent, ASTOCK_COLORS.down, ASTOCK_COLORS.up, ASTOCK_COLORS.gray],
  textStyle: { color: ASTOCK_COLORS.text },
  categoryAxis: {
    axisLine: { lineStyle: { color: ASTOCK_COLORS.grid } },
    axisLabel: { color: ASTOCK_COLORS.text },
    splitLine: { show: false },
  },
  valueAxis: {
    axisLine: { show: false },
    axisLabel: { color: ASTOCK_COLORS.text },
    splitLine: { lineStyle: { color: ASTOCK_COLORS.grid } },
  },
  tooltip: {
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderColor: ASTOCK_COLORS.grid,
    textStyle: { color: ASTOCK_COLORS.text },
  },
}
