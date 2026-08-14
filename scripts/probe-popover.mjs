// 探测：悬浮面板的展开/收起与可视区边界。
// 用法：node scripts/probe-popover.mjs   （环境变量见 scripts/probe-utils.mjs）
import { launchBrowser, openDshPage, openSession } from './probe-utils.mjs'

const browser = await launchBrowser()
const { page, errors } = await openDshPage(browser, { width: 1280, height: 800 })

if (!await openSession(page)) console.log('WARN: 未找到可用的会话（.duc-root 未出现）')
console.log('default expanded:', await page.evaluate(() => !!document.querySelector('.duc-popover')))

// 点击展开
await page.click('.duc-toggle')
await page.waitForTimeout(1500)
const info = await page.evaluate(() => {
  const pop = document.querySelector('.duc-popover')
  if (!pop) return { popoverInDom: false, toggleText: document.querySelector('.duc-toggle')?.textContent }
  const rect = pop.getBoundingClientRect()
  const panel = document.querySelector('.duc-panel')
  const panelRect = panel ? panel.getBoundingClientRect() : null
  return {
    popoverInDom: true,
    popRect: [Math.round(rect.left), Math.round(rect.top), Math.round(rect.right), Math.round(rect.bottom)],
    popSize: [Math.round(rect.width), Math.round(rect.height)],
    viewport: [window.innerWidth, window.innerHeight],
    visible: rect.width > 50 && rect.height > 50 && rect.right > 0 && rect.left < window.innerWidth && rect.bottom > 0 && rect.top < window.innerHeight,
    panelRect: panelRect ? [Math.round(panelRect.top), Math.round(panelRect.bottom), Math.round(panelRect.height)] : null,
    overflowY: getComputedStyle(pop).overflowY,
  }
})
console.log(JSON.stringify(info, null, 2))

// 点击收起
await page.click('.duc-toggle')
await page.waitForTimeout(800)
console.log('after close, popover exists:', await page.evaluate(() => !!document.querySelector('.duc-popover')))

// 再点展开
await page.click('.duc-toggle')
await page.waitForTimeout(1200)
console.log('reopen popover exists:', await page.evaluate(() => !!document.querySelector('.duc-popover')))
console.log('console errors:', errors.length ? errors.slice(0, 5) : 'none')
await browser.close()
