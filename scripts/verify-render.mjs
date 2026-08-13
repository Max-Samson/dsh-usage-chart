import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
const ART = '/Users/mingshenshuai/mycode/dsh-usage-chart/artifacts'
mkdirSync(ART, { recursive: true })

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args: ['--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const consoleErrors = []
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)) })
page.on('pageerror', (e) => consoleErrors.push(`PAGEERROR: ${e.message.slice(0, 300)}`))

await page.goto('http://127.0.0.1:3080', { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(9000)

for (const text of ['实时令牌成本仪表盘与Git侧边栏插件状态', 'next-ai-draw-io', '进行中']) {
  const loc = page.getByText(text, { exact: false }).first()
  if (await loc.count()) { await loc.click({ timeout: 8000 }).catch(() => {}); break }
}
await page.waitForTimeout(5000)

let indicatorText = null
try {
  await page.waitForSelector('.duc-root', { timeout: 60_000 })
  indicatorText = (await page.textContent('.duc-root'))?.trim().replace(/\s+/g, ' ')
  console.log('INDICATOR:', indicatorText)
  await page.screenshot({ path: `${ART}/1-indicator.png` })
} catch {
  console.log('INDICATOR NOT FOUND')
}

if (indicatorText !== null) {
  await page.click('.duc-toggle')
  try {
    await page.waitForSelector('.duc-panel', { timeout: 10_000 })
    await page.waitForTimeout(2500)
    const cells = await page.$$eval('.duc-cell', (els) => els.map((e) => e.textContent?.trim().replace(/\s+/g, ' ')))
    const balanceText = (await page.$eval('.duc-bal', (e) => e.textContent?.trim().replace(/\s+/g, ' '))).catch?.(() => null) ?? null
    const balanceText2 = await page.evaluate(() => {
      const el = document.querySelector('.duc-bal')
      return el ? el.textContent.trim().replace(/\s+/g, ' ') : null
    })
    const barRectCount = await page.$$eval('.duc-panel svg rect', (els) => els.length).catch(() => 0)
    const legend = await page.evaluate(() => {
      const el = document.querySelector('.duc-legend')
      return el ? el.textContent.trim().replace(/\s+/g, ' ') : null
    })
    const notes = await page.$$eval('.duc-note', (els) => els.map((e) => e.textContent?.trim()))
    const errText = await page.evaluate(() => {
      const el = document.querySelector('.duc-err')
      return el ? el.textContent.trim().replace(/\s+/g, ' ') : null
    })
    console.log('PANEL:', JSON.stringify({ cells, balanceText2, barRectCount, legend, notes, errText }, null, 2))
    await page.screenshot({ path: `${ART}/2-panel.png` })
  } catch (e) {
    console.log('PANEL NOT FOUND:', e.message)
    await page.screenshot({ path: `${ART}/1b-fail.png` })
  }
}
console.log('CONSOLE ERRORS:', consoleErrors.length ? JSON.stringify(consoleErrors, null, 2) : 'none')
await browser.close()
