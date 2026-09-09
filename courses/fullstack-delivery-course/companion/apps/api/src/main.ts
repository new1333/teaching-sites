import { serve } from '@hono/node-server'
import { createApp } from './app'

const port = Number.parseInt(process.env.PORT ?? '4510', 10)

serve({ fetch: createApp().fetch, port }, (info) => {
  console.log(`api listening on http://localhost:${info.port}`)
})
