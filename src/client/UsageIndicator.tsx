/**
 * 输入框下方的用量指示器（挂载于 'conversation.composer.dock'）。
 * 一行展示：输入 / 输出 / 缓存命中率 / 成本估算 / 模型 / 余额 + 细上下文压力条，
 * 点击展开可视化面板。成本只消费 /pricing 快照（ADR 2），快照未就绪时隐藏成本位。
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { TokenUsageBuckets } from '../pricing/calc.ts'
import { billedInputTokens, cacheHitPercent, formatMoney, formatTokens } from '../pricing/calc.ts'
import { currencySymbol, useBalance } from './balance.ts'
import { useDisplayCurrency } from './currency.ts'
import { getUiCopy, useUiLocale } from './i18n.ts'
import { resolveCost, usePricing } from './pricing-api.ts'
import { useObservedRounds } from './rounds/observed.ts'
import { snapshotNodes, type ConversationNode, type ConversationSnapshot } from './snapshot.ts'
import type { ContextBreakdownData } from './diagnose/context.ts'
import { UsagePanel } from './UsagePanel.tsx'

export interface DockUsageProps {
  /** 会话快照选择器（framework 标准套件）。 */
  useSession: <S>(selector: (s: ConversationSnapshot) => S) => S
  /** 投影读取钩子（framework 标准套件）。 */
  useProjection: (key: 'tokenUsage' | 'contextPressure' | 'contextBreakdown') => unknown
  sessionId: string
  session: ConversationSnapshot
  input: unknown
}

function deriveModel(nodes: readonly ConversationNode[]): string | undefined {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i]
    if (n.kind !== 'assistant') continue
    if (n.provenance?.model !== undefined && n.provenance.model !== '') return n.provenance.model
    if (n.requestConfig?.model !== undefined && n.requestConfig.model !== '') return n.requestConfig.model
  }
  return undefined
}

function pressurePercent(pressure: { pressureTokens?: number; projectedTokens?: number; contextWindow?: number } | undefined): number | null {
  const used = pressure?.projectedTokens ?? pressure?.pressureTokens
  if (used === undefined || pressure?.contextWindow === undefined || pressure.contextWindow <= 0) return null
  return Math.min(100, Math.round((used / pressure.contextWindow) * 100))
}

/** Solar Chart Bold, supplied project asset. Uses currentColor for both DSH themes. */
function ChartIcon(): JSX.Element {
  return (
    <svg className="duc-toggle-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M20 13.75C20 13.3358 19.6642 13 19.25 13H16.25C15.8358 13 15.5 13.3358 15.5 13.75V20.5H14V4.25C14 3.52169 13.9984 3.05091 13.9518 2.70403C13.908 2.37872 13.8374 2.27676 13.7803 2.21967C13.7232 2.16258 13.6213 2.09197 13.296 2.04823C12.9491 2.00159 12.4783 2 11.75 2C11.0217 2 10.5509 2.00159 10.204 2.04823C9.87872 2.09197 9.77676 2.16258 9.71967 2.21967C9.66258 2.27676 9.59196 2.37872 9.54823 2.70403C9.50159 3.05091 9.5 3.52169 9.5 4.25V20.5H8V8.75C8 8.33579 7.66421 8 7.25 8H4.25C3.83579 8 3.5 8.33579 3.5 8.75V20.5H2H1.75C1.33579 20.5 1 20.8358 1 21.25C1 21.6642 1.33579 22 1.75 22H21.75C22.1642 22 22.5 21.6642 22.5 21.25C22.5 20.8358 22.1642 20.5 21.75 20.5H21.5H20V13.75Z" />
    </svg>
  )
}

