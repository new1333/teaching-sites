<script setup lang="ts">
// companion/app/pages/index.vue · 首页：部署日志（数据暂内联在本页，后续改由 server API 提供）
interface DeployRecord {
  id: number
  env: 'production' | 'staging'
  status: 'success' | 'failed'
  commit: string
  summary: string
}

const deploys: DeployRecord[] = [
  { id: 3, env: 'production', status: 'success', commit: '77aa01f', summary: '备份脚本改用 pg_dump 归档格式' },
  { id: 2, env: 'production', status: 'success', commit: 'd41e8c7', summary: '健康检查超时从 3s 调到 10s' },
  { id: 1, env: 'staging', status: 'failed', commit: '9f3c2ab', summary: '首次部署：迁移失败，已回滚' },
]
</script>

<template>
  <section>
    <p>ship-log 记录每一次部署。此刻数据内联在本页，由服务端渲染成完整 HTML 再发给浏览器。</p>
    <table>
      <thead>
        <tr><th>#</th><th>环境</th><th>commit</th><th>结果</th><th>说明</th></tr>
      </thead>
      <tbody>
        <tr v-for="d in deploys" :key="d.id">
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
