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
  costSplitAt,
  createPricingResolver,
  estimateCost,
  filePricingSource,
  parsePricingFile,
  isPeakHour,
  pricingFor,
  tierAt,
} from '../lib/index.js'

/** 2026-08-26 内置刊例价（双币种 /1M，高峰/空闲）。 */
const FLASH_OFF_PEAK = {
  cny: { cacheMissInput: 1.5, cacheHitInput: 0.05, output: 4.5 },
  usd: { cacheMissInput: 0.22, cacheHitInput: 0.007, output: 0.66 },
}
const FLASH_PEAK = {
  cny: { cacheMissInput: 3.0, cacheHitInput: 0.10, output: 9.0 },
  usd: { cacheMissInput: 0.44, cacheHitInput: 0.014, output: 1.32 },
}
const PRO_OFF_PEAK = {
  cny: { cacheMissInput: 4.5, cacheHitInput: 0.15, output: 13.5 },
  usd: { cacheMissInput: 0.66, cacheHitInput: 0.022, output: 1.98 },
}
const PRO_PEAK = {
  cny: { cacheMissInput: 9.0, cacheHitInput: 0.30, output: 27.0 },
  usd: { cacheMissInput: 1.32, cacheHitInput: 0.044, output: 3.96 },
}

test('builtin source resolves exact and prefixed models, misses unknown', () => {
  const source = builtinPricingSource()
  assert.deepEqual(source.resolve('deepseek-v4-pro').pricing.offPeak, PRO_OFF_PEAK)
  assert.deepEqual(source.resolve('deepseek-v4-pro').pricing.peak, PRO_PEAK)
  // 前缀匹配（带日期后缀的模型版本）
  assert.equal(source.resolve('deepseek-v4-flash-2026-08-01').pricing.offPeak.cny.output, 4.5)
  assert.equal(source.resolve('deepseek-v4-flash-2026-08-01').pricing.offPeak.usd.output, 0.66)
  assert.equal(source.resolve('deepseek-v4-flash-2026-08-01').pricing.peak.usd.output, 1.32)
  assert.deepEqual(source.resolve('deepseek-v4-flash-vision-exp').pricing.offPeak, FLASH_OFF_PEAK)
  assert.deepEqual(source.resolve('deepseek-v4-flash-vision-exp').pricing.peak, FLASH_PEAK)
  assert.equal(source.resolve('unknown-model').pricing, null)
  assert.equal(source.resolve('DEEPSEEK-V4-PRO').pricing.offPeak.cny.cacheMissInput, 4.5, '大小写不敏感')
})
test('tierAt and isPeakHour map timestamps to peak/off-peak by Beijing time and weekday', () => {
  // isPeakHour 单元测试（小时 + 星期）
  assert.equal(isPeakHour(10), true, '默认工作日 10:00 高峰')
  assert.equal(isPeakHour(8), false, '默认工作日 08:00 空闲')
  assert.equal(isPeakHour(12), false, '默认工作日 12:00 空闲')
  assert.equal(isPeakHour(15), true, '默认工作日 15:00 高峰')
  assert.equal(isPeakHour(10, 1), true, '周一 10:00 高峰')
  assert.equal(isPeakHour(10, 5), true, '周五 10:00 高峰')
  assert.equal(isPeakHour(10, 6), false, '周六 10:00 空闲（周末全天空闲）')
  assert.equal(isPeakHour(10, 0), false, '周日 10:00 空闲（周末全天空闲）')
  assert.equal(isPeakHour(15, 6), false, '周六 15:00 空闲')
  assert.equal(isPeakHour(15, 0), false, '周日 15:00 空闲')

  // 基准：1970-01-01T00:00:00Z = 北京时间 1970-01-01（周四）08:00（空闲）。
  const baseThursday = Date.UTC(1970, 0, 1, 0, 0, 0)
  const atBeijingThursday = (hour) => baseThursday + (hour - 8) * 3_600_000
  // 工作日高峰：09:00–12:00、14:00–18:00（北京时间 = UTC 01:00–04:00、06:00–10:00）
  assert.equal(tierAt(atBeijingThursday(9)), 'peak')
  assert.equal(tierAt(atBeijingThursday(10)), 'peak')
  assert.equal(tierAt(atBeijingThursday(11)), 'peak')
  assert.equal(tierAt(atBeijingThursday(14)), 'peak')
  assert.equal(tierAt(atBeijingThursday(17)), 'peak')
  // 工作日空闲：其余时段（含边界 12:00、13:00、18:00）
  assert.equal(tierAt(atBeijingThursday(8)), 'offPeak')
  assert.equal(tierAt(atBeijingThursday(12)), 'offPeak')
  assert.equal(tierAt(atBeijingThursday(13)), 'offPeak')
  assert.equal(tierAt(atBeijingThursday(18)), 'offPeak')
  assert.equal(tierAt(atBeijingThursday(23)), 'offPeak')

  // 周六（1970-01-03）：全天空闲
  const baseSaturday = Date.UTC(1970, 0, 3, 0, 0, 0)
  const atBeijingSaturday = (hour) => baseSaturday + (hour - 8) * 3_600_000
  assert.equal(tierAt(atBeijingSaturday(10)), 'offPeak')
  assert.equal(tierAt(atBeijingSaturday(15)), 'offPeak')

  // 周日（1970-01-04）：全天空闲
  const baseSunday = Date.UTC(1970, 0, 4, 0, 0, 0)
  const atBeijingSunday = (hour) => baseSunday + (hour - 8) * 3_600_000
  assert.equal(tierAt(atBeijingSunday(10)), 'offPeak')
  assert.equal(tierAt(atBeijingSunday(15)), 'offPeak')

  // 周一（1970-01-05）：高峰时段恢复
  const baseMonday = Date.UTC(1970, 0, 5, 0, 0, 0)
  const atBeijingMonday = (hour) => baseMonday + (hour - 8) * 3_600_000
  assert.equal(tierAt(atBeijingMonday(10)), 'peak')

  // 未知/非法时刻按高峰（保守）
  assert.equal(tierAt(null), 'peak')
  assert.equal(tierAt(undefined), 'peak')
  assert.equal(tierAt(Number.NaN), 'peak')
})

