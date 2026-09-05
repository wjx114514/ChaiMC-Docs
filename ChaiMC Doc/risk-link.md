---
layout: page
title: 外部链接提示
---

<script setup>
import { ref, onMounted, computed } from 'vue'
import { useRoute } from 'vitepress'

const route = useRoute()
const targetUrl = ref('')

onMounted(() => {
  const params = new URLSearchParams(window.location.search)
  const t = params.get('target') || ''
  try {
    // 只允许 http/https 协议，防止 javascript: 等注入
    const u = new URL(t)
    if (u.protocol === 'http:' || u.protocol === 'https:') {
      targetUrl.value = t
    }
  } catch {
    targetUrl.value = ''
  }
})

const displayUrl = computed(() => {
  if (!targetUrl.value) return ''
  const u = new URL(targetUrl.value)
  return u.hostname + (u.pathname !== '/' ? u.pathname : '') + u.search
})

function proceed() {
  if (targetUrl.value) {
    window.location.href = targetUrl.value
  }
}

function goBack() {
  if (history.length > 1) {
    history.back()
  } else {
    window.location.href = '/'
  }
}
</script>

<template>
  <div class="risk-link-page">
    <div class="risk-card">
      <div class="risk-icon">
        <svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/>
          <path d="M12 9v4"/>
          <path d="M12 17h.01"/>
        </svg>
      </div>
      <h1 class="risk-title">即将离开 ChaiMC 文档站</h1>
      <p class="risk-desc">你点击的链接指向外部网站，ChaiMC 不对其内容负责。请确认你信任此链接后再继续访问。</p>
      <div v-if="targetUrl" class="risk-target-box">
        <span class="risk-target-label">目标地址：</span>
        <code class="risk-target-url">{{ displayUrl }}</code>
      </div>
      <div v-else class="risk-target-box risk-invalid">
        <span>无效的链接地址</span>
      </div>
      <div class="risk-actions">
        <button class="risk-btn risk-btn-back" @click="goBack">返回文档站</button>
        <button class="risk-btn risk-btn-go" :disabled="!targetUrl" @click="proceed">继续访问 →</button>
      </div>
    </div>
  </div>
</template>
