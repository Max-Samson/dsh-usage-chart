// 探测：展开面板后检查是否被容器裁剪（小视口模拟）。
// 用法：node scripts/probe-panel.mjs   （环境变量见 scripts/probe-utils.mjs）
import { launchBrowser, openDshPage, openSession } from './probe-utils.mjs'

const browser = await launchBrowser()
const { page, errors } = await openDshPage(browser, { width: 1280, height: 800 })

if (!await openSession(page)) console.log('WARN: 未找到可用的会话（.duc-root 未出现）')
await page.click('.duc-toggle')
await page.waitForTimeout(2500)
const info = await page.evaluate(() => {
  const panel = document.querySelector('.duc-panel')
  if (!panel) return { panelInDom: false }
  const rect = panel.getBoundingClientRect()
  const viewportH = window.innerHeight
  // 找裁剪祖先
  let el = panel.parentElement
  const clips = []
  while (el && el !== document.body) {
    const style = getComputedStyle(el)
    if (style.overflow !== 'visible' || style.maxHeight || style.height !== 'auto') {
      const er = el.getBoundingClientRect()
      clips.push({ tag: el.tagName, cls: String(el.className).slice(0, 60), overflow: style.overflow, maxH: style.maxHeight, h: style.height, rect: [Math.round(er.top), Math.round(er.bottom)] })
    }
    el = el.parentElement
  }
  return {
    panelInDom: true,
    panelRect: [Math.round(rect.top), Math.round(rect.bottom), Math.round(rect.height)],
    viewportH,
    visible: rect.height > 20 && rect.top < viewportH && rect.bottom > 0,
    clipAncestors: clips.slice(0, 8),
  }
})
console.log(JSON.stringify(info, null, 2))
console.log('console errors:', errors.length ? errors.slice(0, 5) : 'none')
await browser.close()
