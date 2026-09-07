export default defineNuxtConfig({
  compatibilityDate: '2026-09-01',
  devtools: { enabled: false },
  // 运行期配置面：这里只登记键名与「空默认」——必需项刻意不给安全默认值，
  // 漏配必须在进程启动时暴露（server/plugins/config.ts 的 fail-fast 校验），而不是带病上岗。
  // 真正的值由进程启动时的 NUXT_ 前缀环境变量注入；.env 只承载本机默认值，不进仓库。
  runtimeConfig: {
    // 私有键：只在服务端可见。连接串属于密钥，永不进浏览器。
    dbUrl: '', // 注入变量：NUXT_DB_URL（第 4 章起真正使用）
    public: {
      // 公有键：会随页面序列化进浏览器，只放可展示的非敏感信息。
      appEnv: '', // 注入变量：NUXT_PUBLIC_APP_ENV（公有键在变量名里多一段 PUBLIC_）
    },
  },
})