export function UsageIndicator(props: DockUsageProps): JSX.Element | null {
  const { useSession, useProjection, sessionId } = props
  const locale = useUiLocale()
  const copy = getUiCopy(locale)
  const { currency } = useDisplayCurrency()
  const [expanded, setExpanded] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const toggleRef = useRef<HTMLButtonElement | null>(null)
  // 悬浮面板的锚点坐标（fixed 定位，始终在可视区内）
  const [anchor, setAnchor] = useState<{ left: number; width: number; bottom: number } | null>(null)

  const totals = useProjection('tokenUsage') as TokenUsageBuckets | undefined
  const pressure = useProjection('contextPressure') as { pressureTokens?: number; projectedTokens?: number; contextWindow?: number } | undefined
  const breakdown = useProjection('contextBreakdown') as ContextBreakdownData | undefined
  const nodes = useSession((s) => snapshotNodes(s))
  const model = useMemo(() => deriveModel(nodes), [nodes])
  const pricing = usePricing()
  const observedRounds = useObservedRounds(totals, nodes, pricing.table, currency)
  const { status: balanceStatus, data: balanceData, load: loadBalance } = useBalance(true)

  const hasTokens = totals !== undefined && (billedInputTokens(totals) > 0 || totals.outputTokens > 0)
  const cost = totals !== undefined && pricing.table !== null ? resolveCost(pricing.table, totals, model, Date.now(), currency) : undefined
  const cacheHit = totals !== undefined ? cacheHitPercent(totals) : null
  const pressurePct = pressurePercent(pressure)
  const breakdownTotal = (breakdown?.systemTokens ?? 0) + (breakdown?.toolsTokens ?? 0) + (breakdown?.messageTokens ?? 0)
  const hasBreakdown = breakdownTotal > 0 && pressurePct !== null
  const sysW = hasBreakdown ? Math.max(1, Math.round(((breakdown?.systemTokens ?? 0) / breakdownTotal) * pressurePct)) : 0
  const toolW = hasBreakdown ? Math.max(0, Math.round(((breakdown?.toolsTokens ?? 0) / breakdownTotal) * pressurePct)) : 0
  const msgW = hasBreakdown ? Math.max(0, pressurePct - sysW - toolW) : 0
  const pressureTitle = pressurePct === null ? '' : hasBreakdown
    ? `${copy.pressureBarTitle(pressurePct)} (${copy.systemTokens} ${Math.round(((breakdown?.systemTokens ?? 0) / breakdownTotal) * 100)}% · ${copy.toolsTokens} ${Math.round(((breakdown?.toolsTokens ?? 0) / breakdownTotal) * 100)}% · ${copy.messageTokens} ${Math.round(((breakdown?.messageTokens ?? 0) / breakdownTotal) * 100)}%)`
    : copy.pressureBarTitle(pressurePct)
  const balance = balanceData?.balances?.[0]
  // 计算悬浮面板锚点：贴在指示器行上方、左右对齐输入框。
  const updateAnchor = useMemo(() => () => {
    const el = rootRef.current
    if (el === null) return
    const r = el.getBoundingClientRect()
    const width = Math.min(Math.max(r.width, 320), 520, window.innerWidth - 16)
    const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8)
    setAnchor({ left, width, bottom: window.innerHeight - r.top + 8 })
  }, [])

  useLayoutEffect(() => {
    if (!expanded) return
    updateAnchor()
    const raf = requestAnimationFrame(updateAnchor)
    window.addEventListener('resize', updateAnchor)
    window.addEventListener('scroll', updateAnchor, true)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', updateAnchor)
      window.removeEventListener('scroll', updateAnchor, true)
    }
  }, [expanded, updateAnchor])

  useEffect(() => {
    if (!expanded) return
    const closeOutside = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Node && rootRef.current !== null && !rootRef.current.contains(target)) setExpanded(false)
    }
    const closeWithKeyboard = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setExpanded(false)
      toggleRef.current?.focus()
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeWithKeyboard)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeWithKeyboard)
    }
  }, [expanded])

  // 全空时保持隐藏（与官方 StatsLine 的零数据策略一致）。
  if (!hasTokens && model === undefined && balanceStatus !== 'ok' && balanceStatus !== 'loading' && !expanded) {
    return null
  }

  const parts: { key: string; text: string; estimated?: boolean }[] = []
  if (hasTokens && totals !== undefined) {
    parts.push({ key: 'input', text: `${copy.input} ${formatTokens(billedInputTokens(totals))}` })
    parts.push({ key: 'output', text: `${copy.output} ${formatTokens(totals.outputTokens)}` })
    if (cacheHit !== null) parts.push({ key: 'cache', text: `${copy.cache} ${cacheHit}%` })
  }
  if (cost !== undefined) parts.push({ key: 'cost', text: `${copy.cost} ${cost.estimated ? '≈' : ''}${formatMoney(cost.split.total, currency)}`, estimated: cost.estimated })
  if (model !== undefined) parts.push({ key: 'model', text: model.replace(/^deepseek-/, '') })

  const balanceLabel = balanceStatus === 'loading' || (balanceStatus === 'ok' && balance === undefined)
    ? `${copy.balance} …`
    : balance !== undefined
      ? `${copy.balance} ${currencySymbol(balance.currency)}${balance.totalBalance}`
      : `${copy.balance} --`

  const toggle = (): void => {
    setExpanded((v) => !v)
  }

  return (
    <div className="duc-root" ref={rootRef} lang={locale === 'zh' ? 'zh-CN' : 'en'}>
      <button
        ref={toggleRef}
        type="button"
        className="duc-toggle"
        aria-expanded={expanded}
        title={expanded ? copy.collapseUsage : copy.expandUsage}
        onClick={toggle}
      >
        <ChartIcon />
        <span className="duc-toggle-label">{copy.usage}</span>
        <span className="duc-toggle-caret" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
      </button>
      {parts.map((p, i) => (
        <span key={p.key} className={p.estimated === true ? 'duc-est' : undefined}>
          {i > 0 && <span className="duc-sep" aria-hidden>·</span>}
          {p.text}
        </span>
      ))}
      {parts.length > 0 && <span className="duc-sep" aria-hidden>·</span>}
      {pressurePct !== null && (
        <span
          className="duc-pressure"
          role="img"
          aria-label={copy.pressureBarLabel(`${pressurePct}%`)}
          title={pressureTitle}
          data-level={pressurePct >= 90 ? 'critical' : pressurePct >= 75 ? 'high' : undefined}
        >
          {hasBreakdown ? (
            <>
              <span className="duc-pressure-seg duc-pressure-seg-system" style={{ width: `${sysW}%` }} />
              <span className="duc-pressure-seg duc-pressure-seg-tools" style={{ width: `${toolW}%` }} />
              <span className="duc-pressure-seg duc-pressure-seg-messages" style={{ width: `${msgW}%` }} />
            </>
          ) : (
            <i style={{ width: `${pressurePct}%` }} />
          )}
        </span>
      )}
      <button
        type="button"
        className="duc-balance"
        title={balanceStatus === 'error' ? copy.retryBalanceTitle : copy.officialBalanceTitle}
        onClick={() => void loadBalance()}
      >
        {balanceLabel}
      </button>
      {expanded && anchor !== null && (
        <div
          className="duc-popover"
          style={{ left: anchor.left, width: anchor.width, bottom: anchor.bottom }}
        >
          <UsagePanel
            sessionId={sessionId}
            locale={locale}
            totals={totals ?? { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }}
            model={model}
            observedRounds={observedRounds}
            pressure={pressure}
            breakdown={breakdown}
            balanceStatus={balanceStatus}
            balanceData={balanceData}
            loadBalance={loadBalance}
          />
        </div>
      )}
    </div>
  )
}
