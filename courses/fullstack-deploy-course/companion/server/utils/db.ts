// companion/server/utils/db.ts · 请求一侧的数据库出口：runtimeConfig.dbUrl 的第一个真实消费者
// dbUrl 在第 3 章登记进 runtimeConfig（NUXT_DB_URL 注入）——本章起真正被使用：
// 连接串从进程配置流进连接池，代码里没有一处写死地址
import { createDb, type Db } from '../db/client'
import { pgDeploysRepo } from '../db/deploys'
import type { DeploysRepo } from '../domain/deploys'

// 进程级单例：连接池在进程生命周期里共享——每请求新建池等于每请求重新握手，池就没意义了
let dbSingleton: Db | undefined

export function useDb(): Db {
  const config = useRuntimeConfig()
  dbSingleton ??= createDb(config.dbUrl)
  return dbSingleton
}

// handler 用这一个函数拿仓库：域逻辑只认 DeploysRepo 接口，这里决定给它 PostgreSQL 实现
export function useDeploysRepo(): DeploysRepo {
  return pgDeploysRepo(useDb())
}
