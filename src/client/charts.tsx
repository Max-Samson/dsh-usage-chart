/**
 * 零依赖 SVG 图表组件：每轮用量柱状图 + 水平堆叠条。
 * 不引入 echarts/recharts/d3 —— DSH web 未内置任何图表库，自绘 SVG 与
 * 平台自身渲染方式一致，体积最小、最稳定。
 */
import { useId, useState } from 'react'
import { formatTokens, type TokenUsageBuckets } from '../pricing.ts'
import { getUiCopy, type UiCopy, type UiLocale } from './i18n.ts'

export interface TurnUsage {
  /** 轮次号；-1 表示“当前轮（自页面加载起观测）”。 */
  turn: number
  buckets: TokenUsageBuckets
}

/** 语义色：输入未命中 / 输入命中 / 输出 / 写缓存。
 * 值为 CSS 变量（定义在 .duc-root 的 --duc-* 上，取自平台 static 色板），
 * 明暗主题下均可读；SVG 通过 style={{ fill }} 引用（fill 属性不解析 var()）。 */
export const SEGMENT_COLORS = {
  miss: 'var(--duc-miss)',
  hit: 'var(--duc-hit)',
  output: 'var(--duc-output)',
  write: 'var(--duc-write)',
} as const

export interface Segment {
  label: string
  value: number
  color: string
}

export type TurnChartMode = 'absolute' | 'ratio'

const BAR_HEIGHT = 96
const CHART_WIDTH = 640
const PAD_X = 10
const PAD_TOP = 22
const LABEL_HEIGHT = 22
const MAX_VISIBLE_TURNS = 12

function maxTotal(turns: readonly TurnUsage[]): number {
  let m = 0
  for (const t of turns) {
    const total = t.buckets.uncachedInputTokens + t.buckets.cacheReadTokens + t.buckets.outputTokens + t.buckets.cacheWriteTokens
    if (total > m) m = total
  }
  return m
}

/**
 * 每轮用量柱状图：每根柱按 输入未命中 / 输入命中 / 输出 / 写缓存 堆叠，
 * 高度按所有轮次的最大总量归一化。
 */
