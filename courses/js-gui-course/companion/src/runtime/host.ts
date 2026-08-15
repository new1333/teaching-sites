// 嵌入层：宿主如何「造出一个 JS 世界」。
// globals 是宿主单方面填的字典：挂什么，脚本就有什么。
export interface Runtime {
  readonly name: string
  readonly globals: Record<string, unknown>
  inject(key: string, value: unknown): void
  /** 在这个世界里执行脚本（脚本经 globals 取到注入的能力） */
  run(script: () => void): void
}

export function createRuntime(name: string): Runtime {
  const globals: Record<string, unknown> = {}
  return {
    name,
    globals,
    inject(key, value) {
      globals[key] = value
    },
    run(script) {
      script()
    },
  }
}
