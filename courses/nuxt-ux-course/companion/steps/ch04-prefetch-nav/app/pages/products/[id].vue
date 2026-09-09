<script setup lang="ts">
// companion/app/pages/products/[id].vue · 商品详情（第 3 章终态：useAsyncData 服务端取数 + Lazy 图表）
import type { Product } from '#shared/types'

const route = useRoute()

// 数据面：换上服务端数据流——HTML 直出商品、结果进 payload、客户端水合复用（不再二次请求）。
// 显式 key 带上商品编号：每件商品一份数据，同 key 去重。
const { data: product, error } = await useAsyncData(
  `product-${route.params.id}`,
  () => $fetch<Product>(`/api/products/${route.params.id}`),
)

useHead({ title: computed(() => product.value?.name ?? '商品详情') })

const notFound = computed(() => error.value?.statusCode === 404)
</script>

<template>
  <section>
    <p v-if="notFound" class="state state-error">这个商品不存在——可能是手滑输错了编号。</p>
    <p v-else-if="error" class="state state-error">加载失败：{{ error.statusCode ?? error.message }}</p>
    <article v-else-if="product" class="detail">
      <h1>{{ product.name }}</h1>
      <p class="meta">{{ product.category }} · ¥{{ product.priceYuan }} · ★{{ product.rating }}</p>
      <p class="summary">{{ product.summary }}</p>
      <p><NuxtLink to="/products" class="button">← 回商品列表</NuxtLink></p>

      <!-- 重组件：价格走势图（手写 SVG，数百行）。Lazy 前缀 = 动态导入；
           hydrate-on-interaction = 延迟水合——SSR 仍直出图表本体，
           客户端把代码拆成按需分块、移出首屏，首次交互（悬浮/点按）才拉取并接管。 -->
      <LazyPriceTrendChart
        hydrate-on-interaction
        :product-id="product.id"
        :category="product.category"
        :base-price-yuan="product.priceYuan"
      />
    </article>
  </section>
</template>
