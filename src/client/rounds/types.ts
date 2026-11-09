/**
 * client 侧轮次数据形状：host `/usage` 的 wire 格式（权威历史）
 * 与本页观测增量共用同一 ChartRound 形状，图表只认这一个类型。
 */
import type { CostSplit, TokenUsageBuckets } from '../../pricing/calc.ts'
import type { CompactionRecord } from '../../usage/compactions.ts'

/** 每轮成本（来自 host 折叠或观测增量；两币种均已按当前展示汇率补全）。 */
export interface ChartCost {
  /** 人民币分拆（原价或单币种折算价）。 */
  cny: CostSplit
  /** 美元分拆（原价或单币种折算价）。 */
  usd: CostSplit
  /** 是否使用回退估算价。 */
  estimated: boolean
  /** 是否未定价模型。 */
  unknownModel: boolean
  /** 未定价且不估算（未收录的 Claude 等）：cny/usd 全零，成本未计入。旧 host 不下发时视为 false。 */
  unpriced?: boolean
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
  userSource?: string | null
  cost: ChartCost | null
}

/** /usage 响应（host RoundFold 的 wire 形状）。 */
export interface UsageResponse {
  ok: boolean
  sessionId?: string
  totals?: TokenUsageBuckets
  rounds?: ChartRound[]
  compactions?: CompactionRecord[]
  reason?: string
}

export type UsageStatus = 'idle' | 'loading' | 'ok' | 'error'
