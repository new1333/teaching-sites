// companion/eslint.config.mjs · lint 的契约：recommended 规则集覆盖 TS/JS 表面
// 分工：lint 管约定与坏味道（未用变量、可疑写法），typecheck 管类型（golar）——两者互补不重叠。
// 范围：.ts/.mjs/.js（server/、shared/、tests/、scripts/ 与根配置）；.vue 单文件组件的
// 模板与脚本交给 typecheck 覆盖，不进 lint 范围（诚实声明，见第 8 章）。
import js from '@eslint/js'
import globals from 'globals'

export default [
  // 生成物与本地状态目录不进 lint
  { ignores: ['.nuxt/**', '.output/**', '.data/**', '.backups/**', 'node_modules/**'] },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
]
