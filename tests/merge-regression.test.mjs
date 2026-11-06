import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

async function loadClientModule(path) {
  const result = await build({
    entryPoints: [fileURLToPath(new URL(path, import.meta.url))],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: 'node20',
  })
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`)
}

const [{ useSessionNodes, nodeModelName }, { sameUsage, usageDelta, lastRoundModel, sumRoundCosts, costTotalPrefix }, { resolvePricing, resolveCost }] = await Promise.all([
  loadClientModule('../src/client/snapshot.ts'),
  loadClientModule('../src/client/rounds/summary.ts'),
  loadClientModule('../src/client/pricing-api.ts'),
])

test('chat nodes take priority in DSH 0.1.2+ while both hooks keep a stable call order', () => {
  const calls = []
  const chatNodes = [{ kind: 'assistant', turn: 2, messageId: 'new' }]
  const oldNodes = [{ kind: 'assistant', turn: 1, messageId: 'old' }]
  const nodes = useSessionNodes(
    (selector) => { calls.push('chat'); return selector({ legacy: { nodes: chatNodes } }) },
    (selector) => { calls.push('session'); return selector({ nodes: oldNodes }) },
  )
  assert.equal(nodes, chatNodes)
  assert.deepEqual(calls, ['chat', 'session'])
})

test('node model identity reads 0.1.x provenance, 0.2.x providerMetadata, then requestConfig', () => {
  const base = { kind: 'assistant', seq: 1, turn: 1 }
  // DSH 0.2.x 节点：provenance 已改名为 providerMetadata
  assert.equal(nodeModelName({ ...base, providerMetadata: { provider: 'deepseek', model: 'deepseek-v4-pro' }, requestConfig: { model: 'deepseek-flash' } }), 'deepseek-v4-pro')
  // DSH 0.1.x 节点：provenance 仍优先
  assert.equal(nodeModelName({ ...base, provenance: { provider: 'deepseek', model: 'deepseek-flash' }, providerMetadata: { provider: 'x', model: 'other' } }), 'deepseek-flash')
  // 只有请求配置时回退 requestConfig；空字符串不算模型
  assert.equal(nodeModelName({ ...base, providerMetadata: { provider: 'deepseek', model: '' }, requestConfig: { model: 'deepseek-flash' } }), 'deepseek-flash')
  assert.equal(nodeModelName(base), undefined)
})

test('session nodes remain available when the chat source is absent or empty', () => {
  const oldNodes = [{ kind: 'assistant', turn: 1, messageId: 'old' }]
  const useSession = (selector) => selector({ chat: { legacy: { nodes: oldNodes } }, nodes: [] })
  assert.equal(useSessionNodes(undefined, useSession), oldNodes)
  assert.equal(useSessionNodes((selector) => selector({ legacy: { nodes: [] } }), useSession), oldNodes)
  assert.equal(useSessionNodes(undefined, (selector) => selector({ nodes: oldNodes, running: false })), oldNodes)
})

test('fresh host usage drives model and cost; changed live usage invalidates that cost', () => {
  const usage = { uncachedInputTokens: 5, cacheReadTokens: 2, cacheWriteTokens: 0, outputTokens: 3 }
  assert.equal(sameUsage(usage, { ...usage }), true)
  assert.equal(sameUsage(usage, { ...usage, outputTokens: 4 }), false)
  assert.deepEqual(usageDelta(usage, { ...usage, outputTokens: 1 }), { ...usage, uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 2 })
  assert.equal(usageDelta(usage, { ...usage, outputTokens: 4 }), null)
  assert.equal(lastRoundModel([{ model: 'deepseek-v4-pro' }, { model: null }]), 'deepseek-v4-pro')
})

test('session cost sums each round in its own currency and carries the estimate flag', () => {
  const rounds = [
    { cost: { cny: { input: 2, cacheRead: 0.1, output: 1, total: 3.1 }, usd: { input: 0.3, cacheRead: 0.01, output: 0.1, total: 0.41 }, estimated: false } },
    { cost: { cny: { input: 1, cacheRead: 0.2, output: 2, total: 3.2 }, usd: { input: 0.1, cacheRead: 0.02, output: 0.2, total: 0.32 }, estimated: true } },
  ]
  assert.deepEqual(sumRoundCosts(rounds, 'cny'), { input: 3, cacheRead: 0.30000000000000004, output: 3, total: 6.300000000000001, estimated: true, unpriced: false })
  assert.deepEqual(sumRoundCosts(rounds, 'usd'), { input: 0.4, cacheRead: 0.03, output: 0.30000000000000004, total: 0.73, estimated: true, unpriced: false })
  assert.equal(sumRoundCosts([], 'cny'), null)
  assert.equal(sumRoundCosts([...rounds, { cost: null }], 'cny'), null)
})

async function loadIndicator() {
  const mocks = new Map([
    ['react', 'import { useEffect, useMemo, useRef, useState } from "react"; export { useEffect, useMemo, useRef, useState }; export const useLayoutEffect = useEffect'],
    ['./balance.ts', 'export const currencySymbol = () => "$"; export const useBalance = () => ({ status: "idle", data: null, load: async () => {} })'],
    ['./currency.ts', 'export const useDisplayCurrency = () => ({ currency: "usd" })'],
    ['./i18n.ts', 'export const useUiLocale = () => "en"; export const getUiCopy = () => ({ input: "Input", output: "Output", cache: "Cache", cost: "Cost", balance: "Balance", usage: "Usage", expandUsage: "Expand", collapseUsage: "Collapse", officialBalanceTitle: "Balance" })'],
    ['./pricing-api.ts', 'export const usePricing = () => ({ table: {} }); export const resolveCost = (_table, usage) => ({ split: { input: 0, cacheRead: 0, output: usage.outputTokens * 0.1, total: usage.outputTokens * 0.1 }, estimated: false })'],
    ['./rounds/history.ts', 'export const useHistoryRounds = () => globalThis.__testHistory'],
    ['./rounds/observed.ts', 'export const useObservedRounds = () => []'],
    ['./UsagePanel.tsx', 'export const UsagePanel = () => null'],
  ])
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/client/UsageIndicator.tsx', import.meta.url))],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node',
    target: 'node20',
    external: ['react', 'react/jsx-runtime'],
    plugins: [{
      name: 'indicator-dependencies',
      setup(pluginBuild) {
        pluginBuild.onResolve({ filter: /^(?:\.\/|react$)/ }, (args) => {
          if (args.importer.endsWith('UsageIndicator.tsx') && mocks.has(args.path)) {
            return { path: args.path, namespace: 'indicator-mock' }
          }
        })
        pluginBuild.onLoad({ filter: /.*/, namespace: 'indicator-mock' }, (args) => ({ contents: mocks.get(args.path), loader: 'ts' }))
      },
    }],
  })
  const context = { module: { exports: {} }, require: createRequire(import.meta.url), __testHistory: null }
  context.exports = context.module.exports
  runInNewContext(result.outputFiles[0].text, context)
  return { UsageIndicator: context.module.exports.UsageIndicator, context }
}

test('indicator consumes chat nodes and keeps the panel cost source current', async () => {
  const { UsageIndicator, context } = await loadIndicator()
  const usage = { uncachedInputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 2 }
  const round = { model: 'deepseek-v4-pro', cost: { usd: { input: 0.5, cacheRead: 0, output: 0, total: 0.5 }, estimated: false } }
  const props = {
    sessionId: 'test',
    useChat: (selector) => selector({ legacy: { nodes: [{ kind: 'assistant', turn: 1, provenance: { model: 'deepseek-flash' } }] } }),
    useSession: (selector) => selector({ nodes: [{ kind: 'assistant', turn: 1, provenance: { model: 'legacy-model' } }] }),
    useProjection: (key) => key === 'tokenUsage' ? usage : undefined,
  }

  context.__testHistory = { status: 'ok', rounds: [round], totals: usage, compactions: [], load: async () => {} }
  const current = renderToStaticMarkup(createElement(UsageIndicator, props))
  assert.match(current, /v4-pro/)
  assert.doesNotMatch(current, /legacy-model|deepseek-flash/)
  assert.match(current, /\$0\.500/)

  context.__testHistory = { ...context.__testHistory, totals: { ...usage, outputTokens: 1 } }
  const stale = renderToStaticMarkup(createElement(UsageIndicator, props))
  assert.match(stale, /flash/)
  assert.doesNotMatch(stale, /legacy-model|v4-pro|\$0\.500/)
  assert.match(stale, /≈\$0\.600/)
})

// ── client 价格快照解析（与 host resolver 同一匹配/未定价规则）──────────────
const flat = (output) => {
  const prices = { cacheMissInput: 1, cacheHitInput: 0.1, output }
  return { peak: { cny: prices, usd: prices }, offPeak: { cny: prices, usd: prices } }
}
const FLASH = flat(0.6)
const pricingTable = {
  entries: {
    'claude-opus-5': { pricing: flat(25), source: 'builtin', verifiedAt: 1 },
    'claude-opus-5-5': { pricing: flat(20), source: 'builtin', verifiedAt: 1 },
    'deepseek-flash': { pricing: FLASH, source: 'builtin', verifiedAt: 1 },
  },
  fallback: FLASH,
  fallbackVerifiedAt: null,
  builtinVerifiedAt: 1,
}

test('client resolvePricing: longest key, Claude snapshot suffix only, unpriced Claude', () => {
  assert.equal(resolvePricing(pricingTable, 'claude-opus-5-5-20261101').pricing.offPeak.usd.output, 20)
  assert.equal(resolvePricing(pricingTable, 'anthropic/claude-opus-5.5').pricing.offPeak.usd.output, 20)
  assert.equal(resolvePricing(pricingTable, 'claude-opus-5-20260601').pricing.offPeak.usd.output, 25)
  for (const model of ['claude-opus-5-6', 'anthropic.claude-opus-5-5', 'us.anthropic.claude-sonnet-4-5-20250929-v1:0', 'Claude Opus 5.5']) {
    const r = resolvePricing(pricingTable, model)
    assert.equal(r.known, false, model)
    assert.equal(r.unpriced, true, model)
    assert.equal(r.pricing.offPeak.usd.output, 0, model + ' 不套 DeepSeek 回退价')
  }
  const deepseek = resolvePricing(pricingTable, 'deepseek-v9')
  assert.equal(deepseek.pricing, FLASH)
  assert.equal(deepseek.unpriced, false)
  const usage = { uncachedInputTokens: 1e6, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 1e6 }
  const cost = resolveCost(pricingTable, usage, 'claude-haiku-5-5', 0, 'usd')
  assert.equal(cost.unpriced, true)
  assert.equal(cost.split.total, 0)
})

test('sumRoundCosts marks totals with unpriced rounds as a lower bound', () => {
  const split = (total) => ({ input: total, cacheRead: 0, output: 0, total })
  const mk = (turn, total, extra = {}) => ({ turn, cost: { cny: split(total), usd: split(total), estimated: false, unknownModel: false, source: 'builtin', verifiedAt: 1, ...extra } })
  const priced = sumRoundCosts([mk(1, 1), mk(2, 2)], 'usd')
  assert.equal(priced.unpriced, false)
  assert.equal(costTotalPrefix(priced), '')
  const mixed = sumRoundCosts([mk(1, 1), mk(2, 0, { estimated: true, unknownModel: true, unpriced: true, source: 'fallback' })], 'usd')
  assert.equal(mixed.total, 1)
  assert.equal(mixed.unpriced, true)
  assert.equal(costTotalPrefix(mixed), '≥')
  // 旧 host 未下发 unpriced：视为 false，仅回退估算显示 ≈
  const legacy = sumRoundCosts([mk(1, 1, { estimated: true, unknownModel: true, source: 'fallback' })], 'usd')
  assert.equal(legacy.unpriced, false)
  assert.equal(costTotalPrefix(legacy), '≈')
})
