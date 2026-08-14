/**
 * 共享定价表与成本计算（host 半区与 client 半区共用同一份源码）。
 *
 * 价格来源：DeepSeek 官方定价页 https://api-docs.deepseek.com/quick_start/pricing
 * （2026-08-12 抓取，单位：美元 / 每百万 tokens）。
 * 成本为「官方刊例价」估算值，非账单；余额与 token 数均来自官方数据。
 */

/** 单模型刊例价（USD / 1M tokens）。 */
export interface ModelPricing {
  /** 输入 · 缓存未命中 */
  cacheMissInput: number
  /** 输入 · 缓存命中 */
  cacheHitInput: number
  /** 输出 */
  output: number
}

/** 当前官方在售模型定价表。 */
export const PRICING: Record<string, ModelPricing> = {
  'deepseek-v4-flash': { cacheMissInput: 0.14, cacheHitInput: 0.0028, output: 0.28 },
  'deepseek-v4-pro': { cacheMissInput: 0.435, cacheHitInput: 0.003625, output: 0.87 },
}

/** 未收录模型回退：按 deepseek-v4-flash 刊例价估算并标记 ≈。 */
export const FALLBACK_PRICING: ModelPricing = PRICING['deepseek-v4-flash']

/** 取某模型定价；未收录时返回回退价，并标记为估算。 */
export function pricingFor(model: string | undefined): { pricing: ModelPricing; estimated: boolean } {
  if (model !== undefined) {
    const normalized = model.trim().toLowerCase()
    const direct = PRICING[normalized]
    if (direct !== undefined) return { pricing: direct, estimated: false }
    // 前缀匹配（如带日期后缀的模型版本）。
    for (const [key, value] of Object.entries(PRICING)) {
      if (normalized.startsWith(key)) return { pricing: value, estimated: false }
    }
  }
  return { pricing: FALLBACK_PRICING, estimated: true }
}

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

/**
 * 按刊例价估算一次用量成本（USD）。
 * 注：DeepSeek 目前不对 cacheWrite 计费；若未来计费，未命中价是合理近似。
 */
export function estimateCost(usage: TokenUsageBuckets, model: string | undefined): {
  usd: number
  estimated: boolean
} {
  const { pricing, estimated } = pricingFor(model)
  const usd =
    (usage.uncachedInputTokens / 1_000_000) * pricing.cacheMissInput
    + (usage.cacheReadTokens / 1_000_000) * pricing.cacheHitInput
    + (usage.cacheWriteTokens / 1_000_000) * pricing.cacheMissInput
    + (usage.outputTokens / 1_000_000) * pricing.output
  return { usd, estimated }
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

/** 成本显示币种（本地定制）：'usd' 官方刊例价原币，'cny' 按汇率换算显示。 */
export type DisplayCurrency = 'usd' | 'cny'

/** 默认美元 → 人民币汇率（本地定制；可用 config.cnyPerUsd 覆盖）。 */
export const DEFAULT_CNY_PER_USD = 6.76

/** 规范化显示币种配置。 */
export function normalizeCurrency(value: string | undefined): DisplayCurrency {
  return value === 'cny' ? 'cny' : 'usd'
}

/** 规范化汇率配置：必须为正的有限数值，否则回退默认值。 */
export function normalizeCnyPerUsd(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_CNY_PER_USD
}

/** 把 USD 成本换算为目标显示币种的金额。 */
export function toDisplayAmount(usd: number, currency: DisplayCurrency, cnyPerUsd: number): number {
  return currency === 'cny' ? usd * cnyPerUsd : usd
}

/** 按显示币种格式化金额：CNY 用 ¥，USD 用 $（精度规则与 formatUsd 一致）。 */
export function formatMoney(usd: number, currency: DisplayCurrency, cnyPerUsd: number): string {
  const amount = toDisplayAmount(usd, currency, cnyPerUsd)
  const symbol = currency === 'cny' ? '¥' : '$'
  if (!Number.isFinite(amount) || amount <= 0) return `${symbol}0`
  if (amount < 0.01) return `${symbol}${amount.toFixed(4)}`
  if (amount < 100) return `${symbol}${amount.toFixed(3)}`
  return `${symbol}${amount.toFixed(2)}`
}

/** 刊例价（USD / 1M）换算为目标币种后的数字文本（用于价格说明）。 */
export function formatPricePerM(usd: number, currency: DisplayCurrency, cnyPerUsd: number): string {
  const amount = toDisplayAmount(usd, currency, cnyPerUsd)
  if (currency === 'usd') return String(usd)
  if (amount < 0.1) return amount.toFixed(4)
  return amount.toFixed(3)
}
