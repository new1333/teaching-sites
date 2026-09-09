<!-- companion/app/pages/products/[id].vue · 商品详情（基线版：同样走客户端取数） -->
<script setup lang="ts">
import type { Product } from '#shared/types'

const route = useRoute()

const product = ref<Product | null>(null)
const notFound = ref(false)
const error = ref<string | null>(null)

useHead({ title: computed(() => product.value?.name ?? '商品详情') })

onMounted(async () => {
  try {
    product.value = await $fetch<Product>(`/api/products/${route.params.id}`)
  } catch (err) {
    // $fetch 对 4xx/5xx 抛 FetchError：404 标记为“不存在”，其余算加载失败
    notFound.value = (err as { statusCode?: number }).statusCode === 404
    error.value = err instanceof Error ? err.message : '详情加载失败'
  }
})
</script>

<template>
  <section>
    <p v-if="notFound" class="state state-error">这个商品不存在——可能是手滑输错了编号。</p>
    <p v-else-if="error" class="state state-error">加载失败：{{ error }}</p>
    <p v-else-if="!product" class="state state-loading">详情加载中……蜗牛也在努力。</p>
    <article v-else class="detail">
      <h1>{{ product.name }}</h1>
      <p class="meta">{{ product.category }} · ¥{{ product.priceYuan }} · ★{{ product.rating }}</p>
      <p class="summary">{{ product.summary }}</p>
      <p><NuxtLink to="/products" class="button">← 回商品列表</NuxtLink></p>
    </article>
  </section>
</template>
