import { defineConfig } from 'vitepress'
import { teekConfig } from './teek-config.mts'
import footnote from 'markdown-it-footnote'
import mark from 'markdown-it-mark'
import container from 'markdown-it-container'
import taskList from 'markdown-it-task-lists'

// 文件名映射，用于处理 Obsidian 风格的 [[链接]]
const fileMap = {
  'index.html': '/',
  '1.加入前的准备工作': '/基础教程/1.加入前的准备工作.html',
  '2.如何加入服务器': '/基础教程/2.如何加入服务器.html',
  '3.给服务器新玩家的部分帮助': '/基础教程/3.给服务器新玩家的部分帮助.html',
  '4.基本命令': '/基础教程/4.基本命令.html',
  '5.MinecraftWiki': '/基础教程/5.MinecraftWiki.html',
  'i.启动器的选择和下载': '/其他帮助/i.启动器的选择和下载.html',
  'ii.JAVA的下载': '/其他帮助/ii.JAVA的下载.html',
  'iii.付费指南': '/其他帮助/iii.付费指南.html',
  'iv.如何注册微软账号': '/其他帮助/iv.如何注册微软账号.html',
  '使用基岩版加入服务器': '/可选章节/使用基岩版加入服务器.html',
  '协助开发该文档': '/可选章节/协助开发该文档.html',
  '在本地游玩服务器存档': '/可选章节/在本地游玩服务器存档.html',
  '自己开一个服务器': '/可选章节/自己开一个服务器.html',
  '规则': '/服务器规则/规则.html',
  '玩法目录': '/游玩指南/玩法目录.html',
  '空岛': '/游玩指南/空岛.html',
  '生存': '/游玩指南/生存.html',
  'risk-link': '/risk-link.html',
}

// Obsidian callout 类型到 VitePress custom container 的映射
const calloutTypes = {
  'success': 'success',
  'info': 'info',
  'warning': 'warning',
  'danger': 'danger',
  'faq': 'info',
  'tip': 'tip',
  'important': 'warning',
  'attention': 'warning',
  'question': 'info',
  'note': 'info',
}

const defaultCalloutTitles = {
  'success': '成功',
  'info': '提示',
  'warning': '警告',
  'danger': '危险',
  'tip': '技巧',
  'faq': '常见问题',
  'important': '重要',
  'attention': '注意',
  'question': '问题',
  'note': '注意',
}

// Lucide 图标 SVG（与 VitePress 内置容器使用的图标一致）
const lucideIcons = {
  'info': '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>',
  'tip': '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg>',
  'warning': '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
  'danger': '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M7.86 2h8.28L22 7.86v8.28L16.14 22H7.86L2 16.14V7.86Z"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>',
  'success': '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>',
}

function resolveWikiLink(link) {
  link = link.trim()
  let url = fileMap[link]
  if (!url) {
    // 去掉 .html 后缀再匹配
    const linkNoHtml = link.replace(/\.html$/, '')
    for (const [key, value] of Object.entries(fileMap)) {
      if (key.replace(/\.html$/, '') === linkNoHtml) {
        url = value
        break
      }
    }
  }
  if (!url) {
    url = '/' + encodeURIComponent(link) + '.html'
  }
  return url.replace(/\.html$/, '')
}

