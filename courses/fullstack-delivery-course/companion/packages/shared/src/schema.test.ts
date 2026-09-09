import { describe, expect, it } from 'vitest'
import { createLinkSchema, linkResponseSchema, validationErrorSchema } from './index'

describe('createLinkSchema', () => {
  it('接受 https 网址', () => {
    const result = createLinkSchema.safeParse({ url: 'https://example.com/a?b=1' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.url).toBe('https://example.com/a?b=1')
    }
  })

  it('缺 url 拒绝，错误定位在 url 字段', () => {
    const result = createLinkSchema.safeParse({})
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.path[0]).toBe('url')
    }
  })

  it('http 网址拒绝（必须 https）', () => {
    const result = createLinkSchema.safeParse({ url: 'http://example.com' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.path[0]).toBe('url')
    }
  })

  it('非 URL 字符串拒绝', () => {
    expect(createLinkSchema.safeParse({ url: 'not-a-url' }).success).toBe(false)
  })
})

describe('linkResponseSchema', () => {
  it('接受完整的短链响应', () => {
    const result = linkResponseSchema.safeParse({
      slug: 'a1b2c3d',
      url: 'https://example.com',
      createdAt: '2026-09-09T00:00:00.000Z',
    })
    expect(result.success).toBe(true)
  })

  it('缺 slug 拒绝', () => {
    const result = linkResponseSchema.safeParse({
      url: 'https://example.com',
      createdAt: '2026-09-09T00:00:00.000Z',
    })
    expect(result.success).toBe(false)
  })
})

describe('validationErrorSchema', () => {
  it('接受 {error:{field,message}} 形状', () => {
    const result = validationErrorSchema.safeParse({ error: { field: 'url', message: 'invalid url' } })
    expect(result.success).toBe(true)
  })

  it('缺 message 拒绝', () => {
    expect(validationErrorSchema.safeParse({ error: { field: 'url' } }).success).toBe(false)
  })
})
