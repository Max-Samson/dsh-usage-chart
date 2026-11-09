import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { resolve } from 'node:path'
import { build } from 'esbuild'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createPricingResolver, FALLBACK_PRICING } from '../lib/index.js'

// 仅替换数据 hook；保留真实面板、价格解析、文案与 HStack，防止测试重复实现 UI。
const result = await build({ entryPoints: ['src/client/UsagePanel.tsx'], bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react', 'react/jsx-runtime', 'react-dom'], plugins: [{ name: 'panel-hooks', setup(b) {
  b.onResolve({ filter: /^\.\/(currency|pricing-api)\.ts$/ }, (a) => a.importer.endsWith('/UsagePanel.tsx') ? { path: a.path, namespace: 'hooks' } : undefined)
  b.onLoad({ filter: /.*/, namespace: 'hooks' }, (a) => ({ contents: a.path.includes('currency')
    ? 'export const useDisplayCurrency=()=>globalThis.__meta; export const setDisplayCurrency=()=>{}; export const refreshLiveRate=async()=>"ok";'
    : `export {resolvePricing} from ${JSON.stringify(resolve('src/client/pricing-api.ts'))}; export const usePricing=()=>({table:globalThis.__table});`, loader: 'js', resolveDir: process.cwd() }))
} }] })
const resolver = createPricingResolver()
const context = { module: { exports: {} }, require: createRequire(import.meta.url), __meta: {}, __table: { entries: Object.fromEntries(resolver.list().map((e) => [e.model, e])), fallback: FALLBACK_PRICING } }
context.exports = context.module.exports
context.globalThis = context
runInNewContext(result.outputFiles[0].text, context)

const totals = { uncachedInputTokens: 1, cacheReadTokens: 1, cacheWriteTokens: 1, outputTokens: 1 }
function render(currency, locale, model = 'claude-opus-5-5', unpriced = false) {
  context.__meta = { currency, cnyPerUsd: 7.3 }
  return renderToStaticMarkup(createElement(context.module.exports.UsagePanel, {
    locale, history: { status: 'ok', rounds: [], compactions: [] }, totals, model,
    costSplitTotal: { input: 1, cacheRead: 2, output: 3, total: 6, estimated: unpriced, unpriced },
    observedRounds: [], balanceStatus: 'idle', balanceData: null, loadBalance: async () => {},
  }))
}

test('panel breakdown and HStack include cache-read cost in both currencies and locales', () => {
  for (const currency of ['cny', 'usd']) for (const locale of ['zh', 'en']) {
    const html = render(currency, locale)
    const split = html.match(/class="duc-cost-split">(.*?)<\/div>/)[1]
    const symbol = currency === 'cny' ? '¥' : '$'
    for (const n of [1, 2, 3]) assert.ok(split.includes(`${symbol}${n}.000`), split)
    // 比例必须以完整的 1+2+3 为分母，而非漏项的 1+3。
    assert.match(html, /aria-label="[^"]*17%[^"]*33%[^"]*50%"/)
    assert.ok(html.includes(`${symbol}6.000`))
  }
})

test('Claude unit prices and FX note use the same active rate; write cost is explained', () => {
  const html = render('cny', 'zh')
  assert.match(html, /未命中输入 29.2\/29.2\/1M/)
  assert.match(html, /输出 146\/146\/1M/)
  assert.match(html, /1 USD = 7.3 CNY/)
  assert.match(html, /写缓存单价 36.5\/1M/)
  assert.match(html, /5 分钟 TTL/)
  assert.doesNotMatch(html, /6\.76|27\.04|135\.2/)
  const english = render('usd', 'en')
  assert.match(english, /Cache-write price 5\/1M/)
  assert.match(english, /1 USD = 7.3 CNY/)
})

test('native dual-currency prices stay native; unpriced models never advertise zero unit prices', () => {
  assert.match(render('cny', 'zh', 'deepseek-flash'), /未命中输入 1\/2\/1M/)
  assert.match(render('cny', 'zh', 'deepseek-flash'), /显式双币种报价保留原价/)
  const html = render('usd', 'en', 'claude-opus-5-6', true)
  assert.match(html, /Unpriced model/)
  assert.match(html, /lower bound/)
  assert.doesNotMatch(html, /List price|Cache-write price/)
})
