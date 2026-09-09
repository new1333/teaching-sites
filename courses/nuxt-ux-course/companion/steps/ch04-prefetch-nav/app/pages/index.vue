<!-- companion/app/pages/index.vue · 首页（纯静态 SSR，无数据请求；hero 背景图带 preload 提示） -->
<script setup lang="ts">
useHead({
  title: '首页',
  // 资源提示：hero 蜗牛插画只出现在 CSS 的 background 里，HTML 的预加载扫描器看不见它——
  // 它的发现要等 CSS 下载并解析完。preload 把发现时机提前到「HTML 解析到这一行」，
  // 下载与 CSS 并行。as="image" 必须写对：它决定浏览器把这笔请求放进哪条优先级队列。
  link: [{ rel: 'preload', as: 'image', href: '/hero-snail.svg' }],
})
</script>

<template>
  <section class="hero">
    <div class="hero-copy">
      <h1>慢慢来，比较快</h1>
      <p class="hero-sub">
        蜗牛商店是一家刻意做慢的演示商店：接口带延迟、数据页走客户端取数。
        它慢得很真实——本课程将一层层把它提速，每提速一层都用数字对账。
      </p>
      <p><NuxtLink to="/products" class="button">进店逛逛</NuxtLink></p>
    </div>
    <div class="hero-art" role="img" aria-label="一只顶着雨伞的蜗牛"></div>
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
