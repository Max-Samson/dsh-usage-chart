/**
 * 零依赖 SVG 图表组件：每轮用量柱状图 + 水平堆叠条。
 * 不引入 echarts/recharts/d3 —— DSH web 未内置任何图表库，自绘 SVG 与
 * 平台自身渲染方式一致，体积最小、最稳定。
 */
import type { TokenUsageBuckets } from '../pricing.ts'

export interface TurnUsage {
  /** 轮次号；-1 表示“当前轮（自页面加载起观测）”。 */
  turn: number
  buckets: TokenUsageBuckets
}

/** 语义色：输入未命中 / 输入命中 / 输出 / 写缓存。 */
export const SEGMENT_COLORS = {
  miss: '#4d9fff',
  hit: '#9ad4ff',
  output: '#4ade80',
  write: '#fbbf24',
} as const

export interface Segment {
  label: string
  value: number
  color: string
}

const BAR_HEIGHT = 120
const CHART_WIDTH = 640
const PAD = 10

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
export function TurnBars({ turns }: { turns: readonly TurnUsage[] }): JSX.Element | null {
  if (turns.length === 0) return null
  const max = Math.max(1, maxTotal(turns))
  const n = turns.length
  const gap = 4
  const barW = (CHART_WIDTH - PAD * 2 - gap * (n - 1)) / n
  const labelH = 16

  const segments = (b: TokenUsageBuckets): Segment[] => [
    { label: '输入(未命中)', value: b.uncachedInputTokens, color: SEGMENT_COLORS.miss },
    { label: '输入(命中)', value: b.cacheReadTokens, color: SEGMENT_COLORS.hit },
    { label: '输出', value: b.outputTokens, color: SEGMENT_COLORS.output },
    { label: '写缓存', value: b.cacheWriteTokens, color: SEGMENT_COLORS.write },
  ]

  return (
    <svg className="duc-chart" viewBox={`0 0 ${CHART_WIDTH} ${BAR_HEIGHT + labelH}`} role="img" aria-label="每轮 token 用量">
      {turns.map((t, i) => {
        const x = PAD + i * (barW + gap)
        const total = Math.max(1, t.buckets.uncachedInputTokens + t.buckets.cacheReadTokens + t.buckets.outputTokens + t.buckets.cacheWriteTokens)
        let y = BAR_HEIGHT
        const parts = segments(t.buckets)
          .filter((s) => s.value > 0)
          .map((s) => {
            const h = (s.value / max) * BAR_HEIGHT
            y -= h
            return <rect key={s.label} x={x} y={y} width={barW} height={Math.max(0, h)} fill={s.color} rx={0.5} />
          })
        const title = `轮 ${t.turn === -1 ? '当前' : t.turn}：${t.buckets.uncachedInputTokens.toLocaleString()} 未命中输入 / ${t.buckets.cacheReadTokens.toLocaleString()} 命中输入 / ${t.buckets.outputTokens.toLocaleString()} 输出`
        return (
          <g key={t.turn}>
            <title>{title}</title>
            {parts}
            <text x={x + barW / 2} y={BAR_HEIGHT + 12} textAnchor="middle" fontSize={9} fill="rgba(255,255,255,0.45)">
              {t.turn === -1 ? '本轮' : t.turn}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

/** 水平堆叠条（汇总 / 成本构成）。 */
export function HStack({ segments, width = 260 }: { segments: readonly Segment[]; width?: number }): JSX.Element | null {
  const total = segments.reduce((a, s) => a + s.value, 0)
  if (total <= 0) return null
  let x = 0
  return (
    <svg className="duc-chart" viewBox={`0 0 ${width} 14`} role="img" aria-label="构成">
      {segments.map((s) => {
        const w = (s.value / total) * width
        const rect = <rect key={s.label} x={x} y={0} width={Math.max(0, w - 0.5)} height={14} fill={s.color} rx={2}>
          <title>{`${s.label}: ${s.value.toLocaleString()}`}</title>
        </rect>
        x += w
        return rect
      })}
    </svg>
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

export const TOKEN_LEGEND: readonly { label: string; color: string }[] = [
  { label: '输入(未命中)', color: SEGMENT_COLORS.miss },
  { label: '输入(命中)', color: SEGMENT_COLORS.hit },
  { label: '输出', color: SEGMENT_COLORS.output },
]
