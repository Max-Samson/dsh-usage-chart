import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  BUILTIN_VERIFIED_AT,
  PRICING,
  apply,
  builtinPricingSource,
  createPricingResolver,
  estimateCost,
  filePricingSource,
  parsePricingFile,
  pricingFor,
} from '../lib/index.js'

test('builtin source resolves exact and prefixed models, misses unknown', () => {
  const source = builtinPricingSource()
  assert.equal(source.resolve('deepseek-v4-pro').pricing.cacheMissInput, 0.435)
  assert.equal(source.resolve('deepseek-v4-flash-2026-08-01').pricing.output, 0.28)
  assert.equal(source.resolve('unknown-model').pricing, null)
  assert.equal(source.resolve('DEEPSEEK-V4-PRO').pricing.cacheMissInput, 0.435, '大小写不敏感')
})

test('parsePricingFile validates entries and accepts both shapes', () => {
  const flat = parsePricingFile(JSON.stringify({
    'my-model': { cacheMissInput: 1, cacheHitInput: 0.02, output: 2 },
    'bad-model': { cacheMissInput: -1, cacheHitInput: 0, output: 0 },
    'no-output': { cacheMissInput: 1 },
  }))
  assert.deepEqual(flat['my-model'], { cacheMissInput: 1, cacheHitInput: 0.02, output: 2 })
  assert.equal(flat['bad-model'], undefined)
  assert.equal(flat['no-output'], undefined)

  const nested = parsePricingFile(JSON.stringify({ models: { 'nested-model': { cacheMissInput: 3, cacheHitInput: 0.03, output: 4, verifiedAt: 1_700_000_000_000 } } }))
  assert.equal(nested['nested-model'].cacheMissInput, 3)
  assert.equal(nested['nested-model'].verifiedAt, 1_700_000_000_000)

  assert.deepEqual(parsePricingFile('not json'), {})
})

test('resolver prefers file override over builtin and marks unknown models', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'duc-pricing-'))
  const file = join(dir, 'pricing.json')
  await writeFile(file, JSON.stringify({
    'deepseek-v4-flash': { cacheMissInput: 9.99, cacheHitInput: 0.01, output: 0.5, verifiedAt: 1_800_000_000_000 },
    'custom-model': { cacheMissInput: 1, cacheHitInput: 0.02, output: 2 },
  }))

  const source = filePricingSource(file)
  const resolver = createPricingResolver(source)
  try {
    await source.ready()
    // 文件覆盖内置
    const flash = resolver.resolve('deepseek-v4-flash')
    assert.equal(flash.source, 'file')
    assert.equal(flash.pricing.cacheMissInput, 9.99)
    assert.equal(flash.verifiedAt, 1_800_000_000_000)
    assert.equal(flash.known, true)
    // 内置未覆盖的模型仍命中内置
    const pro = resolver.resolve('deepseek-v4-pro')
    assert.equal(pro.source, 'builtin')
    assert.equal(pro.pricing.cacheMissInput, 0.435)
    // 文件专属模型
    assert.equal(resolver.resolve('custom-model').pricing.output, 2)
    // 未知模型 → 回退 + 显式标记
    const unknown = resolver.resolve('no-such-model')
    assert.equal(unknown.source, 'fallback')
    assert.equal(unknown.known, false)
    assert.equal(unknown.estimated, true)
    // 快照 = 内置 ∪ 文件
    const models = resolver.list().map((m) => m.model)
    assert.ok(models.includes('deepseek-v4-flash'))
    assert.ok(models.includes('deepseek-v4-pro'))
    assert.ok(models.includes('custom-model'))
  } finally {
    source.dispose()
    await rm(dir, { recursive: true, force: true })
  }
})

test('file source serves prefix matches and refresh after rewrite', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'duc-pricing-'))
  const file = join(dir, 'pricing.json')
  await writeFile(file, JSON.stringify({ 'v4-flash': { cacheMissInput: 1, cacheHitInput: 0.01, output: 2 } }))

  const source = filePricingSource(file)
  try {
    await source.ready()
    assert.equal(source.resolve('v4-flash-x1').pricing.cacheMissInput, 1)
    // 重写文件后 reload 应能读到新值（不依赖监听器时序）
    await writeFile(file, JSON.stringify({ 'v4-flash': { cacheMissInput: 7, cacheHitInput: 0.01, output: 2 } }))
    await source.reload()
    assert.equal(source.resolve('v4-flash').pricing.cacheMissInput, 7)
  } finally {
    source.dispose()
    await rm(dir, { recursive: true, force: true })
  }
})

test('estimateCost / pricingFor keep v0.1 compat semantics', () => {
  assert.deepEqual(PRICING['deepseek-v4-flash'], { cacheMissInput: 0.14, cacheHitInput: 0.0028, output: 0.28 })
  assert.equal(estimateCost({ uncachedInputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0 }, 'deepseek-v4-pro').usd, 1.305)
  assert.equal(pricingFor('deepseek-v4-flash').estimated, false)
  assert.equal(pricingFor('unknown-model').estimated, true)
  assert.equal(BUILTIN_VERIFIED_AT, Date.parse('2026-08-12T00:00:00Z'))
})

function responseRecorder() {
  return {
    headers: {},
    status: 0,
    body: '',
    setHeader(name, value) { this.headers[name] = value },
    writeHead(status, headers) { this.status = status; Object.assign(this.headers, headers) },
    end(body) { this.body = body ?? '' },
  }
}

test('/pricing route exposes builtin + fallback + models snapshot', async () => {
  const routes = new Map()
  apply({
    effect(setup) { setup() },
    get() { return undefined },
    webServer: { register(route) { routes.set(route.path, route); return () => {} } },
    sessions: { get() { return undefined } },
  })

  const route = routes.get('/dsh-usage-chart/pricing')
  const recorder = responseRecorder()
  await route.handler({ method: 'GET', url: '/dsh-usage-chart/pricing', headers: { host: 'localhost:3000' } }, recorder)
  assert.equal(recorder.status, 200)
  const body = JSON.parse(recorder.body)
  assert.equal(body.ok, true)
  assert.equal(body.builtinVerifiedAt, BUILTIN_VERIFIED_AT)
  assert.equal(body.fallback.pricing.output, 0.28)
  const models = body.models.map((m) => m.model)
  assert.ok(models.includes('deepseek-v4-flash'))
  assert.ok(models.includes('deepseek-v4-pro'))
})
