/**
 * 余额读取：浏览器 → 宿主同源路由 `/dsh-usage-chart/balance`（宿主办代理，
 * 避免浏览器直连官方 API 的 CORS 与密钥暴露问题）。数据来自官方接口。
 */
import { useCallback, useEffect, useRef, useState } from 'react'

export interface BalanceInfo {
  currency: string
  totalBalance: string
  grantedBalance: string
  toppedUpBalance: string
}

export interface BalanceData {
  ok: boolean
  apiKeyConfigured: boolean
  source?: 'api'
  reason?: 'no-api-key' | 'request-failed' | 'bad-response'
  message?: string
  isAvailable?: boolean
  balances?: BalanceInfo[]
}

export type BalanceStatus = 'idle' | 'loading' | 'ok' | 'error'

const CACHE_MS = 60_000

export function useBalance(autoload = true): { status: BalanceStatus; data: BalanceData | null; load: () => Promise<void> } {
  const [status, setStatus] = useState<BalanceStatus>('idle')
  const [data, setData] = useState<BalanceData | null>(null)
  const lastOk = useRef(0)
  const mounted = useRef(true)

  const load = useCallback(async () => {
    if (data !== null && data.ok && Date.now() - lastOk.current < CACHE_MS) return
    setStatus('loading')
    try {
      const res = await fetch('/dsh-usage-chart/balance', { headers: { Accept: 'application/json' } })
      const body = (await res.json()) as BalanceData
      if (!mounted.current) return
      setData(body)
      setStatus(body.ok ? 'ok' : 'error')
      if (body.ok) lastOk.current = Date.now()
    } catch (error) {
      if (!mounted.current) return
      setData({
        ok: false,
        apiKeyConfigured: false,
        reason: 'request-failed',
        message: error instanceof Error ? error.message : String(error),
      })
      setStatus('error')
    }
  }, [data])

  useEffect(() => {
    mounted.current = true
    if (autoload) void load()
    return () => { mounted.current = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { status, data, load }
}

/** 币种符号。 */
export function currencySymbol(currency: string | undefined): string {
  return currency === 'USD' ? '$' : currency === 'CNY' ? '¥' : `${currency ?? ''} `
}
