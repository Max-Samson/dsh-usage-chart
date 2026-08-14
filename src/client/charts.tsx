/**
 * 零依赖 SVG/HTML 图表原语：水平堆叠条 + 图例 + 语义色。
 * 每轮柱状图（RoundBars）是深模块，独立在 chart/RoundBars.tsx。
 * 不引入 echarts/recharts/d3 —— DSH web 未内置任何图表库，自绘 SVG 与
 * 平台自身渲染方式一致，体积最小、最稳定。
 */
import type { UiCopy } from './i18n.ts'

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
