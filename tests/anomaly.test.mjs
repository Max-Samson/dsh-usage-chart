import assert from 'node:assert/strict'
import test from 'node:test'

import { flagAnomalies } from '../lib/client-test.js'

/** 构造一轮（cost 必有；其余字段按需）。 */
function round(turn, buckets, costTotal, extra = {}) {
  return {
    turn,
    buckets: { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, ...buckets },
    model: null,
    startedAt: null,
    endedAt: null,
    durationMs: null,
    ttftMs: null,
    outputTps: null,
    endReason: null,
    cost: { inputUsd: 0, cacheReadUsd: 0, outputUsd: 0, totalUsd: costTotal, estimated: false, unknownModel: false, source: 'builtin', verifiedAt: null },
    ...extra,
  }
}

const baseline = (turn) => round(turn, { uncachedInputTokens: 1_000, outputTokens: 100, cacheReadTokens: 4_000 }, 0.001)

test('flagAnomalies flags cost spikes with attributed reasons', () => {
  const rounds = [
    baseline(1),
    baseline(2),
    baseline(3),
    // 突增：成本 10x 基线，输出 6x、输入 2x、缓存命中从 ~80% 掉到 10%
    round(4, { uncachedInputTokens: 9_000, outputTokens: 600, cacheReadTokens: 1_000 }, 0.01),
    baseline(5),
  ]
  const flags = flagAnomalies(rounds)
  assert.equal(flags.length, 1)
  assert.equal(flags[0].turn, 4)
  assert.equal(flags[0].costUsd, 0.01)
  assert.deepEqual(new Set(flags[0].reasons), new Set(['output-growth', 'context-bloat', 'cache-hit-drop']))
})

test('flagAnomalies leaves steady rounds unflagged', () => {
  const rounds = [baseline(1), baseline(2), baseline(3), baseline(4), baseline(5)]
  assert.deepEqual(flagAnomalies(rounds), [])
})

test('flagAnomalies skips rounds without cost and honors window size', () => {
  const rounds = [
    { ...baseline(1), cost: null }, // 无成本：跳过
    baseline(2),
    baseline(3),
    round(4, { uncachedInputTokens: 3_000, outputTokens: 500, cacheReadTokens: 0 }, 0.012),
  ]
  // 窗口=1：基线只看上一轮（baseline 3 成本 0.001）→ 突增成立
  const flagsWindow1 = flagAnomalies(rounds, { window: 1 })
  assert.equal(flagsWindow1.length, 1)
  assert.equal(flagsWindow1[0].turn, 4)

  // 阈值=20：0.012 不超过 20×0.001 → 不标记
  assert.deepEqual(flagAnomalies(rounds, { threshold: 20 }), [])
})

test('flagAnomalies requires nonzero baseline cost', () => {
  const rounds = [
    round(1, { uncachedInputTokens: 1, outputTokens: 1 }, 0),
    round(2, { uncachedInputTokens: 1, outputTokens: 1 }, 0),
    round(3, { uncachedInputTokens: 10, outputTokens: 10 }, 0.005),
  ]
  // 基线成本全为 0 时不标记（避免除零/首轮噪声）；出现首个非零成本后才进入判定。
  const flags = flagAnomalies(rounds)
  assert.equal(flags.length, 0)
})
