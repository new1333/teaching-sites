/** 单个图标的绘制数据:body 是 SVG 内部片段(不含 <svg> 壳) */
export interface IconData {
  body: string
  width?: number
  height?: number
}

/** 一个图标集合(Icon Set)的完整数据 */
export interface IconSetData {
  prefix: string
  width?: number
  height?: number
  icons: Record<string, IconData>
}
