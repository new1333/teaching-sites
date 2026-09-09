<!-- companion/app/pages/favorites.vue · 收藏页（基线版：客户端取数，清单固定为 3 件） -->
<script setup lang="ts">
import type { Product } from '#shared/types'

useHead({ title: '我的收藏' })

const favorites = ref<Product[] | null>(null)
const error = ref<string | null>(null)

onMounted(async () => {
  try {
    favorites.value = await $fetch<Product[]>('/api/favorites')
  } catch (err) {
    error.value = err instanceof Error ? err.message : '收藏加载失败'
  }
})
</script>

<template>
  <section>
    <h1>我的收藏</h1>
    <p v-if="error" class="state state-error">加载失败：{{ error }}</p>
    <p v-else-if="!favorites" class="state state-loading">收藏加载中……蜗牛也在努力。</p>
    <div v-else class="grid">
      <ProductCard v-for="p in favorites" :key="p.id" :product="p" />
    </div>
  </section>
</template>
