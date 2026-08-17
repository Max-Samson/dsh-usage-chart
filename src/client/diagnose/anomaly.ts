/**
 * Anomaly（纯模块）：相对最近 N 轮的成本突增判定 + 归因。
 *
 * 图表与徽章共享，不埋在组件内部（ADR 4）。纯函数：喂 ChartRound 序列
 * 断言 flag；cost 为 null 的轮次（观测增量路径）不参与判定。
 */
import { billedInputTokens, cacheHitPercent } from '../../pricing/calc.ts'
import type { ChartRound } from '../rounds/types.ts'

export type AnomalyReason = 'output-growth' | 'context-bloat' | 'cache-hit-drop'

export interface AnomalyFlag {
  turn: number
  costCny: number
  reasons: AnomalyReason[]
}

export interface AnomalyOptions {
  /** 对比窗口：取该轮之前至多 window 轮做基线。默认 6。 */
  window?: number
  /** 突增阈值：成本超过基线均值 × threshold 即标记。默认 2。 */
  threshold?: number
  /** 归因阈值：输出/输入超过基线均值 × 该值归因为增长；缓存命中低于基线该百分点归因为下降。 */
  reasonFactor?: number
  reasonHitDropPp?: number
}

const DEFAULTS = {
  window: 6,
  threshold: 2,
  reasonFactor: 1.8,
  reasonHitDropPp: 15,
} as const

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null
  let sum = 0
  for (const v of values) sum += v
  return sum / values.length
}

/**
 * 标记成本异常轮次。
 * @param rounds - 按轮次升序的完整轮次序列（host 历史）。
 * @param options - 窗口/阈值/归因灵敏度。
 * @returns 每项 { turn, costCny, reasons }；reasons 为归因 chip（可空）。
 */
export function flagAnomalies(rounds: readonly ChartRound[], options?: AnomalyOptions): AnomalyFlag[] {
  const opts = { ...DEFAULTS, ...options }
  const flags: AnomalyFlag[] = []
  if (opts.window <= 0 || opts.threshold <= 0) return flags

  const baselineCosts: number[] = []
  const baselineOutputs: number[] = []
  const baselineInputs: number[] = []
  const baselineHits: number[] = []

  for (const round of rounds) {
    if (round.cost === null) continue

    // 突增判定以官方人民币价分拆为基准（币种不影响相对突增判定）。
    const cost = round.cost.cny.total
    const output = round.buckets.outputTokens
    const input = billedInputTokens(round.buckets)
    const hit = cacheHitPercent(round.buckets)

    // 基线 = 之前至多 window 轮（含 cost 为 null 的轮次会跳过，窗口按有效轮计）。
    const baselineCost = mean(baselineCosts)
    const reasons: AnomalyReason[] = []

    if (baselineCost !== null && baselineCost > 0 && cost > baselineCost * opts.threshold) {
      const baselineOutput = mean(baselineOutputs)
      const baselineInput = mean(baselineInputs)
      const baselineHit = mean(baselineHits)
      if (baselineOutput !== null && baselineOutput > 0 && output > baselineOutput * opts.reasonFactor) {
        reasons.push('output-growth')
      }
      if (baselineInput !== null && baselineInput > 0 && input > baselineInput * opts.reasonFactor) {
        reasons.push('context-bloat')
      }
      if (baselineHit !== null && hit !== null && hit < baselineHit - opts.reasonHitDropPp) {
        reasons.push('cache-hit-drop')
      }
      flags.push({ turn: round.turn, costCny: cost, reasons })
    }

    baselineCosts.push(cost)
    baselineOutputs.push(output)
    baselineInputs.push(input)
    if (hit !== null) baselineHits.push(hit)
    while (baselineCosts.length > opts.window) baselineCosts.shift()
    while (baselineOutputs.length > opts.window) baselineOutputs.shift()
    while (baselineInputs.length > opts.window) baselineInputs.shift()
    while (baselineHits.length > opts.window) baselineHits.shift()
  }

  return flags
}