export function TurnBars({ turns, mode = 'absolute', locale }: { turns: readonly TurnUsage[]; mode?: TurnChartMode; locale: UiLocale }): JSX.Element | null {
  const tooltipId = useId()
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  if (turns.length === 0) return null
  const copy = getUiCopy(locale)
  const visibleTurns = turns.slice(-MAX_VISIBLE_TURNS)
  const max = Math.max(1, maxTotal(visibleTurns))
  const n = visibleTurns.length
  const gap = n <= 4 ? 18 : 9
  const available = CHART_WIDTH - PAD_X * 2
  const barW = Math.min(78, (available - gap * (n - 1)) / n)
  const groupWidth = barW * n + gap * (n - 1)
  const startX = (CHART_WIDTH - groupWidth) / 2
  const baseline = PAD_TOP + BAR_HEIGHT
  const svgHeight = baseline + LABEL_HEIGHT

  const segments = (b: TokenUsageBuckets): Segment[] => [
    { label: copy.segments.miss, value: b.uncachedInputTokens, color: SEGMENT_COLORS.miss },
    { label: copy.segments.hit, value: b.cacheReadTokens, color: SEGMENT_COLORS.hit },
    { label: copy.segments.output, value: b.outputTokens, color: SEGMENT_COLORS.output },
    { label: copy.segments.write, value: b.cacheWriteTokens, color: SEGMENT_COLORS.write },
  ]

  const activeTurn = activeIndex === null ? null : visibleTurns[activeIndex] ?? null
  const activeTotal = activeTurn === null
    ? 0
    : activeTurn.buckets.uncachedInputTokens + activeTurn.buckets.cacheReadTokens + activeTurn.buckets.outputTokens + activeTurn.buckets.cacheWriteTokens
  const activeParts = activeTurn === null ? [] : segments(activeTurn.buckets)
  const activeX = activeIndex === null ? 50 : ((startX + activeIndex * (barW + gap) + barW / 2) / CHART_WIDTH) * 100
  const activeIsCurrent = activeIndex === n - 1

  return (
    <div className="duc-chart-wrap">
      <svg className="duc-turn-chart" viewBox={`0 0 ${CHART_WIDTH} ${svgHeight}`} role="img" aria-label={copy.recentRoundsLabel(n, mode)}>
        <line className="duc-chart-baseline" x1={PAD_X} x2={CHART_WIDTH - PAD_X} y1={baseline} y2={baseline} />
        {visibleTurns.map((t, i) => {
        const x = startX + i * (barW + gap)
        const rawTotal = t.buckets.uncachedInputTokens + t.buckets.cacheReadTokens + t.buckets.outputTokens + t.buckets.cacheWriteTokens
        const total = Math.max(1, rawTotal)
        const totalHeight = mode === 'ratio' && rawTotal > 0 ? BAR_HEIGHT : (total / max) * BAR_HEIGHT
        let y = baseline
        const parts = segments(t.buckets)
          .filter((s) => s.value > 0)
          .map((s) => {
            const h = mode === 'ratio' ? (s.value / total) * BAR_HEIGHT : (s.value / max) * BAR_HEIGHT
            y -= h
            return <rect className="duc-chart-segment" key={s.label} x={x} y={y} width={barW} height={Math.max(0, h)} style={{ fill: s.color }} rx={1.5} />
          })
        const valueY = Math.max(16, baseline - totalHeight - 6)
        const isActive = activeIndex === i
        const isCurrent = i === n - 1
        const title = copy.roundTotalLabel(t.turn, isCurrent, formatTokens(rawTotal))
        return (
          <g
            key={`${t.turn}-${i}`}
            className={`duc-chart-turn${isCurrent ? ' duc-chart-turn-current' : ''}${isActive ? ' is-active' : ''}${activeIndex !== null && !isActive ? ' is-muted' : ''}`}
            role="img"
            tabIndex={0}
            aria-label={title}
            aria-describedby={isActive ? tooltipId : undefined}
            onPointerEnter={() => setActiveIndex(i)}
            onPointerLeave={() => setActiveIndex((active) => active === i ? null : active)}
            onFocus={() => setActiveIndex(i)}
            onBlur={() => setActiveIndex((active) => active === i ? null : active)}
          >
            {isCurrent && (
              <rect
                className="duc-chart-current-band"
                x={x - 4}
                y={baseline - totalHeight - 4}
                width={barW + 8}
                height={totalHeight + 8}
                rx={4}
              />
            )}
            {parts}
            <text className="duc-chart-value" x={x + barW / 2} y={valueY} textAnchor="middle">
              {formatTokens(rawTotal)}
            </text>
            <text className="duc-chart-label" x={x + barW / 2} y={baseline + 16} textAnchor="middle">
              {isCurrent ? copy.currentRound : copy.roundLabel(t.turn)}
            </text>
          </g>
        )
        })}
      </svg>
      {activeTurn !== null && (
        <div
          id={tooltipId}
          className="duc-chart-tooltip"
          role="tooltip"
          style={{ left: `${Math.max(22, Math.min(78, activeX))}%` }}
        >
          <div className="duc-chart-tooltip-head">
            <strong>{copy.roundTitle(activeTurn.turn, activeIsCurrent)}</strong>
            <b>{formatTokens(activeTotal)}</b>
          </div>
          <div className="duc-chart-tooltip-grid">
            {activeParts.map((part) => (
              <span key={part.label}>
                <i style={{ background: part.color }} />
                <em>{part.label}</em>
                <b>{formatTokens(part.value)}</b>
                <small>{activeTotal > 0 ? `${Math.round((part.value / activeTotal) * 100)}%` : '0%'}</small>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/** 水平堆叠条（汇总 / 成本构成）。 */
export function HStack({ segments }: { segments: readonly Segment[]; width?: number }): JSX.Element | null {
  const total = segments.reduce((a, s) => a + s.value, 0)
  if (total <= 0) return null
  const visible = segments.filter((segment) => segment.value > 0)
  const label = visible
    .map((segment) => `${segment.label} ${Math.round((segment.value / total) * 100)}%`)
    .join('，')
  return (
    <div className="duc-composition" role="img" aria-label={label}>
      {visible.map((segment) => (
        <span
          key={segment.label}
          style={{ flexBasis: `${(segment.value / total) * 100}%`, background: segment.color }}
          title={`${segment.label}: ${segment.value.toLocaleString()} (${Math.round((segment.value / total) * 100)}%)`}
        />
      ))}
    </div>
  )
}

/** 图例。 */
export function Legend({ items }: { items: readonly { label: string; color: string }[] }): JSX.Element {
  return (
    <div className="duc-legend">
      {items.map((it) => (
        <span key={it.label}><i style={{ background: it.color }} />{it.label}</span>
      ))}
    </div>
  )
}

export function tokenLegend(copy: UiCopy): readonly { label: string; color: string }[] {
  return [
    { label: copy.segments.miss, color: SEGMENT_COLORS.miss },
    { label: copy.segments.hit, color: SEGMENT_COLORS.hit },
    { label: copy.segments.output, color: SEGMENT_COLORS.output },
    { label: copy.segments.write, color: SEGMENT_COLORS.write },
  ]
}
