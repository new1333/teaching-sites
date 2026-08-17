// src/config.ts —— 配置解析与继承：nginx.conf 子集
// 语法：指令以 ; 结尾；块以名字(参数){ 开始、} 结束；# 到行尾是注释。

export interface ConfigNode {
  name: string // 块名：http / server / location / upstream …
  args: string[] // 块名后的参数（location /api → ['/api']）
  directives: Record<string, string> // 本块直接写的指令（键小写归一）
  children: ConfigNode[]
}

export type ParseConfigResult =
  | { ok: true; root: ConfigNode }
  | { ok: false; reason: 'unclosed-block' | 'stray-close' | 'empty-directive' }

export function parseConfig(text: string): ParseConfigResult {
  // 词法：注释剥掉；结构符前后补空格，保证 { } ; 独立成词；再按空白切
  const stripped = text.replace(/#[^\n]*/g, '').replace(/([{};])/g, ' $1 ')
  const tokens = stripped.match(/\S+/g) ?? []

  const root: ConfigNode = { name: '(root)', args: [], directives: {}, children: [] }
  const stack: ConfigNode[] = [root]
  let pending: string[] = [] // 攒词：直到遇见 ; 或 {

  for (const tok of tokens) {
    if (tok === '{') {
      if (pending.length === 0) return { ok: false, reason: 'empty-directive' }
      const [name, ...args] = pending
      const node: ConfigNode = { name: name.toLowerCase(), args, directives: {}, children: [] }
      stack[stack.length - 1].children.push(node)
      stack.push(node)
      pending = []
    } else if (tok === '}') {
      if (pending.length > 0) return { ok: false, reason: 'empty-directive' } // } 前还有没收尾的词
      if (stack.length === 1) return { ok: false, reason: 'stray-close' }
      stack.pop()
    } else if (tok === ';') {
      if (pending.length < 2) return { ok: false, reason: 'empty-directive' }
      const [key, ...rest] = pending
      stack[stack.length - 1].directives[key.toLowerCase()] = rest.join(' ')
      pending = []
    } else {
      pending.push(tok)
    }
  }

  if (stack.length !== 1) return { ok: false, reason: 'unclosed-block' }
  if (pending.length > 0) return { ok: false, reason: 'empty-directive' }
  return { ok: true, root }
}

/**
 * 沿路径合成某块的「有效指令」：路径上每层先到的当默认值，后到的（更内层）覆盖。
 * 路径元素写法：'http'（按名字找第一个）或 'location /static'（名字+参数全等）。
 * 路径走不通返回 null。
 */
export function resolveConfig(root: ConfigNode, path: string[]): Record<string, string> | null {
  let merged: Record<string, string> = { ...root.directives }
  let node: ConfigNode | undefined = root
  for (const step of path) {
    const parts = step.split(/\s+/)
    const name = parts[0].toLowerCase()
    const args = parts.slice(1).join(' ')
    node = node.children.find(
      (c) => c.name === name && (args === '' || c.args.join(' ') === args),
    )
    if (!node) return null
    merged = { ...merged, ...node.directives } // 内层覆盖外层
  }
  return merged
}
