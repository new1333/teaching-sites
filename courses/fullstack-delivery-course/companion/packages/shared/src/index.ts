import { z } from 'zod'

/** 创建短链的请求体：url 必须是 https 协议的合法网址 */
export const createLinkSchema = z.object({
  url: z.url({ protocol: /^https$/ }),
})

/** POST /api/links 的成功响应：一条短链记录 */
export const linkResponseSchema = z.object({
  slug: z.string(),
  url: z.string(),
  createdAt: z.string(),
})

/** 校验失败（422）的响应：第一个出错字段的定位与原因 */
export const validationErrorSchema = z.object({
  error: z.object({
    field: z.string(),
    message: z.string(),
  }),
})

/** 注册请求体：合法邮箱 + 至少 8 位密码 */
export const registerSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
})

/** 登录请求体：形状与注册一致（分两个导出，将来两端可独立演进） */
export const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
})

/** 注册/登录成功与 me 的响应：一个已登录用户的公开形状 */
export const userResponseSchema = z.object({
  id: z.string(),
  email: z.string(),
})

export type CreateLinkInput = z.infer<typeof createLinkSchema>
export type LinkResponse = z.infer<typeof linkResponseSchema>
export type ValidationError = z.infer<typeof validationErrorSchema>
export type RegisterInput = z.infer<typeof registerSchema>
export type LoginInput = z.infer<typeof loginSchema>
export type UserResponse = z.infer<typeof userResponseSchema>
