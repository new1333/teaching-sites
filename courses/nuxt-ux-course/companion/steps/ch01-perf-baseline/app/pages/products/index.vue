<script setup lang="ts">
// companion/app/pages/products/index.vue · 商品列表（基线版：onMounted + $fetch 的客户端取数）
import type { Product } from '#shared/types'

useHead({ title: '全部商品' })

// 基线版的已知反例：等组件在浏览器里挂载后才发起请求。
// HTML 先走、数据后到——首屏白等正是后续章节要修的路径，本章只负责把它测准。
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
    <h1>全部商品</h1>
    <p v-if="error" class="state state-error">加载失败：{{ error }}</p>
    <p v-else-if="!products" class="state state-loading">商品加载中……蜗牛也在努力。</p>
    <div v-else class="grid">
      <ProductCard v-for="p in products" :key="p.id" :product="p" />
    </div>
  </section>
</template>
