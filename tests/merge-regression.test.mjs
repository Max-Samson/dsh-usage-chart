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

const [{ useSessionNodes }, { sameUsage, usageDelta, lastRoundModel, sumRoundCosts }] = await Promise.all([
  loadClientModule('../src/client/snapshot.ts'),
  loadClientModule('../src/client/rounds/summary.ts'),
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
  assert.deepEqual(sumRoundCosts(rounds, 'cny'), { input: 3, cacheRead: 0.30000000000000004, output: 3, total: 6.300000000000001, estimated: true })
  assert.deepEqual(sumRoundCosts(rounds, 'usd'), { input: 0.4, cacheRead: 0.03, output: 0.30000000000000004, total: 0.73, estimated: true })
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
