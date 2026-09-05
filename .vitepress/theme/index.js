// Teek 主题入口：扩展 Teek 主题并保留自定义样式
import Teek from 'vitepress-theme-teek'
import 'vitepress-theme-teek/index.css'
import './custom.css'

const RISK_PAGE = '/risk-link.html'

function isExternalLink(href, currentHost) {
  if (!href) return false
  // 只处理 http/https 绝对链接
  if (!/^https?:\/\//i.test(href)) return false
  try {
    const u = new URL(href)
    // 排除当前站点自身的链接
    if (u.hostname === currentHost) return false
    return true
  } catch {
    return false
  }
}

function setupExternalLinkInterceptor() {
  if (typeof window === 'undefined') return // SSR guard

  const currentHost = window.location.hostname

  document.addEventListener('click', (e) => {
    const link = e.target.closest && e.target.closest('a')
    if (!link) return

    const href = link.getAttribute('href')
    if (!href) return

    if (href.includes('risk-link')) return
    if (link.closest('.risk-link-page')) return

    if (!isExternalLink(href, currentHost)) return

    e.preventDefault()
    e.stopPropagation()
    const target = encodeURIComponent(href)
    window.location.href = `${RISK_PAGE}?target=${target}`
  }, true)
}

// ---------- 脚注 Popover 预览 ----------
function cleanupFootnotePopovers() {
  document.querySelectorAll('.fn-popover').forEach((el) => el.remove())
}

function enhanceFootnotes() {
  if (typeof window === 'undefined') return
  cleanupFootnotePopovers()

  const refs = document.querySelectorAll('.footnote-ref:not([data-fn-enhanced])')

  refs.forEach((refEl) => {
    refEl.dataset.fnEnhanced = '1'

    // .footnote-ref 可能是 <sup>（href 在内部 <a> 上）或直接是 <a>
    const linkEl = refEl.tagName === 'A' ? refEl : refEl.querySelector('a')
    const href = (linkEl && linkEl.getAttribute('href')) || ''
    if (!href.startsWith('#fn')) return

    const fnEl = document.querySelector(href)
    if (!fnEl) return

    // 克隆脚注内容，移除返回链接
    const clone = fnEl.cloneNode(true)
    clone.querySelectorAll('.footnote-back, .footnote-backref').forEach((el) => el.remove())
    const contentHTML = clone.innerHTML.trim()

    // 用 linkEl（实际的 <a>）做事件绑定和定位
    const triggerEl = linkEl || refEl

    let popover = null
    let hideTimer = null

    function show() {
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null }
      if (popover) return

      const rect = triggerEl.getBoundingClientRect()

      popover = document.createElement('div')
      popover.className = 'fn-popover'
      popover.innerHTML = contentHTML

      // 先添加到 DOM 才能测量尺寸
      popover.style.visibility = 'hidden'
      document.body.appendChild(popover)

      const popRect = popover.getBoundingClientRect()
      const gap = 10

      // 默认显示在上方
      let top = rect.top - popRect.height - gap
      let isBelow = false
      if (top < 8) {
        // 上方空间不够，显示在下方
        top = rect.bottom + gap
        isBelow = true
      }

      // 水平居中对齐 ref，但不超出视口
      let left = rect.left + rect.width / 2 - popRect.width / 2
      const maxLeft = window.innerWidth - popRect.width - 8
      left = Math.max(8, Math.min(left, maxLeft))

      popover.style.left = `${left}px`
      popover.style.top = `${top}px`
      popover.style.visibility = ''
      popover.classList.add('fn-popover--show')
      popover.classList.add(isBelow ? 'fn-popover--below' : 'fn-popover--above')

      // popover 自身 hover时保持显示
      popover.addEventListener('mouseenter', () => {
        if (hideTimer) { clearTimeout(hideTimer); hideTimer = null }
      })
      popover.addEventListener('mouseleave', () => {
        hide()
      })
    }

    function hide() {
      hideTimer = setTimeout(() => {
        if (popover) {
          popover.remove()
          popover = null
        }
      }, 150)
    }

    triggerEl.addEventListener('mouseenter', show)
    triggerEl.addEventListener('mouseleave', hide)
    triggerEl.addEventListener('click', () => {
      if (popover) { popover.remove(); popover = null }
    })
  })
}

export default {
  ...Teek,
  enhanceApp(ctx) {
    if (typeof Teek.enhanceApp === 'function') {
      Teek.enhanceApp(ctx)
    }
    if (typeof window !== 'undefined') {
      setupExternalLinkInterceptor()

      // 脚注 Popover：每次路由切换后重新增强
      const router = ctx.router
      const prevAfter = router.onAfterRouteChanged
      router.onAfterRouteChanged = (to) => {
        if (typeof prevAfter === 'function') prevAfter(to)
        requestAnimationFrame(() =>
          requestAnimationFrame(() => enhanceFootnotes())
        )
      }
      // 首次加载
      requestAnimationFrame(() =>
        requestAnimationFrame(() => enhanceFootnotes())
      )
    }
  },
}
