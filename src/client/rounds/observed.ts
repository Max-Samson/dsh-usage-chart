/**
 * LiveObservation（= 原 useTurnUsage）：本页观测增量 → 每轮封存。
 *
 * 只回答「本页面加载以来」的增量（投影 delta 单调归因），服务实时指示器
 * 与面板回退；如实标注，不做权威历史。权威历史一律走 HistoryFeed
 * （host /usage 折叠）——两条路径保持独立（决策 2）。
 *
 * v1.0.1：观测路径也给出每轮成本——用 /pricing 快照 + 逐轮模型/开始时刻
 * （快照 provenance/requestConfig 与节点 time 推导）按高峰/空闲时段估算
 * 双币种成本，使成本视角在没有宿主历史时也能逐轮显示费用。
 */
import { useLayoutEffect, useMemo, useRef } from 'react'
import type { CostCurrency, TokenUsageBuckets } from '../../pricing/calc.ts'
import { costSplitAt, ZERO_BUCKETS } from '../../pricing/calc.ts'
import type { ConversationNode } from '../snapshot.ts'
import { resolvePricing, type PricingTable } from '../pricing-api.ts'
import type { ChartCost, ChartRound } from './types.ts'

const anyTokens = (b: TokenUsageBuckets): boolean => b.uncachedInputTokens + b.outputTokens + b.cacheReadTokens + b.cacheWriteTokens > 0

interface ObservedState {
  prev: TokenUsageBuckets | undefined
  sealed: Map<number, TokenUsageBuckets>
  openTurn: number
  open: TokenUsageBuckets
}

/** 逐轮推导 { 模型, 开始时刻 }：模型取该轮最后一个 assistant 节点的 provenance/requestConfig；时刻取该轮最早节点时间。 */
function turnMeta(nodes: readonly ConversationNode[]): Map<number, { model: string | null; startedAt: number | null }> {
  const map = new Map<number, { model: string | null; startedAt: number | null }>()
  for (const node of nodes) {
    const turn = node.turn
    if (turn === undefined) continue
    let meta = map.get(turn)
    if (meta === undefined) {
      meta = { model: null, startedAt: null }
      map.set(turn, meta)
    }
    if (typeof node.time === 'number' && Number.isFinite(node.time) && (meta.startedAt === null || node.time < meta.startedAt)) {
      meta.startedAt = node.time
    }
    if (meta.model === null && node.kind === 'assistant') {
      if (node.provenance?.model !== undefined && node.provenance.model !== '') meta.model = node.provenance.model
      else if (node.requestConfig?.model !== undefined && node.requestConfig.model !== '') meta.model = node.requestConfig.model
    }
  }
  return map
}

/**
 * 每轮用量累积：投影每次更新时把增量记到「当前轮」，轮次推进时封存上一轮。
 * 增量单调且按 (turn, step) 有序（token-meter 的不变量），归因准确；
 * 仅覆盖本页面加载以来的观测，语义在面板中如实标注。
 *
 * `pricing` 为 /pricing 快照表（缺省 null 时观测轮次无成本）；`currency` 指定
 * 成本币种——观测轮次按快照 + 逐轮模型/时刻估算双币种成本，供成本视角使用。
 */
export function useObservedRounds(
  totals: TokenUsageBuckets | undefined,
  nodes: readonly ConversationNode[],
  pricing: PricingTable | null,
  currency: CostCurrency,
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
    const metaByTurn = turnMeta(nodes)
    const rounds: ChartRound[] = []
    const pushRound = (turn: number, buckets: TokenUsageBuckets): void => {
      rounds.push(toObservedRound(turn, buckets, metaByTurn.get(turn), pricing, currency))
    }
    for (const [turn, buckets] of ref.current.sealed) {
      pushRound(turn, buckets)
    }
    rounds.sort((a, b) => a.turn - b.turn)
    pushRound(ref.current.openTurn, ref.current.open)
    return rounds
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totals, currentTurn, pricing, currency, nodes])
}

/** 观测增量转 ChartRound：模型/开始时刻/成本从快照 + 节点推导（快照不可用时如实标注 cost 为 null）。 */
function toObservedRound(
  turn: number,
  buckets: TokenUsageBuckets,
  meta: { model: string | null; startedAt: number | null } | undefined,
  pricing: PricingTable | null,
  currency: CostCurrency,
): ChartRound {
  const model = meta?.model ?? null
  const startedAt = meta?.startedAt ?? null
  let cost: ChartCost | null = null
  if (pricing !== null) {
    const resolved = resolvePricing(pricing, model)
    const time = startedAt
    cost = {
      cny: costSplitAt(buckets, resolved.pricing, time, 'cny'),
      usd: costSplitAt(buckets, resolved.pricing, time, 'usd'),
      estimated: !resolved.known,
      unknownModel: !resolved.known,
      source: resolved.source,
      verifiedAt: resolved.verifiedAt,
    }
  }
  return {
    turn,
    buckets: { ...buckets },
    model,
    startedAt,
    endedAt: null,
    durationMs: null,
    ttftMs: null,
    outputTps: null,
    endReason: null,
    cost,
  }
}
