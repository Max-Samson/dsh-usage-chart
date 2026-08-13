/**
 * 每轮用量历史读取：浏览器 → 宿主同源路由 `/dsh-usage-chart/usage?session=<id>`。
 * 宿主从会话日志（adapter 上报的完整事件流）折叠出每轮真实用量，
 * 与 token-meter 折叠语义一致——图表展示完整历史而非仅页面观测增量。
 */
import { useCallback, useEffect, useState } from 'react'
import type { TokenUsageBuckets } from '../pricing.ts'

export interface UsageTurn {
  turn: number
  buckets: TokenUsageBuckets
}

export interface UsageResponse {
  ok: boolean
  sessionId?: string
  totals?: TokenUsageBuckets
  turns?: UsageTurn[]
  reason?: string
}

export type UsageStatus = 'idle' | 'loading' | 'ok' | 'error'

export function useSessionUsage(sessionId: string | undefined): {
  status: UsageStatus
  turns: UsageTurn[]
  totals: TokenUsageBuckets | null
  error: string | null
  load: () => Promise<void>
} {
  const [status, setStatus] = useState<UsageStatus>('idle')
  const [turns, setTurns] = useState<UsageTurn[]>([])
  const [totals, setTotals] = useState<TokenUsageBuckets | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  const load = useCallback(async () => {
    if (sessionId === undefined) return
    setStatus((s) => (s === 'ok' ? s : 'loading'))
    try {
      const res = await fetch(`/dsh-usage-chart/usage?session=${encodeURIComponent(sessionId)}`, {
        headers: { Accept: 'application/json' },
      })
      const body = (await res.json()) as UsageResponse
      if (body.ok && body.turns !== undefined) {
        setTurns(body.turns)
        setTotals(body.totals ?? null)
        setError(null)
        setStatus('ok')
      } else {
        setError(body.reason ?? `HTTP ${res.status}`)
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
    turns,
    totals,
    error,
    load: () => { setNonce((n) => n + 1); return load() },
  }
}
