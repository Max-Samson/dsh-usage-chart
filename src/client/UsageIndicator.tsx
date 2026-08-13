/**
 * 输入框下方的用量指示器（挂载于 'conversation.composer.dock'）。
 * 一行展示：输入 / 输出 / 缓存命中率 / 成本估算 / 模型 / 余额，点击展开可视化面板。
 */
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { TokenUsageBuckets } from '../pricing.ts'
import { billedInputTokens, cacheHitPercent, estimateCost, formatTokens, formatUsd } from '../pricing.ts'
import { currencySymbol, useBalance } from './balance.ts'
import type { TurnUsage } from './charts.tsx'
import { UsagePanel } from './UsagePanel.tsx'
import { snapshotNodes, type ConversationNode, type ConversationSnapshot } from './snapshot.ts'

export interface DockUsageProps {
  /** 会话快照选择器（framework 标准套件）。 */
  useSession: <S>(selector: (s: ConversationSnapshot) => S) => S
  /** 投影读取钩子（framework 标准套件）。 */
  useProjection: (key: 'tokenUsage' | 'contextPressure') => unknown
  sessionId: string
  session: ConversationSnapshot
  input: unknown
}

interface TurnAcc {
  turns: readonly TurnUsage[]
  open: TurnUsage
}

const zero = (): TokenUsageBuckets => ({ uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })
const anyTokens = (b: TokenUsageBuckets): boolean => b.uncachedInputTokens + b.outputTokens + b.cacheReadTokens + b.cacheWriteTokens > 0

/**
 * 每轮用量累积：投影每次更新时把增量记到「当前轮」，轮次推进时封存上一轮。
 * 增量单调且按 (turn, step) 有序（token-meter 的不变量），归因准确；
 * 仅覆盖本页面加载以来的观测，语义在面板中如实标注。
 */
