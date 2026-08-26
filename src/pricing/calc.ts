/**
 * 定价纯计算（两个半区 bundle 同一份源码）。
 *
 * 只做数学：给定单价与用量桶，算出成本分拆与展示格式。
 * 不做来源解析——「价格从哪来、是否未知模型」由 PricingResolver（host）
 * 或 /pricing 快照（client）回答，见 source.ts / resolve.ts / pricing-api.ts。
 *
 * 计费口径（官方定价页，中/英两页同价）：
 *  - 官方刊例价同时以人民币（CNY）与美元（USD）报价（单位：/ 1M tokens）；
 *  - 区分「高峰 / 空闲（休闲期 / 优惠期）」两个时段：
 *    高峰时段为北京时间周一至周五 09:00–12:00、14:00–18:00（即 UTC 01:00–04:00、06:00–10:00），
 *    价格为空闲时段的两倍；其余时段（周一至周五其余时间及周六、周日全天）为空闲时段；
 *  - 成本按所选显示币种、以该币种的官方刊例价直接计算（不做汇率换算）。
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

/** 计费时段：高峰 / 空闲（官方：高峰 = 空闲 × 2，北京时间周一至周五 9–12、14–18，其余及周末为空闲）。 */
export type PriceTierId = 'peak' | 'offPeak'

/** 成本/报价币种：人民币或美元（官方双币种刊例价）。 */
export type CostCurrency = 'cny' | 'usd'

/** 单币种单价（/ 1M tokens）。 */
export interface BucketPrices {
  /** 输入 · 缓存未命中 */
  cacheMissInput: number
  /** 输入 · 缓存命中 */
  cacheHitInput: number
  /** 输出 */
  output: number
}

/** 单时段单价：同一时段同时给出官方人民币与美元报价。 */
export interface PriceTier {
  /** 人民币刊例价（CNY / 1M tokens） */
  cny: BucketPrices
  /** 美元刊例价（USD / 1M tokens） */
  usd: BucketPrices
}

/** 单模型刊例价（高峰 + 空闲双时段，每时段双币种）。 */
export interface ModelPricing {
  /** 高峰时段单价（北京时间周一至周五 09:00–12:00、14:00–18:00）。 */
  peak: PriceTier
  /** 空闲时段单价（其余时段及周末全天；官方为高峰的一半）。 */
  offPeak: PriceTier
}

/** 一次用量的成本分拆。金额币种由调用方指定（costSplit 的 currency 参数）。 */
export interface CostSplit {
  /** 输入侧（未命中输入 + 写缓存，均按未命中价） */
  input: number
  /** 缓存命中输入 */
  cacheRead: number
  /** 输出 */
  output: number
  /** 合计 */
  total: number
}

/**
 * 高峰时段判定（北京时间，UTC+8，无夏令时）：周一至周五 09:00–12:00、14:00–18:00
 * （官方英文页同窗口：UTC 01:00–04:00、06:00–10:00，Monday through Friday）。
 * 周六、周日全天为空闲时段。
 *
 * @param beijingHour 北京时间小时数（0–23）
 * @param beijingDayOfWeek 北京时间星期（0=周日，1=周一，...，6=周六；省略时按工作日判定以兼容旧调用）
 */
export function isPeakHour(beijingHour: number, beijingDayOfWeek?: number): boolean {
  if (beijingDayOfWeek !== undefined && (beijingDayOfWeek === 0 || beijingDayOfWeek === 6)) {
    return false
  }
  return (beijingHour >= 9 && beijingHour < 12) || (beijingHour >= 14 && beijingHour < 18)
}

/**
 * 由时刻（epoch 毫秒）推断计费时段；时刻未知/非法时按高峰计
 * （保守：未知时刻不低估成本）。
 * 内部按北京时间（UTC+8）换算星期与小时进行判定。
 */
