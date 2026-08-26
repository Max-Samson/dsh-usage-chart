// 独立图表探测（v1.0.0 横向滚动）：不依赖运行中的 DSH Web——
// esbuild 把 RoundBars + React 打进临时 HTML，注入合成轮次数据，
// headless Chromium 渲染并断言滚动/几何行为（柱宽恒定、标签不重叠、
// 短历史不滚动且居中），同时截图留档。
//
// 用法：node scripts/probe-chart.mjs   （环境变量见 scripts/probe-utils.mjs）
// 产物：<仓库根>/artifacts/probe-chart-*.png；临时束在 temp/probe-chart/（gitignore）。
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
import { resolveArtifactsDir, resolveChrome, REPO_ROOT } from './probe-utils.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(REPO_ROOT, 'temp', 'probe-chart')
mkdirSync(outDir, { recursive: true })
const entry = join(outDir, 'entry.tsx')
const html = join(outDir, 'index.html')
const bundle = join(outDir, 'bundle.js')

/** 合成数据：18 轮（覆盖滚动）+ 5 轮（短历史不滚动）。 */
const ENTRY = `
import { createRoot } from 'react-dom/client'
import { RoundBars, type RoundChartMode } from '../../src/client/chart/RoundBars.tsx'
import { injectPluginCss } from '../../src/client/styles.ts'
import type { ChartRound } from '../../src/client/rounds/types.ts'
import type { AnomalyFlag } from '../../src/client/diagnose/anomaly.ts'

injectPluginCss()

function makeRounds(TURNS: number): ChartRound[] {
  const rounds: ChartRound[] = []
  for (let i = 1; i <= TURNS; i++) {
    const base = 4200 + i * 1900
    const output = 900 + ((i * 733) % 2600)
    rounds.push({
      turn: i,
      buckets: {
        uncachedInputTokens: Math.round(base * 0.55),
        cacheReadTokens: Math.round(base * 0.3),
        outputTokens: output,
        cacheWriteTokens: Math.round(base * 0.08),
      },
      model: 'deepseek-chat',
      startedAt: Date.now() - (TURNS - i) * 45_000,
      endedAt: null,
      durationMs: 9_000 + ((i * 4213) % 31_000),
      ttftMs: 400 + ((i * 97) % 1_600),
      outputTps: 22 + ((i * 13) % 40),
      endReason: i === 14 ? 'error' : 'completed',
      cost: {
        cny: {
          input: (base * 0.63 / 1_000_000) * 1.5,
          cacheRead: (base * 0.3 / 1_000_000) * 0.1,
          output: (output / 1_000_000) * 4.5,
          total: 0.001 + i * 0.004,
        },
        usd: {
          input: (base * 0.63 / 1_000_000) * 0.22,
          cacheRead: (base * 0.3 / 1_000_000) * 0.014,
          output: (output / 1_000_000) * 0.66,
          total: 0.0001 + i * 0.0004,
        },
        estimated: false,
        unknownModel: false,
        source: 'builtin',
        verifiedAt: Date.now(),
      },
    })
  }
  return rounds
}

const flags: AnomalyFlag[] = [{ turn: 14, reasons: ['output-growth'] }]
const modes: RoundChartMode[] = ['absolute', 'ratio', 'cost']

const container = document.getElementById('root')!
const root = createRoot(container)
root.render(
  <div style={{ width: 460, margin: '0 auto', padding: '20px 0', fontFamily: 'system-ui' }}>
    {modes.map((mode, bi) => (
      <section key={mode} data-block={mode} style={{ marginBottom: 26 }}>
        <h1 style={{ color: '#9aa0a6', fontSize: 12, margin: '0 0 4px' }}>{mode} · 18 rounds</h1>
        <RoundBars rounds={makeRounds(18)} mode={mode} flags={flags} locale={'zh'} />
      </section>
    ))}
    <section data-block="short">
      <h1 style={{ color: '#9aa0a6', fontSize: 12, margin: '0 0 4px' }}>absolute · 5 rounds (no scroll)</h1>
      <RoundBars rounds={makeRounds(5)} mode={'absolute' as RoundChartMode} flags={[]} locale={'zh'} />
    </section>
  </div>,
)

// 探测钩子：按块滚动 / 度量读取（脚本侧通过 page.evaluate 调用）。
;(window as unknown as Record<string, unknown>).__chartScroll = (block: string, left: number): void => {
  const el = document.querySelector<HTMLElement>(\`[data-block="\${block}"] .duc-chart-scroll\`)
  if (el !== null) el.scrollLeft = left
}
;(window as unknown as Record<string, unknown>).__chartMetrics = (block: string): Record<string, unknown> | null => {
  const section = document.querySelector<HTMLElement>(\`[data-block="\${block}"]\`)
  const el = section?.querySelector<HTMLElement>('.duc-chart-scroll')
  if (section === null || el === null) return null
  const svg = el.querySelector<SVGSVGElement>('svg')
  const turns = [...section.querySelectorAll<SVGGElement>('.duc-chart-turn')]
  const segments = [...section.querySelectorAll<SVGRectElement>('.duc-chart-segment')]
  const labels = [...section.querySelectorAll<SVGTextElement>('.duc-chart-value')]
    .map((t) => {
      const b = t.getBBox()
      return { x: b.x, w: b.width, text: t.textContent }
    })
    .sort((a, b) => a.x - b.x)
  let maxOverlap = 0
  for (let i = 1; i < labels.length; i++) {
    maxOverlap = Math.max(maxOverlap, labels[i - 1].x + labels[i - 1].w - labels[i].x)
  }
  const firstX = turns.length > 0 ? Number(turns[0].querySelector('rect')?.getAttribute('x') ?? -1) : -1
  const barW = segments.length > 0 ? Number(segments[0].getAttribute('width')) : -1
  const slot = turns.length > 1
    ? Number(turns[1].querySelector('rect')?.getAttribute('x') ?? -1) - firstX
    : -1
  return {
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
    scrollLeft: el.scrollLeft,
    turnCount: turns.length,
    svgW: Number(svg?.getAttribute('viewBox')?.split(' ')[2] ?? -1),
    firstX,
    barW,
    slot,
    valueLabelMaxOverlap: Math.round(maxOverlap * 100) / 100,
    valueLabels: labels.length,
    valueLabelSamples: labels.slice(0, 3).map((l) => l.text),
    prevBtn: section.querySelectorAll('.duc-chart-scroll-prev').length,
    nextBtn: section.querySelectorAll('.duc-chart-scroll-next').length,
    fadeLeft: section.querySelectorAll('.duc-chart-fade-left').length,
    fadeRight: section.querySelectorAll('.duc-chart-fade-right').length,
  }
}
`

const HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>RoundBars probe</title>
<style>
  :root {
    --duc-miss: #3478f6; --duc-hit: #45a9c7; --duc-output: #43b96f; --duc-write: #d99a2b;
    --duc-anomaly: #d8453c; --duc-duration: #8f6bd8;
    --dsw-alias-label-primary: rgba(255, 255, 255, 0.92);
    --dsw-alias-label-secondary: rgba(255, 255, 255, 0.72);
    --dsw-alias-label-tertiary: rgba(255, 255, 255, 0.55);
    --dsw-alias-border-l3: rgba(255, 255, 255, 0.24);
    --dsw-alias-bg-layer-2: #1e1f22;
    --dsw-alias-bg-layer-3: #26282c;
    --dsw-alias-interactive-bg-hover: rgba(255, 255, 255, 0.09);
  }
  body { margin: 0; background: #141517; }
</style>
</head>
<body><div id="root"></div><script src="./bundle.js"></script></body>
</html>
`

writeFileSync(entry, ENTRY)
writeFileSync(html, HTML)
await build({
  entryPoints: [entry],
  outfile: bundle,
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
})
console.log('[probe-chart] bundled:', bundle)

const artifacts = resolveArtifactsDir()
const browser = await chromium.launch({ executablePath: resolveChrome(), headless: true, args: ['--no-sandbox'] })
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 1500 } })
  const errors = []
  page.on('pageerror', (error) => console.error('PAGE ERROR:', error))
  page.on('console', (msg) => console.log('PAGE LOG:', msg.text()))
  await page.goto('file://' + html, { waitUntil: 'load' })
  await page.waitForSelector('.duc-chart-scroll svg')
  await page.waitForTimeout(400)

  const failures = []
  const read = (block) => page.evaluate((b) => window.__chartMetrics?.(b), block)

  // ── 三个模式 × 18 轮：全部渲染 + 溢出滚动 + 自动滚到最新 + 柱宽/槽距恒定 ──
  const modeResults = {}
  for (const mode of ['absolute', 'ratio', 'cost']) {
    const m = await read(mode)
    modeResults[mode] = m
    if (!m || m.turnCount !== 18) failures.push(`${mode}: turnCount=${m?.turnCount}`)
    if (!m || m.scrollWidth <= m.clientWidth) failures.push(`${mode}: no-overflow`)
    if (!m || Math.abs(m.scrollLeft - (m.scrollWidth - m.clientWidth)) > 2) failures.push(`${mode}: not-at-end ${m?.scrollLeft}/${m?.scrollWidth - m?.clientWidth}`)
    if (!m || m.barW !== 30) failures.push(`${mode}: barW=${m?.barW}`)
    if (!m || m.slot !== 40) failures.push(`${mode}: slot=${m?.slot}`)
    if (!m || m.prevBtn !== 1 || m.fadeLeft !== 1 || m.nextBtn !== 0 || m.fadeRight !== 0) failures.push(`${mode}: end-state-btns`)
    // 密集（可滚动）时 token 视角值标签仅保留当前轮 → 无重叠；成本视角逐轮可见
    if (mode !== 'cost' && (!m || m.valueLabels !== 1)) failures.push(`${mode}: dense-labels=${m?.valueLabels}`)
    if (mode !== 'cost' && (!m || m.valueLabelMaxOverlap > 1)) failures.push(`${mode}: label-overlap=${m?.valueLabelMaxOverlap}`)
  }

  // 滚回开头：右箭头/右渐隐出现，左箭头消失
  await page.evaluate(() => window.__chartScroll?.('absolute', 0))
  await page.waitForTimeout(150)
  const start = await read('absolute')
  if (!start || start.scrollLeft !== 0 || start.nextBtn !== 1 || start.fadeRight !== 1 || start.prevBtn !== 0 || start.fadeLeft !== 0) {
    failures.push(`start-state-btns ${JSON.stringify(start)}`)
  }
  await page.screenshot({ path: join(artifacts, 'probe-chart-start.png') })
  await page.evaluate(() => window.__chartScroll?.('absolute', 99999))
  await page.waitForTimeout(150)
  await page.screenshot({ path: join(artifacts, 'probe-chart-end.png') })

  // 悬浮早期轮次：工具提示出现在可见区内且内容完整
  const early = page.locator('[data-block="absolute"] .duc-chart-turn').nth(2)
  await early.hover()
  await page.waitForTimeout(150)
  const tooltip = await page.evaluate(() => {
    const el = document.querySelector('.duc-chart-tooltip')
    if (el === null) return null
    const rect = el.getBoundingClientRect()
    return {
      text: el.textContent?.trim().replace(/\s+/g, ' ').slice(0, 140),
      left: Math.round(rect.left),
      right: Math.round(rect.right),
      viewportW: window.innerWidth,
    }
  })
  if (!tooltip || tooltip.left < 0 || tooltip.right > tooltip.viewportW) failures.push(`tooltip-out-of-view ${JSON.stringify(tooltip)}`)
  await page.screenshot({ path: join(artifacts, 'probe-chart-tooltip.png') })

  // 箭头按钮可点击滚动
  const beforeClick = start?.scrollLeft ?? 0
  await page.locator('[data-block="absolute"] .duc-chart-scroll-next').click()
  await page.waitForTimeout(350)
  const afterClick = await read('absolute')
  if (!afterClick || afterClick.scrollLeft <= beforeClick) failures.push(`arrow-click-no-scroll ${beforeClick} -> ${afterClick?.scrollLeft}`)

  // ── 短历史（5 轮）：不滚动、图表填满容器（最小宽自适应）、柱宽仍恒定 ──
  const short = await read('short')
  if (!short || short.scrollWidth !== short.clientWidth) failures.push(`short: should-not-scroll ${JSON.stringify(short)}`)
  if (!short || short.prevBtn !== 0 || short.nextBtn !== 0 || short.fadeLeft !== 0 || short.fadeRight !== 0) failures.push(`short: stray-btns`)
  if (!short || short.svgW !== 460) failures.push(`short: svgW=${short?.svgW}`)
  if (!short || short.turnCount !== 5) failures.push(`short: turnCount=${short?.turnCount}`)
  if (!short || short.scrollLeft !== 0) failures.push(`short: scrollLeft=${short?.scrollLeft}`)
  // 5 轮：contentWidth = 20 + 150 + 40 = 210，svgWidth = 460（= 容器）→ firstX = (460-210)/2 + 10 = 135
  if (!short || short.firstX !== 135) failures.push(`short: firstX=${short?.firstX}`)
  // 非密集：值标签全显示且不重叠
  if (!short || short.valueLabels !== 5) failures.push(`short: labels=${short?.valueLabels}`)
  if (!short || short.valueLabelMaxOverlap > 1) failures.push(`short: label-overlap=${short?.valueLabelMaxOverlap}`)

  // 页面级横向溢出检查（滚动容器不应撑破页面）
  const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  if (pageOverflow > 1) failures.push(`page-horizontal-overflow ${pageOverflow}`)

  // ── 几何契约（与 scripts/verify-render.mjs 的既有断言一致） ──
  const geometry = await page.evaluate(() => {
    const ratioSec = document.querySelector('[data-block="ratio"]')
    const ratioHeights = [...ratioSec.querySelectorAll('.duc-chart-turn')].map((g) => {
      const parts = [...g.querySelectorAll('.duc-chart-segment')]
      const top = Math.min(...parts.map((p) => Number(p.getAttribute('y'))))
      const bottom = Math.max(...parts.map((p) => Number(p.getAttribute('y')) + Number(p.getAttribute('height'))))
      return Math.round((bottom - top) * 100) / 100
    })
    const current = document.querySelector('[data-block="absolute"] .duc-chart-turn-current')
    const band = current?.querySelector('.duc-chart-current-band')
    const parts = [...current.querySelectorAll('.duc-chart-segment')]
    const barTop = Math.min(...parts.map((p) => Number(p.getAttribute('y'))))
    const barBottom = Math.max(...parts.map((p) => Number(p.getAttribute('y')) + Number(p.getAttribute('height'))))
    const bandTop = Number(band?.getAttribute('y'))
    const bandBottom = bandTop + Number(band?.getAttribute('height'))
    return {
      ratioHeightSet: [...new Set(ratioHeights)],
      currentBandPadding: {
        top: Math.round((barTop - bandTop) * 10) / 10,
        bottom: Math.round((bandBottom - barBottom) * 10) / 10,
      },
      anomalyFlags: document.querySelectorAll('[data-block="absolute"] .duc-chart-anomaly').length,
      durationPoints: document.querySelector('[data-block="absolute"] .duc-chart-duration polyline')
        ?.getAttribute('points')?.trim().split(/\s+/).length ?? 0,
    }
  })
  if (geometry.ratioHeightSet.length !== 1 || geometry.ratioHeightSet[0] !== 76) {
    failures.push(`ratio-heights ${JSON.stringify(geometry.ratioHeightSet)}`)
  }
  if (Math.abs(geometry.currentBandPadding.top - 4) > 0.1 || Math.abs(geometry.currentBandPadding.bottom - 4) > 0.1) {
    failures.push(`current-band ${JSON.stringify(geometry.currentBandPadding)}`)
  }
  if (geometry.anomalyFlags !== 1) failures.push(`anomaly-flags=${geometry.anomalyFlags}`)
  if (geometry.durationPoints !== 18) failures.push(`duration-points=${geometry.durationPoints}`)

  console.log(JSON.stringify({ modeResults, start, short, tooltip: { left: tooltip?.left, right: tooltip?.right, text: tooltip?.text }, geometry, failures, errors }, null, 2))
  if (failures.length > 0) process.exitCode = 1
} finally {
  await browser.close()
}