test('costSplitAt bills in both official currencies per tier', () => {
  const usage = { uncachedInputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0 }
  const offPeakAt = Date.UTC(1970, 0, 1, 0, 0, 0) // 北京时间 08:00
  const peakAt = Date.UTC(1970, 0, 1, 2, 0, 0) // 北京时间 10:00
  // 空闲：flash 未命中 1.5 + 输出 4.5（CNY）；0.22 + 0.66（USD）
  assert.deepEqual(costSplitAt(usage, PRICING['deepseek-v4-flash'], offPeakAt, 'cny'), { input: 1.5, cacheRead: 0, output: 4.5, total: 6 })
  assert.deepEqual(costSplitAt(usage, PRICING['deepseek-v4-flash'], offPeakAt, 'usd'), { input: 0.22, cacheRead: 0, output: 0.66, total: 0.88 })
  // 高峰 = 空闲 × 2
  assert.deepEqual(costSplitAt(usage, PRICING['deepseek-v4-flash'], peakAt, 'cny'), { input: 3, cacheRead: 0, output: 9, total: 12 })
  assert.deepEqual(costSplitAt(usage, PRICING['deepseek-v4-flash'], peakAt, 'usd'), { input: 0.44, cacheRead: 0, output: 1.32, total: 1.76 })
})

