/**
 * 共享探测工具：把脚本与开发者本机解耦（纯 JavaScript，Node ≥ 20 直接运行）。
 *
 * 环境变量（全部可选）：
 *  - DSH_PROBE_CHROME     Chrome/Chromium 可执行文件路径（默认按平台常见位置查找）
 *  - DSH_PROBE_URL        DSH Web 地址（默认 http://127.0.0.1:3080）
 *  - DSH_PROBE_ARTIFACTS  截图输出目录（默认 <仓库根>/artifacts，已 gitignore）
 *  - DSH_PROBE_SESSION    目标会话标题片段，逗号分隔多个备选（默认内置常用标题）
 */
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

/** 仓库根目录（本文件位于 <repo>/scripts/ 下）。 */
export const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/** 解析 Chrome 可执行文件：DSH_PROBE_CHROME > 平台常见位置 > PATH 名称。 */
export function resolveChrome() {
  const fromEnv = process.env.DSH_PROBE_CHROME
  if (fromEnv !== undefined && fromEnv !== '') {
    if (existsSync(fromEnv)) return fromEnv
    throw new Error(`DSH_PROBE_CHROME 指向的文件不存在: ${fromEnv}`)
  }
  const candidates = process.platform === 'darwin'
    ? [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      ]
    : process.platform === 'win32'
      ? [
          join(process.env.PROGRAMFILES ?? 'C:\\Program Files', 'Google\\Chrome\\Application\\chrome.exe'),
          join(process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)', 'Google\\Chrome\\Application\\chrome.exe'),
          join(process.env.LOCALAPPDATA ?? '', 'Google\\Chrome\\Application\\chrome.exe'),
        ]
      : ['google-chrome', 'chromium', 'chromium-browser', 'google-chrome-stable']
  for (const candidate of candidates) {
    // 绝对/相对路径需要存在；裸名称按 PATH 可执行处理（交给 spawn 解析）。
    if (candidate.includes('/') || candidate.includes('\\') || isAbsolute(candidate)) {
      if (existsSync(candidate)) return candidate
    } else if (process.platform !== 'win32') {
      return candidate
    }
  }
  throw new Error([
    '未找到 Chrome/Chromium。',
    '请安装 Chrome/Chromium，或设置 DSH_PROBE_CHROME=<可执行文件路径> 后再运行。',
    `（已尝试: ${candidates.join('、')}）`,
  ].join('\n'))
}

/** 目标 DSH Web 地址（默认 127.0.0.1:3080）。 */
export function resolveTargetUrl() {
  return process.env.DSH_PROBE_URL ?? 'http://127.0.0.1:3080'
}

/** 截图输出目录（默认 <仓库根>/artifacts），不存在则创建。 */
export function resolveArtifactsDir() {
  const fromEnv = process.env.DSH_PROBE_ARTIFACTS
  const dir = fromEnv !== undefined && fromEnv !== '' ? fromEnv : join(REPO_ROOT, 'artifacts')
  mkdirSync(dir, { recursive: true })
  return dir
}

/** 目标会话标题片段（逗号分隔多个备选；默认内置常用标题）。 */
export function resolveSessionTitles() {
  const fromEnv = process.env.DSH_PROBE_SESSION
  if (fromEnv !== undefined && fromEnv !== '') {
    return fromEnv.split(',').map((item) => item.trim()).filter(Boolean)
  }
  return ['实时令牌成本仪表盘与Git侧边栏插件状态', 'next-ai-draw-io', '进行中']
}

/** 启动无头浏览器（no-sandbox，便于容器/CI）。 */
export function launchBrowser() {
  return chromium.launch({
    executablePath: resolveChrome(),
    headless: true,
    args: ['--no-sandbox'],
  })
}

/**
 * 打开 DSH 页面并等待 boot 完成；收集 console/page 错误。
 * @returns { page, errors } errors 为数组，收集 console error 与 pageerror。
 */
