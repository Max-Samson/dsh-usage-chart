/**
 * RoundBars（深模块）：每轮用量柱状图，三种视角 + 解释卡。
 *
 * - 视角：absolute（token 总量）/ ratio（构成 100%）/ cost（各桶 × 单价堆叠成本）；
 * - 耗时叠加层：柱顶点线（总耗时，零依赖 SVG 折线）——「贵是因为慢还是 token 多」一眼可见；
 * - 异常轮次标记：相对近 N 轮成本突增的轮次加警示描边 + 角标，Tooltip 显示归因 chip；
 * - 缓存命中迷你趋势：柱底小刻度融入现有图，不单独成图；
 * - Tooltip 解释卡：token 分桶 + 成本 + 模型 + 耗时/TTFT/TPS + 缓存命中 + 结束原因。
 *
 * v1.0.0（本轮）：不再截断最近 12 轮——全部轮次渲染进横向滚动容器
 * （固定细柱宽，超出视口的部分左右滑动查看；自动滚到最新轮次，越界时出现
 * 箭头按钮 + 边缘渐隐提示）。SVG 单位恒为 1:1 CSS px（viewBox 宽 == 样式宽），
 * 因此工具提示可用内容坐标 - scrollLeft 精确定位，与滚动位置无关。
 *
 * 零依赖 SVG；复用既有交互路径（hover / focus / 当前轮高亮）。
 */
import { useId, useLayoutEffect, useRef, useState } from 'react'
import { cacheHitPercent, formatDuration, formatMoney, formatTokens, tierAt, type CostCurrency, type TokenUsageBuckets } from '../../pricing/calc.ts'
import { SEGMENT_COLORS } from '../charts.tsx'
import type { AnomalyFlag } from '../diagnose/anomaly.ts'
import { getUiCopy, type UiCopy, type UiLocale } from '../i18n.ts'
import type { ChartRound } from '../rounds/types.ts'

export type RoundChartMode = 'absolute' | 'ratio' | 'cost'

export interface Segment {
  label: string
  value: number
  color: string
}

const BAR_HEIGHT = 76
const PAD_X = 10
const PAD_TOP = 18
const LABEL_HEIGHT = 18
const TICK_HEIGHT = 20
/** 固定细柱宽与柱间距：无论轮次多少柱宽恒定，视觉不再随数据拥挤。 */
const BAR_WIDTH = 30
const GAP = 10
const SLOT = BAR_WIDTH + GAP
/** 图表最小宽度（CSS px，SVG 单位 1:1）。轮次少时图表居中显示，不拉伸柱宽。 */
const MIN_CHART_WIDTH = 480
/** 值标签的最大字符数：过长（如 "$0.0013"、"123.4K"）时省略，避免与相邻柱重叠。 */
const MAX_VALUE_LABEL_CHARS = 5
/** 成本视角值标签的最大字符数：成本数值（如 "¥0.0013"）偏长，放宽以便逐轮可见。 */
const COST_LABEL_MAX_CHARS = 9
/** 工具提示相对可见区边缘的最小留白（px，解释卡宽 240px 的一半 + 边距）。 */
const TOOLTIP_MARGIN = 126
/** 耗时叠加：柱顶偏移的最大像素（随总耗时归一化）。 */
const DURATION_BAND = 11

function tokenTotal(b: TokenUsageBuckets): number {
  return b.uncachedInputTokens + b.cacheReadTokens + b.outputTokens + b.cacheWriteTokens
}

function tokenSegments(copy: UiCopy, b: TokenUsageBuckets): Segment[] {
  return [
    { label: copy.segments.miss, value: b.uncachedInputTokens, color: SEGMENT_COLORS.miss },
    { label: copy.segments.hit, value: b.cacheReadTokens, color: SEGMENT_COLORS.hit },
    { label: copy.segments.output, value: b.outputTokens, color: SEGMENT_COLORS.output },
    { label: copy.segments.write, value: b.cacheWriteTokens, color: SEGMENT_COLORS.write },
  ]
}

function costSegments(copy: UiCopy, round: ChartRound, currency: CostCurrency): Segment[] {
  const cost = round.cost
  if (cost === null || typeof cost !== 'object') return []
  const split = cost[currency] ?? cost.cny ?? cost.usd
  if (split === undefined || split === null) return []
  return [
    { label: copy.inputCost, value: split.input, color: SEGMENT_COLORS.miss },
    { label: copy.segments.hit, value: split.cacheRead, color: SEGMENT_COLORS.hit },
    { label: copy.outputCost, value: split.output, color: SEGMENT_COLORS.output },
  ]
}

