/**
 * HistoryFeed（= 原 useSessionUsage）：host `/usage` 完整历史折叠 → rounds。
 *
 * 面板与徽章专用（权威基准）；失败时由调用方回退到 LiveObservation
 * 增量（如实标注）。模块级 in-flight 去重：同一会话多个消费者
 * （面板 + 每轮徽章）共享一次请求。
 */
import { useCallback, useEffect, useState } from 'react'
import type { TokenUsageBuckets } from '../../pricing/calc.ts'
import type { ChartRound, UsageResponse, UsageStatus } from './types.ts'

const inflight = new Map<string, Promise<UsageResponse>>()

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

export function useHistoryRounds(sessionId: string | undefined): {
  status: UsageStatus
  rounds: ChartRound[]
  totals: TokenUsageBuckets | null
  error: string | null
  load: () => Promise<void>
} {
  const [status, setStatus] = useState<UsageStatus>('idle')
  const [rounds, setRounds] = useState<ChartRound[]>([])
  const [totals, setTotals] = useState<TokenUsageBuckets | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  const load = useCallback(async () => {
    if (sessionId === undefined) return
    setStatus((s) => (s === 'ok' ? s : 'loading'))
    try {
      const body = await fetchUsage(sessionId)
      if (body.ok && body.rounds !== undefined) {
        setRounds(body.rounds)
        setTotals(body.totals ?? null)
        setError(null)
        setStatus('ok')
      } else {
        setError(body.reason ?? 'unknown')
        setStatus('error')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStatus('error')
    }
  }, [sessionId])

  useEffect(() => {
    void load()
  }, [load, nonce])

  return {
    status,
    rounds,
    totals,
    error,
    load: () => { setNonce((n) => n + 1); return load() },
  }
}
