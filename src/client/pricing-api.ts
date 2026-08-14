/**
 * client 价格消费：`/pricing` 快照是 client 的唯一价格输入（ADR 2）。
 *
 * host 解析（内置刊例价 + 用户覆盖 pricing.json）后经同源路由导出，
 * 本模块只做：拉取快照（5 分钟缓存）、按模型解析单价、算成本分拆。
 * 不内置任何价格常量——快照不可用时成本显示优雅降级（不猜测）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CostSplit, ModelPricing, TokenUsageBuckets } from '../pricing/calc.ts'
import { costSplit } from '../pricing/calc.ts'

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
}

/** 按快照解析模型价格（精确 → 前缀 → 回退）。 */
export function resolvePricing(table: PricingTable, model: string | null | undefined): ResolvedClientPricing {
  const name = model?.trim().toLowerCase() ?? ''
  if (name !== '') {
    const direct = table.entries[name]
    if (direct !== undefined) {
      return { pricing: direct.pricing, source: direct.source, verifiedAt: direct.verifiedAt, known: true }
    }
    for (const [key, entry] of Object.entries(table.entries)) {
      if (name.startsWith(key)) {
        return { pricing: entry.pricing, source: entry.source, verifiedAt: entry.verifiedAt, known: true }
      }
    }
  }
  return { pricing: table.fallback, source: 'fallback', verifiedAt: table.fallbackVerifiedAt, known: false }
}

export interface ResolvedClientCost {
  split: CostSplit
  estimated: boolean
  unknownModel: boolean
  source: 'file' | 'builtin' | 'fallback'
  verifiedAt: number | null
}

/** 一次用量的成本解析（快照 + 模型 → 分拆 + 未知标注）。 */
export function resolveCost(table: PricingTable, usage: TokenUsageBuckets, model: string | null | undefined): ResolvedClientCost {
  const resolved = resolvePricing(table, model)
  return {
    split: costSplit(usage, resolved.pricing),
    estimated: !resolved.known,
    unknownModel: !resolved.known,
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
