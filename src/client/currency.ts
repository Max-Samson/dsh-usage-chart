/**
 * 客户端成本显示币种（本地定制）：
 *  - 宿主在 `/dsh-usage-chart/meta` 下发 config.currency / config.cnyPerUsd，
 *    作为默认值（无用户选择时生效）；
 *  - 用户可在用量面板中切换 USD/CNY，选择写入 localStorage
 *    （`dsh-usage-chart:currency`），在本浏览器中记住并覆盖配置默认值；
 *  - 「刷新汇率」经宿主 `/dsh-usage-chart/rate` 拉取实时汇率，覆盖当前汇率
 *    并在本次会话内生效（不落盘，避免陈旧汇率被长期记住）；
 *  - 组件经 useDisplayCurrency() 读取，切换后全界面实时更新。
 */
import { useSyncExternalStore } from 'react'
import { DEFAULT_CNY_PER_USD, type DisplayCurrency } from '../pricing.ts'

export interface DisplayMeta {
  currency: DisplayCurrency
  cnyPerUsd: number
  /** 汇率来源：'config'（配置默认）或 'live'（本次会话内刷新所得）。 */
  rateSource?: 'config' | 'live'
  /** 实时汇率获取时间（epoch ms；仅 rateSource === 'live' 时有意义）。 */
  rateFetchedAt?: number
}

export type RateRefreshResult = 'ok' | 'request-failed' | 'bad-response'

const STORAGE_KEY = 'dsh-usage-chart:currency'
const DEFAULT_META: DisplayMeta = { currency: 'usd', cnyPerUsd: DEFAULT_CNY_PER_USD, rateSource: 'config' }

let meta: DisplayMeta = DEFAULT_META
/** 用户是否已在界面中手动选择过（此后 meta 拉取不再覆盖币种）。 */
let userChosen = false
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of [...listeners]) listener()
}

/** 读取本浏览器记住的币种选择（无效值返回 null）。 */
function storedCurrency(): DisplayCurrency | null {
  try {
    const value = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY)
    return value === 'cny' || value === 'usd' ? value : null
  } catch {
    return null
  }
}

/** 读取当前显示币种快照（订阅源的 getSnapshot）。 */
export function getDisplayMeta(): DisplayMeta {
  return meta
}

/** 订阅显示币种变化（返回退订函数）。 */
export function subscribeDisplayMeta(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 组件读当前显示币种与汇率。 */
export function useDisplayCurrency(): DisplayMeta {
  return useSyncExternalStore(subscribeDisplayMeta, getDisplayMeta)
}

/**
 * 用户切换币种：更新 store 并写入 localStorage。
 * 汇率（cnyPerUsd）保持宿主配置值不变。
 */
export function setDisplayCurrency(currency: DisplayCurrency): void {
  userChosen = true
  if (meta.currency === currency) return
  meta = { ...meta, currency }
  try {
    localStorage.setItem(STORAGE_KEY, currency)
  } catch {
    // localStorage 不可用时仅本次会话内生效。
  }
  notify()
}

/**
 * 从宿主 meta 路由拉取默认币种与汇率。
 * 用户已手动选择过时不再覆盖（本地选择优先于配置默认值）。
 */
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
      // 只更新汇率，币种保留用户选择；实时汇率（本会话内刷新）优先于配置默认。
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
    // 忽略：保持默认（usd）。
  }
}

/**
 * 应用实时汇率：覆盖当前汇率并标注来源与获取时间。
 * 仅在本次会话内生效（不写 localStorage，避免陈旧汇率被长期记住）。
 */
export function setLiveRate(rate: number, fetchedAt: number): void {
  if (meta.currency === 'cny' && meta.cnyPerUsd === rate && meta.rateSource === 'live' && meta.rateFetchedAt === fetchedAt) return
  meta = { ...meta, cnyPerUsd: rate, rateSource: 'live', rateFetchedAt: fetchedAt }
  notify()
}

/** 经宿主代理拉取实时汇率；成功返回 'ok'，失败返回结构化原因（不改动当前汇率）。 */
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

/**
 * 插件 apply 时调用：先读本浏览器记住的选择（立即生效），
 * 再拉取宿主配置作为兜底默认值。
 */
export function initDisplayMeta(): void {
  const stored = storedCurrency()
  if (stored !== null) {
    userChosen = true
    meta = { ...meta, currency: stored }
  }
  void fetchDisplayMeta()
}
