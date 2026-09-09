<script setup lang="ts">
// companion/app/components/SiteHeader.vue · 站点页头与导航（预取策略由 NAV_LINKS 表驱动）
import { NAV_LINKS, prefetchPropsFor } from '~/utils/nav-links'
</script>

<template>
  <header class="site-header">
    <NuxtLink to="/" class="brand">🐌 蜗牛商店</NuxtLink>
    <nav class="nav">
      <!-- 策略三件套同源：prefetchPropsFor 把档位译成 NuxtLink props（行为面），
           data-prefetch 把档位标注在锚点上（HTML 可见的配置面，gate 与排查锚点）。 -->
      <NuxtLink
        v-for="link in NAV_LINKS"
        :key="link.to"
        v-bind="prefetchPropsFor(link.prefetch)"
        :to="link.to"
        :data-prefetch="link.prefetch"
      >{{ link.label }}</NuxtLink>
    </nav>
  </header>
</template>
