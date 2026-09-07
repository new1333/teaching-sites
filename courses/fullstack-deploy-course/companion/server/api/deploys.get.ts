// companion/server/api/deploys.get.ts · GET /api/deploys：文件路径即路由，.get 后缀限定 HTTP 方法
import { listDeploys } from '../domain/deploys'

export default defineEventHandler(() => {
  return listDeploys()
})