test('parsePricingFile validates entries and accepts dual-currency + legacy shapes', () => {
  // 新格式：{ peak: { cny, usd }, offPeak: { cny, usd } } 双时段 × 双币种显式定价
  const tiered = parsePricingFile(JSON.stringify({
    'my-model': {
      peak: { cny: { cacheMissInput: 2, cacheHitInput: 0.02, output: 4 }, usd: { cacheMissInput: 0.3, cacheHitInput: 0.003, output: 0.6 } },
      offPeak: { cny: { cacheMissInput: 1, cacheHitInput: 0.01, output: 2 }, usd: { cacheMissInput: 0.15, cacheHitInput: 0.0015, output: 0.3 } },
    },
    'bad-peak': {
      peak: { cny: { cacheMissInput: -1, cacheHitInput: 0, output: 0 }, usd: { cacheMissInput: 1, cacheHitInput: 0, output: 0 } },
      offPeak: { cny: { cacheMissInput: 1, cacheHitInput: 0, output: 0 }, usd: { cacheMissInput: 1, cacheHitInput: 0, output: 0 } },
    },
  }))
  assert.deepEqual(tiered['my-model'], {
    peak: { cny: { cacheMissInput: 2, cacheHitInput: 0.02, output: 4 }, usd: { cacheMissInput: 0.3, cacheHitInput: 0.003, output: 0.6 } },
    offPeak: { cny: { cacheMissInput: 1, cacheHitInput: 0.01, output: 2 }, usd: { cacheMissInput: 0.15, cacheHitInput: 0.0015, output: 0.3 } },
  })
  assert.equal(tiered['bad-peak'], undefined)

  // 兼容①：时段单价平铺桶价 → 视为人民币，美元按默认汇率折算
  const singleCny = parsePricingFile(JSON.stringify({
    'single-cny': {
      peak: { cacheMissInput: 2, cacheHitInput: 0.02, output: 4 },
      offPeak: { cacheMissInput: 1, cacheHitInput: 0.01, output: 2 },
    },
  }))
  assert.equal(singleCny['single-cny'].peak.cny.cacheMissInput, 2)
  assert.equal(singleCny['single-cny'].peak.usd.cacheMissInput, 2 / 6.76)
  assert.equal(singleCny['single-cny'].offPeak.cny.output, 2)
  assert.equal(singleCny['single-cny'].offPeak.usd.output, 2 / 6.76)

  // 兼容②：v0.1 平铺单价 → 高峰/空闲同价、人民币 + 折算美元
  const flat = parsePricingFile(JSON.stringify({
    'legacy-model': { cacheMissInput: 1, cacheHitInput: 0.02, output: 2 },
    'no-output': { cacheMissInput: 1 },
  }))
  assert.deepEqual(flat['legacy-model'], {
    peak: { cny: { cacheMissInput: 1, cacheHitInput: 0.02, output: 2 }, usd: { cacheMissInput: 1 / 6.76, cacheHitInput: 0.02 / 6.76, output: 2 / 6.76 } },
    offPeak: { cny: { cacheMissInput: 1, cacheHitInput: 0.02, output: 2 }, usd: { cacheMissInput: 1 / 6.76, cacheHitInput: 0.02 / 6.76, output: 2 / 6.76 } },
  })
  assert.equal(flat['no-output'], undefined)

  const nested = parsePricingFile(JSON.stringify({
    models: {
      'nested-model': {
        peak: { cny: { cacheMissInput: 3, cacheHitInput: 0.03, output: 4 }, usd: { cacheMissInput: 0.44, cacheHitInput: 0.0044, output: 0.59 } },
        offPeak: { cny: { cacheMissInput: 1.5, cacheHitInput: 0.015, output: 2 }, usd: { cacheMissInput: 0.22, cacheHitInput: 0.0022, output: 0.29 } },
        verifiedAt: 1_700_000_000_000,
      },
    },
  }))
  assert.equal(nested['nested-model'].peak.cny.cacheMissInput, 3)
  assert.equal(nested['nested-model'].peak.usd.cacheMissInput, 0.44)
  assert.equal(nested['nested-model'].verifiedAt, 1_700_000_000_000)

  assert.deepEqual(parsePricingFile('not json'), {})
})

