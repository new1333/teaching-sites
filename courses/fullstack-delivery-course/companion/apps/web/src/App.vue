<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { LinkResponse, UserResponse } from '@shortlink/shared'
import { createLink, fetchMe, login, logout, register, shortUrlOf } from './api'

const url = ref('')
const links = ref<LinkResponse[]>([])
const error = ref('')
const me = ref<UserResponse | null>(null)
const email = ref('')
const password = ref('')
const busy = ref(false)

onMounted(async () => {
  try {
    me.value = await fetchMe()
  } catch {
    me.value = null
  }
})

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

async function doRegister() {
  error.value = ''
  busy.value = true
  try {
    me.value = await register(email.value, password.value)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

async function doLogin() {
  error.value = ''
  busy.value = true
  try {
    me.value = await login(email.value, password.value)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

async function doLogout() {
  error.value = ''
  await logout()
  me.value = null
}
</script>

<template>
  <main>
    <h1>shortlink 短链工作台</h1>

    <p v-if="me" class="who">
      已登录：{{ me.email }}
      <button type="button" @click="doLogout">登出</button>
    </p>
    <form v-else class="auth" @submit.prevent="doLogin">
      <input v-model="email" type="email" placeholder="you@example.com" size="24" />
      <input v-model="password" type="password" placeholder="密码（至少 8 位）" size="24" />
      <button type="submit" :disabled="busy">登录</button>
      <button type="button" :disabled="busy" @click="doRegister">注册</button>
    </form>

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
.who {
  color: #27ae60;
}
.error {
  color: #c0392b;
}
</style>
