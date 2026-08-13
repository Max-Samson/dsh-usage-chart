import { chromium } from 'playwright-core'
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args: ['--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const errs = []
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 250)) })
page.on('pageerror', (e) => errs.push(`PAGEERROR: ${e.message.slice(0, 300)}`))
await page.goto('http://127.0.0.1:3080', { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(9000)
const loc = page.getByText('实时令牌成本仪表盘与Git侧边栏插件状态', { exact: false }).first()
if (await loc.count()) await loc.click({ timeout: 8000 }).catch(() => {})
await page.waitForSelector('.duc-root', { timeout: 60000 }).catch(() => {})
console.log('default expanded:', await page.evaluate(() => !!document.querySelector('.duc-popover')))

// 点击展开
await page.click('.duc-toggle')
await page.waitForTimeout(1500)
const info = await page.evaluate(() => {
  const pop = document.querySelector('.duc-popover')
  if (!pop) return { popoverInDom: false, toggleText: document.querySelector('.duc-toggle')?.textContent }
  const r = pop.getBoundingClientRect()
  const panel = document.querySelector('.duc-panel')
  const pr = panel ? panel.getBoundingClientRect() : null
  return {
    popoverInDom: true,
    popRect: [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)],
    popSize: [Math.round(r.width), Math.round(r.height)],
    viewport: [window.innerWidth, window.innerHeight],
    visible: r.width > 50 && r.height > 50 && r.right > 0 && r.left < window.innerWidth && r.bottom > 0 && r.top < window.innerHeight,
    panelRect: pr ? [Math.round(pr.top), Math.round(pr.bottom), Math.round(pr.height)] : null,
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
console.log('errors:', errs.length ? errs.slice(0, 5) : 'none')
await browser.close()
