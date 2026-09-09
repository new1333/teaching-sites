<script setup lang="ts">
// companion/app/pages/products/index.vue · 商品列表（第 2 章版：useAsyncData 服务端取数）
import type { Product } from '#shared/types'

useHead({ title: '全部商品' })

// 四步链路的前三步都从这一行发生：SSR 期间在服务端执行 handler → 渲染进 HTML → 结果序列化进 payload。
// 显式 key 'products'：同 key 去重，客户端水合时直接从 payload 取数，不再第二次请求 /api/products。
// 旧的反例写法（onMounted + $fetch）完整保留在 /demo/client-fetch，供对照与门槛锚定。
const { data: products, error } = await useAsyncData('products', () =>
  $fetch<Product[]>('/api/products'),
)
</script>

<template>
  <section>
    <h1>全部商品</h1>
    <p v-if="error" class="state state-error">加载失败：{{ error.statusCode ?? error.message }}</p>
    <div v-else-if="products" class="grid">
      <ProductCard v-for="p in products" :key="p.id" :product="p" />
    </div>
  </section>
</template>
