import assert from 'node:assert/strict'
import test from 'node:test'

import {
  PRICING,
  apply,
  cacheHitPercent,
  estimateCost,
  foldTurnUsage,
  isTrustedRequest,
  normalizeBaseUrl,
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

function mountedRoutes(events = []) {
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
  })
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

test('pricing matches the documented DeepSeek V4 prices', () => {
  assert.deepEqual(PRICING['deepseek-v4-flash'], { cacheMissInput: 0.14, cacheHitInput: 0.0028, output: 0.28 })
  assert.equal(cacheHitPercent({ uncachedInputTokens: 50, outputTokens: 0, cacheReadTokens: 50, cacheWriteTokens: 0 }), 50)
  assert.equal(estimateCost({ uncachedInputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0 }, 'deepseek-v4-pro').usd, 1.305)
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

test('balance route reports no-api-key when no key is configured anywhere', async () => {
  const { recorder, body } = await balanceResponse()
  assert.equal(recorder.status, 200)
  assert.equal(body.apiKeyConfigured, false)
  assert.equal(body.reason, 'no-api-key')
})
