// src/errors.ts —— 统一的“错误转文字”帮助函数，避免到处写 (err as Error).message
// catch 块里的异常类型是 unknown；用 instanceof 收窄而不是类型断言。

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
