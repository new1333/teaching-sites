<!-- companion/app/components/SiteHeader.vue · 站点页头与导航 -->
<template>
  <header class="site-header">
    <NuxtLink to="/" class="brand">🐌 蜗牛商店</NuxtLink>
    <nav class="nav">
      <NuxtLink to="/products">商品</NuxtLink>
      <NuxtLink to="/search">搜索</NuxtLink>
      <NuxtLink to="/favorites">收藏</NuxtLink>
    </nav>
  </header>
</template>
