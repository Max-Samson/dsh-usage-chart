// 完整渲染验证：指示器 → 面板（汇总/成本/轮次图表）→ 构成视图与悬浮详情 →
// 明暗主题 → 中英文界面（经 DSH 设置页真实切换）。
// 用法：node scripts/verify-render.mjs   （环境变量见 scripts/probe-utils.mjs）
import { join } from 'node:path'
import {
  launchBrowser,
  openDshPage,
  openSession,
  openSettings,
  pickLanguage,
  readLanguagePill,
  resolveArtifactsDir,
} from './probe-utils.mjs'

const artifacts = resolveArtifactsDir()
const browser = await launchBrowser()
const { page, errors } = await openDshPage(browser)

/** 展开面板：若已展开直接返回；否则 DOM 级点击并轮询 .duc-panel 出现（最多 3 次）。 */
async function clickToggle() {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (await page.locator('.duc-panel').count() > 0) return true
    const clicked = await page.evaluate(() => {
      const button = document.querySelector('.duc-toggle')
      if (button === null) return false
      const rect = button.getBoundingClientRect()
      button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2 }))
      return true
    })
    if (!clicked) return false
    await page.waitForTimeout(1500)
  }
  return (await page.locator('.duc-panel').count()) > 0
}

if (!await openSession(page)) console.log('WARN: 未找到可用的会话（.duc-root 未出现），后续检查可能失败')

let indicatorText = null
try {
  await page.waitForSelector('.duc-root', { timeout: 60_000 })
  const usageIcon = await page.$eval('.duc-toggle-icon', (icon) => ({
    width: getComputedStyle(icon).width,
    height: getComputedStyle(icon).height,
    pathFill: icon.querySelector('path')?.getAttribute('fill'),
  }))
  if (usageIcon.width !== '13px' || usageIcon.height !== '13px' || usageIcon.pathFill !== 'currentColor') {
    throw new Error(`usage-icon-invalid ${JSON.stringify(usageIcon)}`)
  }
  indicatorText = (await page.textContent('.duc-root'))?.trim().replace(/\s+/g, ' ')
  console.log('INDICATOR:', indicatorText, usageIcon)
  await page.screenshot({ path: join(artifacts, '1-indicator.png') })
} catch {
  console.log('INDICATOR NOT FOUND')
}

