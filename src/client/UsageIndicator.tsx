/**
 * 输入框下方的用量指示器（挂载于 'conversation.composer.dock'）。
 * 一行展示：输入 / 输出 / 缓存命中率 / 成本估算 / 模型 / 余额 + 细上下文压力条，
 * 点击展开可视化面板。成本只消费 /pricing 快照（ADR 2），快照未就绪时隐藏成本位。
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { TokenUsageBuckets } from '../pricing/calc.ts'
import { billedInputTokens, cacheHitPercent, formatMoney, formatTokens } from '../pricing/calc.ts'
import { currencySymbol, useBalance } from './balance.ts'
import { useDisplayCurrency } from './currency.ts'
import { getUiCopy, useUiLocale } from './i18n.ts'
import { clampPanelOffset, PANEL_POS_KEY, readPanelOffset, type PanelOffset, type PanelRect } from './panel-position.ts'
import { resolveCost, usePricing } from './pricing-api.ts'
import { useHistoryRounds } from './rounds/history.ts'
import { useObservedRounds } from './rounds/observed.ts'
import { lastRoundModel, sameUsage, sumRoundCosts, usageDelta } from './rounds/summary.ts'
import { useSessionNodes, type ChatNodesHook, type ConversationNode, type ConversationSnapshot } from './snapshot.ts'
import type { ContextBreakdownData } from './diagnose/context.ts'
import { UsagePanel } from './UsagePanel.tsx'

export interface DockUsageProps {
  /** 会话快照选择器（framework 标准套件）。 */
  useSession: <S>(selector: (s: ConversationSnapshot) => S) => S
  /** chat 快照选择器（framework 标准套件；0.1.2 起节点列表在这里）。 */
  useChat?: ChatNodesHook
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

/**
 * fixed 定位的包含块：任一 transform/filter/contain 祖先都会把定位基准从视口改成它自己
 * （皮肤给 dock 子元素加了 backdrop-filter，面板随之整体偏移）。
 */
function containingBlock(start: HTMLElement): Element | null {
  // 属性可能不存在（旧浏览器）：undefined 一律按「不创建包含块」处理。
  const creates = (value: string | undefined): boolean => value !== undefined && value !== 'none' && value !== 'normal'
  for (let node: Element | null = start; node !== null; node = node.parentElement) {
    const style = getComputedStyle(node)
    if (creates(style.transform) || creates(style.translate) || creates(style.rotate) || creates(style.scale)
      || creates(style.perspective) || creates(style.filter) || creates(style.backdropFilter)
      || /\b(layout|paint|strict|content)\b/.test(style.contain)
      || creates(style.containerType)
      || /\b(transform|translate|rotate|scale|perspective|filter|backdrop-filter|contain)\b/.test(style.willChange)) return node
  }
  return null
}