test('resolver prefers file override over builtin and marks unknown models', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'duc-pricing-'))
  const file = join(dir, 'pricing.json')
  await writeFile(file, JSON.stringify({
    'deepseek-v4-flash': {
      peak: { cny: { cacheMissInput: 19.98, cacheHitInput: 0.02, output: 1.0 }, usd: { cacheMissInput: 2.96, cacheHitInput: 0.003, output: 0.15 } },
      offPeak: { cny: { cacheMissInput: 9.99, cacheHitInput: 0.01, output: 0.5 }, usd: { cacheMissInput: 1.48, cacheHitInput: 0.0015, output: 0.074 } },
      verifiedAt: 1_800_000_000_000,
    },
    'custom-model': { cacheMissInput: 1, cacheHitInput: 0.02, output: 2 },
  }))

  const source = filePricingSource(file)
  const resolver = createPricingResolver(source)
  try {
    await source.ready()
    // 文件覆盖内置
    const flash = resolver.resolve('deepseek-v4-flash')
    assert.equal(flash.source, 'file')
    assert.equal(flash.pricing.offPeak.cny.cacheMissInput, 9.99)
    assert.equal(flash.pricing.peak.cny.cacheMissInput, 19.98)
    assert.equal(flash.pricing.peak.usd.cacheMissInput, 2.96)
    assert.equal(flash.verifiedAt, 1_800_000_000_000)
    assert.equal(flash.known, true)
    // 内置未覆盖的模型仍命中内置
    const pro = resolver.resolve('deepseek-v4-pro')
    assert.equal(pro.source, 'builtin')
    assert.deepEqual(pro.pricing.offPeak, PRO_OFF_PEAK)
    // 文件专属模型（v0.1 平铺 → 高峰/空闲同价，美元按默认汇率折算）
    assert.equal(resolver.resolve('custom-model').pricing.peak.cny.output, 2)
    assert.equal(resolver.resolve('custom-model').pricing.offPeak.cny.output, 2)
    assert.equal(resolver.resolve('custom-model').pricing.offPeak.usd.output, 2 / 6.76)
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
    assert.equal(source.resolve('v4-flash-x1').pricing.offPeak.cny.cacheMissInput, 1)
    // 重写文件后 reload 应能读到新值（不依赖监听器时序）
    await writeFile(file, JSON.stringify({ 'v4-flash': { cacheMissInput: 7, cacheHitInput: 0.01, output: 2 } }))
    await source.reload()
    assert.equal(source.resolve('v4-flash').pricing.offPeak.cny.cacheMissInput, 7)
  } finally {
    source.dispose()
    await rm(dir, { recursive: true, force: true })
  }
})

test('estimateCost / pricingFor keep v0.1 compat semantics', () => {
  assert.deepEqual(PRICING['deepseek-v4-flash'], { peak: FLASH_PEAK, offPeak: FLASH_OFF_PEAK })
  // 时刻未知 → 按高峰价保守估算：1M 未命中输入 + 1M 输出（v4-pro 高峰 CNY = 9 + 27）
  assert.equal(estimateCost({ uncachedInputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0 }, 'deepseek-v4-pro').cny, 36)
  assert.equal(pricingFor('deepseek-v4-flash').estimated, false)
  assert.equal(pricingFor('unknown-model').estimated, true)
  assert.equal(BUILTIN_VERIFIED_AT, Date.parse('2026-08-26T00:00:00Z'))
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
  assert.equal(body.fallback.pricing.offPeak.cny.output, 4.5)
  assert.equal(body.fallback.pricing.offPeak.usd.output, 0.66)
  assert.equal(body.fallback.pricing.peak.usd.output, 1.32)
  const models = body.models.map((m) => m.model)
  assert.ok(models.includes('deepseek-v4-flash'))
  assert.ok(models.includes('deepseek-v4-pro'))
  assert.ok(models.includes('deepseek-v4-flash-vision-exp'))
})