export function tierAt(timeMs: number | null | undefined): PriceTierId {
  if (timeMs === null || timeMs === undefined || !Number.isFinite(timeMs)) return 'peak'
  const beijingDate = new Date(timeMs + 8 * 3_600_000)
  const beijingDayOfWeek = beijingDate.getUTCDay()
  const beijingHour = beijingDate.getUTCHours()
  return isPeakHour(beijingHour, beijingDayOfWeek) ? 'peak' : 'offPeak'
}

/**
 * 按单价估算一次用量成本。`tier` 显式指定计费时段，`currency` 指定币种
 * （金额以该币种的官方刊例价计算）。
 * 注：DeepSeek 目前不对 cacheWrite 计费；若未来计费，未命中价是合理近似。
 */
export function costSplit(
  usage: TokenUsageBuckets,
  pricing: ModelPricing,
  tier: PriceTierId,
  currency: CostCurrency,
): CostSplit {
  const prices = pricing[tier][currency]
  const input = ((usage.uncachedInputTokens + usage.cacheWriteTokens) / 1_000_000) * prices.cacheMissInput
  const cacheRead = (usage.cacheReadTokens / 1_000_000) * prices.cacheHitInput
  const output = (usage.outputTokens / 1_000_000) * prices.output
  return { input, cacheRead, output, total: input + cacheRead + output }
}

/** 按时刻自动选时段、按币种计费（host 每轮、client 实时估算用）。 */
export function costSplitAt(
  usage: TokenUsageBuckets,
  pricing: ModelPricing,
  timeMs: number | null | undefined,
  currency: CostCurrency,
): CostSplit {
  return costSplit(usage, pricing, tierAt(timeMs), currency)
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

/** 人民币金额格式化：小于 ¥0.01 显示 4 位小数，否则 2–3 位。 */
export function formatCny(cny: number): string {
  if (!Number.isFinite(cny) || cny <= 0) return '¥0'
  if (cny < 0.01) return `¥${cny.toFixed(4)}`
  if (cny < 100) return `¥${cny.toFixed(3)}`
  return `¥${cny.toFixed(2)}`
}

/** 毫秒 → 紧凑耗时：812ms / 2.4s / 1m 12s；缺失或非法返回占位符。 */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return '—'
  if (ms < 1_000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${Math.round(ms / 100) / 10}s`
  const s = Math.round(ms / 1_000)
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

// ── 成本显示（2026-08-17 起：官方双币种刊例价，成本按显示币种直接计算）───
// 内部成本按所选币种（cny | usd）计算，不做汇率换算；汇率仅用于
// 「1 USD ≈ X CNY」参考注记（见 host /rate 与 client currency.ts）。

/** 默认美元兑人民币汇率（配置缺失 / 单币种覆盖折算时使用）。 */
export const DEFAULT_CNY_PER_USD = 6.76

/** 归一化显示币种：仅 'cny' 有效，其余回退 'usd'。 */
export function normalizeCurrency(value: string | undefined): CostCurrency {
  return value === 'cny' ? 'cny' : 'usd'
}

/** 归一化汇率：正有限数才采用，否则回退默认值。 */
export function normalizeCnyPerUsd(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_CNY_PER_USD
}

/** 金额格式化（¥ / $，分级小数位）；金额已按显示币种计算，不再换算。 */
export function formatMoney(amount: number, currency: CostCurrency): string {
  const symbol = currency === 'cny' ? '¥' : '$'
  if (!Number.isFinite(amount) || amount <= 0) return `${symbol}0`
  if (amount < 0.01) return `${symbol}${amount.toFixed(4)}`
  if (amount < 100) return `${symbol}${amount.toFixed(3)}`
  return `${symbol}${amount.toFixed(2)}`
}

/** 每百万 tokens 单价格式化（按显示币种输出官方报价原值）。 */
export function formatPricePerM(amount: number, currency: CostCurrency): string {
  if (currency === 'cny') return String(amount)
  const fixed = amount < 0.1 ? amount.toFixed(4) : amount.toFixed(3)
  return String(parseFloat(fixed))
}
