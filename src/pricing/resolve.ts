/**
 * PricingResolver（host 半区）：按优先级解析某模型的价格并标注来源/时效/未知。
 *
 * 优先级（ROADMAP §4）：用户覆盖文件 > 内置默认 > 未收录回退。
 * 未知模型不静默按 0 计——`unknown: true` 显式标记，UI 显示「未定价模型」。
 */
import type { CostSplit, ModelPricing, TokenUsageBuckets } from './calc.ts'
import { costSplitAt, DEFAULT_CNY_PER_USD, pricingAtRate, isUnpricedWhenUnknown, normalizeModelId, UNPRICED_PRICING } from './calc.ts'
import { builtinPricingSource, FALLBACK_PRICING, type PricingSource } from './source.ts'

/** 解析结果：定价 + 来源 + 时效 + 是否显式收录。 */
export interface ResolvedPricing {
  pricing: ModelPricing
  /** 命中来源；回退（fallback）表示模型未收录。 */
  source: 'file' | 'builtin' | 'fallback'
  /** 条目最后核验时间（epoch 毫秒）；回退时为内置表核验日期。 */
  verifiedAt: number | null
  /** 模型是否被显式定价（file 或 builtin 收录）；false = 未定价模型。 */
  known: boolean
  /** 是否使用了回退估算（未知模型）。 */
  estimated: boolean
  /**
   * 是否「未定价、不估算」：未收录的 Claude 等非 DeepSeek 模型，单价全零，
   * 成本未计入（区别于按 deepseek-flash 回退价估算的 DeepSeek 未知模型）。
   */
  unpriced: boolean
}

/** 解析器接口（接缝消费方只依赖它）。 */
export interface PricingResolver {
  /** 解析模型价格；model 为 null/undefined 时按未知模型回退处理。 */
  resolve(model: string | null | undefined): ResolvedPricing
  /** 快照：全部已知模型条目（内置 ∪ 文件），供 /pricing 路由导出。 */
  list(): Array<{ model: string; pricing: ModelPricing; source: 'file' | 'builtin'; verifiedAt: number | null }>
}

/**
 * 未收录回退。DeepSeek（及模型名缺失）按 deepseek-flash 价估算；Claude 等
 * 非 DeepSeek 模型不套 DeepSeek 价（会严重低估），返回全零单价 + 未定价标记。
 */
function fallbackResult(normalized = ''): ResolvedPricing {
  const unpriced = isUnpricedWhenUnknown(normalized)
  return {
    pricing: unpriced ? UNPRICED_PRICING : FALLBACK_PRICING,
    source: 'fallback',
    verifiedAt: null,
    known: false,
    estimated: true,
    unpriced,
  }
}

/**
 * 组合解析器：file 优先，其次 builtin，最后未收录回退。
 * 均不做 IO——来源的读取/监听在 source 适配器内部完成。
 */
export function createPricingResolver(file?: PricingSource | null, cnyPerUsd: number = DEFAULT_CNY_PER_USD): PricingResolver {
  const builtin = builtinPricingSource()
  const sources: PricingSource[] = file === null || file === undefined ? [builtin] : [file, builtin]

  const resolve = (model: string | null | undefined): ResolvedPricing => {
    if (model === null || model === undefined) return fallbackResult()
    const normalized = normalizeModelId(model)
    if (normalized === '') return fallbackResult()
    for (const source of sources) {
      const hit = source.resolve(normalized)
      if (hit.pricing !== null) {
        return {
          pricing: pricingAtRate(hit.pricing, cnyPerUsd),
          source: source.id,
          verifiedAt: hit.verifiedAt,
          known: true,
          estimated: false,
          unpriced: false,
        }
      }
    }
    return fallbackResult(normalized)
  }

  const list = (): Array<{ model: string; pricing: ModelPricing; source: 'file' | 'builtin'; verifiedAt: number | null }> => {
    const table = new Map<string, { pricing: ModelPricing; source: 'file' | 'builtin'; verifiedAt: number | null }>()
    for (const source of sources) {
      for (const model of source.knownModels()) {
        const hit = source.resolve(model)
        if (hit.pricing === null) continue
        const key = normalizeModelId(model)
        if (!table.has(key)) {
          table.set(key, { pricing: pricingAtRate(hit.pricing, cnyPerUsd), source: source.id, verifiedAt: hit.verifiedAt })
        }
      }
    }
    return [...table.entries()]
      .map(([model, value]) => ({ model, ...value }))
      .sort((a, b) => a.model.localeCompare(b.model))
  }

  return { resolve, list }
}

// ── v0.1 兼容出口（lib/index.js 原样导出）───────────────────────────────────
// 兼容旧调用参数；未显式传汇率时使用统一默认值，新代码应传当前展示汇率。

const builtinOnly = builtinPricingSource()

/** 取某模型定价；未收录时返回回退价，并标记为估算（v0.1 兼容）。 */
export function pricingFor(model: string | undefined, cnyPerUsd: number = DEFAULT_CNY_PER_USD): { pricing: ModelPricing; estimated: boolean } {
  const normalized = model === undefined ? '' : normalizeModelId(model)
  const resolved = normalized === '' ? null : builtinOnly.resolve(normalized)
  if (resolved === null || resolved.pricing === null) {
    return { pricing: isUnpricedWhenUnknown(normalized) ? UNPRICED_PRICING : FALLBACK_PRICING, estimated: true }
  }
  return { pricing: pricingAtRate(resolved.pricing, cnyPerUsd), estimated: false }
}

/** 按内置刊例价估算一次用量成本（CNY；时刻未知按高峰价保守估算）（v0.1 兼容）。 */
export function estimateCost(usage: TokenUsageBuckets, model: string | undefined, cnyPerUsd: number = DEFAULT_CNY_PER_USD): { cny: number; estimated: boolean } {
  const { pricing, estimated } = pricingFor(model, cnyPerUsd)
  const split: CostSplit = costSplitAt(usage, pricing, null, 'cny')
  return { cny: split.total, estimated }
}
