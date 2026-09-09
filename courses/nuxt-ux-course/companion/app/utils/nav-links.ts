// companion/app/utils/nav-links.ts · 站点导航的预取策略表（纯数据 + 纯映射，可单测）
//
// 策略与理由（改任何一条策略，必须连这里的理由一起改——理由是策略的一部分）：
// - /products   viewport     核心动线：首页主按钮与页头都指向商品列表，保留 NuxtLink 默认的
//                             视口预取——进视口且空闲即取，点击时代码已就位。
// - /search     interaction  次级动线：hover/focus 是更强的意图信号，改为交互触发，省下
//                             「每页空闲都为一个次级目标花字节」的常开成本。
// - /favorites  none         低频目标且仍是客户端取数形态：预取只省代码下载、省不掉数据白屏
//                             等待，页头全站出现意味着成本每页都付——先裁掉，等页面形态升级再评估。
//
// 两条工程约束：
// 1. 理由写在注释、不写成数据字段——这个模块会进每个页面的共享分块，文档字符串是纯负载；
// 2. data-prefetch 标注：NuxtLink 的预取发生在客户端运行时，SSR HTML 的锚点上没有它的痕迹，
//    策略以 data-prefetch 落在锚点上，是给 gate 与浏览器排查用的显式配置面（行为面仍归 NuxtLink）。

/** 预取策略三档：viewport=保持默认视口预取；interaction=交互触发；none=裁剪（不预取） */
export type NavPrefetchMode = 'viewport' | 'interaction' | 'none'

export interface NavLinkSpec {
  to: string
  label: string
  prefetch: NavPrefetchMode
}

/** 页头导航与预取策略表（SiteHeader 渲染与 tests/nav-links.test.ts 共用） */
export const NAV_LINKS: readonly NavLinkSpec[] = [
  { to: '/products', label: '商品', prefetch: 'viewport' },
  { to: '/search', label: '搜索', prefetch: 'interaction' },
  { to: '/favorites', label: '收藏', prefetch: 'none' },
]

/** 策略 → NuxtLink 预取 props 的纯映射 */
export interface NuxtLinkPrefetchProps {
  noPrefetch?: boolean
  prefetchOn?: { visibility?: boolean; interaction?: boolean }
}

/**
 * 把策略档位翻译成 NuxtLink 的预取 props：
 * - viewport：空对象——不传任何 prop，保持 NuxtLink 默认（prefetch: true + prefetchOn: { visibility: true }）；
 * - none：noPrefetch: true——整条链接不预取；
 * - interaction：prefetchOn 两个键都要显式写——prefetchOn 是按触发器逐项回退默认值的，
 *   只写 { interaction: true } 会保留 visibility 的默认 true，裁剪就不成立。
 */
export function prefetchPropsFor(mode: NavPrefetchMode): NuxtLinkPrefetchProps {
  if (mode === 'none') return { noPrefetch: true }
  if (mode === 'interaction') return { prefetchOn: { visibility: false, interaction: true } }
  return {}
}
