// companion/drizzle.config.ts · drizzle-kit 的配置：generate 看哪儿 diff、migrate 连哪个库
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  // 单一事实源：表结构声明。generate 对比「这份声明」与「上一次迁移」产出 diff
  schema: './server/db/schema.ts',
  // 迁移账本：生成的 SQL 文件落在这里，按序号排队，入库共享
  out: './server/db/migrations',
  // 连接串走环境（.env 的 NUXT_DB_URL，经 npm script 的 --env-file 装载）——不在代码里写死
  dbCredentials: {
    url: process.env.NUXT_DB_URL ?? '',
  },
})
