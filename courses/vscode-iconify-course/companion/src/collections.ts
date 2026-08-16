// 构建期随包携带的静态集合元数据:只有 id 与图标名清单,不含任何绘制数据。
// 真实世界里这份数据有几百个集合、几十万个图标名;实验场用一份迷你版验证同样的结构。
export interface CollectionMeta {
  id: string
  name?: string
  icons: string[]
}

export const builtinCollections: CollectionMeta[] = [
  { id: 'carbon', name: 'Carbon', icons: ['home', 'search', 'settings'] },
  { id: 'mdi', name: 'Material Design Icons', icons: ['home', 'account', 'content-save'] },
  { id: 'mdi-light', name: 'MDI Light', icons: ['home', 'account'] },
  { id: 'ph', name: 'Phosphor', icons: ['cycle'] },
]

export const builtinCollectionIds = builtinCollections.map(c => c.id)
