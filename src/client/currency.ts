/**
 * client 成本显示币种状态（PR #5 移植）。
 *
 * 数据流：/dsh-usage-chart/meta（config 币种 + 汇率）→ 模块级 store；
 * 用户切换（USD/CNY）写入 localStorage 覆盖 config 默认；「刷新汇率」经
 * /dsh-usage-chart/rate 拉到实时汇率（本次会话有效）。组件经
 * useDisplayCurrency()（useSyncExternalStore）读取。
 */
import { useSyncExternalStore } from 'react'
import { DEFAULT_CNY_PER_USD, type DisplayCurrency } from '../pricing/calc.ts'

export interface DisplayMeta {
  currency: DisplayCurrency
  cnyPerUsd: number
  rateSource?: 'config' | 'live'
  rateFetchedAt?: number
}

export type RateRefreshResult = 'ok' | 'request-failed' | 'bad-response'

const STORAGE_KEY = 'dsh-usage-chart:currency'
const DEFAULT_META: DisplayMeta = { currency: 'usd', cnyPerUsd: DEFAULT_CNY_PER_USD, rateSource: 'config' }

let meta: DisplayMeta = DEFAULT_META
let userChosen = false
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of [...listeners]) listener()
}

function storedCurrency(): DisplayCurrency | null {
  try {
    const value = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY)
    return value === 'cny' || value === 'usd' ? value : null
  } catch {
    return null
  }
}

export function getDisplayMeta(): DisplayMeta {
  return meta
}

export function subscribeDisplayMeta(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useDisplayCurrency(): DisplayMeta {
  return useSyncExternalStore(subscribeDisplayMeta, getDisplayMeta)
}

export function setDisplayCurrency(currency: DisplayCurrency): void {
  userChosen = true
  if (meta.currency === currency) return
  meta = { ...meta, currency }
  try {
    localStorage.setItem(STORAGE_KEY, currency)
  } catch {
    // ignore
  }
  notify()
}

export async function fetchDisplayMeta(): Promise<void> {
  try {
    const res = await fetch('/dsh-usage-chart/meta', { headers: { Accept: 'application/json' } })
    if (!res.ok) return
    const body = (await res.json()) as { ok?: boolean; currency?: string; cnyPerUsd?: number }
    if (body.ok !== true) return
    const currency: DisplayCurrency = body.currency === 'cny' ? 'cny' : 'usd'
    const cnyPerUsd =
      typeof body.cnyPerUsd === 'number' && Number.isFinite(body.cnyPerUsd) && body.cnyPerUsd > 0
        ? body.cnyPerUsd
        : DEFAULT_CNY_PER_USD
    if (userChosen) {
      if (meta.cnyPerUsd !== cnyPerUsd && meta.rateSource !== 'live') {
        meta = { ...meta, cnyPerUsd }
        notify()
      }
      return
    }
    if ((meta.currency !== currency || meta.cnyPerUsd !== cnyPerUsd) && meta.rateSource !== 'live') {
      meta = { currency, cnyPerUsd }
      notify()
    }
  } catch {
    // ignore
  }
}

export function setLiveRate(rate: number, fetchedAt: number): void {
  if (meta.currency === 'cny' && meta.cnyPerUsd === rate && meta.rateSource === 'live' && meta.rateFetchedAt === fetchedAt) return
  meta = { ...meta, cnyPerUsd: rate, rateSource: 'live', rateFetchedAt: fetchedAt }
  notify()
}

export async function refreshLiveRate(): Promise<RateRefreshResult> {
  try {
    const res = await fetch('/dsh-usage-chart/rate', { headers: { Accept: 'application/json' } })
    const body = (await res.json()) as { ok?: boolean; rate?: unknown; fetchedAt?: unknown; reason?: string }
    if (body.ok === true && typeof body.rate === 'number' && Number.isFinite(body.rate) && body.rate > 0) {
      setLiveRate(body.rate, typeof body.fetchedAt === 'number' ? body.fetchedAt : Date.now())
      return 'ok'
    }
    return body.reason === 'bad-response' ? 'bad-response' : 'request-failed'
  } catch {
    return 'request-failed'
  }
}

export function initDisplayMeta(): void {
  const stored = storedCurrency()
  if (stored !== null) {
    userChosen = true
    meta = { ...meta, currency: stored }
  }
  void fetchDisplayMeta()
}
