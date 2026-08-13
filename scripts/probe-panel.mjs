import { chromium } from 'playwright-core'
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args: ['--no-sandbox'],
})
// 用小视口模拟真实桌面
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const errs = []
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)) })
page.on('pageerror', (e) => errs.push(`PAGEERROR: ${e.message.slice(0, 300)}`))
await page.goto('http://127.0.0.1:3080', { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(9000)
const loc = page.getByText('实时令牌成本仪表盘与Git侧边栏插件状态', { exact: false }).first()
if (await loc.count()) await loc.click({ timeout: 8000 }).catch(() => {})
await page.waitForSelector('.duc-root', { timeout: 60000 }).catch(() => {})
await page.click('.duc-toggle')
await page.waitForTimeout(2500)
const info = await page.evaluate(() => {
  const panel = document.querySelector('.duc-panel')
  if (!panel) return { panelInDom: false }
  const r = panel.getBoundingClientRect()
  const vh = window.innerHeight
  // 找裁剪祖先
  let el = panel.parentElement
  const clips = []
  while (el && el !== document.body) {
    const cs = getComputedStyle(el)
    if (cs.overflow !== 'visible' || cs.maxHeight || cs.height !== 'auto') {
      const er = el.getBoundingClientRect()
      clips.push({ tag: el.tagName, cls: String(el.className).slice(0, 60), overflow: cs.overflow, maxH: cs.maxHeight, h: cs.height, rect: [Math.round(er.top), Math.round(er.bottom)] })
    }
    el = el.parentElement
  }
  return {
    panelInDom: true,
    panelRect: [Math.round(r.top), Math.round(r.bottom), Math.round(r.height)],
    viewportH: vh,
    visible: r.height > 20 && r.top < vh && r.bottom > 0,
    clipAncestors: clips.slice(0, 8),
  }
})
console.log(JSON.stringify(info, null, 2))
console.log('errors:', errs.length ? errs.slice(0, 5) : 'none')
await browser.close()
