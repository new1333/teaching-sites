<script setup lang="ts">
// companion: apps/web/src/App.vue
import { ref } from 'vue'
import type { LinkResponse } from '@shortlink/shared'
import { createLink, shortUrlOf } from './api'

const url = ref('')
const links = ref<LinkResponse[]>([])
const error = ref('')

async function submit() {
  error.value = ''
  try {
    const link = await createLink(url.value)
    links.value = [link, ...links.value]
    url.value = ''
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}
</script>

<template>
  <main>
    <h1>shortlink 短链工作台</h1>
    <form @submit.prevent="submit">
      <input v-model="url" placeholder="https://example.com/very-long-url" size="40" />
      <button type="submit">创建短链</button>
    </form>
    <p v-if="error" class="error">{{ error }}</p>
    <ul>
      <li v-for="link in links" :key="link.slug">
        <a :href="shortUrlOf(link)" target="_blank" rel="noopener">{{ shortUrlOf(link) }}</a>
        → {{ link.url }}
        <small>（创建于 {{ link.createdAt }}）</small>
      </li>
    </ul>
  </main>
</template>

<style scoped>
.error {
  color: #c0392b;
}
</style>
