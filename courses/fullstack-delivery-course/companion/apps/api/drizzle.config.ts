// companion: apps/api/drizzle.config.ts · drizzle-kit 的配置（generate 生成迁移、migrate 执行迁移）
import { defineConfig } from 'drizzle-kit'
import { requireDatabaseUrl } from './src/config'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: requireDatabaseUrl(),
  },
})
