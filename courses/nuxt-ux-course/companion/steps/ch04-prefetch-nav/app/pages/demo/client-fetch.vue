<script setup lang="ts">
// companion/app/pages/demo/client-fetch.vue · 反例页：完整保留第 1 章基线的客户端取数商品列表。
// /products 在第 2 章改为 useAsyncData 服务端取数后，这条「HTML 先走、数据后到」的白屏路径
// 原样搬到这里——读者可随时对照两种首屏形态，gate:ch1 的坏页锚点也钉在这一页上。
import type { Product } from '#shared/types'

useHead({ title: '反例：客户端取数' })

// 已知反例（刻意保留，勿改成 useAsyncData）：等组件在浏览器里挂载后才发起请求。
// 服务端渲染时 onMounted 不执行，HTML 只输出加载壳；商品要等浏览器接手后再发请求。
const products = ref<Product[] | null>(null)
const error = ref<string | null>(null)

onMounted(async () => {
  try {
    products.value = await $fetch<Product[]>('/api/products')
  } catch (err) {
    error.value = err instanceof Error ? err.message : '商品加载失败'
  }
})
</script>

<template>
  <section>
    <h1>反例：客户端取数</h1>
    <p class="state">
      这一页是基线站商品列表的原始形态：数据等浏览器挂载后再请求，首屏先白等一拍。
      对照新版：<NuxtLink to="/products">/products（服务端取数）</NuxtLink>。
    </p>
    <p v-if="error" class="state state-error">加载失败：{{ error }}</p>
    <p v-else-if="!products" class="state state-loading">商品加载中……蜗牛也在努力。</p>
    <div v-else class="grid">
      <ProductCard v-for="p in products" :key="p.id" :product="p" />
    </div>
  </section>
</template>
