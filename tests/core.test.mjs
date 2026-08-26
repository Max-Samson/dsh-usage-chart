import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_CNY_PER_USD,
  PRICING,
  apply,
  cacheHitPercent,
  estimateCost,
  foldTurnUsage,
  formatMoney,
  formatPricePerM,
  isTrustedRequest,
  normalizeBaseUrl,
  normalizeCnyPerUsd,
  normalizeCurrency,
} from '../lib/index.js'

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

function mountedRoutes(events = [], config = {}) {
  const routes = new Map()
  apply({
    effect(setup) { setup() },
    get() { return undefined },
    webServer: {
      register(route) { routes.set(route.path, route); return () => {} },
    },
    sessions: {
      get(id) { return id === 'session-test' ? { id, events } : undefined },
    },
  }, config)
  return routes
}

test('foldTurnUsage replaces duplicate samples and sums completed steps', () => {
  const events = [
    { type: 'assistant/chunk', seq: 1, data: { turn: 1, step: 0, chunk: { type: 'usage', usage: { inputTokens: 10, outputTokens: 2, cacheReadTokens: 3 } } } },
    { type: 'assistant/message', seq: 2, data: { turn: 1, step: 0, usage: { inputTokens: 12, outputTokens: 4, cacheReadTokens: 5 } } },
    { type: 'assistant/message', seq: 3, data: { turn: 1, step: 1, usage: { inputTokens: 7, outputTokens: 1 } } },
    { type: 'assistant/message', seq: 4, data: { turn: 2, step: 0, usage: { inputTokens: 3, outputTokens: 2, cacheWriteTokens: 1 } } },
  ]

  assert.deepEqual(foldTurnUsage(events), {
    totals: { uncachedInputTokens: 22, outputTokens: 7, cacheReadTokens: 5, cacheWriteTokens: 1 },
    turns: [
      { turn: 1, buckets: { uncachedInputTokens: 19, outputTokens: 5, cacheReadTokens: 5, cacheWriteTokens: 0 } },
      { turn: 2, buckets: { uncachedInputTokens: 3, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 1 } },
    ],
  })
})

