import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

/**
 * 打包 RoundBars，并把 react 的 useState 换成可注入初值的版本：
 * 静态渲染无法 hover，借 `__activeIndex` 让解释卡（Tooltip）直接渲染出来。
 */
async function loadRoundBars() {
  const reactMock = [
    'const React = require("react")',
    'export const useId = React.useId',
    'export const useRef = React.useRef',
    'export const useLayoutEffect = () => {}',
    'export const useState = (init) => [init === null && globalThis.__activeIndex != null ? globalThis.__activeIndex : init, () => {}]',
  ].join('\n')
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/client/chart/RoundBars.tsx', import.meta.url))],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node',
    target: 'node20',
    external: ['react', 'react/jsx-runtime', 'react-dom'],
    plugins: [{
      name: 'react-state-mock',
      setup(pluginBuild) {
        pluginBuild.onResolve({ filter: /^react$/ }, (args) => (args.importer.endsWith('RoundBars.tsx') ? { path: 'react', namespace: 'react-mock' } : undefined))
        pluginBuild.onLoad({ filter: /.*/, namespace: 'react-mock' }, () => ({ contents: reactMock, loader: 'js', resolveDir: process.cwd() }))
      },
    }],
  })
  const context = { module: { exports: {} }, require: createRequire(import.meta.url), globalThis: undefined, __activeIndex: null }
  context.globalThis = context
  context.exports = context.module.exports
  runInNewContext(result.outputFiles[0].text, context)
  return { RoundBars: context.module.exports.RoundBars, context }
}

const { RoundBars, context } = await loadRoundBars()

const buckets = { uncachedInputTokens: 1000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 500 }
const split = (total) => ({ input: total, cacheRead: 0, output: 0, total })
const mkRound = (turn, model, cost) => ({
  turn, buckets, model, startedAt: null, endedAt: null, durationMs: null, ttftMs: null, outputTps: null, endReason: null, cost,
})
const priced = mkRound(1, 'claude-opus-5-5', { cny: split(0.5), usd: split(0.07), estimated: false, unknownModel: false, unpriced: false, source: 'builtin', verifiedAt: 1 })
const unpriced = mkRound(2, 'claude-haiku-5-5', { cny: split(0), usd: split(0), estimated: true, unknownModel: true, unpriced: true, source: 'fallback', verifiedAt: null })

function render(props, activeIndex = null) {
  context.__activeIndex = activeIndex
  return renderToStaticMarkup(createElement(RoundBars, { rounds: [priced, unpriced], locale: 'en', currency: 'usd', ...props }))
}

test('cost mode labels unpriced rounds as Unpriced instead of $0', () => {
  const html = render({ mode: 'cost' })
  assert.match(html, /aria-label="Round 2, current, total Unpriced"/)
  assert.match(html, /duc-chart-value duc-chart-value-unpriced[^>]*>Unpriced</)
  assert.doesNotMatch(html, /total \$0(?:\.0+)?"/)
  // 已定价轮次照常显示金额
  assert.match(html, /aria-label="Round 1, total \$0\.0700?"/)
})

test('cost mode tooltip head shows Unpriced for an unpriced round', () => {
  const html = render({ mode: 'cost' }, 1)
  assert.match(html, /duc-chart-tooltip-head"><strong>[^<]*<\/strong><b>Unpriced<\/b>/)
})

test('token mode tooltip shows the round cost as Unpriced, not a zero estimate', () => {
  const html = render({ mode: 'absolute' }, 1)
  assert.match(html, /<em>Round cost<\/em><b>Unpriced<\/b>/)
  assert.doesNotMatch(html, /<em>Round cost<\/em><b>\$0/)
  const pricedHtml = render({ mode: 'absolute' }, 0)
  assert.match(pricedHtml, /<em>Round cost<\/em><b>\$0\.07/)
})

test('zh locale uses 未定价', () => {
  context.__activeIndex = null
  const html = renderToStaticMarkup(createElement(RoundBars, { rounds: [priced, unpriced], locale: 'zh', currency: 'cny', mode: 'cost' }))
  assert.match(html, />未定价</)
})
