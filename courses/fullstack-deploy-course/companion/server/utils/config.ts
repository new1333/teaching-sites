// companion/server/utils/config.ts · 启动期配置门卫：必需环境变量一次校验、一次报全，绝不部分返回
import { z } from 'zod'

// 配置错误：problems 携带全部问题项（键 + 原因），由启动插件打印成清单后以非 0 退出码结束进程
export class ConfigError extends Error {
  constructor(readonly problems: readonly { key: string; reason: string }[]) {
    super(
      `必需环境变量校验失败（${problems.length} 项）：\n` +
        problems.map((p) => `  - ${p.key}: ${p.reason}`).join('\n'),
    )
    this.name = 'ConfigError'
  }
}

// 必需环境变量的守门 schema（键名与 nuxt.config.ts 的 runtimeConfig 注入规则一一对应）：
//   NUXT_DB_URL        → 私有键 dbUrl（数据库连接串，第 4 章起真正使用；密钥只在服务端存在）
//   NUXT_PUBLIC_APP_ENV → 公有键 public.appEnv（运行环境名；NUXT_PUBLIC_ 前缀 + 双下划线定位嵌套键）
const requiredEnvSchema = z.object({
  NUXT_DB_URL: z.string().refine(
    (v) => v.length > 0 && (v.startsWith('postgres://') || v.startsWith('postgresql://')),
    '不能为空，且必须以 postgres:// 或 postgresql:// 开头（第 4 章的 PostgreSQL 驱动只认这两种写法）',
  ),
  NUXT_PUBLIC_APP_ENV: z.enum(['local', 'staging', 'production'], {
    error: '只允许 local、staging 或 production',
  }),
})

// 应用视角的配置形状：env 里的 NUXT_ 前缀在这里翻译掉，调用方只见 dbUrl / appEnv
export interface AppConfig {
  dbUrl: string
  appEnv: 'local' | 'staging' | 'production'
}

export function loadAppConfig(env: Record<string, string | undefined>): AppConfig {
  const parsed = requiredEnvSchema.safeParse(env)
  if (!parsed.success) {
    // 一次报全：zod 的 issues 覆盖所有未通过的字段，不只第一个
    const problems = parsed.error.issues.map((issue) => {
      const key = issue.path.join('.')
      // 缺失与非法分开说：键没设置是「缺」，设置了但值不对是「错」
      const reason = env[key] === undefined ? '缺失（未设置）' : issue.message
      return { key, reason }
    })
    throw new ConfigError(problems)
  }
  return {
    dbUrl: parsed.data.NUXT_DB_URL,
    appEnv: parsed.data.NUXT_PUBLIC_APP_ENV,
  }
}