if (indicatorText !== null) {
  await clickToggle()
  try {
    await page.waitForSelector('.duc-panel', { timeout: 10_000 })
    await page.waitForTimeout(2500)
    const cells = await page.$$eval('.duc-cell', (els) => els.map((el) => el.textContent?.trim().replace(/\s+/g, ' ')))
    const balanceText = await page.evaluate(() => {
      const el = document.querySelector('.duc-bal')
      return el ? el.textContent.trim().replace(/\s+/g, ' ') : null
    })
    const barRectCount = await page.$$eval('.duc-panel svg rect', (els) => els.length).catch(() => 0)
    const legend = await page.evaluate(() => {
      const el = document.querySelector('.duc-legend')
      return el ? el.textContent.trim().replace(/\s+/g, ' ') : null
    })
    const notes = await page.$$eval('.duc-note', (els) => els.map((el) => el.textContent?.trim()))
    const chartControls = await page.$$eval('.duc-view-toggle button', (els) => els.map((el) => ({
      text: el.textContent?.trim(),
      pressed: el.getAttribute('aria-pressed'),
    })))
    const currentBandCount = await page.$$eval('.duc-chart-current-band', (els) => els.length)
    const currentBandGeometry = await page.$eval('.duc-chart-turn-current', (group) => {
      const band = group.querySelector('.duc-chart-current-band')
      const parts = [...group.querySelectorAll('.duc-chart-segment')]
      if (band === null || parts.length === 0) return null
      const barTop = Math.min(...parts.map((part) => Number(part.getAttribute('y'))))
      const barBottom = Math.max(...parts.map((part) => Number(part.getAttribute('y')) + Number(part.getAttribute('height'))))
      const bandTop = Number(band.getAttribute('y'))
      const bandBottom = bandTop + Number(band.getAttribute('height'))
      return { topPadding: barTop - bandTop, bottomPadding: bandBottom - barBottom }
    })
    if (currentBandGeometry === null
      || Math.abs(currentBandGeometry.topPadding - 4) > 0.1
      || Math.abs(currentBandGeometry.bottomPadding - 4) > 0.1) {
      throw new Error(`current-band-misaligned ${JSON.stringify(currentBandGeometry)}`)
    }
    const errText = await page.evaluate(() => {
      const el = document.querySelector('.duc-err')
      return el ? el.textContent.trim().replace(/\s+/g, ' ') : null
    })
    console.log('PANEL:', JSON.stringify({ cells, balanceText, barRectCount, legend, notes, chartControls, currentBandCount, currentBandGeometry, errText }, null, 2))
    await page.screenshot({ path: join(artifacts, '2-panel.png') })

    // ── 构成视图 + 悬浮详情（按钮文案随语言变化，按图表区 aria-label 定位） ──
    // 面板现有两组 .duc-view-toggle（成本币种 / 图表视图），必须限定在图表组内取第二个按钮。
    const ratioButton = page
      .locator('.duc-view-toggle[aria-label="图表显示方式"], .duc-view-toggle[aria-label="Chart display"]')
      .first()
      .locator('button')
      .nth(1)
    if (await ratioButton.count()) {
      await ratioButton.click()
      const ratioHeights = await page.$$eval('.duc-chart-turn', (groups) => groups.map((group) => {
        const parts = [...group.querySelectorAll('.duc-chart-segment')]
        if (parts.length === 0) return 0
        const top = Math.min(...parts.map((part) => Number(part.getAttribute('y'))))
        const bottom = Math.max(...parts.map((part) => Number(part.getAttribute('y')) + Number(part.getAttribute('height'))))
        return Math.round((bottom - top) * 100) / 100
      }))
      const lastTurn = page.locator('.duc-chart-turn').last()
      await lastTurn.hover()
      const tooltipText = await page.locator('.duc-chart-tooltip').textContent()
      await page.locator('.duc-chart-turn').first().focus()
      const keyboardTooltipVisible = await page.locator('.duc-chart-tooltip').isVisible()
      const keyboardTooltipText = await page.locator('.duc-chart-tooltip').textContent()
      console.log('CHART INTERACTION:', JSON.stringify({
        ratioHeights,
        tooltipText: tooltipText?.trim().replace(/\s+/g, ' '),
        keyboardTooltipVisible,
        keyboardTooltipText: keyboardTooltipText?.trim().replace(/\s+/g, ' '),
      }, null, 2))
      await page.screenshot({ path: join(artifacts, '3-chart-ratio-tooltip.png') })
    }

    // ── 明暗主题（data-ds-dark-theme 是 theme 服务的真实开关） ──
    const startedDark = await page.evaluate(() => document.body.hasAttribute('data-ds-dark-theme'))
    await page.evaluate((dark) => {
      document.body.toggleAttribute('data-ds-dark-theme', !dark)
    }, startedDark)
    await page.waitForTimeout(300)
    await page.screenshot({ path: join(artifacts, `2-panel-${startedDark ? 'light' : 'dark'}.png`) })
    await page.evaluate((dark) => {
      document.body.toggleAttribute('data-ds-dark-theme', dark)
    }, startedDark)

    // ── 英文界面：经 DSH 设置页真实切换语言（locale 服务驱动，非 html lang） ──
    const originalLanguage = await (async () => {
      if (!await openSettings(page)) return null
      return readLanguagePill(page)
    })()
    const switchedToEnglish = originalLanguage !== null
      && (await pickLanguage(page, 'English'))
    if (switchedToEnglish) {
      await openSession(page)
      const panelOpened = await clickToggle()
      await page.waitForTimeout(2500)
      if (!panelOpened) {
        console.log('WARN: 切换语言后面板未打开，跳过英文界面断言')
      } else {
        const englishUi = await page.evaluate(() => ({
          indicator: document.querySelector('.duc-root')?.textContent?.trim().replace(/\s+/g, ' '),
          headings: [...document.querySelectorAll('.duc-section h4')].map((el) => el.textContent?.trim()),
          controls: [...document.querySelectorAll('.duc-view-toggle button')].map((el) => el.textContent?.trim()),
          explainer: document.querySelector('.duc-chart-explainer')?.textContent?.trim().replace(/\s+/g, ' '),
        }))
        if (!englishUi.headings.includes('Session usage')
          || !englishUi.headings.includes('Usage by round')
          || !englishUi.controls.includes('Total')
          || !englishUi.controls.includes('Mix')) {
          throw new Error(`english-locale-missing ${JSON.stringify(englishUi)}`)
        }
        console.log('ENGLISH UI:', JSON.stringify(englishUi, null, 2))
        await page.screenshot({ path: join(artifacts, '4-panel-en.png') })
      }
      // 恢复原语言
      if (await openSettings(page)) await pickLanguage(page, originalLanguage)
      await openSession(page)
    } else {
      console.log('WARN: 未能通过设置页切换语言（跳过英文界面检查）；面板仍以当前语言渲染。')
    }
  } catch (error) {
    console.log('PANEL NOT FOUND:', error instanceof Error ? error.message : error)
    await page.screenshot({ path: join(artifacts, '1b-fail.png') })
  }
}
console.log('CONSOLE ERRORS:', errors.length ? JSON.stringify(errors, null, 2) : 'none')
await browser.close()
