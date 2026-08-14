/**
 * LiveObservation（= 原 useTurnUsage）：本页观测增量 → 每轮封存。
 *
 * 只回答「本页面加载以来」的增量（投影 delta 单调归因），服务实时指示器
 * 与面板回退；如实标注，不做权威历史。权威历史一律走 HistoryFeed
 * （host /usage 折叠）——两条路径保持独立（决策 2）。
 */
import { useLayoutEffect, useMemo, useRef } from 'react'
import type { TokenUsageBuckets } from '../../pricing/calc.ts'
import { ZERO_BUCKETS } from '../../pricing/calc.ts'
import type { ConversationNode } from '../snapshot.ts'
import type { ChartRound } from './types.ts'

const anyTokens = (b: TokenUsageBuckets): boolean => b.uncachedInputTokens + b.outputTokens + b.cacheReadTokens + b.cacheWriteTokens > 0

interface ObservedState {
  prev: TokenUsageBuckets | undefined
  sealed: Map<number, TokenUsageBuckets>
  openTurn: number
  open: TokenUsageBuckets
}

/**
 * 每轮用量累积：投影每次更新时把增量记到「当前轮」，轮次推进时封存上一轮。
 * 增量单调且按 (turn, step) 有序（token-meter 的不变量），归因准确；
 * 仅覆盖本页面加载以来的观测，语义在面板中如实标注。
 */
export function useObservedRounds(
  totals: TokenUsageBuckets | undefined,
  nodes: readonly ConversationNode[],
): readonly ChartRound[] {
  const ref = useRef<ObservedState>({
    prev: undefined,
    sealed: new Map(),
    openTurn: -1,
    open: ZERO_BUCKETS,
  })

  const currentTurn = useMemo(() => {
    let m = 0
    for (const n of nodes) if (n.turn > m) m = n.turn
    return m
  }, [nodes])

  useLayoutEffect(() => {
    const r = ref.current
    if (totals === undefined) return
    if (r.prev === undefined) {
      r.prev = totals
      r.openTurn = currentTurn
      return
    }
    const delta: TokenUsageBuckets = {
      uncachedInputTokens: Math.max(0, totals.uncachedInputTokens - r.prev.uncachedInputTokens),
      outputTokens: Math.max(0, totals.outputTokens - r.prev.outputTokens),
      cacheReadTokens: Math.max(0, totals.cacheReadTokens - r.prev.cacheReadTokens),
      cacheWriteTokens: Math.max(0, totals.cacheWriteTokens - r.prev.cacheWriteTokens),
    }
    if (currentTurn !== r.openTurn) {
      if (anyTokens(r.open)) r.sealed.set(r.openTurn, r.open)
      r.openTurn = currentTurn
      r.open = ZERO_BUCKETS
    }
    if (anyTokens(delta)) {
      r.open.uncachedInputTokens += delta.uncachedInputTokens
      r.open.outputTokens += delta.outputTokens
      r.open.cacheReadTokens += delta.cacheReadTokens
      r.open.cacheWriteTokens += delta.cacheWriteTokens
    }
    r.prev = totals
  }, [totals, currentTurn])

  return useMemo(() => {
    const rounds: ChartRound[] = []
    for (const [turn, buckets] of ref.current.sealed) {
      rounds.push(toObservedRound(turn, buckets))
    }
    rounds.sort((a, b) => a.turn - b.turn)
    rounds.push(toObservedRound(ref.current.openTurn, ref.current.open))
    return rounds
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totals, currentTurn])
}

/** 观测增量转 ChartRound：无成本/时序/模型（如实标注，cost 为 null）。 */
function toObservedRound(turn: number, buckets: TokenUsageBuckets): ChartRound {
  return {
    turn,
    buckets: { ...buckets },
    model: null,
    startedAt: null,
    endedAt: null,
    durationMs: null,
    ttftMs: null,
    outputTps: null,
    endReason: null,
    cost: null,
  }
}
