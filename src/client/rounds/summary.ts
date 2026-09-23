import type { CostCurrency, CostSplit, TokenUsageBuckets } from '../../pricing/calc.ts'
import type { ChartRound } from './types.ts'

/** The host fold is current only when it accounts for the live projection. */
export function sameUsage(a: TokenUsageBuckets | null | undefined, b: TokenUsageBuckets | null | undefined): boolean {
  return a !== null && a !== undefined && b !== null && b !== undefined
    && a.uncachedInputTokens === b.uncachedInputTokens
    && a.cacheReadTokens === b.cacheReadTokens
    && a.cacheWriteTokens === b.cacheWriteTokens
    && a.outputTokens === b.outputTokens
}

/** Return only newly projected usage; a negative bucket means the snapshots cannot be combined. */
export function usageDelta(live: TokenUsageBuckets, history: TokenUsageBuckets | null): TokenUsageBuckets | null {
  if (history === null) return null
  const delta = {
    uncachedInputTokens: live.uncachedInputTokens - history.uncachedInputTokens,
    cacheReadTokens: live.cacheReadTokens - history.cacheReadTokens,
    cacheWriteTokens: live.cacheWriteTokens - history.cacheWriteTokens,
    outputTokens: live.outputTokens - history.outputTokens,
  }
  return Object.values(delta).every((value) => Number.isFinite(value) && value >= 0) ? delta : null
}

/** Use the latest attributed round, including when the last round has no model yet. */
export function lastRoundModel(rounds: readonly ChartRound[]): string | undefined {
  for (let i = rounds.length - 1; i >= 0; i--) {
    const model = rounds[i].model
    if (model !== null && model !== '') return model
  }
  return undefined
}

/** Sum separately priced rounds; incomplete history must fall back to a live estimate. */
export function sumRoundCosts(rounds: readonly ChartRound[], currency: CostCurrency): (CostSplit & { estimated: boolean }) | null {
  if (rounds.length === 0) return null
  const sum: CostSplit = { input: 0, cacheRead: 0, output: 0, total: 0 }
  let estimated = false
  for (const round of rounds) {
    const cost = round.cost
    if (cost === null) return null
    const split = cost[currency]
    sum.input += split.input
    sum.cacheRead += split.cacheRead
    sum.output += split.output
    sum.total += split.total
    estimated ||= cost.estimated
  }
  return { ...sum, estimated }
}
