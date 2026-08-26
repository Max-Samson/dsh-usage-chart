/**
 * ContextReport（client 侧纯模块）：上下文构成与压缩诊断。
 *
 * 小接口：`analyzeContext(pressure, breakdown, compactions, currency?) → ContextReport`。
 * 大实现：
 *  1) 上下文容量与压力占比（结合官方 contextPressure 投影）；
 *  2) 官方 contextBreakdown 投影拆解（系统提示 / 工具定义 / 历史消息占比）；
 *  3) 压缩历史聚合（总裁剪释放 Token、总 summarize 开销、逐次压缩记录）；
 *  4) 阈值告警与优化建议（如 >80% 建议开新会话或精简大文件注入）。
 *
 * 纯函数：不发请求、无状态，测试喂合成投影与折叠记录即可全面验证。
 */
import type { CostCurrency } from '../../pricing/calc.ts'
import type { CompactionRecord } from '../../usage/compactions.ts'

export interface ContextPressureData {
  pressureTokens?: number
  projectedTokens?: number
  contextWindow?: number
}

export interface ContextBreakdownData {
  systemTokens?: number
  toolsTokens?: number
  messageTokens?: number
}

export interface ContextBreakdownItem {
  tokens: number
  percent: number
}

export interface ContextBreakdownSummary {
  system: ContextBreakdownItem
  tools: ContextBreakdownItem
  messages: ContextBreakdownItem
  totalTokens: number
  isAvailable: boolean
}

export interface CompactionItemSummary {
  seq: number
  turn: number | null
  time: number | null
  shadowedTokens: number
  model: string | null
  costCny: number | null
  costUsd: number | null
}

export interface CompactionSummary {
  count: number
  totalFreedTokens: number
  totalCostCny: number
  totalCostUsd: number
  items: CompactionItemSummary[]
}

export type ContextPressureLevel = 'normal' | 'caution' | 'critical'

export interface ContextReport {
  usedTokens: number | null
  contextWindow: number | null
  occupancyPercent: number | null
  pressureLevel: ContextPressureLevel
  breakdown: ContextBreakdownSummary
  compaction: CompactionSummary
  suggestion: string | null
}

function safeNonNegative(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0
}

/**
 * 分析上下文与压缩状态，生成结构化诊断报告。
 */
export function analyzeContext(
  pressure?: ContextPressureData,
  breakdown?: ContextBreakdownData,
  compactions?: readonly CompactionRecord[],
  currency: CostCurrency = 'cny',
): ContextReport {
  // 1. 压力与容量
  const usedTokens = pressure?.projectedTokens ?? pressure?.pressureTokens ?? null
  const contextWindow = pressure?.contextWindow && pressure.contextWindow > 0 ? pressure.contextWindow : null
  const occupancyPercent = usedTokens !== null && contextWindow !== null
    ? Math.min(100, Math.round((usedTokens / contextWindow) * 100))
    : null

  const pressureLevel: ContextPressureLevel = occupancyPercent === null
    ? 'normal'
    : occupancyPercent >= 90
      ? 'critical'
      : occupancyPercent >= 75
        ? 'caution'
        : 'normal'

  // 2. 上下文构成拆解（contextBreakdown 投影）
  const sysTokens = safeNonNegative(breakdown?.systemTokens)
  const toolTokens = safeNonNegative(breakdown?.toolsTokens)
  const msgTokens = safeNonNegative(breakdown?.messageTokens)
  const breakdownTotal = sysTokens + toolTokens + msgTokens
  const isBreakdownAvailable = breakdownTotal > 0

  const calcPct = (val: number): number =>
    breakdownTotal === 0 ? 0 : Math.round((val / breakdownTotal) * 100)

  const breakdownSummary: ContextBreakdownSummary = {
    system: { tokens: sysTokens, percent: calcPct(sysTokens) },
    tools: { tokens: toolTokens, percent: calcPct(toolTokens) },
    messages: { tokens: msgTokens, percent: calcPct(msgTokens) },
    totalTokens: breakdownTotal,
    isAvailable: isBreakdownAvailable,
  }

  // 3. 压缩收益与开销汇总
  const compactionList = compactions ?? []
  let totalFreed = 0
  let totalCostCny = 0
  let totalCostUsd = 0
  const items: CompactionItemSummary[] = []

  for (const c of compactionList) {
    totalFreed += c.shadowedTokenCount
    const cnyCost = c.cost?.cny.total ?? 0
    const usdCost = c.cost?.usd.total ?? 0
    totalCostCny += cnyCost
    totalCostUsd += usdCost
    items.push({
      seq: c.seq,
      turn: c.turn,
      time: c.startedAt ?? c.endedAt,
      shadowedTokens: c.shadowedTokenCount,
      model: c.model,
      costCny: c.cost ? cnyCost : null,
      costUsd: c.cost ? usdCost : null,
    })
  }

  const compactionSummary: CompactionSummary = {
    count: compactionList.length,
    totalFreedTokens: totalFreed,
    totalCostCny,
    totalCostUsd,
    items,
  }

  // 4. 优化建议判定
  let suggestion: string | null = null
  if (occupancyPercent !== null) {
    if (occupancyPercent >= 90) {
      suggestion = 'critical'
    } else if (occupancyPercent >= 75) {
      suggestion = 'caution'
    }
  }

  return {
    usedTokens,
    contextWindow,
    occupancyPercent,
    pressureLevel,
    breakdown: breakdownSummary,
    compaction: compactionSummary,
    suggestion,
  }
}
