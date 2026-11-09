import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'esbuild'
import * as host from '../lib/index.js'

async function loadClient(path) {
  const result = await build({ entryPoints: [path], bundle: true, write: false, format: 'esm', platform: 'node' })
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`)
}
const client = await loadClient('src/client/pricing-api.ts')
const prices = (output) => ({ cacheMissInput: 4, cacheHitInput: 0.2, output, cacheWrite: 5 })
const usage = { uncachedInputTokens: 1e6, cacheReadTokens: 1e6, cacheWriteTokens: 1e6, outputTokens: 1e6 }
const tableFor = (resolver) => client.tableOf({ ok: true, models: resolver.list(), fallback: { pricing: host.FALLBACK_PRICING, verifiedAt: null } })

async function withFile(entries, run) {
  const dir = await mkdtemp(join(tmpdir(), 'duc-consistency-'))
  const file = join(dir, 'pricing.json')
  await writeFile(file, JSON.stringify(entries))
  const source = host.filePricingSource(file)
  try { await source.ready(); await run(source, file) }
  finally { source.dispose(); await rm(dir, { recursive: true, force: true }) }
}

test('real snapshot preserves file priority before exact/longest matching', async () => {
  await withFile({ 'deepseek-v4': { cny: prices(99), usd: prices(99) }, 'deepseek-v4-flash': { cny: prices(77), usd: prices(77) } }, async (source) => {
    const resolver = host.createPricingResolver(source)
    for (const entries of [resolver.list(), resolver.list().reverse()]) {
      const table = client.tableOf({ ok: true, models: entries, fallback: { pricing: host.FALLBACK_PRICING, verifiedAt: null } })
      for (const model of ['deepseek-v4-pro', 'deepseek-v4-pro-x', 'deepseek-v4-flash-x', 'deepseek-flash', 'unknown', 'claude-opus-5.5-20261101', 'claude-opus-5-6']) {
        const h = resolver.resolve(model), c = client.resolvePricing(table, model)
        for (const key of ['pricing', 'source', 'verifiedAt', 'known', 'unpriced']) assert.deepEqual(c[key], h[key], `${model}: ${key}`)
      }
    }
  })
})

test('all single-currency prices share the supplied FX rate; native dual quotes stay unchanged', async () => {
  await withFile({ 'custom-usd': { usd: prices(20) }, 'custom-cny': prices(20), 'mixed': { peak: { usd: prices(20) }, offPeak: { cny: prices(30), usd: prices(7) } } }, async (source) => {
    for (const rate of [6.76, 7.3, 8]) {
      const resolver = host.createPricingResolver(source, rate), table = tableFor(resolver)
      for (const model of ['claude-opus-5-5', 'custom-usd', 'custom-cny', 'mixed', 'deepseek-v4-pro']) {
        const h = resolver.resolve(model), c = client.resolvePricing(table, model, rate)
        assert.deepEqual(c.pricing, h.pricing, model)
        for (const currency of ['usd', 'cny']) assert.deepEqual(client.resolveCost(table, usage, model, 0, currency, rate).split, host.costSplitAt(usage, h.pricing, 0, currency))
      }
      assert.equal(resolver.resolve('claude-opus-5-5').pricing.offPeak.cny.output, 20 * rate)
      assert.equal(resolver.resolve('custom-usd').pricing.offPeak.cny.cacheWrite, 5 * rate)
      assert.equal(resolver.resolve('custom-cny').pricing.offPeak.usd.output, 20 / rate)
      assert.equal(resolver.resolve('mixed').pricing.peak.cny.output, 20 * rate)
      assert.equal(resolver.resolve('mixed').pricing.offPeak.cny.output, 30)
      assert.deepEqual(resolver.resolve('deepseek-v4-pro').pricing, host.PRICING['deepseek-v4-pro'])
    }
    // 更换汇率不能在上次折算值上继续乘；更不能修改内置/文件源对象。
    const table = tableFor(host.createPricingResolver(source, 8))
    assert.equal(client.resolvePricing(table, 'custom-usd', 7.3).pricing.offPeak.cny.output, 146)
    assert.equal(client.resolvePricing(table, 'custom-usd', 8).pricing.offPeak.usd.output, 20)
  })
})

function recorder() {
  return { status: 0, setHeader() {}, writeHead(status) { this.status = status }, end(body) { this.body = JSON.parse(body) } }
}

test('/usage uses one validated display FX rate for historical rounds and compactions', async () => {
  await withFile({}, async (_source, file) => {
    const routes = new Map(), disposers = []
    const events = [
      { type: 'turn/start', seq: 1, time: 1000, data: { turn: 1 } },
      { type: 'request/context', seq: 2, time: 1001, data: { turn: 1, step: 0, model: 'claude-opus-5-5' } },
      { type: 'assistant/message', seq: 3, time: 1002, data: { turn: 1, step: 0, usage: { inputTokens: 1e6, outputTokens: 1e6 } } },
      { type: 'compaction/summary', seq: 4, time: 1003, data: { turn: 1, shadowedTokenCount: 100, model: 'claude-opus-5-5', usage: { inputTokens: 1e6, outputTokens: 1e6 } } },
    ]
    host.apply({ effect(setup) { disposers.push(setup()) }, get() {}, webServer: { register(route) { routes.set(route.path, route); return () => {} } }, sessions: { get() { return { events } } } }, { pricingFile: file, cnyPerUsd: 7.1 })
    try {
      for (const [query, rate] of [['', 7.1], ['&cnyPerUsd=7.3', 7.3], ['&cnyPerUsd=-1', 7.1], ['&cnyPerUsd=Infinity', 7.1], ['&cnyPerUsd=bad', 7.1]]) {
        const res = recorder()
        await routes.get('/dsh-usage-chart/usage').handler({ method: 'GET', url: `/dsh-usage-chart/usage?session=session-test${query}`, headers: { host: 'localhost', origin: 'http://localhost' } }, res)
        assert.equal(res.status, 200)
        assert.ok(Math.abs(res.body.rounds[0].cost.cny.total - 24 * rate) < 1e-9)
        assert.ok(Math.abs(res.body.compactions[0].cost.cny.total - 24 * rate) < 1e-9)
      }
    } finally { for (const dispose of disposers) dispose?.() }
  })
})

test('shared FX helper and compatibility exports preserve base prices without mutation', () => {
  const original = host.PRICING['claude-opus-5-5']
  const before = JSON.stringify(original)
  for (const rate of [7.1, 7.3, 8]) {
    assert.equal(host.pricingAtRate(original, rate).peak.cny.cacheWrite, 5 * rate)
    assert.equal(host.pricingFor('claude-opus-5-5', rate).pricing.peak.cny.output, 20 * rate)
    assert.ok(Math.abs(host.estimateCost(usage, 'claude-opus-5-5', rate).cny - 29.2 * rate) < 1e-9)
  }
  assert.equal(JSON.stringify(original), before)
  for (const invalid of [NaN, Infinity, -1, 0]) assert.equal(host.pricingAtRate(original, invalid).peak.cny.output, 20 * host.DEFAULT_CNY_PER_USD)
})

test('single-currency override parsing rejects explicit invalid pairs rather than replacing them', () => {
  const parsed = host.parsePricingFile(JSON.stringify({
    'usd-only': { usd: prices(20) },
    'cny-only': { cny: prices(20) },
    'bad-cny': { cny: { cacheMissInput: -1 }, usd: prices(20) },
    'bad-usd': { cny: prices(20), usd: { output: -1 } },
    'bad-write': { usd: { ...prices(20), cacheWrite: -1 } },
    // 用户不能靠伪造来源标记，把明确给出的两种原价变成派生报价。
    'explicit-pair': { cny: prices(50), usd: prices(20), baseCurrency: 'usd' },
  }))
  assert.equal(parsed['usd-only'].peak.baseCurrency, 'usd')
  assert.equal(parsed['cny-only'].offPeak.baseCurrency, 'cny')
  for (const key of ['bad-cny', 'bad-usd', 'bad-write']) assert.equal(parsed[key], undefined)
  assert.equal(parsed['explicit-pair'].peak.baseCurrency, undefined)
  assert.equal(host.pricingAtRate(parsed['explicit-pair'], 8).peak.cny.output, 50)
})