export async function openDshPage(browser, viewport = { width: 1440, height: 900 }) {
  const page = await browser.newPage({ viewport })
  const errors = []
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text().slice(0, 300)) })
  page.on('pageerror', (error) => errors.push(`PAGEERROR: ${String(error).slice(0, 300)}`))
  await page.goto(resolveTargetUrl(), { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await page.waitForTimeout(9000)
  return { page, errors }
}

/**
 * 打开第一个匹配标题的会话并等待 .duc-root 出现。
 * 先按文本点击，失败再按会话行类名点击（尽力而为，取决于 DSH 版本 DOM）。
 */
export async function openSession(page, titles = resolveSessionTitles()) {
  for (const title of titles) {
    const textLocator = page.getByText(title, { exact: false }).first()
    if (await textLocator.count() > 0) {
      await textLocator.click({ timeout: 8000 }).catch(() => {})
      await page.waitForTimeout(5000)
      if (await page.locator('.duc-root').count() > 0) return true
    }
  }
  // 兜底：CSS module 会话行类名（含标题文本）
  const clicked = await page.evaluate((titles) => {
    const row = [...document.querySelectorAll('.YDXeBa_sessionRow')].find((el) => titles.some((t) => el.textContent?.includes(t)))
    if (row === undefined) return false
    const rect = row.getBoundingClientRect()
    row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: rect.x + 30, clientY: rect.y + 10 }))
    return true
  }, titles)
  if (clicked) {
    await page.waitForTimeout(6000)
    return (await page.locator('.duc-root').count()) > 0
  }
  return false
}

/** 打开设置页（按钮文案随语言变化：Settings / 设置）。 */
export async function openSettings(page) {
  const opened = await page.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find((el) => ['Settings', '设置'].includes((el.textContent ?? '').trim()))
    if (button === undefined) return false
    button.click()
    return true
  })
  if (opened) await page.waitForTimeout(2500)
  return opened
}

/** 读取「语言」行的当前选择（English / 中文；打开设置页后调用）。 */
export async function readLanguagePill(page) {
  return page.evaluate(() => {
    const row = [...document.querySelectorAll('*')].find((el) => {
      const text = el.textContent ?? ''
      return el.children.length <= 6 && text.length < 140
        && ((text.includes('Language') && text.includes('English')) || (text.includes('语言') && text.includes('中文')))
    })
    if (row === undefined) return null
    const pill = [...row.querySelectorAll('button')].find((button) => /English|中文/.test(button.textContent ?? ''))
    return pill ? pill.textContent?.trim() ?? null : null
  })
}

/**
 * 在「设置页已打开」的前提下，把语言切到 target（'English' | '中文'）。
 * 真实用户路径：点击语言行选择器 → 菜单项；触发 locale 服务，插件实时切换。
 */
export async function pickLanguage(page, target) {
  const pillClicked = await page.evaluate(() => {
    const row = [...document.querySelectorAll('*')].find((el) => {
      const text = el.textContent ?? ''
      return el.children.length <= 6 && text.length < 140
        && ((text.includes('Language') && text.includes('English')) || (text.includes('语言') && text.includes('中文')))
    })
    const pill = row === undefined ? null : [...row.querySelectorAll('button')].find((button) => /English|中文/.test(button.textContent ?? ''))
    if (pill === null || pill === undefined) return false
    pill.click()
    return true
  })
  if (!pillClicked) return false
  await page.waitForTimeout(1200)
  const picked = await page.evaluate((label) => {
    const item = [...document.querySelectorAll('[role="menuitem"], [role="option"], [class*="menu"] [class*="item"]')]
      .find((el) => (el.textContent ?? '').trim() === label)
    if (item === undefined) return false
    item.click()
    return true
  }, target)
  await page.waitForTimeout(2500)
  return picked
}

/**
 * 通过 DSH 设置页把应用语言切到 target（'English' | '中文'）——真实用户路径，
 * 触发 locale 服务，插件随设置实时切换。返回是否成功。
 */
export async function setAppLanguage(page, target) {
  if (!await openSettings(page)) return false
  return pickLanguage(page, target)
}
