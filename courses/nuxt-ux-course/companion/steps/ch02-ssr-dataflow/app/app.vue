<!-- companion/app/app.vue · 站点外壳：页头 + 页面出口 + 页脚 -->
<script setup lang="ts">
useHead({
  titleTemplate: (chunk) => (chunk ? `${chunk} · 蜗牛商店` : '蜗牛商店'),
})
</script>

<template>
  <div class="shell">
    <SiteHeader />
    <main class="main">
      <NuxtPage />
    </main>
    <footer class="footer">蜗牛商店 · 教学演示站：刻意做慢，逐章提速</footer>
  </div>
</template>