// 将 Obsidian 语法的 markdown 文本转换为 VitePress 兼容语法
function transformObsidianMarkdown(src) {
  let result = src

  // 1. 处理 Obsidian [[Wiki 链接]]，支持 [[链接|显示文本]]
  result = result.replace(/\[\[([^\]]+)\]\]/g, (match, content) => {
    let [link, display] = content.split('|')
    link = (link || '').trim()
    display = (display || link).trim()
    const url = resolveWikiLink(link)
    return `[${display}](${url})`
  })

  // 2. 处理 Obsidian callout 块: > [!type] title  ...内容...
  // 需要逐块识别 blockquote callout
  // 思路：按行扫描，识别以 > [!type] 开头的 blockquote 块
  const lines = result.split('\n')
  const output = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    // 匹配 callout 开头行：> [!type] 或 > [!type]- 可选 title
    const calloutMatch = line.match(/^\s*>\s*\[!(\w+)\](-)?\s*(.*)$/i)

    if (calloutMatch) {
      const calloutType = calloutMatch[1].toLowerCase()
      const isCollapsible = calloutMatch[2] === '-'
      let title = calloutMatch[3] || ''
      const vpType = calloutTypes[calloutType] || calloutTypes[calloutType.toLowerCase()] || 'info'

      if (!title) {
        title = defaultCalloutTitles[calloutType.toLowerCase()] || defaultCalloutTitles[vpType] || calloutType
      }

      // 写入 VitePress custom container 开头
      const containerHeader = isCollapsible
        ? `::: collapsible ${vpType} ${title}`
        : `::: ${vpType} ${title}`
      output.push(containerHeader)

      i++
      // 继续读取属于这个 blockquote/callout 的后续行
      // 直到遇到空行且下一行不是以 > 开头，或者遇到不是 blockquote 的行
      let firstContentLine = true
      while (i < lines.length) {
        const nextLine = lines[i]
        // 匹配 blockquote 的续行
        const quoteMatch = nextLine.match(/^\s*>\s?(.*)$/)
        if (quoteMatch) {
          // 如果是嵌套 callout（下一行也是 [!xxx] 开头），先结束当前 callout，下一轮处理
          const nestedMatch = quoteMatch[1].match(/^\[!(\w+)\]/i)
          if (nestedMatch && !firstContentLine) {
            // 可能是嵌套，或者是新的 callout —— 此处保守处理，结束当前 callout
            output.push(':::')
            output.push('')
            // i 保持不变，下一轮处理
            break
          }
          // 写入去掉 > 前缀的内容
          output.push(quoteMatch[1])
          i++
          firstContentLine = false
        } else {
          // 非 blockquote 行，callout 结束
          break
        }
      }

      // 写入 container 结束
      output.push(':::')
      output.push('')
    } else {
      // 普通行，直接输出
      output.push(line)
      i++
    }
  }

  return output.join('\n')
}

