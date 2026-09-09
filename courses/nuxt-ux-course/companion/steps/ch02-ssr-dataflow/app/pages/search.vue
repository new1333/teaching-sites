<!-- companion/app/pages/search.vue · 搜索页（基线版：提交后客户端请求 /api/search） -->
<script setup lang="ts">
import type { Product } from '#shared/types'

useHead({ title: '搜索' })

const route = useRoute()
const router = useRouter()

const keyword = ref(String(route.query.q ?? ''))
const results = ref<Product[] | null>(null)
const searching = ref(false)
const error = ref<string | null>(null)

async function runSearch(q: string) {
  if (!q) {
    results.value = []
    return
  }
  searching.value = true
  error.value = null
  try {
    results.value = await $fetch<Product[]>('/api/search', { query: { q } })
  } catch {
    error.value = '搜索失败，稍后再试'
  } finally {
    searching.value = false
  }
}

function submit() {
  router.push({ query: keyword.value ? { q: keyword.value } : {} })
}

onMounted(() => {
  const q = String(route.query.q ?? '')
  if (q) runSearch(q)
})

watch(
  () => route.query.q,
  (q) => {
    keyword.value = String(q ?? '')
    runSearch(keyword.value)
  },
)
</script>

<template>
  <section>
    <h1>搜索</h1>
    <form class="search-form" @submit.prevent="submit">
      <input
        v-model="keyword"
        type="search"
        name="q"
        placeholder="试试“伞”或“陶”"
        aria-label="搜索关键词"
      />
      <button type="submit">搜一搜</button>
    </form>

    <p v-if="error" class="state state-error">{{ error }}</p>
    <p v-else-if="searching" class="state state-loading">搜索中……蜗牛也在努力。</p>
    <template v-else-if="results">
      <p v-if="results.length === 0" class="state">没有命中任何商品。</p>
      <div v-else class="grid">
        <ProductCard v-for="p in results" :key="p.id" :product="p" />
      </div>
    </template>
  </section>
</template>
