import {
  linkResponseSchema,
  validationErrorSchema,
  type LinkResponse,
} from '@shortlink/shared'

const apiOrigin = 'http://localhost:4510'

/** 短链的完整 URL：导航跨源不受 CORS 限制，可以直接点开 */
export function shortUrlOf(link: LinkResponse): string {
  return `${apiOrigin}/${link.slug}`
}

export async function createLink(url: string): Promise<LinkResponse> {
  const res = await fetch('/api/links', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url }),
  })
  if (res.status === 422) {
    const body = validationErrorSchema.parse(await res.json())
    throw new Error(`${body.error.field}：${body.error.message}`)
  }
  if (!res.ok) {
    throw new Error(`创建失败（HTTP ${res.status}）`)
  }
  return linkResponseSchema.parse(await res.json())
}
