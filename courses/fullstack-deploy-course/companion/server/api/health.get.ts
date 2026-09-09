// companion/server/api/health.get.ts · GET /api/health：容器健康检查的探针端点
//
// HEALTHCHECK / 编排器的 --wait / 后续部署脚本的健康门禁，探的都是这里：
//   200 + {status:"ok"} —— 进程活着且能应答 HTTP。
// 探测是周期性的（Dockerfile 里 interval 3s），所以这个端点必须便宜：
// 不查数据库、不做业务逻辑——「数据库能不能连」是另一类健康信号（分级讨论在加固一章）。
// appEnv 顺带回报：健康检查响应本身成了环境变量注入的活证据。
export default defineEventHandler(() => {
  const config = useRuntimeConfig()
  return { status: 'ok', appEnv: config.public.appEnv }
})
