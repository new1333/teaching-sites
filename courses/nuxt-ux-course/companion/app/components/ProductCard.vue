<!-- companion/app/components/ProductCard.vue · 商品卡片（缩略图为确定性内联 SVG，无图片资产） -->
<script setup lang="ts">
import type { Product } from '#shared/types'

const props = defineProps<{ product: Product }>()

// 类别 → 主题色的确定性映射：同一件商品永远得到同一张缩略图
const CATEGORY_COLORS: Record<string, string> = {
  雨具: '#4c7c9b',
  园艺: '#6a8d5f',
  厨房: '#a2704a',
  书房: '#8a7ca8',
}
const color = computed(() => CATEGORY_COLORS[props.product.category] ?? '#888')
</script>

<template>
  <article class="product-card">
    <svg class="thumb" viewBox="0 0 96 72" role="img" :aria-label="product.name">
      <rect width="96" height="72" rx="8" :fill="color" opacity="0.16" />
      <circle cx="48" cy="36" r="17" :fill="color" opacity="0.66" />
      <text x="48" y="40" text-anchor="middle" font-size="12" fill="#fff">
        {{ product.id }}
      </text>
    </svg>
    <h3 class="name">{{ product.name }}</h3>
    <p class="meta">{{ product.category }} · ¥{{ product.priceYuan }} · ★{{ product.rating }}</p>
    <p class="summary">{{ product.summary }}</p>
    <NuxtLink class="detail-link" :to="`/products/${product.id}`">看详情 →</NuxtLink>
  </article>
</template>
