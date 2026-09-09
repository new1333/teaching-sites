// companion/vitest.config.ts · 测试分两个项目：unit 不碰数据库，integration 由 globalSetup 拉起一次性库
// pnpm test 一条命令跑两者；单测保持「无需 db:up 也能跑」的快车道
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/*.test.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          include: ['tests/integration/*.test.ts'],
          globalSetup: ['tests/integration/global-setup.ts'],
        },
      },
    ],
  },
})
