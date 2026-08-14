/**
 * 用量可视化面板（参考 DeepSeek 开发者平台 usage 页的信息组织）：
 *  1) 会话汇总  2) 成本估算  3) 每轮用量柱状图  4) 账户余额
 * 汇总数字来自官方 adapter 上报的 tokenUsage 投影；余额来自官方接口；
 * 每轮柱状图优先取宿主从会话日志折叠的完整历史（/dsh-usage-chart/usage），
 * 请求失败时回退到「本页观测」增量（如实标注）。
 */
import { useMemo, useState } from 'react'
import type { TokenUsageBuckets } from '../pricing.ts'
import { billedInputTokens, cacheHitPercent, estimateCost, formatMoney, formatPricePerM, formatTokens, pricingFor } from '../pricing.ts'
import { currencySymbol, type BalanceData, type BalanceStatus } from './balance.ts'
import { refreshLiveRate, setDisplayCurrency, useDisplayCurrency } from './currency.ts'
import { HStack, Legend, SEGMENT_COLORS, tokenLegend, TurnBars, type TurnChartMode, type TurnUsage } from './charts.tsx'
import { getUiCopy, type UiLocale } from './i18n.ts'
import { useSessionUsage } from './usage-api.ts'

export interface ContextPressureView {
  pressureTokens?: number
  projectedTokens?: number
  contextWindow?: number
}

export interface UsagePanelProps {
  sessionId: string | undefined
  locale: UiLocale
  totals: TokenUsageBuckets
  model: string | undefined
  /** 回退：本页观测的每轮增量（仅当宿主历史不可用时展示）。 */
  observedTurns: readonly TurnUsage[]
  pressure: ContextPressureView | undefined
  /** 余额状态由指示器共享（同一实例，避免重复查询）。 */
  balanceStatus: BalanceStatus
  balanceData: BalanceData | null
  loadBalance: () => Promise<void>
}

function occupancyPercent(pressure: ContextPressureView | undefined): number | null {
  const used = pressure?.projectedTokens ?? pressure?.pressureTokens
  if (used === undefined || pressure?.contextWindow === undefined || pressure.contextWindow <= 0) return null
  return Math.min(100, Math.round((used / pressure.contextWindow) * 100))
}

