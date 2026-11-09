/**
 * HistoryFeed（= 原 useSessionUsage）：host `/usage` 完整历史折叠 → rounds + compactions。
 *
 * 指示器与面板共享一份实例，徽章各自订阅权威基准；失败时由调用方
 * 回退到 LiveObservation 增量（如实标注）。模块级 in-flight 去重
 * 使同一会话、同一展示汇率的同时请求只访问宿主一次。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_CNY_PER_USD, normalizeCnyPerUsd } from '../../pricing/calc.ts'
import type { TokenUsageBuckets } from '../../pricing/calc.ts'
import type { CompactionRecord } from '../../usage/compactions.ts'
import type { ChartRound, UsageResponse, UsageStatus } from './types.ts'

const inflight = new Map<string, Promise<UsageResponse>>()

export interface HistoryRounds {
  status: UsageStatus
  rounds: ChartRound[]
  compactions: CompactionRecord[]
  totals: TokenUsageBuckets | null
  error: string | null
  load: () => Promise<void>
}

interface HistoryState extends Omit<HistoryRounds, 'load'> {
  sessionId: string | undefined
  rate: number
}

function emptyState(sessionId: string | undefined, rate: number): HistoryState {
  return { sessionId, rate, status: 'idle', rounds: [], compactions: [], totals: null, error: null }
}

function fetchUsage(sessionId: string, rate: number): Promise<UsageResponse> {
  // 汇率是历史成本的展示身份；不同汇率的并发请求不能共用同一份旧金额。
  const key = `${sessionId}:${rate}`
  const cached = inflight.get(key)
  if (cached !== undefined) return cached
  const promise = fetch(`/dsh-usage-chart/usage?session=${encodeURIComponent(sessionId)}&cnyPerUsd=${rate}`, {
    headers: { Accept: 'application/json' },
  })
    .then(async (res) => {
      const body = (await res.json()) as UsageResponse
      return body
    })
    .catch((error) => ({
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    }))
    .finally(() => {
      inflight.delete(key)
    })
  inflight.set(key, promise)
  return promise
}

export function useHistoryRounds(sessionId: string | undefined, cnyPerUsd: number = DEFAULT_CNY_PER_USD): HistoryRounds {
  const rate = normalizeCnyPerUsd(cnyPerUsd)
  const [state, setState] = useState<HistoryState>(() => emptyState(sessionId, rate))
  const requestVersion = useRef(0)

  const load = useCallback(async () => {
    if (sessionId === undefined) return
    const version = ++requestVersion.current
    setState((current) => {
      const selected = current.sessionId === sessionId && current.rate === rate ? current : emptyState(sessionId, rate)
      return { ...selected, status: selected.status === 'ok' ? 'ok' : 'loading' }
    })
    try {
      const body = await fetchUsage(sessionId, rate)
      if (version !== requestVersion.current) return
      if (body.ok && body.rounds !== undefined) {
        setState((current) => current.sessionId === sessionId && current.rate === rate ? {
          sessionId, rate, status: 'ok', rounds: body.rounds ?? [], compactions: body.compactions ?? [],
          totals: body.totals ?? null, error: null,
        } : current)
      } else {
        setState((current) => current.sessionId === sessionId && current.rate === rate ? {
          ...current, status: 'error', compactions: [], error: body.reason ?? 'unknown',
        } : current)
      }
    } catch (e) {
      if (version !== requestVersion.current) return
      setState((current) => current.sessionId === sessionId && current.rate === rate ? {
        ...current, status: 'error', error: e instanceof Error ? e.message : String(e),
      } : current)
    }
  }, [sessionId, rate])

  useEffect(() => {
    void load()
    // 切换会话/汇率或卸载后，旧响应不得覆盖新身份的成本。
    return () => { requestVersion.current++ }
  }, [load])

  const selected = state.sessionId === sessionId && state.rate === rate ? state : emptyState(sessionId, rate)
  return { ...selected, load }
}
