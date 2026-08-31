// src/cli.ts —— 从配置文件路径启动代理运行时；支持 SIGINT/SIGTERM 优雅关闭
// main() 可被测试直接调用；只有作为脚本被执行（node cli.js config.json）时才会自动跑起来。

import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import type EventEmitter from 'node:events'
import { parseProxyConfig } from './config.js'
import { errorMessage } from './errors.js'
import { createProxyRuntime } from './runtime.js'
import type { ProxyRuntime } from './runtime.js'
import type { ProxyEvent } from './types.js'

export type LoadConfigOutcome = ReturnType<typeof parseProxyConfig>

function logEvent(event: ProxyEvent): void {
  const detail = event.detail === undefined ? '' : ` ${JSON.stringify(event.detail)}`
  console.log(`[${event.type}] ${event.message}${detail}`)
}

/** 读取配置文件、JSON.parse、再交给 config.ts 严格校验；JSON 语法错误也算校验失败,统一走 errors 数组。*/
export async function loadConfigFile(path: string): Promise<LoadConfigOutcome> {
  const text = await readFile(path, 'utf8')
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (err) {
    return { ok: false, errors: [`配置文件不是合法 JSON：${errorMessage(err)}`] }
  }
  return parseProxyConfig(raw)
}

export async function startFromConfigPath(path: string, sink: (event: ProxyEvent) => void = logEvent): Promise<ProxyRuntime> {
  const parsed = await loadConfigFile(path)
  if (!parsed.ok) {
    throw new Error(`配置校验失败：\n${parsed.errors.map((e) => `  - ${e}`).join('\n')}`)
  }
  return createProxyRuntime(parsed.config, { sink })
}

export interface GracefulShutdownOptions {
  /** 信号来源，默认是真实的 process；测试注入一个 EventEmitter 就能在不真的杀死进程的前提下验证关闭逻辑。*/
  readonly signals?: EventEmitter
  /** 退出函数，默认是真实的 process.exit；测试注入一个 spy 以观察调用而不真的退出。*/
  readonly exit?: (code: number) => void
  readonly log?: (message: string) => void
}

export function installGracefulShutdown(runtime: ProxyRuntime, options: GracefulShutdownOptions = {}): void {
  const signals = options.signals ?? process
  const exit = options.exit ?? ((code: number) => process.exit(code))
  const log = options.log ?? ((message: string) => console.log(message))

  let shuttingDown = false
  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return
    shuttingDown = true
    log(`收到 ${signal}，正在关闭代理运行时…`)
    await runtime.close()
    exit(0)
  }
  signals.on('SIGINT', () => {
    void shutdown('SIGINT')
  })
  signals.on('SIGTERM', () => {
    void shutdown('SIGTERM')
  })
}

export async function main(argv: readonly string[]): Promise<void> {
  const configPath = argv[2]
  if (configPath === undefined) {
    console.error('用法：node cli.js <config.json>')
    process.exitCode = 1
    return
  }
  const runtime = await startFromConfigPath(configPath)
  console.log(`HTTP 代理监听端口 ${runtime.httpPort}，SOCKS5 代理监听端口 ${runtime.socksPort}`)
  installGracefulShutdown(runtime)
}

const entryArg = process.argv[1]
const isDirectRun = entryArg !== undefined && import.meta.url === pathToFileURL(entryArg).href
if (isDirectRun) {
  main(process.argv).catch((err: unknown) => {
    console.error(errorMessage(err))
    process.exitCode = 1
  })
}
