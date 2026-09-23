/**
 * 悬浮面板的位置偏移：读取与夹取的纯函数（无 React / 无 DOM 依赖，便于单测）。
 *
 * 面板是 `position: fixed`；祖先含 transform / filter / contain 时，坐标基准是那个
 * 祖先而不是视口（见 UsageIndicator 的 containingBlock()）。拖动只做
 * `transform: translate()` 的相对位移，因此与包含块坐标换算互不干扰。
 */

/** 拖动偏移的持久化键（沿用既有键名，升级后已保存的位置不丢）。 */
export const PANEL_POS_KEY = 'dsh-usage-chart:panel-pos'

/** 拖到边界时，面板在包含块内至少保留的可见像素。 */
export const MIN_VISIBLE_PX = 48

export interface PanelOffset {
  x: number
  y: number
}

/** 视口坐标下的矩形（DOMRect 的最小子集）。 */
export interface PanelRect {
  left: number
  top: number
  right: number
  bottom: number
}

/** 读取已持久化的偏移；缺失、坏 JSON、非有限数值一律回 {0,0}。 */
export function readPanelOffset(
  storage: Pick<Storage, 'getItem'> | undefined = typeof localStorage === 'undefined' ? undefined : localStorage,
): PanelOffset {
  try {
    const raw = storage?.getItem(PANEL_POS_KEY) ?? null
    if (raw === null) return { x: 0, y: 0 }
    const parsed = JSON.parse(raw) as { x?: unknown; y?: unknown } | null
    const finite = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0)
    return { x: finite(parsed?.x), y: finite(parsed?.y) }
  } catch {
    return { x: 0, y: 0 }
  }
}

/**
 * 夹取偏移：未位移的面板矩形 panel 平移 offset 后，四条边都至少保留
 * minVisible 像素落在包含块 bounds 内——任意方向都拖不出可视区。
 * 面板本身比包含块还大（该轴 min > max）时保持原值，避免被顶到反方向。
 */
export function clampPanelOffset(
  offset: PanelOffset,
  panel: PanelRect,
  bounds: PanelRect,
  minVisible: number = MIN_VISIBLE_PX,
): PanelOffset {
  const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max)
  const minX = bounds.left - panel.right + minVisible
  const maxX = bounds.right - panel.left - minVisible
  const minY = bounds.top - panel.bottom + minVisible
  const maxY = bounds.bottom - panel.top - minVisible
  return {
    x: minX <= maxX ? clamp(offset.x, minX, maxX) : offset.x,
    y: minY <= maxY ? clamp(offset.y, minY, maxY) : offset.y,
  }
}