function useTurnUsage(
  totals: TokenUsageBuckets | undefined,
  nodes: readonly ConversationNode[],
): TurnAcc {
  const ref = useRef<{ prev: TokenUsageBuckets | undefined; sealed: Map<number, TokenUsageBuckets>; openTurn: number; open: TokenUsageBuckets }>({
    prev: undefined,
    sealed: new Map(),
    openTurn: -1,
    open: zero(),
  })

  const currentTurn = useMemo(() => {
    let m = 0
    for (const n of nodes) if (n.turn > m) m = n.turn
    return m
  }, [nodes])

  useLayoutEffect(() => {
    const r = ref.current
    if (totals === undefined) return
    if (r.prev === undefined) {
      r.prev = totals
      r.openTurn = currentTurn
      return
    }
    const delta: TokenUsageBuckets = {
      uncachedInputTokens: Math.max(0, totals.uncachedInputTokens - r.prev.uncachedInputTokens),
      outputTokens: Math.max(0, totals.outputTokens - r.prev.outputTokens),
      cacheReadTokens: Math.max(0, totals.cacheReadTokens - r.prev.cacheReadTokens),
      cacheWriteTokens: Math.max(0, totals.cacheWriteTokens - r.prev.cacheWriteTokens),
    }
    if (currentTurn !== r.openTurn) {
      if (anyTokens(r.open)) r.sealed.set(r.openTurn, r.open)
      r.openTurn = currentTurn
      r.open = zero()
    }
    if (anyTokens(delta)) {
      r.open.uncachedInputTokens += delta.uncachedInputTokens
      r.open.outputTokens += delta.outputTokens
      r.open.cacheReadTokens += delta.cacheReadTokens
      r.open.cacheWriteTokens += delta.cacheWriteTokens
    }
    r.prev = totals
  }, [totals, currentTurn])

  return useMemo(() => {
    const turns: TurnUsage[] = []
    for (const [turn, buckets] of ref.current.sealed) turns.push({ turn, buckets })
    turns.sort((a, b) => a.turn - b.turn)
    const open = { turn: ref.current.openTurn, buckets: { ...ref.current.open } }
    return { turns, open }
  }, [totals, currentTurn])
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

export function UsageIndicator(props: DockUsageProps): JSX.Element | null {
  const { useSession, useProjection, sessionId } = props
  const [expanded, setExpanded] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  // 悬浮面板的锚点坐标（fixed 定位，始终在可视区内）
  const [anchor, setAnchor] = useState<{ left: number; right: number; bottom: number } | null>(null)

  const totals = useProjection('tokenUsage') as TokenUsageBuckets | undefined
  const pressure = useProjection('contextPressure') as { pressureTokens?: number; projectedTokens?: number; contextWindow?: number } | undefined
  const nodes = useSession((s) => snapshotNodes(s))
  const model = useMemo(() => deriveModel(nodes), [nodes])
  const acc = useTurnUsage(totals, nodes)
  const { status: balanceStatus, data: balanceData, load: loadBalance } = useBalance(true)

  const hasTokens = totals !== undefined && (billedInputTokens(totals) > 0 || totals.outputTokens > 0)
  const cost = totals !== undefined ? estimateCost(totals, model) : undefined
  const cacheHit = totals !== undefined ? cacheHitPercent(totals) : null
  const balance = balanceData?.balances?.[0]

  // 计算悬浮面板锚点：贴在指示器行上方、左右对齐输入框。
  const updateAnchor = useMemo(() => () => {
    const el = rootRef.current
    if (el === null) return
    const r = el.getBoundingClientRect()
    setAnchor({ left: r.left, right: window.innerWidth - r.right, bottom: window.innerHeight - r.top + 8 })
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

  // 全空时保持隐藏（与官方 StatsLine 的零数据策略一致）。
  if (!hasTokens && model === undefined && balanceStatus !== 'ok' && balanceStatus !== 'loading' && !expanded) {
    return null
  }

  const parts: string[] = []
  if (hasTokens && totals !== undefined) {
    parts.push(`输入 ${formatTokens(billedInputTokens(totals))}`)
    parts.push(`输出 ${formatTokens(totals.outputTokens)}`)
    if (cacheHit !== null) parts.push(`缓存 ${cacheHit}%`)
  }
  if (cost !== undefined) parts.push(`成本 ${cost.estimated ? '≈' : ''}${formatUsd(cost.usd)}`)
  if (model !== undefined) parts.push(model.replace(/^deepseek-/, ''))

  const balanceLabel = balanceStatus === 'loading' || (balanceStatus === 'ok' && balance === undefined)
    ? '余额 …'
    : balance !== undefined
      ? `余额 ${currencySymbol(balance.currency)}${balance.totalBalance}`
      : '余额 –'

  const toggle = (): void => {
    setExpanded((v) => !v)
  }

  return (
    <div className="duc-root" ref={rootRef}>
      <button
        type="button"
        className="duc-toggle"
        aria-expanded={expanded}
        title={expanded ? '收起用量面板' : '展开用量面板'}
        onClick={toggle}
      >
        {expanded ? '▾' : '▸'}<span className="duc-toggle-label">用量</span>
      </button>
      {parts.map((p, i) => (
        <span key={p} className={p.startsWith('成本') || p.startsWith('≈') ? 'duc-est' : undefined}>
          {i > 0 && <span className="duc-sep" aria-hidden>·</span>}
          {p}
        </span>
      ))}
      {parts.length > 0 && <span className="duc-sep" aria-hidden>·</span>}
      <button
        type="button"
        className="duc-balance"
        title={balanceStatus === 'error' ? '点击重试余额查询' : '余额来自官方接口'}
        onClick={() => void loadBalance()}
      >
        {balanceLabel}
      </button>
      {expanded && anchor !== null && (
        <div
          className="duc-popover"
          style={{ left: anchor.left, right: anchor.right, bottom: anchor.bottom }}
        >
          <UsagePanel
            sessionId={sessionId}
            totals={totals ?? { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }}
            model={model}
            observedTurns={[...acc.turns, acc.open]}
            pressure={pressure}
            balanceStatus={balanceStatus}
            balanceData={balanceData}
            loadBalance={loadBalance}
          />
        </div>
      )}
    </div>
  )
}
