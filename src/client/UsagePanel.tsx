/**
 * 用量可视化面板（编排根，不内联派生）：
 *  1) 会话汇总  2) 成本估算（价格快照 + 来源/时效/未知模型标注）  3) 每轮柱状图
 *     （absolute/ratio/cost 三视角 + 耗时叠加 + 异常标记 + 解释卡）  4) 账户余额
 * 汇总数字来自官方 adapter 上报的 tokenUsage 投影；余额来自官方接口；
 * 每轮柱状图优先取宿主从会话日志折叠的完整历史（/dsh-usage-chart/usage），
 * 请求失败时回退到「本页观测」增量（如实标注）。
 */
import { useEffect, useMemo, useState } from 'react'
import type { PriceTierId, TokenUsageBuckets } from '../pricing/calc.ts'
import { billedInputTokens, cacheHitPercent, costSplitAt, formatMoney, formatPricePerM, formatTokens, tierAt } from '../pricing/calc.ts'
import { currencySymbol, type BalanceData, type BalanceStatus } from './balance.ts'
import { refreshLiveRate, setDisplayCurrency, useDisplayCurrency } from './currency.ts'
import { RoundBars, type RoundChartMode } from './chart/RoundBars.tsx'
import { HStack, Legend, SEGMENT_COLORS, tokenLegend } from './charts.tsx'
import { flagAnomalies } from './diagnose/anomaly.ts'
import { analyzeContext, type ContextBreakdownData } from './diagnose/context.ts'
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
  breakdown?: ContextBreakdownData
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

/**
 * 当前计费时段（v1.0.1）：按北京时间实时判定高峰/空闲，跨整点及周末自动翻转。
 * 高峰时段（北京时间周一至周五 09:00–12:00、14:00–18:00）价格为空闲时段的 2 倍。
 */
function useCurrentTier(): PriceTierId {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])
  return tierAt(now)
}

