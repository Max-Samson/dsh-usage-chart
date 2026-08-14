/**
 * 用量可视化面板（编排根，不内联派生）：
 *  1) 会话汇总  2) 成本估算（价格快照 + 来源/时效/未知模型标注）  3) 每轮柱状图
 *     （absolute/ratio/cost 三视角 + 耗时叠加 + 异常标记 + 解释卡）  4) 账户余额
 * 汇总数字来自官方 adapter 上报的 tokenUsage 投影；余额来自官方接口；
 * 每轮柱状图优先取宿主从会话日志折叠的完整历史（/dsh-usage-chart/usage），
 * 请求失败时回退到「本页观测」增量（如实标注）。
 */
import { useMemo, useState } from 'react'
import type { TokenUsageBuckets } from '../pricing/calc.ts'
import { billedInputTokens, cacheHitPercent, costSplit, formatTokens, formatUsd } from '../pricing/calc.ts'
import { currencySymbol, type BalanceData, type BalanceStatus } from './balance.ts'
import { RoundBars, type RoundChartMode } from './chart/RoundBars.tsx'
import { HStack, Legend, SEGMENT_COLORS, tokenLegend } from './charts.tsx'
import { flagAnomalies } from './diagnose/anomaly.ts'
import { getUiCopy, type UiLocale } from './i18n.ts'
import { resolvePricing, usePricing } from './pricing-api.ts'
import { useHistoryRounds } from './rounds/history.ts'
import type { ChartRound } from './rounds/types.ts'

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
  observedRounds: readonly ChartRound[]
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
  const [chartMode, setChartMode] = useState<RoundChartMode>('absolute')
  const {
    sessionId, locale, totals, model, observedRounds, pressure,
    balanceStatus: status, balanceData: data, loadBalance: load,
  } = props
  const copy = getUiCopy(locale)

  const history = useHistoryRounds(sessionId)
  const pricing = usePricing()

  const historyRounds = history.status === 'ok' ? history.rounds : null
  const chartRounds = historyRounds ?? observedRounds
  const flags = useMemo(() => flagAnomalies(historyRounds ?? []), [historyRounds])

  // 成本估算：价格唯一输入是 /pricing 快照（ADR 2）；快照不可用则降级提示。
  const costView = useMemo(() => {
    if (pricing.table === null) return null
    return resolvePricing(pricing.table, model)
  }, [pricing.table, model])
  const costSplitTotal = useMemo(() => costView === null ? null : costSplit(totals, costView.pricing), [costView, totals])
  const occupancy = occupancyPercent(pressure)
  const cacheHit = cacheHitPercent(totals)
  const hasTokens = billedInputTokens(totals) > 0 || totals.outputTokens > 0

  const balance = data?.balances?.[0]

  const chartSourceNote = historyRounds !== null
    ? copy.historySource(chartRounds.length > 12)
    : history.status === 'error'
      ? copy.historyFallback(history.error ?? copy.unknown)
      : copy.historyLoading

  const sourceText = costView === null ? '' : costView.source === 'file'
    ? locale === 'zh' ? '用户覆盖 pricing.json' : 'user override pricing.json'
    : costView.source === 'builtin'
      ? locale === 'zh' ? '官方刊例价' : 'official list price'
      : locale === 'zh' ? '回退估算' : 'fallback estimate'
  const verifiedText = costView?.verifiedAt !== null && costView?.verifiedAt !== undefined
    ? `，${copy.pricingVerifiedLabel} ${new Date(costView.verifiedAt).toISOString().slice(0, 10)}`
    : ''

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
          <strong className="duc-section-value">
            {costSplitTotal !== null ? `≈ ${formatUsd(costSplitTotal.totalUsd)}` : copy.unavailable}
          </strong>
        </div>
        {costSplitTotal !== null && costView !== null ? (
          <>
            <div className="duc-cost-split">
              <span><i style={{ background: SEGMENT_COLORS.miss }} />{copy.inputCost} <b>{formatUsd(costSplitTotal.inputUsd)}</b></span>
              <span><i style={{ background: SEGMENT_COLORS.output }} />{copy.outputCost} <b>{formatUsd(costSplitTotal.outputUsd)}</b></span>
            </div>
            <HStack
              segments={[
                { label: copy.inputCost, value: costSplitTotal.inputUsd, color: SEGMENT_COLORS.miss },
                { label: copy.outputCost, value: costSplitTotal.outputUsd, color: SEGMENT_COLORS.output },
              ]}
            />
            <div className="duc-note">
              {copy.pricingNote(
                costView.pricing.cacheMissInput,
                costView.pricing.cacheHitInput,
                costView.pricing.output,
                sourceText,
                verifiedText,
              )}
              {!costView.known && model !== undefined && (
                <><span className="duc-unknown-chip">{copy.unknownModel}</span> {model}</>
              )}
            </div>
          </>
        ) : (
          <div className="duc-empty">{copy.costUnavailable}</div>
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
              <button
                type="button"
                title={copy.costModeTitle}
                aria-pressed={chartMode === 'cost'}
                onClick={() => setChartMode('cost')}
              >{copy.costMode}</button>
            </div>
            {history.status === 'ok' && (
              <button type="button" className="duc-refresh" onClick={() => void history.load()}>{copy.refresh}</button>
            )}
          </div>
        </div>
        <div className="duc-chart-explainer">
          <span>{copy.roundExplainer}</span>
          <b>{chartMode === 'absolute' ? copy.totalExplainer : chartMode === 'ratio' ? copy.compositionExplainer : copy.costExplainer}</b>
        </div>
        <RoundBars rounds={chartRounds} mode={chartMode} flags={flags} locale={locale} />
        {chartRounds.length === 0
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
