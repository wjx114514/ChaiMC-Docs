// Teek 主题配置
import { defineTeekConfig } from 'vitepress-theme-teek/config'

// Teek 主题配置，所有 Teek 配置都放到 ... 中
export const teekConfig = defineTeekConfig({
  // 关闭 Teek 博客风首页，还原为 VitePress 默认文档风首页（hero + features）
  teekHome: false,
  // 禁用 Teek 自动侧边栏插件，恢复使用 config.js 中手动配置的分组侧边栏
  vitePlugins: {
    sidebar: false,
  },
  // 关闭文章页的最近更新栏
  articleUpdate: { enabled: false },
  // 站点基本信息
  author: { name: '凉森' },
})
