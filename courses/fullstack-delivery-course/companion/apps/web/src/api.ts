import {
  linkResponseSchema,
  userResponseSchema,
  validationErrorSchema,
  type LinkResponse,
  type UserResponse,
} from '@shortlink/shared'

const apiOrigin = 'http://localhost:4510'

/** 短链的完整 URL：导航跨源不受 CORS 限制，可以直接点开 */
export function shortUrlOf(link: LinkResponse): string {
  return `${apiOrigin}/${link.slug}`
}

/**
 * 同源 fetch：页面与 /api 之间隔着 Vite 代理，浏览器视为同一个源，
 * Cookie 默认随请求自动带上（credentials 的默认值就是 same-origin）。
 */
async function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function createLink(url: string): Promise<LinkResponse> {
  const res = await postJson('/api/links', { url })
  if (res.status === 422) {
    const body = validationErrorSchema.parse(await res.json())
    throw new Error(`${body.error.field}：${body.error.message}`)
  }
  if (res.status === 401) {
    throw new Error('请先登录：创建短链需要一个已登录的会话')
  }
  if (!res.ok) {
    throw new Error(`创建失败（HTTP ${res.status}）`)
  }
  return linkResponseSchema.parse(await res.json())
}

export async function register(email: string, password: string): Promise<UserResponse> {
  const res = await postJson('/api/auth/register', { email, password })
  if (res.status === 409) {
    throw new Error('该邮箱已注册')
  }
  if (res.status === 422) {
    const body = validationErrorSchema.parse(await res.json())
    throw new Error(`${body.error.field}：${body.error.message}`)
  }
  if (!res.ok) {
    throw new Error(`注册失败（HTTP ${res.status}）`)
  }
  return userResponseSchema.parse(await res.json())
}

export async function login(email: string, password: string): Promise<UserResponse> {
  const res = await postJson('/api/auth/login', { email, password })
  if (res.status === 401 || res.status === 422) {
    throw new Error('邮箱或密码不正确')
  }
  if (!res.ok) {
    throw new Error(`登录失败（HTTP ${res.status}）`)
  }
  return userResponseSchema.parse(await res.json())
}

export async function logout(): Promise<void> {
  await postJson('/api/auth/logout', {})
}

/** 页面加载时问一句「我是谁」：401 代表没有会话，返回 null 而不是抛错 */
export async function fetchMe(): Promise<UserResponse | null> {
  const res = await fetch('/api/auth/me')
  if (res.status === 401) return null
  if (!res.ok) {
    throw new Error(`读取登录态失败（HTTP ${res.status}）`)
  }
  return userResponseSchema.parse(await res.json())
}
