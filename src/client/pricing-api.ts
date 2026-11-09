/**
 * client 价格消费：`/pricing` 快照是 client 的唯一价格输入（ADR 2）。
 *
 * host 解析（内置刊例价 + 用户覆盖 pricing.json）后经同源路由导出，
 * 本模块只做：拉取快照（5 分钟缓存）、按模型解析单价、算成本分拆。
 * 不内置任何价格常量——快照不可用时成本显示优雅降级（不猜测）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CostCurrency, CostSplit, ModelPricing, TokenUsageBuckets } from '../pricing/calc.ts'
import { costSplitAt, DEFAULT_CNY_PER_USD, pricingAtRate, isUnpricedWhenUnknown, matchPricingKey, normalizeModelId, UNPRICED_PRICING } from '../pricing/calc.ts'

export interface PricingEntry {
  pricing: ModelPricing
  source: 'file' | 'builtin'
  verifiedAt: number | null
}

export interface PricingSnapshot {
  ok: boolean
  pricingFile?: string
  builtinVerifiedAt?: number | null
  fallback?: { pricing: ModelPricing; verifiedAt: number | null }
  models?: Array<{ model: string } & PricingEntry>
}

export type PricingStatus = 'idle' | 'loading' | 'ok' | 'error'

const CACHE_MS = 5 * 60_000

/** 模块级 in-flight 去重：指示器 / 面板 / 徽章共享一次 /pricing 请求。 */
const inflight = new Map<string, Promise<PricingSnapshot>>()

function fetchPricing(): Promise<PricingSnapshot> {
  const cached = inflight.get('snapshot')
  if (cached !== undefined) return cached
  const promise = fetch('/dsh-usage-chart/pricing', { headers: { Accept: 'application/json' } })
    .then((res) => res.json() as Promise<PricingSnapshot>)
    .catch(() => ({ ok: false } as PricingSnapshot))
    .finally(() => {
      inflight.delete('snapshot')
    })
  inflight.set('snapshot', promise)
  return promise
}

/** 模型 → 条目索引（精确 + 前缀匹配查找用）。 */
export interface PricingTable {
  entries: Record<string, PricingEntry>
  fallback: ModelPricing
  fallbackVerifiedAt: number | null
  builtinVerifiedAt: number | null
}

export function tableOf(snapshot: PricingSnapshot | null): PricingTable | null {
  if (snapshot === null || !snapshot.ok || snapshot.models === undefined || snapshot.fallback === undefined) return null
  const entries: Record<string, PricingEntry> = {}
  for (const entry of snapshot.models) {
    entries[entry.model] = { pricing: entry.pricing, source: entry.source, verifiedAt: entry.verifiedAt }
  }
  return {
    entries,
    fallback: snapshot.fallback.pricing,
    fallbackVerifiedAt: snapshot.fallback.verifiedAt,
    builtinVerifiedAt: snapshot.builtinVerifiedAt ?? null,
  }
}

export interface ResolvedClientPricing {
  pricing: ModelPricing
  source: 'file' | 'builtin' | 'fallback'
  verifiedAt: number | null
  /** 是否显式定价；false = 未定价模型（回退估算）。 */
  known: boolean
  /** 未定价且不估算（未收录的 Claude 等）：单价全零，成本未计入。 */
  unpriced: boolean
}

/** 按来源（文件 → 内置）选键，再补全展示币种；未收录 Claude 标记未定价。 */
export function resolvePricing(table: PricingTable, model: string | null | undefined, cnyPerUsd: number = DEFAULT_CNY_PER_USD): ResolvedClientPricing {
  const name = model === null || model === undefined ? '' : normalizeModelId(model)
  if (name !== '') {
    // 来源优先级必须与 host 相同：文件前缀覆盖也应胜过内置精确键。
    // 不能先在拍平的快照上选最长键，否则历史刷新前后会使用不同价格。
    for (const source of ['file', 'builtin'] as const) {
      const keys = Object.keys(table.entries).filter((key) => table.entries[key]?.source === source)
      const key = matchPricingKey(keys, name)
      const entry = key === null ? undefined : table.entries[key]
      if (entry !== undefined) {
        return { pricing: pricingAtRate(entry.pricing, cnyPerUsd), source: entry.source, verifiedAt: entry.verifiedAt, known: true, unpriced: false }
      }
    }
    // Claude 等非 DeepSeek 模型未收录：不套 DeepSeek 回退价，标记未定价。
    if (isUnpricedWhenUnknown(name)) {
      return { pricing: UNPRICED_PRICING, source: 'fallback', verifiedAt: null, known: false, unpriced: true }
    }
  }
  return { pricing: pricingAtRate(table.fallback, cnyPerUsd), source: 'fallback', verifiedAt: table.fallbackVerifiedAt, known: false, unpriced: false }
}

export interface ResolvedClientCost {
  split: CostSplit
  estimated: boolean
  unknownModel: boolean
  /** 未定价且不估算：split 全零，成本未计入。 */
  unpriced: boolean
  source: 'file' | 'builtin' | 'fallback'
  verifiedAt: number | null
}

/**
 * 一次用量的成本解析（快照 + 模型 → 分拆 + 未知标注）。
 * `at` 为发生时刻（epoch 毫秒），用于按高峰/空闲时段计费；缺省用当前时刻。
 * `currency` 指定币种：金额以该币种的官方刊例价计算（'cny' | 'usd'）。
 */
export function resolveCost(
  table: PricingTable,
  usage: TokenUsageBuckets,
  model: string | null | undefined,
  at: number | null | undefined,
  currency: CostCurrency,
  cnyPerUsd: number = DEFAULT_CNY_PER_USD,
): ResolvedClientCost {
  const resolved = resolvePricing(table, model, cnyPerUsd)
  return {
    split: costSplitAt(usage, resolved.pricing, at, currency),
    estimated: !resolved.known,
    unknownModel: !resolved.known,
    unpriced: resolved.unpriced,
    source: resolved.source,
    verifiedAt: resolved.verifiedAt,
  }
}

export function usePricing(): { status: PricingStatus; table: PricingTable | null; load: () => Promise<void> } {
  const [status, setStatus] = useState<PricingStatus>('idle')
  const [table, setTable] = useState<PricingTable | null>(null)
  const lastOk = useRef(0)

  const load = useCallback(async () => {
    if (table !== null && Date.now() - lastOk.current < CACHE_MS) return
    setStatus((s) => (s === 'ok' ? s : 'loading'))
    try {
      const body = await fetchPricing()
      const next = tableOf(body)
      if (next === null) {
        setStatus('error')
        return
      }
      setTable(next)
      lastOk.current = Date.now()
      setStatus('ok')
    } catch {
      setStatus('error')
    }
  }, [table])

  useEffect(() => {
    void load()
  }, [load])

  return { status, table, load }
}