test('foldTurnUsage ignores malformed or negative usage samples', () => {
  const events = [
    { type: 'assistant/message', seq: 1, data: { turn: 1, step: 0, usage: { inputTokens: -1, outputTokens: 2 } } },
    { type: 'assistant/message', seq: 2, data: { turn: 1, step: 1, usage: { inputTokens: '10', outputTokens: 2 } } },
    { type: 'assistant/message', seq: 3, data: { turn: 1, step: 2, usage: null } },
  ]
  assert.deepEqual(foldTurnUsage(events), {
    totals: { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    turns: [],
  })
})

test('pricing matches the documented DeepSeek V4 prices (CNY + USD, peak/off-peak)', () => {
  assert.deepEqual(PRICING['deepseek-v4-flash'], {
    offPeak: {
      cny: { cacheMissInput: 1.5, cacheHitInput: 0.05, output: 4.5 },
      usd: { cacheMissInput: 0.22, cacheHitInput: 0.007, output: 0.66 },
    },
    peak: {
      cny: { cacheMissInput: 3.0, cacheHitInput: 0.10, output: 9.0 },
      usd: { cacheMissInput: 0.44, cacheHitInput: 0.014, output: 1.32 },
    },
  })
  assert.deepEqual(PRICING['deepseek-v4-flash-vision-exp'], PRICING['deepseek-v4-flash'])
  assert.equal(cacheHitPercent({ uncachedInputTokens: 50, outputTokens: 0, cacheReadTokens: 50, cacheWriteTokens: 0 }), 50)
  // 时刻未知 → 高峰价保守估算：1M 未命中输入 + 1M 输出（v4-pro 高峰 CNY = 9 + 27）
  assert.equal(estimateCost({ uncachedInputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0 }, 'deepseek-v4-pro').cny, 36)
})

test('normalizeBaseUrl accepts HTTPS and loopback HTTP only', () => {
  assert.equal(normalizeBaseUrl(undefined), 'https://api.deepseek.com')
  assert.equal(normalizeBaseUrl('https://proxy.example/v1/'), 'https://proxy.example/v1')
  assert.equal(normalizeBaseUrl('http://127.0.0.1:8080/'), 'http://127.0.0.1:8080')
  assert.throws(() => normalizeBaseUrl('http://proxy.example'))
  assert.throws(() => normalizeBaseUrl('https://user:pass@proxy.example'))
})

test('isTrustedRequest allows same-origin GET and rejects cross-origin or mutation requests', () => {
  assert.equal(isTrustedRequest({ method: 'GET', headers: { host: 'localhost:3000', origin: 'http://localhost:3000', 'sec-fetch-site': 'same-origin' } }), true)
  assert.equal(isTrustedRequest({ method: 'GET', headers: { host: 'localhost:3000', origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' } }), false)
  assert.equal(isTrustedRequest({ method: 'POST', headers: { host: 'localhost:3000' } }), false)
})

test('mounted Host routes enforce method and browser-origin guards', async () => {
  const route = mountedRoutes().get('/dsh-usage-chart/usage')

  const methodResponse = responseRecorder()
  await route.handler({ method: 'POST', url: '/dsh-usage-chart/usage?session=session-test', headers: { host: 'localhost:3000' } }, methodResponse)
  assert.equal(methodResponse.status, 405)
  assert.equal(methodResponse.headers.Allow, 'GET')

  const originResponse = responseRecorder()
  await route.handler({ method: 'GET', url: '/dsh-usage-chart/usage?session=session-test', headers: { host: 'localhost:3000', origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' } }, originResponse)
  assert.equal(originResponse.status, 403)

  const okResponse = responseRecorder()
  await route.handler({ method: 'GET', url: '/dsh-usage-chart/usage?session=session-test', headers: { host: 'localhost:3000', origin: 'http://localhost:3000', 'sec-fetch-site': 'same-origin' } }, okResponse)
  assert.equal(okResponse.status, 200)
  assert.equal(okResponse.headers['Cache-Control'], 'no-store')
  assert.equal(JSON.parse(okResponse.body).ok, true)
})

/** 余额路由：baseUrl 指向回环拒绝端口，避免真实网络请求；用 apiKeyConfigured 判断密钥是否解析到。 */
async function balanceResponse(extraCtx = {}, config = {}) {
  const routes = new Map()
  apply({
    effect(setup) { setup() },
    get(name) { return name === 'credentials' ? extraCtx.credentials : undefined },
    webServer: { register(route) { routes.set(route.path, route); return () => {} } },
    sessions: { get() { return undefined } },
    ...extraCtx,
  }, { baseUrl: 'http://127.0.0.1:1', ...config })
  const route = routes.get('/dsh-usage-chart/balance')
  const recorder = responseRecorder()
  await route.handler({ method: 'GET', url: '/dsh-usage-chart/balance', headers: { host: 'localhost:3000' } }, recorder)
  return { recorder, body: JSON.parse(recorder.body) }
}

test('balance route resolves the API key through the credentials service', async () => {
  const { recorder, body } = await balanceResponse({
    credentials: { resolve: async (ref) => ref === 'DEEPSEEK_API_KEY' ? { value: 'sk-test', source: 'user' } : undefined },
  })
  assert.equal(recorder.status, 200)
  assert.equal(body.apiKeyConfigured, true, 'credentials 服务提供的密钥应被解析到')
  assert.equal(body.reason, 'request-failed') // 回环端口拒绝连接：证明拿到了密钥并尝试了请求
})

test('balance route prefers config.apiKey over the credentials service', async () => {
  const { body } = await balanceResponse(
    { credentials: { resolve: async () => { throw new Error('should not be called') } } },
    { apiKey: 'sk-from-config' },
  )
  assert.equal(body.apiKeyConfigured, true)
})

/** 临时移除/恢复 process.env.DEEPSEEK_API_KEY，隔离「无密钥」用例与宿主环境。 */
function withEnvKey(value, run) {
  const previous = process.env.DEEPSEEK_API_KEY
  if (value === undefined) delete process.env.DEEPSEEK_API_KEY
  else process.env.DEEPSEEK_API_KEY = value
  return Promise.resolve().then(run).finally(() => {
    if (previous === undefined) delete process.env.DEEPSEEK_API_KEY
    else process.env.DEEPSEEK_API_KEY = previous
  })
}

test('balance route reports no-api-key when no key is configured anywhere', async () => {
  await withEnvKey(undefined, async () => {
    const { recorder, body } = await balanceResponse()
    assert.equal(recorder.status, 200)
    assert.equal(body.apiKeyConfigured, false)
    assert.equal(body.reason, 'no-api-key')
  })
})

test('balance route falls back to $DEEPSEEK_API_KEY when no credentials/config key exists', async () => {
  await withEnvKey('sk-env-test', async () => {
    const { recorder, body } = await balanceResponse()
    assert.equal(recorder.status, 200)
    assert.equal(body.apiKeyConfigured, true, '应解析到环境变量密钥')
    assert.equal(body.reason, 'request-failed') // 回环端口拒绝连接：证明拿到了密钥并尝试了请求
  })
})

test('display-currency helpers format amounts in the selected currency', () => {
  assert.equal(normalizeCurrency(undefined), 'usd')
  assert.equal(normalizeCurrency('usd'), 'usd')
  assert.equal(normalizeCurrency('cny'), 'cny')
  assert.equal(normalizeCurrency('eur'), 'usd')
  assert.equal(normalizeCnyPerUsd(undefined), DEFAULT_CNY_PER_USD)
  assert.equal(normalizeCnyPerUsd(7.1), 7.1)
  assert.equal(normalizeCnyPerUsd(-1), DEFAULT_CNY_PER_USD)
  assert.equal(normalizeCnyPerUsd('x'), DEFAULT_CNY_PER_USD)

  // 金额已按显示币种计算（官方 CNY / USD 刊例价），格式化不再换算。
  assert.equal(formatMoney(0, 'usd'), '$0')
  assert.equal(formatMoney(0.058, 'usd'), '$0.058')
  assert.equal(formatMoney(0.392, 'cny'), '¥0.392')
  assert.equal(formatMoney(1.5, 'cny'), '¥1.500')
  assert.equal(formatMoney(123, 'usd'), '$123.00')
  assert.equal(formatMoney(0.0013, 'usd'), '$0.0013')

  assert.equal(formatPricePerM(1.5, 'cny'), '1.5')
  assert.equal(formatPricePerM(0.22, 'usd'), '0.22')
  assert.equal(formatPricePerM(0.007, 'usd'), '0.007')
  assert.equal(formatPricePerM(1.32, 'usd'), '1.32')
  assert.equal(formatPricePerM(0.044, 'usd'), '0.044')
})

test('mounted /dsh-usage-chart/meta route serves display-currency defaults and honors config', async () => {
  const sameOrigin = { host: 'localhost:3000', origin: 'http://localhost:3000', 'sec-fetch-site': 'same-origin' }

  const defaults = mountedRoutes().get('/dsh-usage-chart/meta')
  const defaultResponse = responseRecorder()
  await defaults.handler({ method: 'GET', url: '/dsh-usage-chart/meta', headers: { ...sameOrigin } }, defaultResponse)
  assert.equal(defaultResponse.status, 200)
  assert.deepEqual(JSON.parse(defaultResponse.body), { ok: true, currency: 'usd', cnyPerUsd: DEFAULT_CNY_PER_USD })

  const custom = mountedRoutes([], { currency: 'cny', cnyPerUsd: 7.1 }).get('/dsh-usage-chart/meta')
  const customResponse = responseRecorder()
  await custom.handler({ method: 'GET', url: '/dsh-usage-chart/meta', headers: { ...sameOrigin } }, customResponse)
  assert.deepEqual(JSON.parse(customResponse.body), { ok: true, currency: 'cny', cnyPerUsd: 7.1 })

  const invalid = mountedRoutes([], { currency: 'eur', cnyPerUsd: -5 }).get('/dsh-usage-chart/meta')
  const invalidResponse = responseRecorder()
  await invalid.handler({ method: 'GET', url: '/dsh-usage-chart/meta', headers: { ...sameOrigin } }, invalidResponse)
  assert.deepEqual(JSON.parse(invalidResponse.body), { ok: true, currency: 'usd', cnyPerUsd: DEFAULT_CNY_PER_USD })

  const methodResponse = responseRecorder()
  await defaults.handler({ method: 'POST', url: '/dsh-usage-chart/meta', headers: { host: 'localhost:3000' } }, methodResponse)
  assert.equal(methodResponse.status, 405)
})

test('mounted /dsh-usage-chart/rate route parses the FX source and reports failures', async () => {
  const originalFetch = globalThis.fetch
  const route = mountedRoutes().get('/dsh-usage-chart/rate')
  const sameOrigin = { host: 'localhost:3000', origin: 'http://localhost:3000', 'sec-fetch-site': 'same-origin' }
  try {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ result: 'success', rates: { CNY: 6.77 } }) })
    const okResponse = responseRecorder()
    await route.handler({ method: 'GET', url: '/dsh-usage-chart/rate', headers: { ...sameOrigin } }, okResponse)
    assert.equal(okResponse.status, 200)
    const okBody = JSON.parse(okResponse.body)
    assert.equal(okBody.ok, true)
    assert.equal(okBody.rate, 6.77)
    assert.equal(typeof okBody.fetchedAt, 'number')

    globalThis.fetch = async () => ({ ok: true, json: async () => ({ rates: {} }) })
    const badResponse = responseRecorder()
    await route.handler({ method: 'GET', url: '/dsh-usage-chart/rate', headers: { ...sameOrigin } }, badResponse)
    assert.equal(JSON.parse(badResponse.body).reason, 'bad-response')

    globalThis.fetch = async () => ({ ok: true, json: async () => ({ rates: { CNY: -1 } }) })
    const negativeResponse = responseRecorder()
    await route.handler({ method: 'GET', url: '/dsh-usage-chart/rate', headers: { ...sameOrigin } }, negativeResponse)
    assert.equal(JSON.parse(negativeResponse.body).reason, 'bad-response')

    globalThis.fetch = async () => ({ ok: false, json: async () => ({}) })
    const httpResponse = responseRecorder()
    await route.handler({ method: 'GET', url: '/dsh-usage-chart/rate', headers: { ...sameOrigin } }, httpResponse)
    assert.equal(JSON.parse(httpResponse.body).reason, 'request-failed')

    globalThis.fetch = async () => { throw new Error('network down') }
    const throwResponse = responseRecorder()
    await route.handler({ method: 'GET', url: '/dsh-usage-chart/rate', headers: { ...sameOrigin } }, throwResponse)
    assert.equal(JSON.parse(throwResponse.body).reason, 'request-failed')

    // 多源回退：主源网络失败时自动尝试回退源
    let calls = 0
    globalThis.fetch = async () => {
      calls += 1
      if (calls === 1) throw new Error('network down on primary')
      return { ok: true, json: async () => ({ rates: { CNY: 6.7 } }) }
    }
    const fallbackResponse = responseRecorder()
    await route.handler({ method: 'GET', url: '/dsh-usage-chart/rate', headers: { ...sameOrigin } }, fallbackResponse)
    const fallbackBody = JSON.parse(fallbackResponse.body)
    assert.equal(fallbackBody.ok, true)
    assert.equal(fallbackBody.rate, 6.7)
    assert.equal(typeof fallbackBody.source, 'string', '回退源成功时应标注 source')

    const methodResponse = responseRecorder()
    await route.handler({ method: 'POST', url: '/dsh-usage-chart/rate', headers: { host: 'localhost:3000' } }, methodResponse)
    assert.equal(methodResponse.status, 405)
  } finally {
    globalThis.fetch = originalFetch
  }
})
