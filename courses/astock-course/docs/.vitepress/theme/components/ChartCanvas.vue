<script setup lang="ts">
// docs/.vitepress/theme/components/ChartCanvas.vue · 全课程共用 echarts 容器
// 动态 import 分包加载（首屏不吞几百 KB），随版心宽度自适应，option 变化整体重绘。
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { astockEChartsTheme } from '../echarts-theme'

const props = defineProps<{
  option: Record<string, unknown>
  height?: string
  ariaLabel?: string
}>()

const el = ref<HTMLDivElement | null>(null)
let chart: { setOption: (o: unknown, t?: boolean) => void; resize: () => void; dispose: () => void } | null = null
let observer: ResizeObserver | null = null
let alive = false

onMounted(async () => {
  alive = true
  if (!el.value) return
  const echarts = await import('echarts')
  if (!alive || !el.value) return
  echarts.registerTheme('astock', astockEChartsTheme as never)
  chart = echarts.init(el.value, 'astock')
  chart.setOption(props.option, true)
  observer = new ResizeObserver(() => chart?.resize())
  observer.observe(el.value)
})

watch(
  () => props.option,
  (opt) => {
    chart?.setOption(opt, true)
  },
)

onBeforeUnmount(() => {
  alive = false
  observer?.disconnect()
  chart?.dispose()
  chart = null
})
</script>

<template>
  <div
    ref="el"
    class="astock-chart"
    :style="{ height: height ?? '380px' }"
    role="img"
    :aria-label="ariaLabel ?? '课程图表'"
  />
</template>

<style scoped>
.astock-chart {
  width: 100%;
}
</style>
