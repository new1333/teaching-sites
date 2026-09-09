// companion: apps/api/src/main.ts
import { serve } from '@hono/node-server'
import { createApp } from './app'
import { requireDatabaseUrl } from './config'
import { createPgStore } from './db/store.pg'

const port = Number.parseInt(process.env.PORT ?? '4510', 10)
const store = createPgStore(requireDatabaseUrl())

serve({ fetch: createApp(store).fetch, port }, (info) => {
  console.log(`api listening on http://localhost:${info.port}`)
})
