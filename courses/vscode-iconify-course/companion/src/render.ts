import type { IconSetData } from './types'
import { utf8ToBase64 } from './base64'

/** 渲染所需的全部信息:裸 body + 尺寸与宽高比 */
export interface IconRenderInfo {
  key: string
  body: string
  width: number
  height: number
  ratio: number
}

/** 集合数据 → 渲染信息:尺寸回退链 图标自身 > 集合默认 > 16 */
export function toRenderInfo(set: IconSetData, icon: string, key: string): IconRenderInfo | undefined {
  const data = set.icons[icon]
  if (!data)
    return undefined
  const width = data.width ?? set.width ?? 16
  const height = data.height ?? set.height ?? 16
  return { key, body: data.body, width, height, ratio: width / height || 1 }
}

/** 给裸 body 穿上 <svg> 壳:宽按 ratio 撑开,viewBox 保持原始坐标系 */
export function pathToSvg(info: IconRenderInfo, fontSize: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${fontSize * info.ratio}px" height="${fontSize}px" preserveAspectRatio="xMidYMid meet" viewBox="0 0 ${info.width} ${info.height}">${info.body}</svg>`
}

export function toDataUrl(svg: string): string {
  return `data:image/svg+xml;base64,${utf8ToBase64(svg)}`
}

export interface Renderer {
  /** 按 (颜色, 字号, 键) 缓存的 data URL 生成 */
  getIconDataUrl(info: IconRenderInfo, fontSize?: number, color?: string): string
}

export function createRenderer(options: { toDataUrl?: (svg: string) => string } = {}): Renderer {
  const encode = options.toDataUrl ?? toDataUrl
  const cache = new Map<string, string>()
  function getIconDataUrl(info: IconRenderInfo, fontSize = 32, color = 'currentColor'): string {
    const cacheKey = `${color}:${fontSize}:${info.key}`
    const hit = cache.get(cacheKey)
    if (hit !== undefined)
      return hit
    // currentColor 是 SVG 的继承占位,装饰场景没有继承链,渲染前换成实际主题色
    const svg = pathToSvg(info, fontSize).replaceAll('currentColor', color)
    const url = encode(svg)
    cache.set(cacheKey, url)
    return url
  }
  return { getIconDataUrl }
}
