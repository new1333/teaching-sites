<!-- companion/app/pages/index.vue · 首页（纯静态 SSR，无数据请求） -->
<script setup lang="ts">
useHead({ title: '首页' })
</script>

<template>
  <section class="hero">
    <h1>慢慢来，比较快</h1>
    <p class="hero-sub">
      蜗牛商店是一家刻意做慢的演示商店：接口带延迟、数据页走客户端取数。
      它慢得很真实——本课程将一层层把它提速，每提速一层都用数字对账。
    </p>
    <p><NuxtLink to="/products" class="button">进店逛逛</NuxtLink></p>
  </section>
  <section class="features">
    <div class="feature">
      <h2>雨具</h2>
      <p>伞、雨披、雨靴——雨天出门的第一道防线。</p>
    </div>
    <div class="feature">
      <h2>园艺</h2>
      <p>苔藓、蕨类、陶偶——养得慢，活得久。</p>
    </div>
    <div class="feature">
      <h2>厨房</h2>
      <p>陶锅、滤杯、蒸笼——慢火出好味。</p>
    </div>
    <div class="feature">
      <h2>书房</h2>
      <p>笔记本、书签、台灯——陪人坐得住。</p>
    </div>
  </section>
</template>
