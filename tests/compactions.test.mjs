import assert from 'node:assert/strict'
import test from 'node:test'

import { foldCompactions, foldRounds } from '../lib/index.js'
import { analyzeContext } from '../lib/context-test.js'

function stream() {
  let seq = 0
  return {
    events: [],
    push(type, time, data) {
      this.events.push({ type, seq: ++seq, time, data })
    },
  }
}

test('foldCompactions folds compaction lifecycle and computes shadowed tokens and summarize cost', () => {
  const s = stream()
  s.push('turn/start', 1_000, { turn: 1 })
  s.push('user/message', 1_005, { turn: 1, source: 'human' })
  s.push('assistant/message', 2_000, { turn: 1, step: 0, usage: { inputTokens: 500, outputTokens: 100 } })
  s.push('turn/end', 3_000, { turn: 1, reason: { kind: 'completed' } })

  // 触发压缩
  s.push('turn/start', 4_000, { turn: 2 })
  s.push('compaction/start', 4_100, {})
  s.push('compaction/summary', 4_500, {
    shadowedTokenCount: 35_000,
    shadowedRange: { start: 1, end: 10 },
    shadowedSeqs: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    model: 'deepseek-v4-flash',
    usage: { inputTokens: 10_000, outputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0 },
  })
  s.push('compaction/end', 5_000, {})
  s.push('assistant/message', 6_000, { turn: 2, step: 0, usage: { inputTokens: 200, outputTokens: 50 } })
  s.push('turn/end', 7_000, { turn: 2, reason: { kind: 'completed' } })

  const compactions = foldCompactions(s.events)
  assert.equal(compactions.length, 1)
  const c1 = compactions[0]
  assert.equal(c1.turn, 2)
  assert.equal(c1.shadowedTokenCount, 35_000)
  assert.deepEqual(c1.shadowedRange, { start: 1, end: 10 })
  assert.deepEqual(c1.shadowedSeqs, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  assert.equal(c1.model, 'deepseek-v4-flash')
  assert.equal(c1.startedAt, 4_100)
  assert.equal(c1.endedAt, 5_000)
  assert.ok(c1.cost !== null)
  // summarize 10K input + 500 output 成本大于 0
  assert.ok(c1.cost.cny.total > 0)
  assert.ok(c1.cost.usd.total > 0)
})

test('foldCompactions tolerates standalone compaction/summary without start event', () => {
  const s = stream()
  s.push('compaction/summary', 2_000, {
    shadowedTokenCount: 12_000,
    model: 'deepseek-v4-flash',
  })
  s.push('compaction/end', 3_000, {})

  const compactions = foldCompactions(s.events)
  assert.equal(compactions.length, 1)
  assert.equal(compactions[0].shadowedTokenCount, 12_000)
  assert.equal(compactions[0].model, 'deepseek-v4-flash')
})

test('foldRounds captures userSource attribution for human and agent injections', () => {
  const s = stream()
  s.push('turn/start', 1_000, { turn: 1 })
  s.push('user/message', 1_010, { turn: 1, source: 'human' })
  s.push('assistant/message', 2_000, { turn: 1, step: 0, usage: { inputTokens: 10, outputTokens: 5 } })
  s.push('turn/end', 3_000, { turn: 1, reason: { kind: 'completed' } })

  s.push('turn/start', 4_000, { turn: 2 })
  s.push('user/message', 4_010, { turn: 2, source: 'agent.inject' })
  s.push('assistant/message', 5_000, { turn: 2, step: 0, usage: { inputTokens: 50, outputTokens: 20 } })
  s.push('turn/end', 6_000, { turn: 2, reason: { kind: 'completed' } })

  const { rounds } = foldRounds(s.events)
  assert.equal(rounds.length, 2)
  assert.equal(rounds[0].userSource, 'human')
  assert.equal(rounds[1].userSource, 'agent.inject')
})

test('analyzeContext evaluates breakdown percentages, pressure levels, and recommendations', () => {
  // 正常压力与完整 breakdown
  const normalReport = analyzeContext(
    { pressureTokens: 50_000, projectedTokens: 60_000, contextWindow: 200_000 },
    { systemTokens: 10_000, toolsTokens: 20_000, messageTokens: 30_000 },
    [],
    'cny',
  )
  assert.equal(normalReport.occupancyPercent, 30)
  assert.equal(normalReport.pressureLevel, 'normal')
  assert.equal(normalReport.suggestion, null)
  assert.equal(normalReport.breakdown.isAvailable, true)
  assert.equal(normalReport.breakdown.system.percent, 17)
  assert.equal(normalReport.breakdown.tools.percent, 33)
  assert.equal(normalReport.breakdown.messages.percent, 50)
  assert.equal(normalReport.compaction.count, 0)

  // 警告与危急阈值建议
  const cautionReport = analyzeContext(
    { projectedTokens: 160_000, contextWindow: 200_000 },
    { systemTokens: 20_000, toolsTokens: 40_000, messageTokens: 100_000 },
    [],
  )
  assert.equal(cautionReport.occupancyPercent, 80)
  assert.equal(cautionReport.pressureLevel, 'caution')
  assert.equal(cautionReport.suggestion, 'caution')

  const criticalReport = analyzeContext(
    { projectedTokens: 190_000, contextWindow: 200_000 },
    undefined,
    [
      {
        seq: 1,
        startedAt: 1_000,
        endedAt: 2_000,
        turn: 5,
        shadowedTokenCount: 40_000,
        shadowedRange: null,
        shadowedSeqs: null,
        model: 'deepseek-v4-flash',
        summarizeUsage: { uncachedInputTokens: 5000, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0 },
        cost: {
          cny: { input: 0.015, cacheRead: 0, output: 0.0018, total: 0.0168 },
          usd: { input: 0.0022, cacheRead: 0, output: 0.00026, total: 0.00246 },
          estimated: false,
          unknownModel: false,
          source: 'builtin',
          verifiedAt: null,
        },
      },
    ],
  )
  assert.equal(criticalReport.occupancyPercent, 95)
  assert.equal(criticalReport.pressureLevel, 'critical')
  assert.equal(criticalReport.suggestion, 'critical')
  assert.equal(criticalReport.breakdown.isAvailable, false)
  assert.equal(criticalReport.compaction.count, 1)
  assert.equal(criticalReport.compaction.totalFreedTokens, 40_000)
  assert.equal(criticalReport.compaction.totalCostCny, 0.0168)
})