/** 该轮在本视角下的「总量」（决定柱高/值标签）。 */
function roundTotal(round: ChartRound, mode: RoundChartMode, currency: CostCurrency): number {
  if (mode === 'cost') return round.cost?.[currency]?.total ?? 0
  return tokenTotal(round.buckets)
}

function formatTotal(value: number, mode: RoundChartMode, currency: CostCurrency): string {
  return mode === 'cost' ? formatMoney(value, currency) : formatTokens(value)
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value))
}

export function RoundBars({
  rounds,
  mode = 'absolute',
  flags = [],
  locale,
  currency = 'cny',
}: {
  rounds: readonly ChartRound[]
  mode?: RoundChartMode
  flags?: readonly AnomalyFlag[]
  locale: UiLocale
  /** 成本视角的显示币种（官方 CNY / USD 刊例价）。 */
  currency?: CostCurrency
}): JSX.Element | null {
  const tooltipId = useId()
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const [scrollLeft, setScrollLeft] = useState(0)
  const [viewportW, setViewportW] = useState(0)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  // 测量可见区宽度（驱动箭头/渐隐的出现与工具提示的边界收敛）。
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el === null) return
    const update = (): void => setViewportW(el.clientWidth)
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // 新数据（轮次变化）或切换视角后自动滚回最新轮次，保证「当前轮」始终可见。
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el !== null) el.scrollLeft = el.scrollWidth
  }, [rounds, mode])

  if (rounds.length === 0) return null
  const copy = getUiCopy(locale)

  const n = rounds.length
  const contentWidth = PAD_X * 2 + n * BAR_WIDTH + Math.max(0, n - 1) * GAP
  // 最小宽度自适应可见区：≤480px 时填满容器（不滚动、不拉伸柱宽），
  // 更宽时取 480px 居中；内容超出时 svgWidth = 内容宽 → 横向滚动。
  const targetMin = Math.min(MIN_CHART_WIDTH, viewportW > 0 ? viewportW : MIN_CHART_WIDTH)
  const svgWidth = Math.max(contentWidth, targetMin)
  const startX = (svgWidth - contentWidth) / 2 + PAD_X
  const baseline = PAD_TOP + BAR_HEIGHT
  const svgHeight = baseline + LABEL_HEIGHT + TICK_HEIGHT

  const maxValue = Math.max(1, ...rounds.map((r) => roundTotal(r, mode, currency)))
  let maxDuration = 0
  for (const r of rounds) if (r.durationMs !== null && r.durationMs > maxDuration) maxDuration = r.durationMs
  const hasDuration = maxDuration > 0

  const flagByTurn = new Map<number, AnomalyFlag>()
  for (const flag of flags) flagByTurn.set(flag.turn, flag)

  const segmentsOf = (r: ChartRound): Segment[] => (mode === 'cost' ? costSegments(copy, r, currency) : tokenSegments(copy, r.buckets))

  const onScroll = (): void => {
    const el = scrollRef.current
    if (el === null) return
    setScrollLeft((prev) => (Math.abs(prev - el.scrollLeft) < 1 ? prev : el.scrollLeft))
  }

  // 越界状态：驱动箭头按钮与边缘渐隐的显隐。
  const scrollable = viewportW > 0 && svgWidth > viewportW + 1
  const maxScroll = Math.max(0, svgWidth - viewportW)
  const canScrollLeft = scrollable && scrollLeft > 1
  const canScrollRight = scrollable && scrollLeft < maxScroll - 1

  const scrollBy = (dir: 1 | -1): void => {
    const el = scrollRef.current
    if (el === null) return
    const reduce = typeof matchMedia !== 'undefined'
      && matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollBy({
      left: dir * Math.max(120, Math.round(viewportW * 0.7)),
      behavior: reduce ? 'auto' : 'smooth',
    })
  }

  const activeRound = activeIndex === null ? null : rounds[activeIndex] ?? null
  const activeIsCurrent = activeIndex === n - 1
  const activeParts = activeRound === null ? [] : segmentsOf(activeRound).filter((s) => s.value > 0)
  // 工具提示位置：内容坐标（SVG 单位 == CSS px）减去已滚动距离，再收敛进可见区。
  const vw = viewportW > 0 ? viewportW : MIN_CHART_WIDTH
  const activeX = activeIndex === null ? 0 : startX + activeIndex * SLOT + BAR_WIDTH / 2
  const tooltipLeft = activeIndex === null
    ? '50%'
    : `${clamp(activeX - scrollLeft, TOOLTIP_MARGIN, Math.max(TOOLTIP_MARGIN, vw - TOOLTIP_MARGIN))}px`

  return (
    <div className="duc-chart-wrap">
      <div className="duc-chart-scroll" ref={scrollRef} onScroll={onScroll}>
        <svg
          className="duc-turn-chart"
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          style={{ width: `${svgWidth}px` }}
          role="img"
          aria-label={copy.roundsLabel(n, mode)}
        >
          <line className="duc-chart-baseline" x1={PAD_X} x2={svgWidth - PAD_X} y1={baseline} y2={baseline} />
          {rounds.map((round, i) => {
            const x = startX + i * SLOT
            const rawTotal = roundTotal(round, mode, currency)
            const total = Math.max(1, rawTotal)
            const totalHeight = mode === 'ratio' && rawTotal > 0 ? BAR_HEIGHT : (total / maxValue) * BAR_HEIGHT
            let y = baseline
            const parts = segmentsOf(round)
              .filter((s) => s.value > 0)
              .map((s) => {
                const h = mode === 'ratio' ? (s.value / total) * BAR_HEIGHT : (s.value / maxValue) * BAR_HEIGHT
                y -= h
                return <rect className="duc-chart-segment" key={s.label} x={x} y={y} width={BAR_WIDTH} height={Math.max(0, h)} style={{ fill: s.color }} rx={1.5} />
              })
            const durationOffset = round.durationMs !== null && hasDuration
              ? Math.min(DURATION_BAND, (round.durationMs / maxDuration) * DURATION_BAND)
              : 0
            const valueY = Math.max(14 + durationOffset, baseline - totalHeight - 4)
            const isActive = activeIndex === i
            const isCurrent = i === n - 1
            const flag = flagByTurn.get(round.turn)
            const hit = cacheHitPercent(round.buckets)
            const totalText = formatTotal(rawTotal, mode, currency)
            // 值标签策略：当前轮始终显示；成本视角每一轮都显示（仅省略过长文本，
            // 费用数据逐轮可见）；其余视角在可滚动（密集）时省略非当前轮，
            // 数值随时在 Tooltip 里。
            const showValue = isCurrent
              || (mode === 'cost'
                ? totalText.length <= COST_LABEL_MAX_CHARS
                : !scrollable && totalText.length <= MAX_VALUE_LABEL_CHARS)
            const title = copy.roundTotalLabel(round.turn, isCurrent, totalText)
            return (
              <g
                key={`${round.turn}-${i}`}
                className={`duc-chart-turn${isCurrent ? ' duc-chart-turn-current' : ''}${isActive ? ' is-active' : ''}${activeIndex !== null && !isActive ? ' is-muted' : ''}${flag !== undefined ? ' duc-chart-anomaly' : ''}`}
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
                    width={BAR_WIDTH + 8}
                    height={totalHeight + 8}
                    rx={4}
                  />
                )}
                {parts}
                {flag !== undefined && <path className="duc-chart-flag" d={`M ${x + BAR_WIDTH - 7} ${baseline - totalHeight + 2} h 5 v 5 z`} />}
                {hit !== null && (
                  <rect
                    className="duc-chart-hit-tick"
                    x={x + BAR_WIDTH / 2 - 2}
                    y={baseline + 3 + (6 - Math.max(1.5, (hit / 100) * 6))}
                    width={4}
                    height={Math.max(1.5, (hit / 100) * 6)}
                    rx={1}
                    style={{ fill: SEGMENT_COLORS.hit }}
                  >
                    <title>{copy.cacheHit}: {hit}%</title>
                  </rect>
                )}
                {showValue && (
                  <text className="duc-chart-value" x={x + BAR_WIDTH / 2} y={valueY} textAnchor="middle">
                    {totalText}
                  </text>
                )}
                <text className="duc-chart-label" x={x + BAR_WIDTH / 2} y={baseline + 16} textAnchor="middle">
                  {isCurrent ? copy.currentRound : copy.roundLabel(round.turn)}
                </text>
              </g>
            )
          })}
          {hasDuration && (
            <g className="duc-chart-duration">
              <polyline
                fill="none"
                points={rounds
                  .map((round, i) => {
                    const x = startX + i * SLOT + BAR_WIDTH / 2
                    const rawTotal = roundTotal(round, mode, currency)
                    const totalHeight = mode === 'ratio' && rawTotal > 0 ? BAR_HEIGHT : (Math.max(1, rawTotal) / maxValue) * BAR_HEIGHT
                    const offset = round.durationMs !== null ? Math.min(DURATION_BAND, (round.durationMs / maxDuration) * DURATION_BAND) : 0
                    return `${x},${baseline - totalHeight - offset - 3}`
                  })
                  .join(' ')}
              />
              {rounds.map((round, i) => {
                const x = startX + i * SLOT + BAR_WIDTH / 2
                const rawTotal = roundTotal(round, mode, currency)
                const totalHeight = mode === 'ratio' && rawTotal > 0 ? BAR_HEIGHT : (Math.max(1, rawTotal) / maxValue) * BAR_HEIGHT
                const offset = round.durationMs !== null ? Math.min(DURATION_BAND, (round.durationMs / maxDuration) * DURATION_BAND) : 0
                return (
                  <circle
                    key={`dur-${round.turn}`}
                    className="duc-chart-duration-dot"
                    cx={x}
                    cy={baseline - totalHeight - offset - 3}
                    r={2.4}
                  >
                    <title>{copy.duration}: {formatDuration(round.durationMs)}</title>
                  </circle>
                )
              })}
            </g>
          )}
        </svg>
      </div>
      {canScrollLeft && (
        <button
          type="button"
          className="duc-chart-scroll-btn duc-chart-scroll-prev"
          aria-label={copy.scrollEarlier}
          title={copy.scrollEarlier}
          onClick={() => scrollBy(-1)}
        >‹</button>
      )}
      {canScrollRight && (
        <button
          type="button"
          className="duc-chart-scroll-btn duc-chart-scroll-next"
          aria-label={copy.scrollLatest}
          title={copy.scrollLatest}
          onClick={() => scrollBy(1)}
        >›</button>
      )}
      {canScrollLeft && <div className="duc-chart-fade duc-chart-fade-left" aria-hidden="true" />}
      {canScrollRight && <div className="duc-chart-fade duc-chart-fade-right" aria-hidden="true" />}
      {activeRound !== null && (
        <div
          id={tooltipId}
          className="duc-chart-tooltip duc-chart-tooltip-wide"
          role="tooltip"
          style={{ left: tooltipLeft }}
        >
          <div className="duc-chart-tooltip-head">
            <strong>{copy.roundTitle(activeRound.turn, activeIsCurrent)}</strong>
            <b>{formatTotal(roundTotal(activeRound, mode, currency), mode, currency)}</b>
          </div>
          <div className="duc-chart-tooltip-grid">
            {activeParts.map((part) => (
              <span key={part.label}>
                <i style={{ background: part.color }} />
                <em>{part.label}</em>
                <b>{mode === 'cost' ? formatMoney(part.value, currency) : formatTokens(part.value)}</b>
                <small>{activeParts.length > 0 && roundTotal(activeRound, mode, currency) > 0
                  ? `${Math.round((part.value / roundTotal(activeRound, mode, currency)) * 100)}%`
                  : '0%'}</small>
              </span>
            ))}
          </div>
          <div className="duc-chart-tooltip-meta">
            {mode !== 'cost' && activeRound.cost !== null && (
              <span><em>{copy.costLabel}</em><b>{formatMoney(activeRound.cost[currency].total, currency)}{activeRound.cost.estimated ? ` ${copy.estimatedMark}` : ''}</b></span>
            )}
            {activeRound.model !== null && <span><em>{copy.modelLabel}</em><b>{activeRound.model.replace(/^deepseek-/, '')}</b></span>}
            <span><em>{copy.tierLabel}</em><b>{copy.tiers[tierAt(activeRound.startedAt ?? undefined)]}</b></span>
            <span><em>{copy.duration}</em><b>{formatDuration(activeRound.durationMs)}</b></span>
            <span><em>{copy.ttft}</em><b>{formatDuration(activeRound.ttftMs)}</b></span>
            {activeRound.outputTps !== null && <span><em>{copy.outputTps}</em><b>{Math.round(activeRound.outputTps)} t/s</b></span>}
            {cacheHitPercent(activeRound.buckets) !== null && <span><em>{copy.cacheHit}</em><b>{cacheHitPercent(activeRound.buckets)}%</b></span>}
            {activeRound.userSource !== undefined && activeRound.userSource !== null && (
              <span>
                <em>{copy.userSourceLabel}</em>
                <b>
                  {copy.userSources[
                    activeRound.userSource.toLowerCase().includes('agent')
                      ? 'agent'
                      : activeRound.userSource.toLowerCase().includes('continuation') || activeRound.userSource.toLowerCase().includes('goal')
                        ? 'continuation'
                        : 'human'
                  ] ?? activeRound.userSource}
                </b>
              </span>
            )}
            {activeRound.endReason !== null && <span><em>{copy.endReason}</em><b>{copy.endReasonLabel(activeRound.endReason)}</b></span>}
          </div>
          {(() => {
            const flag = flagByTurn.get(activeRound.turn)
            if (flag === undefined) return null
            return (
              <div className="duc-chart-tooltip-flags" role="note">
                <span className="duc-flag-chip">{copy.anomaly}</span>
                {flag.reasons.map((reason) => (
                  <span className="duc-flag-chip duc-flag-chip-reason" key={reason}>{copy.anomalyReason(reason)}</span>
                ))}
              </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}
