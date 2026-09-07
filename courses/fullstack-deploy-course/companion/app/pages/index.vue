<script setup lang="ts">
// companion/app/pages/index.vue · 首页：部署日志 + 当前环境名（公有运行期配置，随环境变量注入）
import type { DeployRecord } from '#shared/types'

const { data: deploys } = await useFetch<DeployRecord[]>('/api/deploys')
const config = useRuntimeConfig()
const appEnv = config.public.appEnv
</script>

<template>
  <section>
    <p>
      ship-log 记录每一次部署。当前环境：<code>{{ appEnv }}</code>。
      数据来自 GET /api/deploys，SSR 期间由同一个 Node 进程里的 server/ 代码提供。
    </p>
    <table>
      <thead>
        <tr><th>#</th><th>环境</th><th>commit</th><th>结果</th><th>说明</th></tr>
      </thead>
      <tbody>
        <tr v-for="d in deploys ?? []" :key="d.id">
          <td>{{ d.id }}</td>
          <td>{{ d.env }}</td>
          <td><code>{{ d.commit }}</code></td>
          <td>{{ d.status === 'success' ? '成功' : '失败' }}</td>
          <td>{{ d.summary }}</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
