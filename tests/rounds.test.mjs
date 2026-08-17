import assert from 'node:assert/strict'
import test from 'node:test'

import { apply, foldRounds, foldTurnUsage, tierAt } from '../lib/index.js'

/** 2026-08-17 内置刊例价（双币种 /1M）：flash 高峰/空闲。 */
const FLASH_PEAK = {
  cny: { cacheMissInput: 3.0, cacheHitInput: 0.10, output: 9.0 },
  usd: { cacheMissInput: 0.44, cacheHitInput: 0.014, output: 1.32 },
}
const FLASH_OFF_PEAK = {
  cny: { cacheMissInput: 1.5, cacheHitInput: 0.05, output: 4.5 },
  usd: { cacheMissInput: 0.22, cacheHitInput: 0.007, output: 0.66 },
}

/** 合成事件流工具：seq 自动递增，time 由调用方给定。 */
function stream() {
  let seq = 0
  return {
    events: [],
    push(type, time, data) {
      this.events.push({ type, seq: ++seq, time, data })
    },
  }
}

/** 固定解析器：任何模型都命中 flash 价，source=builtin。 */
function flashResolver() {
  return {
    resolve() {
      return { pricing: { peak: FLASH_PEAK, offPeak: FLASH_OFF_PEAK }, source: 'builtin', verifiedAt: 1_752_000_000_000, known: true, estimated: false }
    },
  }
}

test('foldRounds computes per-round timing, TTFT, TPS, model attribution and cost', () => {
  const s = stream()
  // 轮 1：request/context 显式归因 v4-pro
  s.push('turn/start', 1_000, { turn: 1 })
  s.push('step/start', 1_005, { turn: 1, step: 0 })
  s.push('request/context', 1_010, { provider: 'deepseek', model: 'deepseek-v4-pro' })
  s.push('request/header', 1_015, { header: { config: { provider: 'deepseek', model: 'deepseek-v4-pro' } } }) // 与 context 一致，不改变归因
  s.push('assistant/chunk', 2_000, { turn: 1, step: 0, chunk: { type: 'usage', usage: { inputTokens: 80, outputTokens: 10, cacheReadTokens: 20 } } })
  s.push('assistant/message', 3_000, { turn: 1, step: 0, usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 30 } }) // 终样替换早样
  s.push('step/end', 4_000, { turn: 1, step: 0 })
  s.push('turn/end', 5_000, { turn: 1, reason: { kind: 'completed' } })
  // 轮 2：无 request/context → 模型跨轮携带回退
  s.push('turn/start', 6_000, { turn: 2 })
  s.push('step/start', 6_005, { turn: 2, step: 0 })
  s.push('assistant/message', 8_000, { turn: 2, step: 0, usage: { inputTokens: 10, outputTokens: 5 } })
  s.push('turn/end', 9_000, { turn: 2, reason: { kind: 'max-tokens' } })

  const { totals, rounds } = foldRounds(s.events, flashResolver())

  assert.deepEqual(totals, { uncachedInputTokens: 110, outputTokens: 25, cacheReadTokens: 30, cacheWriteTokens: 0 })

  const r1 = rounds.find((r) => r.turn === 1)
  assert.ok(r1, 'round 1 present')
  assert.deepEqual(r1.buckets, { uncachedInputTokens: 100, outputTokens: 20, cacheReadTokens: 30, cacheWriteTokens: 0 })
  assert.equal(r1.model, 'deepseek-v4-pro')
  assert.equal(r1.startedAt, 1_000)
  assert.equal(r1.endedAt, 5_000)
  assert.equal(r1.durationMs, 4_000)
  assert.equal(r1.ttftMs, 1_000) // 2000 - 1000
  assert.equal(r1.outputTps, 20 / ((5_000 - 2_000) / 1_000)) // 输出 20 / 3s
  assert.equal(r1.endReason, 'completed')
  assert.equal(r1.cost.source, 'builtin')
  assert.equal(r1.cost.estimated, false)
  // 轮 1 开始于 1970-01-01T00:00:01Z = 北京时间 08:00（空闲时段）→ 空闲价
  assert.equal(tierAt(r1.startedAt), 'offPeak')
  assert.equal(r1.cost.cny.input, (100 / 1_000_000) * 1.5)
  assert.equal(r1.cost.cny.cacheRead, (30 / 1_000_000) * 0.05)
  assert.equal(r1.cost.cny.output, (20 / 1_000_000) * 4.5)
  assert.equal(r1.cost.usd.input, (100 / 1_000_000) * 0.22)
  assert.equal(r1.cost.usd.cacheRead, (30 / 1_000_000) * 0.007)
  assert.equal(r1.cost.usd.output, (20 / 1_000_000) * 0.66)

  const r2 = rounds.find((r) => r.turn === 2)
  assert.ok(r2, 'round 2 present')
  assert.equal(r2.model, 'deepseek-v4-pro', '模型跨轮携带回退')
  assert.equal(r2.endReason, 'max-tokens')
  assert.equal(r2.durationMs, 3_000)
  assert.equal(r2.ttftMs, 2_000)
})

