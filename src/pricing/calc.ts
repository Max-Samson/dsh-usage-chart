/**
 * 定价纯计算（两个半区 bundle 同一份源码）。
 *
 * 只做数学：给定单价与用量桶，算出成本分拆与展示格式。
 * 不做来源解析——「价格从哪来、是否未知模型」由 PricingResolver（host）
 * 或 /pricing 快照（client）回答，见 source.ts / resolve.ts / pricing-api.ts。
 */

/** token 用量四桶（与 @deepseek-ai/dsh-token-meter 的 TokenUsageProjection 一致）。 */
export interface TokenUsageBuckets {
  uncachedInputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

export const ZERO_BUCKETS: TokenUsageBuckets = {
  uncachedInputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
}

/** 单模型刊例价（USD / 1M tokens）。 */
export interface ModelPricing {
  /** 输入 · 缓存未命中 */
  cacheMissInput: number
  /** 输入 · 缓存命中 */
  cacheHitInput: number
  /** 输出 */
  output: number
}

/** 一次用量的成本分拆（USD）。 */
export interface CostSplit {
  /** 输入侧（未命中输入 + 写缓存，均按未命中价） */
  inputUsd: number
  /** 缓存命中输入 */
  cacheReadUsd: number
  /** 输出 */
  outputUsd: number
  /** 合计 */
  totalUsd: number
}

/**
 * 按单价估算一次用量成本（USD）。
 * 注：DeepSeek 目前不对 cacheWrite 计费；若未来计费，未命中价是合理近似。
 */
export function costSplit(usage: TokenUsageBuckets, pricing: ModelPricing): CostSplit {
  const inputUsd = ((usage.uncachedInputTokens + usage.cacheWriteTokens) / 1_000_000) * pricing.cacheMissInput
  const cacheReadUsd = (usage.cacheReadTokens / 1_000_000) * pricing.cacheHitInput
  const outputUsd = (usage.outputTokens / 1_000_000) * pricing.output
  return { inputUsd, cacheReadUsd, outputUsd, totalUsd: inputUsd + cacheReadUsd + outputUsd }
}

/** 输入侧计费 tokens（三个不相交的 prompt 侧桶之和，与 StatsLine 口径一致）。 */
export function billedInputTokens(usage: TokenUsageBuckets): number {
  return usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
}

/** 缓存命中率（输入侧），无输入时返回 null。 */
export function cacheHitPercent(usage: TokenUsageBuckets): number | null {
  const denominator = billedInputTokens(usage)
  return denominator === 0 ? null : Math.round((usage.cacheReadTokens / denominator) * 100)
}

/** 紧凑 token 数：517 / 12.2K / 517K / 1.2M。 */
export function formatTokens(n: number): string {
  const scaled = (v: number): string =>
    v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10)
  if (n < 1_000) return String(n)
  if (n < 1_000_000) return `${scaled(n / 1_000)}K`
  return `${scaled(n / 1_000_000)}M`
}

/** 美元金额：小于 $0.01 显示 4 位小数，否则 2 位。 */
export function formatUsd(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return '$0'
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  if (usd < 100) return `$${usd.toFixed(3)}`
  return `$${usd.toFixed(2)}`
}

/** 毫秒 → 紧凑耗时：812ms / 2.4s / 1m 12s；缺失或非法返回占位符。 */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return '—'
  if (ms < 1_000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${Math.round(ms / 100) / 10}s`
  const s = Math.round(ms / 1_000)
  return `${Math.floor(s / 60)}m ${s % 60}s`
}
