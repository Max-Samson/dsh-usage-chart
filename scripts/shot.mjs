import { chromium } from 'playwright-core'
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args: ['--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto('http://127.0.0.1:3080', { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(9000)
const loc = page.getByText('实时令牌成本仪表盘与Git侧边栏插件状态', { exact: false }).first()
if (await loc.count()) await loc.click({ timeout: 8000 }).catch(() => {})
await page.waitForSelector('.duc-root', { timeout: 60000 }).catch(() => {})
await page.waitForTimeout(1500)
await page.screenshot({ path: 'artifacts/3-collapsed.png' })
await page.click('.duc-toggle')
await page.waitForTimeout(2500)
await page.screenshot({ path: 'artifacts/4-panel-open.png' })
console.log('screenshots saved')
await browser.close()
