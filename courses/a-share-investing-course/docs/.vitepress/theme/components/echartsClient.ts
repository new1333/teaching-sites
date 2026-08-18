// echartsClient：echarts 的 SSR 安全加载入口（三个交互图表组件共用）。
// 硬约束：VitePress build 会先以 SSR 模式执行 theme 下的所有模块，
// 任何顶层 `import echarts`（哪怕是 `from 'echarts/core'`）都会在 Node 端
// 拉起 zrender 的 DOM 环境探测，导致构建失败。因此本文件只允许：
//   1. `import type`（编译期擦除，不产生运行时导入）；
//   2. 运行时动态 import——仅在组件 onMounted 之后才会走到这里。
// 模块级缓存保证 echarts 只加载、注册（use）一次，多个图表共享一个 chunk。
import type { EChartsType } from 'echarts/core'

let loader: Promise<typeof import('echarts/core')> | null = null

function loadCore() {
  if (!loader) {
    loader = Promise.all([
      import('echarts/core'),
      import('echarts/charts'),
      import('echarts/components'),
      import('echarts/renderers'),
    ]).then(([core, charts, components, renderers]) => {
      // 按需注册：只引入三个图表组件实际用到的系列/组件/渲染器，
      // 避免把整个 echarts 打进首屏 chunk。
      core.use([
        charts.CandlestickChart,
        charts.LineChart,
        charts.BarChart,
        charts.ScatterChart,
        components.GridComponent,
        components.TooltipComponent,
        components.AxisPointerComponent,
        components.DataZoomComponent,
        components.LegendComponent,
        components.MarkPointComponent,
        components.MarkLineComponent,
        components.MarkAreaComponent,
        renderers.CanvasRenderer,
      ])
      return core
    })
  }
  return loader
}

/** 在挂载完成的容器上初始化 echarts 实例（调用方负责 dispose） */
export async function initChart(el: HTMLElement): Promise<EChartsType> {
  const core = await loadCore()
  return core.init(el)
}

/** option 的宽松类型：按需注册下不做完整 ComposeOption 推导，保持与教学组件的简洁度 */
export type ChartOption = import('echarts/core').EChartsCoreOption