test('foldRounds bills peak vs off-peak rounds by their start time', () => {
  const s = stream()
  // 高峰轮：开始于北京时间 10:00（UTC 02:00）
  const peakStart = Date.UTC(1970, 0, 1, 2, 0, 0)
  s.push('turn/start', peakStart, { turn: 1 })
  s.push('assistant/message', peakStart + 500, { turn: 1, step: 0, usage: { inputTokens: 1_000_000, outputTokens: 0 } })
  s.push('turn/end', peakStart + 1_000, { turn: 1, reason: { kind: 'completed' } })
  // 空闲轮：开始于北京时间 08:00（UTC 00:00）
  const offPeakStart = Date.UTC(1970, 0, 1, 0, 0, 0)
  s.push('turn/start', offPeakStart, { turn: 2 })
  s.push('assistant/message', offPeakStart + 500, { turn: 2, step: 0, usage: { inputTokens: 1_000_000, outputTokens: 0 } })
  s.push('turn/end', offPeakStart + 1_000, { turn: 2, reason: { kind: 'completed' } })

  const { rounds } = foldRounds(s.events, flashResolver())
  const peak = rounds.find((r) => r.turn === 1)
  const offPeak = rounds.find((r) => r.turn === 2)
  assert.equal(tierAt(peak.startedAt), 'peak')
  assert.equal(tierAt(offPeak.startedAt), 'offPeak')
  // 1M 未命中输入：高峰 = 空闲 × 2（CNY 3.0/1.5；USD 0.44/0.22）
  assert.equal(peak.cost.cny.total, 3.0)
  assert.equal(peak.cost.usd.total, 0.44)
  assert.equal(offPeak.cost.cny.total, 1.5)
  assert.equal(offPeak.cost.usd.total, 0.22)
})

test('foldRounds tolerates missing turn/end (open round) and missing model', () => {
  const s = stream()
  s.push('turn/start', 100, { turn: 7 })
  s.push('step/start', 110, { turn: 7, step: 0 })
  s.push('assistant/message', 500, { turn: 7, step: 0, usage: { inputTokens: 5, outputTokens: 3 } })
  // 没有 turn/end：当前轮

  const { rounds } = foldRounds(s.events, flashResolver())
  assert.equal(rounds.length, 1)
  assert.equal(rounds[0].model, null)
  assert.equal(rounds[0].startedAt, 100)
  assert.equal(rounds[0].endedAt, null)
  assert.equal(rounds[0].durationMs, null)
  assert.equal(rounds[0].ttftMs, 400)
  assert.equal(rounds[0].outputTps, null)
  assert.equal(rounds[0].endReason, null)
})

test('foldRounds attributes model from request/header when request/context absent', () => {
  const s = stream()
  s.push('turn/start', 100, { turn: 3 })
  s.push('request/header', 150, { header: { config: { provider: 'deepseek', model: 'deepseek-v4-flash' } } })
  s.push('assistant/message', 200, { turn: 3, step: 0, usage: { inputTokens: 1, outputTokens: 1 } })
  s.push('turn/end', 300, { turn: 3, reason: 'completed' })

  const { rounds } = foldRounds(s.events, flashResolver())
  assert.equal(rounds[0].model, 'deepseek-v4-flash')
})

test('foldRounds marks unknown models and uses fallback pricing', () => {
  const s = stream()
  s.push('turn/start', 100, { turn: 1 })
  s.push('request/context', 110, { provider: 'deepseek', model: 'some-future-model' })
  s.push('assistant/message', 200, { turn: 1, step: 0, usage: { inputTokens: 1_000_000, outputTokens: 0 } })
  s.push('turn/end', 300, { turn: 1, reason: { kind: 'completed' } })

  // 真实解析器：some-future-model 未收录 → 回退 flash 估算价并标记未知。
  const { rounds } = foldRounds(s.events)
  assert.equal(rounds[0].model, 'some-future-model')
  assert.equal(rounds[0].cost.unknownModel, true)
  assert.equal(rounds[0].cost.estimated, true)
  assert.equal(rounds[0].cost.source, 'fallback')
  // 轮开始于北京时间 08:00（空闲）→ 1M token × flash 空闲未命中价（CNY 1.5 / USD 0.22）
  assert.equal(rounds[0].cost.cny.total, 1.5)
  assert.equal(rounds[0].cost.usd.total, 0.22)
})

