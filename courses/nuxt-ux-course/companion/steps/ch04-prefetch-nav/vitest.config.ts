// companion/vitest.config.ts · 只跑根 tests/ 下的纯逻辑测试
// （steps/ 里的各章快照自带同名测试，但不带 .nuxt 类型缓存，不参与本仓测试）
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