export default defineConfig({
  extends: teekConfig,
  title: 'ChaiMC 服务器文档',
  description: 'ChaiMC Minecraft 服务器帮助文档',
  lang: 'zh-CN',
  base: '/',
  cleanUrls: true,
  ignoreDeadLinks: true,

  vite: {
    plugins: [
      {
        name: 'vite-plugin-obsidian-transform',
        enforce: 'pre',
        transform(code, id) {
          if (id.endsWith('.md')) {
            return transformObsidianMarkdown(code)
          }
        }
      }
    ]
  },

  themeConfig: {
    nav: [
      { text: '首页', link: '/' },
      {
        text: '基础教程',
        items: [
          { text: '1. 加入前的准备工作', link: '/基础教程/1.加入前的准备工作' },
          { text: '2. 如何加入服务器', link: '/基础教程/2.如何加入服务器' },
          { text: '3. 给服务器新玩家的部分帮助', link: '/基础教程/3.给服务器新玩家的部分帮助' },
          { text: '4. 基本命令', link: '/基础教程/4.基本命令' },
          { text: '5. MinecraftWiki', link: '/基础教程/5.MinecraftWiki' },
        ]
      },
      {
        text: '服务器规则',
        link: '/服务器规则/规则'
      },
      {
        text: '游玩指南',
        items: [
          { text: '玩法目录', link: '/游玩指南/玩法目录' },
          { text: '空岛', link: '/游玩指南/空岛' },
          { text: '生存', link: '/游玩指南/生存' },
        ]
      },
      {
        text: '其他帮助',
        items: [
          { text: 'i. 启动器的选择和下载', link: '/其他帮助/i.启动器的选择和下载' },
          { text: 'ii. JAVA的下载', link: '/其他帮助/ii.JAVA的下载' },
          { text: 'iii. 付费指南', link: '/其他帮助/iii.付费指南' },
          { text: 'iv. 如何注册微软账号', link: '/其他帮助/iv.如何注册微软账号' },
        ]
      },
      {
        text: '可选章节',
        items: [
          { text: '使用基岩版加入服务器', link: '/可选章节/使用基岩版加入服务器' },
          { text: '在本地游玩服务器存档', link: '/可选章节/在本地游玩服务器存档' },
          { text: '自己开一个服务器', link: '/可选章节/自己开一个服务器' },
          { text: '协助开发该文档', link: '/可选章节/协助开发该文档' },
        ]
      },
    ],

    sidebar: {
      '/': [
        {
          text: '基础教程',
          items: [
            { text: '1. 加入前的准备工作', link: '/基础教程/1.加入前的准备工作' },
            { text: '2. 如何加入服务器', link: '/基础教程/2.如何加入服务器' },
            { text: '3. 给服务器新玩家的部分帮助', link: '/基础教程/3.给服务器新玩家的部分帮助' },
            { text: '4. 基本命令', link: '/基础教程/4.基本命令' },
            { text: '5. MinecraftWiki', link: '/基础教程/5.MinecraftWiki' },
          ]
        },
        {
          text: '服务器规则',
          items: [
            { text: '规则', link: '/服务器规则/规则' },
          ]
        },
        {
          text: '游玩指南',
          items: [
            { text: '玩法目录', link: '/游玩指南/玩法目录' },
            { text: '空岛', link: '/游玩指南/空岛' },
            { text: '生存', link: '/游玩指南/生存' },
          ]
        },
        {
          text: '其他帮助',
          items: [
            { text: 'i. 启动器的选择和下载', link: '/其他帮助/i.启动器的选择和下载' },
            { text: 'ii. JAVA的下载', link: '/其他帮助/ii.JAVA的下载' },
            { text: 'iii. 付费指南', link: '/其他帮助/iii.付费指南' },
            { text: 'iv. 如何注册微软账号', link: '/其他帮助/iv.如何注册微软账号' },
          ]
        },
        {
          text: '可选章节',
          items: [
            { text: '使用基岩版加入服务器', link: '/可选章节/使用基岩版加入服务器' },
            { text: '在本地游玩服务器存档', link: '/可选章节/在本地游玩服务器存档' },
            { text: '自己开一个服务器', link: '/可选章节/自己开一个服务器' },
            { text: '协助开发该文档', link: '/可选章节/协助开发该文档' },
          ]
        }
      ],
    },

    search: {
      provider: 'local',
      options: {
        locales: {
          root: {
            translations: {
              button: {
                buttonText: '搜索文档',
                buttonAriaLabel: '搜索文档',
              },
              modal: {
                noResultsText: '没有找到相关结果',
                resetButtonTitle: '清除查询条件',
                footer: {
                  selectText: '选择',
                  navigateText: '切换',
                  closeText: '关闭',
                },
              },
            },
          },
        },
      },
    },

    footer: {
      copyright: '© 2026 ChaiMC Server'
    },

    docFooter: {
      prev: '上一页',
      next: '下一页'
    },

    outline: {
      label: '页面导航',
      level: [2, 3],
    },
  },

  markdown: {
    lineNumbers: true,
    config: (md) => {
      // 启用脚注支持（Obsidian 的 [^1] 和 [^1]: xxx 语法）
      md.use(footnote)
      // 启用 Obsidian ==高亮标注== 语法
      md.use(mark)
      // 启用任务列表复选框 - [ ] / - [x]
      md.use(taskList)
      // 注册 success 容器类型（用于 Obsidian > [!success] 标注）
      md.use(container, 'success', {
        render(tokens, idx, _options, env) {
          const token = tokens[idx]
          if (token.nesting === 1) {
            const info = token.info.trim().slice('success'.length).trim()
            const title = md.renderInline(info || '成功', { references: env.references })
            return `<div class="success custom-block"><p class="custom-block-title">${title}</p>\n`
          } else {
            return '</div>\n'
          }
        }
      })
      // 注册 collapsible 容器类型（用于 Obsidian > [!type]- 折叠标注，保留原颜色）
      md.use(container, 'collapsible', {
        render(tokens, idx, _options, env) {
          const token = tokens[idx]
          if (token.nesting === 1) {
            const info = token.info.trim().slice('collapsible'.length).trim()
            const spaceIdx = info.indexOf(' ')
            let type = 'info', title = ''
            if (spaceIdx === -1) {
              type = info || 'info'
            } else {
              type = info.slice(0, spaceIdx)
              title = info.slice(spaceIdx + 1)
            }
            const titleHtml = md.renderInline(title || '详情', { references: env.references })
            return `<details class="custom-block details ${type}"><summary><span class="custom-block-title">${titleHtml}</span></summary>\n`
          } else {
            return '</details>\n'
          }
        }
      })
    }
  }
})
