// 截图：打开目标会话，拍「收起 / 展开面板」两张图。
// 用法：node scripts/shot.mjs   （环境变量见 scripts/probe-utils.mjs）
import { join } from 'node:path'
import { launchBrowser, openDshPage, openSession, resolveArtifactsDir } from './probe-utils.mjs'

const artifacts = resolveArtifactsDir()
const browser = await launchBrowser()
const { page, errors } = await openDshPage(browser)

if (!await openSession(page)) console.log('WARN: 未找到可用的会话（.duc-root 未出现），截图可能不完整')
await page.waitForTimeout(1500)
await page.screenshot({ path: join(artifacts, '3-collapsed.png') })
await page.click('.duc-toggle')
await page.waitForTimeout(2500)
await page.screenshot({ path: join(artifacts, '4-panel-open.png') })
console.log(`screenshots saved to ${artifacts}`)
console.log('console errors:', errors.length ? JSON.stringify(errors) : 'none')
await browser.close()
