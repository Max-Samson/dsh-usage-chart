/**
 * RoundBars（深模块）：每轮用量柱状图，三种视角 + 解释卡。
 *
 * - 视角：absolute（token 总量）/ ratio（构成 100%）/ cost（各桶 × 单价堆叠成本）；
 * - 耗时叠加层：柱顶点线（总耗时，零依赖 SVG 折线）——「贵是因为慢还是 token 多」一眼可见；
 * - 异常轮次标记：相对近 N 轮成本突增的轮次加警示描边 + 角标，Tooltip 显示归因 chip；
 * - 缓存命中迷你趋势：柱底小刻度融入现有图，不单独成图；
 * - Tooltip 解释卡：token 分桶 + 成本 + 模型 + 耗时/TTFT/TPS + 缓存命中 + 结束原因。
 *
 * 零依赖 SVG；复用既有交互路径（hover / focus / 当前轮高亮）。
 */
import { useId, useState } from 'react'
import { cacheHitPercent, formatDuration, formatTokens, formatUsd, type TokenUsageBuckets } from '../../pricing/calc.ts'
import { SEGMENT_COLORS } from '../charts.tsx'
import type { AnomalyFlag } from '../diagnose/anomaly.ts'
import { getUiCopy, type UiLocale } from '../i18n.ts'
import type { ChartRound } from '../rounds/types.ts'

export type RoundChartMode = 'absolute' | 'ratio' | 'cost'

export interface Segment {
  label: string
  value: number
  color: string
}

const BAR_HEIGHT = 96
const CHART_WIDTH = 640
const PAD_X = 10
const PAD_TOP = 22
const LABEL_HEIGHT = 22
const TICK_HEIGHT = 26
const MAX_VISIBLE_ROUNDS = 12
/** 耗时叠加：柱顶偏移的最大像素（随总耗时归一化）。 */
const DURATION_BAND = 11

function tokenTotal(b: TokenUsageBuckets): number {
  return b.uncachedInputTokens + b.cacheReadTokens + b.outputTokens + b.cacheWriteTokens
}

function tokenSegments(copy: ReturnType<typeof getUiCopy>, b: TokenUsageBuckets): Segment[] {
  return [
    { label: copy.segments.miss, value: b.uncachedInputTokens, color: SEGMENT_COLORS.miss },
    { label: copy.segments.hit, value: b.cacheReadTokens, color: SEGMENT_COLORS.hit },
    { label: copy.segments.output, value: b.outputTokens, color: SEGMENT_COLORS.output },
    { label: copy.segments.write, value: b.cacheWriteTokens, color: SEGMENT_COLORS.write },
  ]
}

function costSegments(copy: ReturnType<typeof getUiCopy>, round: ChartRound): Segment[] {
  const cost = round.cost
  if (cost === null) return []
  return [
    { label: copy.inputCost, value: cost.inputUsd, color: SEGMENT_COLORS.miss },
    { label: copy.segments.hit, value: cost.cacheReadUsd, color: SEGMENT_COLORS.hit },
    { label: copy.outputCost, value: cost.outputUsd, color: SEGMENT_COLORS.output },
  ]
}

/** 该轮在本视角下的「总量」（决定柱高/值标签）。 */
function roundTotal(round: ChartRound, mode: RoundChartMode): number {
  if (mode === 'cost') return round.cost?.totalUsd ?? 0
  return tokenTotal(round.buckets)
}

function formatTotal(value: number, mode: RoundChartMode): string {
  return mode === 'cost' ? formatUsd(value) : formatTokens(value)
}

