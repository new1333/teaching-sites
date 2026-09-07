// companion/server/plugins/config.ts · Nitro 启动插件：进程起跳前校验必需配置，缺项带清单退出
// server/plugins/ 下的插件由 Nitro 在服务启动时执行一次（dev 与生产产物都走这里）
// process 显式从 node:process import（与 Nitro 产物入口同款写法），不依赖全局类型
import process from 'node:process'
import { ConfigError, loadAppConfig } from '../utils/config'

export default defineNitroPlugin(() => {
  try {
    const config = loadAppConfig(process.env)
    console.log(`[config] 必需配置校验通过（appEnv=${config.appEnv}）`)
  } catch (err) {
    if (err instanceof ConfigError) {
      // fail-fast：不带病上岗。退出码 1 让守护进程 / 容器编排 / CI 都能看见「这次启动失败了」
      console.error(`[config] ${err.message}`)
      process.exit(1)
    }
    throw err
  }
})