test('foldTurnUsage stays compatible with the v0.1 semantics', () => {
  const events = [
    { type: 'assistant/chunk', seq: 1, time: 100, data: { turn: 1, step: 0, chunk: { type: 'usage', usage: { inputTokens: 10, outputTokens: 2, cacheReadTokens: 3 } } } },
    { type: 'assistant/message', seq: 2, time: 200, data: { turn: 1, step: 0, usage: { inputTokens: 12, outputTokens: 4, cacheReadTokens: 5 } } },
    { type: 'assistant/message', seq: 3, time: 300, data: { turn: 1, step: 1, usage: { inputTokens: 7, outputTokens: 1 } } },
    { type: 'assistant/message', seq: 4, time: 400, data: { turn: 2, step: 0, usage: { inputTokens: 3, outputTokens: 2, cacheWriteTokens: 1 } } },
  ]
  assert.deepEqual(foldTurnUsage(events), {
    totals: { uncachedInputTokens: 22, outputTokens: 7, cacheReadTokens: 5, cacheWriteTokens: 1 },
    turns: [
      { turn: 1, buckets: { uncachedInputTokens: 19, outputTokens: 5, cacheReadTokens: 5, cacheWriteTokens: 0 } },
      { turn: 2, buckets: { uncachedInputTokens: 3, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 1 } },
    ],
  })
})

test('foldRounds ignores zero-usage turns and malformed samples', () => {
  const s = stream()
  s.push('turn/start', 100, { turn: 1 })
  s.push('turn/end', 500, { turn: 1, reason: { kind: 'completed' } }) // 无用量的轮
  s.push('turn/start', 600, { turn: 2 })
  s.push('assistant/message', 700, { turn: 2, step: 0, usage: { inputTokens: -1, outputTokens: 2 } }) // 非法
  s.push('turn/end', 800, { turn: 2, reason: { kind: 'completed' } })

  const { totals, rounds } = foldRounds(s.events, flashResolver())
  assert.equal(rounds.length, 0)
  assert.deepEqual(totals, { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })
})

// ── 路由级：/usage 返回 rounds（含成本/耗时/模型）──────────────────────────

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

test('/usage route returns rounds with cost and timing', async () => {
  const events = [
    { type: 'turn/start', seq: 1, time: 1_000, data: { turn: 1 } },
    { type: 'request/context', seq: 2, time: 1_010, data: { provider: 'deepseek', model: 'deepseek-v4-pro' } },
    { type: 'assistant/message', seq: 3, time: 2_000, data: { turn: 1, step: 0, usage: { inputTokens: 1_000_000, outputTokens: 0 } } },
    { type: 'turn/end', seq: 4, time: 5_000, data: { turn: 1, reason: { kind: 'completed' } } },
  ]
  const routes = new Map()
  apply({
    effect(setup) { setup() },
    get() { return undefined },
    webServer: { register(route) { routes.set(route.path, route); return () => {} } },
    sessions: { get(id) { return id === 'session-test' ? { id, events } : undefined } },
  })

  const route = routes.get('/dsh-usage-chart/usage')
  const recorder = responseRecorder()
  await route.handler({ method: 'GET', url: '/dsh-usage-chart/usage?session=session-test', headers: { host: 'localhost:3000' } }, recorder)
  assert.equal(recorder.status, 200)
  const body = JSON.parse(recorder.body)
  assert.equal(body.ok, true)
  assert.equal(body.rounds.length, 1)
  assert.equal(body.rounds[0].turn, 1)
  assert.equal(body.rounds[0].model, 'deepseek-v4-pro')
  assert.equal(body.rounds[0].durationMs, 4_000)
  // 轮开始于北京时间 08:00（空闲）→ 1M token × v4-pro 空闲未命中价（CNY 4.5 / USD 0.66）
  assert.equal(body.rounds[0].cost.cny.total, 4.5)
  assert.equal(body.rounds[0].cost.usd.total, 0.66)
  assert.equal(body.rounds[0].cost.unknownModel, false)
})
