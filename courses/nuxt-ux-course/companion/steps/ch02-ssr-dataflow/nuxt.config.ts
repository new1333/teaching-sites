// companion/nuxt.config.ts —— 蜗牛商店基线站配置
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  telemetry: false,
  devtools: { enabled: false },
  css: ['~/assets/css/main.css'],
  app: {
    head: {
      htmlAttrs: { lang: 'zh-CN' },
      title: '蜗牛商店',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        {
          name: 'description',
          content: '蜗牛商店——一个刻意做慢、逐章提速的电商教学演示站。',
        },
      ],
    },
  },
})