export function UsagePanel(props: UsagePanelProps): JSX.Element {
  const [chartMode, setChartMode] = useState<TurnChartMode>('absolute')
  const [rateStatus, setRateStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle')
  const {
    sessionId, locale, totals, model, observedTurns, pressure,
    balanceStatus: status, balanceData: data, loadBalance: load,
  } = props
  const copy = getUiCopy(locale)
  const { currency, cnyPerUsd, rateFetchedAt } = useDisplayCurrency()

  const usage = useSessionUsage(sessionId)

  const cost = useMemo(() => estimateCost(totals, model), [totals, model])
  const pricing = pricingFor(model)
  const inputCost =
    ((totals.uncachedInputTokens + totals.cacheWriteTokens) * pricing.pricing.cacheMissInput
      + totals.cacheReadTokens * pricing.pricing.cacheHitInput) / 1_000_000
  const outputCost = (totals.outputTokens * pricing.pricing.output) / 1_000_000
  const occupancy = occupancyPercent(pressure)
  const cacheHit = cacheHitPercent(totals)
  const hasTokens = billedInputTokens(totals) > 0 || totals.outputTokens > 0
  // 价格说明：CNY 模式下显示换算后的刊例价与所用汇率。
  const currencySuffix = currency === 'cny' ? `CNY（1 USD ≈ ${cnyPerUsd} CNY）` : 'USD'

  const onRefreshRate = async (): Promise<void> => {
    setRateStatus('loading')
    const result = await refreshLiveRate()
    setRateStatus(result === 'ok' ? 'ok' : 'error')
  }

  const balance = data?.balances?.[0]

  // 每轮柱状图数据：优先宿主折叠的完整历史；失败/加载中时回退本页观测。
  const historyTurns = usage.status === 'ok' ? usage.turns : null
  const chartTurns = historyTurns ?? observedTurns
  const chartSourceNote = historyTurns !== null
    ? copy.historySource(chartTurns.length > 12)
    : usage.status === 'error'
      ? copy.historyFallback(usage.error ?? copy.unknown)
      : copy.historyLoading

  return (
    <div className="duc-panel" role="dialog" aria-label={copy.usageDetails}>
      <section className="duc-section">
        <div className="duc-section-head">
          <h4>{copy.sessionUsage}</h4>
          {model !== undefined && <span className="duc-section-meta">{model.replace(/^deepseek-/, '')}</span>}
        </div>
        {hasTokens ? (
          <>
            <div className="duc-grid">
              <div className="duc-cell"><b>{formatTokens(billedInputTokens(totals))}</b><span>{copy.billedInput}</span></div>
              <div className="duc-cell"><b>{formatTokens(totals.outputTokens)}</b><span>{copy.output}</span></div>
              <div className="duc-cell"><b>{cacheHit !== null ? `${cacheHit}%` : copy.unavailable}</b><span>{copy.cacheHit}</span></div>
              <div className="duc-cell"><b>{occupancy !== null ? `${occupancy}%` : copy.unavailable}</b><span>{copy.contextUsage}</span></div>
            </div>
            <HStack
              segments={[
                { label: copy.segments.miss, value: totals.uncachedInputTokens, color: SEGMENT_COLORS.miss },
                { label: copy.segments.hit, value: totals.cacheReadTokens, color: SEGMENT_COLORS.hit },
                { label: copy.segments.output, value: totals.outputTokens, color: SEGMENT_COLORS.output },
                { label: copy.segments.write, value: totals.cacheWriteTokens, color: SEGMENT_COLORS.write },
              ]}
            />
            <Legend items={tokenLegend(copy)} />
          </>
        ) : (
          <div className="duc-empty">{copy.sessionEmpty}</div>
        )}
      </section>

      <section className="duc-section">
        <div className="duc-section-head">
          <h4>{copy.costEstimate}</h4>
          <div className="duc-chart-actions">
            <div className="duc-view-toggle" role="group" aria-label={copy.currencyToggleLabel}>
              <button
                type="button"
                title={copy.currencyToggleUsdTitle}
                aria-pressed={currency === 'usd'}
                onClick={() => setDisplayCurrency('usd')}
              >$ USD</button>
              <button
                type="button"
                title={copy.currencyToggleCnyTitle}
                aria-pressed={currency === 'cny'}
                onClick={() => setDisplayCurrency('cny')}
              >¥ CNY</button>
            </div>
            <button
              type="button"
              className="duc-refresh"
              disabled={rateStatus === 'loading'}
              title={copy.refreshRateTitle}
              onClick={() => void onRefreshRate()}
            >{rateStatus === 'loading' ? copy.refreshingRate : copy.refreshRate}</button>
            <strong className="duc-section-value">≈ {formatMoney(cost.usd, currency, cnyPerUsd)}</strong>
          </div>
        </div>
        <div className="duc-cost-split">
          <span><i style={{ background: SEGMENT_COLORS.miss }} />{copy.inputCost} <b>{formatMoney(inputCost, currency, cnyPerUsd)}</b></span>
          <span><i style={{ background: SEGMENT_COLORS.output }} />{copy.outputCost} <b>{formatMoney(outputCost, currency, cnyPerUsd)}</b></span>
        </div>
        <HStack
          segments={[
            { label: copy.inputCost, value: inputCost, color: SEGMENT_COLORS.miss },
            { label: copy.outputCost, value: outputCost, color: SEGMENT_COLORS.output },
          ]}
        />
        <div className="duc-note">{copy.pricingNote(
          formatPricePerM(pricing.pricing.cacheMissInput, currency, cnyPerUsd),
          formatPricePerM(pricing.pricing.cacheHitInput, currency, cnyPerUsd),
          formatPricePerM(pricing.pricing.output, currency, cnyPerUsd),
          currencySuffix,
        )}</div>
        {currency === 'cny' && rateStatus !== 'idle' && (
          <div className="duc-note">{rateStatus === 'ok'
            ? copy.rateLive(cnyPerUsd, new Date(rateFetchedAt ?? Date.now()).toLocaleTimeString())
            : copy.rateError(cnyPerUsd)}</div>
        )}
      </section>

      <section className="duc-section">
        <div className="duc-section-head">
          <h4>{copy.roundUsage}</h4>
          <div className="duc-chart-actions">
            <div className="duc-view-toggle" role="group" aria-label={copy.chartDisplay}>
              <button
                type="button"
                title={copy.totalModeTitle}
                aria-pressed={chartMode === 'absolute'}
                onClick={() => setChartMode('absolute')}
              >{copy.totalMode}</button>
              <button
                type="button"
                title={copy.compositionModeTitle}
                aria-pressed={chartMode === 'ratio'}
                onClick={() => setChartMode('ratio')}
              >{copy.compositionMode}</button>
            </div>
            {usage.status === 'ok' && (
              <button type="button" className="duc-refresh" onClick={() => void usage.load()}>{copy.refresh}</button>
            )}
          </div>
        </div>
        <div className="duc-chart-explainer">
          <span>{copy.roundExplainer}</span>
          <b>{chartMode === 'absolute' ? copy.totalExplainer : copy.compositionExplainer}</b>
        </div>
        <TurnBars turns={chartTurns} mode={chartMode} locale={locale} />
        {chartTurns.length === 0
          ? <div className="duc-empty">{copy.roundEmpty}</div>
          : <><Legend items={tokenLegend(copy)} /><div className="duc-note">{chartSourceNote}</div></>}
      </section>

      <section className="duc-section">
        <div className="duc-section-head">
          <h4>{copy.accountBalance}</h4>
          <span className="duc-section-meta">DeepSeek API</span>
        </div>
        {status === 'loading' && <div className="duc-balance-skeleton" aria-label={copy.loadingBalance}><i /><span /></div>}
        {status === 'ok' && balance !== undefined && (
          <div className="duc-bal">
            <div className="duc-balance-primary">
              <span className="amount">{currencySymbol(balance.currency)}{balance.totalBalance}</span>
              <span className={data?.isAvailable ? 'duc-status-ok' : 'duc-status-warn'}>{data?.isAvailable ? copy.balanceEnough : copy.balanceLow}</span>
            </div>
            <div className="duc-balance-breakdown">
              <span>{copy.currency} <b>{balance.currency}</b></span>
              <span>{copy.toppedUp} <b>{balance.toppedUpBalance}</b></span>
              <span>{copy.granted} <b>{balance.grantedBalance}</b></span>
            </div>
          </div>
        )}
        {(status === 'error' || status === 'idle') && data !== null && (
          <div className="duc-err">
            <span>{data.reason === 'no-api-key'
              ? copy.noApiKey
              : copy.balanceError(data.message ?? data.reason ?? copy.unknown)}</span>
            <button type="button" onClick={() => void load()}>{copy.retry}</button>
          </div>
        )}
        {status === 'idle' && data === null && (
          <div className="duc-empty">{copy.balanceIdle}</div>
        )}
      </section>
    </div>
  )
}
