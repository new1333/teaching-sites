// companion: apps/api/src/main.ts
import { serve } from '@hono/node-server'
import { createApp } from './app'
import { requireDatabaseUrl } from './config'
import { createPgStore } from './db/store.pg'
import { createAuthStore } from './auth/session'

const port = Number.parseInt(process.env.PORT ?? '4510', 10)
const store = createPgStore(requireDatabaseUrl())
const auth = createAuthStore(requireDatabaseUrl())

serve({ fetch: createApp(store, auth).fetch, port }, (info) => {
  console.log(`api listening on http://localhost:${info.port}`)
})
