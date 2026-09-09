// 读者与课程共用的领域类型（Nuxt 4 的 shared/ 目录：app 与 server 两侧都可引用）
export interface Product {
  id: number
  name: string
  category: string
  priceYuan: number
  rating: number
  summary: string
}
