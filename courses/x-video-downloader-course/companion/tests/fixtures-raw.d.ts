// tests/fixtures-raw.d.ts —— 给「?raw 整文件读文本」的 import 一个类型（vite/vitest 的约定后缀）。
// 工程没装 @types/node，读 fixture 文本走 ?raw 而不是 node:fs，测试环境零 Node API。
declare module '*?raw' {
  const content: string
  export default content
}
