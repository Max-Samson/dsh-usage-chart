/**
 * 插件注入的样式（与 monorepo css-modules-inline 插件同款 <style data-plugin> 机制，
 * 插件卸载时由 loader 清理）。零 CSS 依赖，直接字符串注入。
 */
export const PLUGIN_CSS_ID = 'dsh-usage-chart/css'

export const PLUGIN_CSS = `
[data-plugin-css="${PLUGIN_CSS_ID}"]{display:none}

.duc-root {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font-size: 12px;
  line-height: 20px;
  color: var(--dsh-fg-muted, rgba(255, 255, 255, 0.62));
  user-select: none;
  flex-wrap: wrap;
}

.duc-toggle {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 20px;
  margin: 0;
  padding: 0 6px;
  border: 1px solid transparent;
  border-radius: 5px;
  background: transparent;
  color: inherit;
  font-size: 11px;
  cursor: pointer;
  flex: none;
}
.duc-toggle:hover { background: rgba(127, 127, 127, 0.18); border-color: rgba(127, 127, 127, 0.3); }
.duc-toggle-label { font-size: 11px; }

.duc-sep { opacity: 0.35; margin: 0 2px; }

.duc-est { opacity: 0.72; }
.duc-balance { cursor: pointer; border-bottom: 1px dashed currentColor; }
.duc-balance:hover { color: var(--dsh-fg, rgba(255, 255, 255, 0.9)); }

/* 悬浮面板：fixed 定位贴在指示器行上方，避免被 dock/滚动容器裁剪。 */
.duc-popover {
  position: fixed;
  z-index: 9999;
  max-height: calc(100vh - 48px);
  overflow-y: auto;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
}

.duc-panel {
  width: 100%;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid rgba(127, 127, 127, 0.22);
  background: color-mix(in srgb, var(--dsh-surface, #1e1f22) 88%, transparent);
  box-sizing: border-box;
  font-size: 12px;
  line-height: 1.6;
  color: var(--dsh-fg, rgba(255, 255, 255, 0.88));
}

.duc-panel h4 {
  margin: 10px 0 6px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--dsh-fg-muted, rgba(255, 255, 255, 0.5));
}
.duc-panel h4:first-child { margin-top: 0; }

.duc-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 8px;
}
.duc-cell {
  padding: 6px 8px;
  border-radius: 6px;
  background: rgba(127, 127, 127, 0.08);
}
.duc-cell b { display: block; font-size: 14px; font-weight: 600; color: var(--dsh-fg, rgba(255, 255, 255, 0.92)); }
.duc-cell span { font-size: 11px; color: var(--dsh-fg-muted, rgba(255, 255, 255, 0.5)); }

.duc-chart { display: block; width: 100%; margin-top: 4px; }
.duc-legend { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 4px; font-size: 11px; color: var(--dsh-fg-muted, rgba(255, 255, 255, 0.55)); }
.duc-legend i { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin-right: 4px; vertical-align: -1px; }

.duc-note { margin-top: 6px; font-size: 11px; color: var(--dsh-fg-muted, rgba(255, 255, 255, 0.45)); }

.duc-refresh {
  margin-top: 8px;
  border: 1px solid rgba(127, 127, 127, 0.35);
  border-radius: 5px;
  background: transparent;
  color: var(--dsh-fg-muted, rgba(255, 255, 255, 0.6));
  font-size: 11px;
  padding: 2px 10px;
  cursor: pointer;
}
.duc-refresh:hover { background: rgba(127, 127, 127, 0.15); color: var(--dsh-fg, rgba(255, 255, 255, 0.9)); }

.duc-err {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #e8a33d;
}
.duc-err button {
  border: 1px solid rgba(127, 127, 127, 0.35);
  border-radius: 5px;
  background: transparent;
  color: inherit;
  font-size: 11px;
  padding: 2px 8px;
  cursor: pointer;
}
.duc-err button:hover { background: rgba(127, 127, 127, 0.15); }

.duc-bal {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
}
.duc-bal .amount { font-size: 18px; font-weight: 700; }
.duc-bal .sub { font-size: 11px; color: var(--dsh-fg-muted, rgba(255, 255, 255, 0.5)); }
`

/** 幂等注入 <style data-plugin="dsh-usage-chart">（工厂执行时调用一次）。 */
export function injectPluginCss(): void {
  if (typeof document === 'undefined') return
  if (document.querySelector(`style[data-plugin-css="${PLUGIN_CSS_ID}"]`) !== null) return
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-usage-chart'
  tag.dataset.pluginCss = PLUGIN_CSS_ID
  tag.textContent = PLUGIN_CSS
  document.head.appendChild(tag)
}
