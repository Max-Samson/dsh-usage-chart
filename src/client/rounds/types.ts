/**
 * client 侧轮次数据形状：host `/usage` 的 wire 格式（权威历史）
 * 与本页观测增量共用同一 ChartRound 形状，图表只认这一个类型。
 */
import type { CostSplit, TokenUsageBuckets } from '../../pricing/calc.ts'

/** 每轮成本（来自 host 折叠，官方 CNY/USD 双币种各一份；观测增量路径为 null）。 */
export interface ChartCost {
  /** 人民币分拆（官方 CNY 价）。 */
  cny: CostSplit
  /** 美元分拆（官方 USD 价）。 */
  usd: CostSplit
  /** 是否使用回退估算价。 */
  estimated: boolean
  /** 是否未定价模型。 */
  unknownModel: boolean
  source: 'file' | 'builtin' | 'fallback'
  verifiedAt: number | null
}

/** 一轮（权威历史或本页观测增量）。 */
export interface ChartRound {
  turn: number
  buckets: TokenUsageBuckets
  model: string | null
  startedAt: number | null
  endedAt: number | null
  durationMs: number | null
  ttftMs: number | null
  outputTps: number | null
  endReason: string | null
  cost: ChartCost | null
}

/** /usage 响应（host RoundFold 的 wire 形状）。 */
export interface UsageResponse {
  ok: boolean
  sessionId?: string
  totals?: TokenUsageBuckets
  rounds?: ChartRound[]
  reason?: string
}

export type UsageStatus = 'idle' | 'loading' | 'ok' | 'error'
