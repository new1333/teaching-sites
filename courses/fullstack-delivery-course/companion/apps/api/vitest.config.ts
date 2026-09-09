// companion: apps/api/vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // 数据库是共享资源：测试文件之间串行，避免一个文件 TRUNCATE 时另一个文件正在断言
    fileParallelism: false,
  },
})