export function RoundBars({
  rounds,
  mode = 'absolute',
  flags = [],
  locale,
}: {
  rounds: readonly ChartRound[]
  mode?: RoundChartMode
  flags?: readonly AnomalyFlag[]
  locale: UiLocale
}): JSX.Element | null {
  const tooltipId = useId()
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  if (rounds.length === 0) return null
  const copy = getUiCopy(locale)
  const visible = rounds.slice(-MAX_VISIBLE_ROUNDS)
  const n = visible.length
  const gap = n <= 4 ? 18 : 9
  const available = CHART_WIDTH - PAD_X * 2
  const barW = Math.min(78, (available - gap * (n - 1)) / n)
  const groupWidth = barW * n + gap * (n - 1)
  const startX = (CHART_WIDTH - groupWidth) / 2
  const baseline = PAD_TOP + BAR_HEIGHT
  const svgHeight = baseline + LABEL_HEIGHT + TICK_HEIGHT

  const maxValue = Math.max(1, ...visible.map((r) => roundTotal(r, mode)))
  let maxDuration = 0
  for (const r of visible) if (r.durationMs !== null && r.durationMs > maxDuration) maxDuration = r.durationMs
  const hasDuration = maxDuration > 0

  const flagByTurn = new Map<number, AnomalyFlag>()
  for (const flag of flags) flagByTurn.set(flag.turn, flag)

  const segmentsOf = (r: ChartRound): Segment[] => (mode === 'cost' ? costSegments(copy, r) : tokenSegments(copy, r.buckets))

  const activeRound = activeIndex === null ? null : visible[activeIndex] ?? null
  const activeIsCurrent = activeIndex === n - 1
  const activeParts = activeRound === null ? [] : segmentsOf(activeRound).filter((s) => s.value > 0)
  const activeX = activeIndex === null ? 50 : ((startX + activeIndex * (barW + gap) + barW / 2) / CHART_WIDTH) * 100

  return (
    <div className="duc-chart-wrap">
      <svg className="duc-turn-chart" viewBox={`0 0 ${CHART_WIDTH} ${svgHeight}`} role="img" aria-label={copy.recentRoundsLabel(n, mode)}>
        <line className="duc-chart-baseline" x1={PAD_X} x2={CHART_WIDTH - PAD_X} y1={baseline} y2={baseline} />
        {visible.map((round, i) => {
          const x = startX + i * (barW + gap)
          const rawTotal = roundTotal(round, mode)
          const total = Math.max(1, rawTotal)
          const totalHeight = mode === 'ratio' && rawTotal > 0 ? BAR_HEIGHT : (total / maxValue) * BAR_HEIGHT
          let y = baseline
          const parts = segmentsOf(round)
            .filter((s) => s.value > 0)
            .map((s) => {
              const h = mode === 'ratio' ? (s.value / total) * BAR_HEIGHT : (s.value / maxValue) * BAR_HEIGHT
              y -= h
              return <rect className="duc-chart-segment" key={s.label} x={x} y={y} width={barW} height={Math.max(0, h)} style={{ fill: s.color }} rx={1.5} />
            })
          const durationOffset = round.durationMs !== null && hasDuration
            ? Math.min(DURATION_BAND, (round.durationMs / maxDuration) * DURATION_BAND)
            : 0
          const valueY = Math.max(16 + durationOffset, baseline - totalHeight - 6)
          const isActive = activeIndex === i
          const isCurrent = i === n - 1
          const flag = flagByTurn.get(round.turn)
          const hit = cacheHitPercent(round.buckets)
          const title = copy.roundTotalLabel(round.turn, isCurrent, formatTotal(rawTotal, mode))
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
                  width={barW + 8}
                  height={totalHeight + 8}
                  rx={4}
                />
              )}
              {parts}
              {flag !== undefined && <path className="duc-chart-flag" d={`M ${x + barW - 7} ${baseline - totalHeight + 2} h 5 v 5 z`} />}
              {hit !== null && (
                <rect
                  className="duc-chart-hit-tick"
                  x={x + barW / 2 - 2}
                  y={baseline + 3 + (6 - Math.max(1.5, (hit / 100) * 6))}
                  width={4}
                  height={Math.max(1.5, (hit / 100) * 6)}
                  rx={1}
                  style={{ fill: SEGMENT_COLORS.hit }}
                >
                  <title>{copy.cacheHit}: {hit}%</title>
                </rect>
              )}
              <text className="duc-chart-value" x={x + barW / 2} y={valueY} textAnchor="middle">
                {formatTotal(rawTotal, mode)}
              </text>
              <text className="duc-chart-label" x={x + barW / 2} y={baseline + 16} textAnchor="middle">
                {isCurrent ? copy.currentRound : copy.roundLabel(round.turn)}
              </text>
            </g>
          )
        })}
        {hasDuration && (
          <g className="duc-chart-duration">
            <polyline
              fill="none"
              points={visible
                .map((round, i) => {
                  const x = startX + i * (barW + gap) + barW / 2
                  const rawTotal = roundTotal(round, mode)
                  const totalHeight = mode === 'ratio' && rawTotal > 0 ? BAR_HEIGHT : (Math.max(1, rawTotal) / maxValue) * BAR_HEIGHT
                  const offset = round.durationMs !== null ? Math.min(DURATION_BAND, (round.durationMs / maxDuration) * DURATION_BAND) : 0
                  return `${x},${baseline - totalHeight - offset - 3}`
                })
                .join(' ')}
            />
            {visible.map((round, i) => {
              const x = startX + i * (barW + gap) + barW / 2
              const rawTotal = roundTotal(round, mode)
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
      {activeRound !== null && (
        <div
          id={tooltipId}
          className="duc-chart-tooltip duc-chart-tooltip-wide"
          role="tooltip"
          style={{ left: `${Math.max(22, Math.min(78, activeX))}%` }}
        >
          <div className="duc-chart-tooltip-head">
            <strong>{copy.roundTitle(activeRound.turn, activeIsCurrent)}</strong>
            <b>{formatTotal(roundTotal(activeRound, mode), mode)}</b>
          </div>
          <div className="duc-chart-tooltip-grid">
            {activeParts.map((part) => (
              <span key={part.label}>
                <i style={{ background: part.color }} />
                <em>{part.label}</em>
                <b>{mode === 'cost' ? formatUsd(part.value) : formatTokens(part.value)}</b>
                <small>{activeParts.length > 0 && roundTotal(activeRound, mode) > 0
                  ? `${Math.round((part.value / roundTotal(activeRound, mode)) * 100)}%`
                  : '0%'}</small>
              </span>
            ))}
          </div>
          <div className="duc-chart-tooltip-meta">
            {mode !== 'cost' && activeRound.cost !== null && (
              <span>{copy.costLabel}<b>{formatUsd(activeRound.cost.totalUsd)}{activeRound.cost.estimated ? ` ${copy.estimatedMark}` : ''}</b></span>
            )}
            {activeRound.model !== null && <span>{copy.modelLabel}<b>{activeRound.model.replace(/^deepseek-/, '')}</b></span>}
            <span>{copy.duration}<b>{formatDuration(activeRound.durationMs)}</b></span>
            <span>{copy.ttft}<b>{formatDuration(activeRound.ttftMs)}</b></span>
            {activeRound.outputTps !== null && <span>{copy.outputTps}<b>{Math.round(activeRound.outputTps)} t/s</b></span>}
            {cacheHitPercent(activeRound.buckets) !== null && <span>{copy.cacheHit}<b>{cacheHitPercent(activeRound.buckets)}%</b></span>}
            {activeRound.endReason !== null && <span>{copy.endReason}<b>{copy.endReasonLabel(activeRound.endReason)}</b></span>}
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