export function UsageIndicator(props: DockUsageProps): JSX.Element | null {
  const { useSession, useChat, useProjection, sessionId } = props
  const locale = useUiLocale()
  const copy = getUiCopy(locale)
  const { currency } = useDisplayCurrency()
  const [expanded, setExpanded] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const toggleRef = useRef<HTMLButtonElement | null>(null)
  // 悬浮面板的锚点坐标（fixed 定位，始终在可视区内）
  const [anchor, setAnchor] = useState<{ left: number; width: number; bottom: number } | null>(null)
  // 面板可拖动：偏移叠加在锚点上（transform，不动包含块坐标换算），持久化到 localStorage。
  const [offset, setOffset] = useState<PanelOffset>(() => readPanelOffset())
  const offsetRef = useRef(offset)
  offsetRef.current = offset
  const panelRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{ pointerX: number; pointerY: number; offset: PanelOffset } | null>(null)

  const totals = useProjection('tokenUsage') as TokenUsageBuckets | undefined
  const pressure = useProjection('contextPressure') as { pressureTokens?: number; projectedTokens?: number; contextWindow?: number } | undefined
  const breakdown = useProjection('contextBreakdown') as ContextBreakdownData | undefined
  const nodes = useSessionNodes(useChat, useSession)
  const history = useHistoryRounds(sessionId)
  const usageVersion = totals === undefined ? null : [
    totals.uncachedInputTokens, totals.cacheReadTokens, totals.cacheWriteTokens, totals.outputTokens,
  ].join(':')
  const refreshVersion = useRef<{ sessionId: string; usage: string | null } | null>(null)
  const historyCurrent = history.status === 'ok' && (totals === undefined || sameUsage(totals, history.totals))
  const model = useMemo(() => {
    const live = deriveModel(nodes)
    const host = history.status === 'ok' ? lastRoundModel(history.rounds) : undefined
    return historyCurrent ? host ?? live : live ?? host
  }, [nodes, history.status, history.rounds, historyCurrent])
  const pricing = usePricing()
  const observedRounds = useObservedRounds(totals, nodes, pricing.table, currency)
  const { status: balanceStatus, data: balanceData, load: loadBalance } = useBalance(true)

  // Projection updates immediately; refresh the authoritative fold after a quiet period.
  useEffect(() => {
    if (history.status !== 'ok' || usageVersion === null) return
    const previous = refreshVersion.current
    if (previous?.sessionId === sessionId && previous.usage === usageVersion) return
    refreshVersion.current = { sessionId, usage: usageVersion }
    if (previous?.sessionId !== sessionId && historyCurrent) return
    const timer = window.setTimeout(() => { void history.load() }, 750)
    return () => window.clearTimeout(timer)
  }, [sessionId, usageVersion, history.status, historyCurrent, history.load])

  const hasTokens = totals !== undefined && (billedInputTokens(totals) > 0 || totals.outputTokens > 0)
  // 已折叠的轮次保留各自的模型/时段；实时投影领先时仅估算新增 token。
  const historyCost = history.status === 'ok' ? sumRoundCosts(history.rounds, currency) : null
  const delta = totals !== undefined && history.status === 'ok' ? usageDelta(totals, history.totals) : null
  const estimateBuckets = historyCost !== null && delta !== null ? delta : totals
  const estimate = estimateBuckets !== undefined && pricing.table !== null
    ? resolveCost(pricing.table, estimateBuckets, model, Date.now(), currency)
    : undefined
  let costSplitTotal = historyCurrent ? historyCost : null
  if (!historyCurrent && historyCost !== null && delta !== null && estimate !== undefined) {
    costSplitTotal = {
      input: historyCost.input + estimate.split.input,
      cacheRead: historyCost.cacheRead + estimate.split.cacheRead,
      output: historyCost.output + estimate.split.output,
      total: historyCost.total + estimate.split.total,
      estimated: true,
    }
  } else if (!historyCurrent && estimate !== undefined) {
    costSplitTotal = { ...estimate.split, estimated: true }
  }
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
    const left = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - width - 8))
    // 视口坐标 → 包含块坐标：面板是 fixed，祖先有 transform/filter/contain 时 left/bottom 以它为准。
    const block = containingBlock(el)
    const base = block?.getBoundingClientRect()
    // fixed 的坐标原点是包含块 padding box，而 DOMRect 覆盖 border box。
    const borderBottom = block === null ? 0 : Number.parseFloat(getComputedStyle(block).borderBottomWidth) || 0
    setAnchor({
      left: left - (base?.left ?? 0) - (block?.clientLeft ?? 0),
      width,
      bottom: (base?.bottom ?? window.innerHeight) - borderBottom - r.top + 8,
    })
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

  // 卸载时兜底恢复：拖动中途组件被卸载不该把整页文字设成不可选。
  useEffect(() => () => { document.body.style.userSelect = '' }, [])

  /** 当前包含块（祖先无 transform/filter/contain 时即视口）的视口矩形。 */
  const dragBounds = (): PanelRect => {
    const el = rootRef.current
    const rect = el === null ? undefined : containingBlock(el)?.getBoundingClientRect()
    return rect === undefined
      ? { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }
      : { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
  }

  /** 夹取并落盘一个候选偏移（面板矩形扣掉当前偏移 = 未位移基准）。 */
  const applyOffset = (next: PanelOffset): void => {
    const panel = panelRef.current
    let final = next
    if (panel !== null) {
      const rect = panel.getBoundingClientRect()
      const base = {
        left: rect.left - offsetRef.current.x,
        top: rect.top - offsetRef.current.y,
        right: rect.right - offsetRef.current.x,
        bottom: rect.bottom - offsetRef.current.y,
      }
      final = clampPanelOffset(next, base, dragBounds())
    }
    offsetRef.current = final // pointermove 是连续的，ref 必须立刻跟上（setState 异步）
    setOffset(final)
    try {
      localStorage.setItem(PANEL_POS_KEY, JSON.stringify(final))
    } catch {
      // 隐私模式 / 配额满：位置不持久化，拖动本身照常可用。
    }
  }

  /** 双击「用量」复位到按钮正上方（并清掉已存的位置）。 */
  const clearOffset = (): void => {
    offsetRef.current = { x: 0, y: 0 }
    setOffset({ x: 0, y: 0 })
    try {
      localStorage.removeItem(PANEL_POS_KEY)
    } catch {
      // ignore
    }
  }

  const beginDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    dragRef.current = { pointerX: event.clientX, pointerY: event.clientY, offset: offsetRef.current }
    event.currentTarget.setPointerCapture?.(event.pointerId)
    event.preventDefault()
    document.body.style.userSelect = 'none'
  }

  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (drag === null) return
    applyOffset({
      x: drag.offset.x + event.clientX - drag.pointerX,
      y: drag.offset.y + event.clientY - drag.pointerY,
    })
  }

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (dragRef.current === null) return
    dragRef.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    document.body.style.userSelect = ''
  }

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
  if (costSplitTotal !== null) parts.push({ key: 'cost', text: `${copy.cost} ${costSplitTotal.estimated ? '≈' : ''}${formatMoney(costSplitTotal.total, currency)}`, estimated: costSplitTotal.estimated })
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
        onDoubleClick={clearOffset}
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
          ref={panelRef}
          style={{ left: anchor.left, width: anchor.width, bottom: anchor.bottom, transform: `translate(${offset.x}px, ${offset.y}px)` }}
        >
          <div
            className="duc-popover-handle"
            title={copy.dragPanelTitle}
            onPointerDown={beginDrag}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          />
          <UsagePanel
            history={history}
            locale={locale}
            totals={totals ?? { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }}
            model={model}
            costSplitTotal={costSplitTotal}
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