export function UsagePanel(props: UsagePanelProps): JSX.Element {
  const [chartMode, setChartMode] = useState<RoundChartMode>('absolute')
  const [rateStatus, setRateStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle')
  const {
    sessionId, locale, totals, model, observedRounds, pressure, breakdown,
    balanceStatus: status, balanceData: data, loadBalance: load,
  } = props
  const copy = getUiCopy(locale)
  const { currency, cnyPerUsd, rateFetchedAt } = useDisplayCurrency()
  const currencySuffix = currency === 'cny' ? `CNY（1 USD ≈ ${cnyPerUsd} CNY）` : 'USD'
  const currentTier = useCurrentTier()

  const onRefreshRate = async (): Promise<void> => {
    setRateStatus('loading')
    const result = await refreshLiveRate()
    setRateStatus(result === 'ok' ? 'ok' : 'error')
  }

  const history = useHistoryRounds(sessionId)
  const pricing = usePricing()

  const historyRounds = history.status === 'ok' ? history.rounds : null
  const chartRounds = historyRounds ?? observedRounds
  const flags = useMemo(() => flagAnomalies(historyRounds ?? []), [historyRounds])
  const contextReport = useMemo(
    () => analyzeContext(pressure, breakdown, history.compactions, currency),
    [pressure, breakdown, history.compactions, currency],
  )
  // 成本估算：价格唯一输入是 /pricing 快照（ADR 2）；快照不可用则降级提示。
  // 模型归因优先 host 折叠（ADR 1 权威基准），快照 provenance 推导仅作回退。
  const hostModel = useMemo(() => {
    const list = history.status === 'ok' ? history.rounds : []
    const last = list.length > 0 ? list[list.length - 1] : null
    return last?.model ?? null
  }, [history.status, history.rounds])
  const effectiveModel = hostModel ?? model ?? undefined
  const costView = useMemo(() => {
    if (pricing.table === null) return null
    return resolvePricing(pricing.table, effectiveModel)
  }, [pricing.table, effectiveModel])
  // 面板汇总成本：按所选币种的官方刊例价、按高峰/空闲时段计费。时段取
  // 「最近一轮历史的开始时刻」（更贴近实际发生时段；无历史时用当前时刻）。
  const costSplitTotal = useMemo(() => {
    if (costView === null) return null
    const last = historyRounds !== null && historyRounds.length > 0 ? historyRounds[historyRounds.length - 1] : null
    return costSplitAt(totals, costView.pricing, last?.startedAt ?? Date.now(), currency)
  }, [costView, totals, historyRounds, currency])
  const occupancy = occupancyPercent(pressure)
  const cacheHit = cacheHitPercent(totals)
  const hasTokens = billedInputTokens(totals) > 0 || totals.outputTokens > 0

  const balance = data?.balances?.[0]

  const chartSourceNote = historyRounds !== null
    ? copy.historySource(chartRounds.length)
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
          <span className="duc-head-right">
            <span
              className={`duc-tier-tag duc-tier-${currentTier.toLowerCase()}`}
              title={`${copy.tiers[currentTier]}：${copy.tierWindow[currentTier]}`}
            >{copy.tiers[currentTier]}</span>
            {effectiveModel !== undefined && <span className="duc-section-meta">{effectiveModel.replace(/^deepseek-/, '')}</span>}
          </span>
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
          </>
        ) : (
          <div className="duc-empty">{copy.sessionEmpty}</div>
        )}
      </section>
      {/* v1.1.0：上下文构成与压缩诊断 */}
      <section className="duc-section">
        <div className="duc-section-head">
          <h4>{copy.contextDiagnostics}</h4>
          <span className="duc-section-meta">
            {occupancy !== null ? `${copy.contextUsage} ${occupancy}%` : copy.unavailable}
            {contextReport.compaction.count > 0 ? ` · ✂️ ${formatTokens(contextReport.compaction.totalFreedTokens)}` : ''}
          </span>
        </div>
        {contextReport.breakdown.isAvailable ? (
          <>
            <div className="duc-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
              <div className="duc-cell">
                <b>{formatTokens(contextReport.breakdown.system.tokens)}</b>
                <span>{copy.systemTokens} ({contextReport.breakdown.system.percent}%)</span>
              </div>
              <div className="duc-cell">
                <b>{formatTokens(contextReport.breakdown.tools.tokens)}</b>
                <span>{copy.toolsTokens} ({contextReport.breakdown.tools.percent}%)</span>
              </div>
              <div className="duc-cell">
                <b>{formatTokens(contextReport.breakdown.messages.tokens)}</b>
                <span>{copy.messageTokens} ({contextReport.breakdown.messages.percent}%)</span>
              </div>
            </div>
            <div className="duc-context-bar">
              <span style={{ width: `${contextReport.breakdown.system.percent}%`, background: 'var(--duc-hit, #45a9c7)' }} />
              <span style={{ width: `${contextReport.breakdown.tools.percent}%`, background: 'var(--duc-write, #d99a2b)' }} />
              <span style={{ width: `${contextReport.breakdown.messages.percent}%`, background: 'var(--duc-output, #43b96f)' }} />
            </div>
            <div className="duc-note">{copy.contextApproxNote}</div>
          </>
        ) : (
          <div className="duc-empty">{copy.unavailable}</div>
        )}

        {contextReport.compaction.count > 0 && (
          <div className="duc-compaction-list">
            <div className="duc-note" style={{ marginTop: '4px', fontWeight: 600 }}>
              {copy.compactionSavingsTotal(formatTokens(contextReport.compaction.totalFreedTokens), contextReport.compaction.count)}
            </div>
            {contextReport.compaction.items.map((item) => (
              <div key={item.seq} className="duc-compaction-item">
                <div className="duc-compaction-item-left">
                  <span className="duc-compaction-badge">{copy.compactionRound(item.turn)}</span>
                  <span className="duc-compaction-freed">✂️ {copy.compactionFreed(formatTokens(item.shadowedTokens))}</span>
                </div>
                <div className="duc-compaction-cost">
                  {item.costCny !== null
                    ? copy.compactionCost(formatMoney(currency === 'cny' ? item.costCny : (item.costUsd ?? item.costCny / cnyPerUsd), currency))
                    : ''}
                </div>
              </div>
            ))}
          </div>
        )}

        {contextReport.suggestion === 'critical' && (
          <div className="duc-suggestion duc-suggestion-critical">{copy.contextSuggestionCritical}</div>
        )}
        {contextReport.suggestion === 'caution' && (
          <div className="duc-suggestion duc-suggestion-caution">{copy.contextSuggestionCaution}</div>
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
            <strong className="duc-section-value">
              {costSplitTotal !== null ? `≈ ${formatMoney(costSplitTotal.total, currency)}` : copy.unavailable}
            </strong>
          </div>
        </div>
        {costSplitTotal !== null && costView !== null ? (
          <>
            <div className="duc-cost-split">
              <span><i style={{ background: SEGMENT_COLORS.miss }} />{copy.inputCost} <b>{formatMoney(costSplitTotal.input, currency)}</b></span>
              <span><i style={{ background: SEGMENT_COLORS.output }} />{copy.outputCost} <b>{formatMoney(costSplitTotal.output, currency)}</b></span>
            </div>
            <HStack
              segments={[
                { label: copy.inputCost, value: costSplitTotal.input, color: SEGMENT_COLORS.miss },
                { label: copy.outputCost, value: costSplitTotal.output, color: SEGMENT_COLORS.output },
              ]}
            />
            <div className="duc-note">
              {copy.pricingNote(
                `${formatPricePerM(costView.pricing.offPeak[currency].cacheMissInput, currency)}/${formatPricePerM(costView.pricing.peak[currency].cacheMissInput, currency)}`,
                `${formatPricePerM(costView.pricing.offPeak[currency].cacheHitInput, currency)}/${formatPricePerM(costView.pricing.peak[currency].cacheHitInput, currency)}`,
                `${formatPricePerM(costView.pricing.offPeak[currency].output, currency)}/${formatPricePerM(costView.pricing.peak[currency].output, currency)}`,
                currencySuffix,
                sourceText,
                verifiedText,
              )}
              {!costView.known && effectiveModel !== undefined && (
                <><span className="duc-unknown-chip">{copy.unknownModel}</span> {model}</>
              )}
            </div>
            {currency === 'cny' && rateStatus !== 'idle' && (
              <div className="duc-note">{rateStatus === 'ok'
                ? copy.rateLive(cnyPerUsd, new Date(rateFetchedAt ?? Date.now()).toLocaleTimeString())
                : copy.rateError(cnyPerUsd)}</div>
            )}
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
        <RoundBars rounds={chartRounds} mode={chartMode} flags={flags} locale={locale} currency={currency} />
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
