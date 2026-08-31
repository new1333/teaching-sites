// scripts/node-api.d.ts —— 给脚本用到的几个 node: API 补最小类型声明。
// 工程不装 @types/node（tests/fixtures-raw.d.ts 同款策略）：扩展运行时零 Node 依赖，
// 脚本只在开发侧跑，声明「恰好用到的那几个函数签名」就够 tsc --noEmit 过关。

declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string
  export function readFileSync(path: string): Uint8Array
  export function readdirSync(path: string): string[]
  export function statSync(path: string): { isFile(): boolean; isDirectory(): boolean }
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void
  export function writeFileSync(path: string, data: Uint8Array | string): void
}

declare module 'node:path' {
  export function join(...parts: string[]): string
  export function dirname(p: string): string
  export function relative(from: string, to: string): string
}

declare module 'node:url' {
  export function fileURLToPath(u: string): string
}

declare const process: { exit(code?: number): never }
