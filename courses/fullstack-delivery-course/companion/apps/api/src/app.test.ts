// companion: apps/api/src/app.test.ts · 端点 e2e（第 4 章起经 createAuthedApp 拿登录态）
import { afterAll, describe, expect, it } from 'vitest'
import { createAuthedApp } from '../test/helpers'

const app = await createAuthedApp()
const base = app.base

afterAll(async () => {
  await app.shutdown()
})

// res.json() 的类型是 unknown，测试里按需收窄成宽松的 JSON 形状
const json = (res: Response) => res.json() as Promise<Record<string, any>>

describe('GET /healthz', () => {
  it('返回 200 与 {status:"ok"}', async () => {
    const res = await fetch(`${base}/healthz`)
    expect(res.status).toBe(200)
    expect(await json(res)).toEqual({ status: 'ok' })
  })
})

describe('POST /api/links', () => {
  // 不带 Cookie 的裸 POST：校验是无状态纯检查，先于身份——缺 url 依然 422
  const postLink = (body: unknown) =>
    fetch(`${base}/api/links`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

  it('登录后合法请求返回 201，body 含 slug/url/createdAt', async () => {
    const res = await app.postLink({ url: 'https://example.com/very-long-path' })
    expect(res.status).toBe(201)
    const body = await json(res)
    expect(body.url).toBe('https://example.com/very-long-path')
    expect(typeof body.slug).toBe('string')
    expect(body.slug).toHaveLength(7)
    expect(typeof body.createdAt).toBe('string')
  })

  it('缺 url 返回 422 且 error.field 为 "url"', async () => {
    const res = await postLink({})
    expect(res.status).toBe(422)
    const body = await json(res)
    expect(body.error?.field).toBe('url')
    expect(typeof body.error?.message).toBe('string')
    expect(body.error?.message.length).toBeGreaterThan(0)
  })

  it('http 网址（非 https）返回 422', async () => {
    const res = await postLink({ url: 'http://example.com' })
    expect(res.status).toBe(422)
    const body = await json(res)
    expect(body.error?.field).toBe('url')
  })
})

describe('GET /:slug', () => {
  it('命中返回 302 且 Location 指向原网址', async () => {
    const created = await app.postLink({ url: 'https://example.com/target' })
    const { slug } = await json(created)
    const res = await fetch(`${base}/${slug}`, { redirect: 'manual' })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://example.com/target')
  })

  it('未知 slug 返回 404', async () => {
    const res = await fetch(`${base}/nope-${Date.now()}`, { redirect: 'manual' })
    expect(res.status).toBe(404)
  })
})
