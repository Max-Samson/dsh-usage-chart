/**
 * HistoryFeed（= 原 useSessionUsage）：host `/usage` 完整历史折叠 → rounds + compactions。
 *
 * 指示器与面板共享一份实例，徽章各自订阅权威基准；失败时由调用方
 * 回退到 LiveObservation 增量（如实标注）。模块级 in-flight 去重
 * 使同一会话的同时请求只访问宿主一次。
 */
import { useCallback, useEffect, useState } from 'react'
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
}

function emptyState(sessionId: string | undefined): HistoryState {
  return { sessionId, status: 'idle', rounds: [], compactions: [], totals: null, error: null }
}

function fetchUsage(sessionId: string): Promise<UsageResponse> {
  const cached = inflight.get(sessionId)
  if (cached !== undefined) return cached
  const promise = fetch(`/dsh-usage-chart/usage?session=${encodeURIComponent(sessionId)}`, {
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
      inflight.delete(sessionId)
    })
  inflight.set(sessionId, promise)
  return promise
}

export function useHistoryRounds(sessionId: string | undefined): HistoryRounds {
  const [state, setState] = useState<HistoryState>(() => emptyState(sessionId))

  const load = useCallback(async () => {
    if (sessionId === undefined) return
    setState((current) => {
      const selected = current.sessionId === sessionId ? current : emptyState(sessionId)
      return { ...selected, status: selected.status === 'ok' ? 'ok' : 'loading' }
    })
    try {
      const body = await fetchUsage(sessionId)
      if (body.ok && body.rounds !== undefined) {
        setState((current) => current.sessionId === sessionId ? {
          sessionId, status: 'ok', rounds: body.rounds ?? [], compactions: body.compactions ?? [],
          totals: body.totals ?? null, error: null,
        } : current)
      } else {
        setState((current) => current.sessionId === sessionId ? {
          ...current, status: 'error', compactions: [], error: body.reason ?? 'unknown',
        } : current)
      }
    } catch (e) {
      setState((current) => current.sessionId === sessionId ? {
        ...current, status: 'error', error: e instanceof Error ? e.message : String(e),
      } : current)
    }
  }, [sessionId])

  useEffect(() => {
    void load()
  }, [load])

  const selected = state.sessionId === sessionId ? state : emptyState(sessionId)
  return { ...selected, load }
}
