import { Hono } from 'hono'
import { nanoid } from 'nanoid'
import { createLinkSchema, type LinkResponse } from '@shortlink/shared'
import { createMemoryStore, type MemoryStore } from './store'

export function createApp(store: MemoryStore = createMemoryStore()) {
  const app = new Hono()

  // 浅检查：进程活着就答 ok
  app.get('/healthz', (c) => c.json({ status: 'ok' }))

  app.post('/api/links', async (c) => {
    const body = await c.req.json().catch(() => null)
    const parsed = createLinkSchema.safeParse(body)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      const field = issue?.path.join('.') || 'body'
      return c.json(
        { error: { field, message: issue?.message ?? '请求体不合法' } },
        422,
      )
    }
    const link: LinkResponse = {
      slug: nanoid(7),
      url: parsed.data.url,
      createdAt: new Date().toISOString(),
    }
    store.put(link)
    return c.json(link, 201)
  })

  app.get('/:slug', (c) => {
    const link = store.get(c.req.param('slug'))
    if (!link) {
      return c.json({ error: 'not found' }, 404)
    }
    return c.redirect(link.url, 302)
  })

  return app
}
