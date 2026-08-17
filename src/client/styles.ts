/**
 * 插件注入的样式（与 monorepo css-modules-inline 插件同款 <style data-plugin> 机制，
 * 插件卸载时由 loader 清理）。零 CSS 依赖，直接字符串注入。
 *
 * 主题适配：DSH web 以 `body[data-ds-dark-theme]` 区分明暗（见
 * @deepseek-ai/dsh-client-ui-theme），语义 token `--dsw-alias-label-*` /
 * `--dsw-alias-bg-*` / `--dsw-alias-border-*` 会随主题翻转。本插件全部文字、
 * 表面与边框颜色都走这些 token（fallback 取中性色，保证深色下仍有兜底），
 * 不写死白色；图表语义色定义为 `.duc-root` 上的自定义属性
 * `--duc-{miss,hit,output,write}`（取平台 static 色板，明暗两态均可读），
 * SVG 与图例通过 `var(--duc-*)` 引用，明暗主题下自动一致。
 */
export const PLUGIN_CSS_ID = 'dsh-usage-chart/css'

export const PLUGIN_CSS = `
[data-plugin-css="${PLUGIN_CSS_ID}"]{display:none}

.duc-root {
  /* 图表语义色（CSS 变量，供 SVG/图例引用；取平台 static 色板，明暗均可读） */
  --duc-miss: var(--dsw-static-blue-500, #3478f6);
  --duc-hit: var(--dsw-static-cyan-400, #45a9c7);
  --duc-output: var(--dsw-static-green-450, #43b96f);
  --duc-write: var(--dsw-static-amber-450, #d99a2b);
  /* v0.2：异常警示色 + 耗时叠加色 */
  --duc-anomaly: var(--dsw-static-red-500, #d8453c);
  --duc-duration: var(--dsw-static-violet-450, #8f6bd8);
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font-size: 12px;
  line-height: 20px;
  color: var(--dsw-alias-label-secondary, #5f6368);
  user-select: none;
  flex-wrap: wrap;
}

.duc-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
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
.duc-toggle:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.18)); border-color: var(--dsw-alias-border-l3, rgba(127, 127, 127, 0.3)); }
.duc-toggle:active { transform: translateY(1px); }
.duc-toggle:focus-visible,
.duc-balance:focus-visible,
.duc-refresh:focus-visible,
.duc-view-toggle button:focus-visible,
.duc-err button:focus-visible {
  outline: 2px solid var(--duc-miss);
  outline-offset: 2px;
}
.duc-toggle-label { font-size: 11px; }
.duc-toggle-icon { display: block; width: 13px; height: 13px; flex: none; color: currentColor; }
.duc-toggle-caret { margin-left: 1px; font-size: 9px; line-height: 1; opacity: 0.58; }

.duc-sep { opacity: 0.35; margin: 0 2px; }

.duc-est { opacity: 0.72; }
.duc-balance {
  margin: 0;
  padding: 0;
  border: 0;
  border-bottom: 1px dashed currentColor;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.duc-balance:hover { color: var(--dsw-alias-label-primary, rgba(255, 255, 255, 0.9)); }

/* 悬浮面板：fixed 定位贴在指示器行上方，避免被 dock/滚动容器裁剪。 */
.duc-popover {
  position: fixed;
  z-index: 9999;
  max-height: calc(100vh - 48px);
  overflow-y: auto;
  border-radius: 10px;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.14), 0 2px 8px rgba(15, 23, 42, 0.08);
}
body[data-ds-dark-theme] .duc-popover { box-shadow: 0 16px 40px rgba(0, 0, 0, 0.42); }

.duc-panel {
  width: 100%;
  padding: 0 14px;
  border-radius: 10px;
  border: 1px solid var(--dsw-alias-border-l3, rgba(127, 127, 127, 0.22));
  background: var(--dsw-alias-bg-layer-2, rgba(30, 31, 34, 0.92));
  box-sizing: border-box;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-label-primary, rgba(255, 255, 255, 0.88));
  font-variant-numeric: tabular-nums;
}

.duc-section { padding: 12px 0; }
.duc-section + .duc-section { border-top: 1px solid var(--dsw-alias-border-l3, rgba(127, 127, 127, 0.18)); }

.duc-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 22px;
  gap: 12px;
}
.duc-section h4 {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0;
  color: var(--dsw-alias-label-secondary, rgba(255, 255, 255, 0.72));
}
.duc-section-meta {
  color: var(--dsw-alias-label-tertiary, rgba(255, 255, 255, 0.55));
  font-size: 10.5px;
  white-space: nowrap;
}
.duc-head-right {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
/* v1.0.1：高峰/空闲时段 tag（红=高峰，绿=空闲） */
.duc-tier-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0 7px;
  border: 1px solid currentColor;
  border-radius: 8px;
  font-size: 10px;
  font-weight: 600;
  line-height: 16px;
  white-space: nowrap;
  cursor: default;
}
.duc-tier-tag::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}
.duc-tier-peak { color: var(--duc-anomaly, #d8453c); }
.duc-tier-offpeak { color: var(--duc-output, #43b96f); }
.duc-section-value {
  color: var(--dsw-alias-label-primary, rgba(255, 255, 255, 0.92));
  font-size: 16px;
  font-weight: 650;
  white-space: nowrap;
}

.duc-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0;
  margin-top: 8px;
  overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l3, rgba(127, 127, 127, 0.18));
  border-radius: 8px;
  background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.055));
}
.duc-cell {
  min-width: 0;
  padding: 8px 9px;
  background: transparent;
}
.duc-cell + .duc-cell { border-left: 1px solid var(--dsw-alias-border-l3, rgba(127, 127, 127, 0.18)); }
.duc-cell b { display: block; font-size: 14px; font-weight: 650; line-height: 1.35; color: var(--dsw-alias-label-primary, rgba(255, 255, 255, 0.92)); }
.duc-cell span { display: block; margin-top: 2px; overflow: hidden; font-size: 10.5px; color: var(--dsw-alias-label-tertiary, rgba(255, 255, 255, 0.58)); text-overflow: ellipsis; white-space: nowrap; }

/* 构成条使用固定高度，避免 SVG 宽高比随容器宽度放大。 */
.duc-composition {
  display: flex;
  width: 100%;
  height: 10px;
  margin-top: 9px;
  overflow: hidden;
  border-radius: 3px;
  background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.08));
}
.duc-composition span { min-width: 1px; height: 100%; }
.duc-composition span + span { border-left: 1px solid var(--dsw-alias-bg-layer-2, rgba(30, 31, 34, 0.92)); }

.duc-chart-wrap { position: relative; margin-top: 6px; }

/* v1.0.0：横向滚动——全部轮次可见（不再截断最近 12 轮），
   超出视口的部分左右滑动查看；细滚动条 + 箭头/渐隐提示越界。 */
.duc-chart-scroll {
  width: 100%;
  overflow-x: auto;
  overflow-y: hidden;
  overscroll-behavior-x: contain;
  scrollbar-width: thin;
  scrollbar-color: var(--dsw-alias-border-l3, rgba(127, 127, 127, 0.4)) transparent;
}
.duc-chart-scroll::-webkit-scrollbar { height: 5px; }
.duc-chart-scroll::-webkit-scrollbar-track { background: transparent; }
.duc-chart-scroll::-webkit-scrollbar-thumb { border-radius: 3px; background: var(--dsw-alias-border-l3, rgba(127, 127, 127, 0.4)); }
.duc-chart-scroll::-webkit-scrollbar-thumb:hover { background: var(--dsw-alias-label-tertiary, rgba(127, 127, 127, 0.6)); }

/* SVG 宽度由组件内联设置（viewBox 宽 == 样式宽，单位 1:1 CSS px），
   轮次少时居中显示、不拉伸柱宽。 */
.duc-turn-chart { display: block; margin: 0 auto; overflow: visible; color: var(--dsw-alias-label-tertiary, rgba(255, 255, 255, 0.52)); }
.duc-chart-baseline { stroke: var(--dsw-alias-border-l3, rgba(127, 127, 127, 0.25)); stroke-width: 1; }
.duc-chart-value { fill: var(--dsw-alias-label-secondary, rgba(255, 255, 255, 0.72)); font-size: 13px; font-weight: 650; }

/* v1.0.0：横向滚动提示——边缘渐隐（pointer-events: none，不挡交互） */
.duc-chart-fade {
  position: absolute;
  top: 0;
  bottom: 0;
  z-index: 1;
  width: 26px;
  pointer-events: none;
}
.duc-chart-fade-left { left: 0; background: linear-gradient(to right, var(--dsw-alias-bg-layer-2, rgba(30, 31, 34, 0.92)), transparent); }
.duc-chart-fade-right { right: 0; background: linear-gradient(to left, var(--dsw-alias-bg-layer-2, rgba(30, 31, 34, 0.92)), transparent); }

/* v1.0.0：横向滚动箭头按钮（越界时才出现） */
.duc-chart-scroll-btn {
  position: absolute;
  top: 60px;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  margin: 0;
  padding: 0;
  border: 1px solid var(--dsw-alias-border-l3, rgba(127, 127, 127, 0.34));
  border-radius: 50%;
  background: var(--dsw-alias-bg-layer-2, rgba(30, 31, 34, 0.92));
  color: var(--dsw-alias-label-secondary, rgba(255, 255, 255, 0.7));
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
  opacity: 0.92;
  transition: opacity 120ms ease, color 120ms ease;
}
.duc-chart-scroll-prev { left: 2px; }
.duc-chart-scroll-next { right: 2px; }
.duc-chart-scroll-btn:hover { color: var(--dsw-alias-label-primary, rgba(255, 255, 255, 0.92)); }
.duc-chart-scroll-btn:active { transform: translateY(1px); }
.duc-chart-scroll-btn:focus-visible { outline: 2px solid var(--duc-miss); outline-offset: 1px; }
.duc-chart-label { fill: currentColor; font-size: 13px; font-weight: 500; }
.duc-chart-turn { outline: none; cursor: default; }
.duc-chart-segment { transition: opacity 120ms ease, filter 120ms ease; }
.duc-chart-turn.is-muted .duc-chart-segment { opacity: 0.42; }
.duc-chart-turn.is-active .duc-chart-segment { filter: brightness(1.06); }
.duc-chart-current-band {
  fill: var(--duc-miss);
  fill-opacity: 0.09;
  stroke: var(--duc-miss);
  stroke-opacity: 0.34;
  stroke-width: 1;
}
.duc-chart-turn-current .duc-chart-label { fill: var(--dsw-alias-label-primary, rgba(255, 255, 255, 0.9)); font-weight: 700; }
.duc-chart-turn:focus-visible .duc-chart-current-band,
.duc-chart-turn:focus-visible .duc-chart-segment:first-of-type { stroke: var(--duc-miss); stroke-width: 2; }

/* v0.2：耗时叠加层（柱顶点线） */
.duc-chart-duration polyline { stroke: var(--duc-duration); stroke-width: 1.2; stroke-dasharray: 3 2; opacity: 0.9; }
.duc-chart-duration-dot { fill: var(--duc-duration); stroke: var(--dsw-alias-bg-layer-2, #fff); stroke-width: 1; }

/* v0.2：异常轮次标记（警示描边 + 角标） */
.duc-chart-turn.duc-chart-anomaly .duc-chart-segment { filter: saturate(1.15); }
.duc-chart-turn.duc-chart-anomaly.is-active .duc-chart-segment { filter: brightness(1.05) saturate(1.25); }
.duc-chart-turn.duc-chart-anomaly .duc-chart-flag { fill: var(--duc-anomaly); }
.duc-chart-turn.duc-chart-anomaly:focus-visible .duc-chart-current-band,
.duc-chart-turn.duc-chart-anomaly:focus-visible .duc-chart-segment:first-of-type { stroke: var(--duc-anomaly); stroke-width: 2; }

/* v0.2：缓存命中迷你趋势（柱底小刻度） */
.duc-chart-hit-tick { opacity: 0.85; }

/* v0.2：解释卡 Tooltip（加宽 + 元信息行 + 异常 chip） */
.duc-chart-tooltip-wide { width: 212px; }
.duc-chart-tooltip-meta {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 2px 10px;
  margin-top: 6px;
  padding-top: 5px;
  border-top: 1px solid var(--dsw-alias-border-l3, rgba(127, 127, 127, 0.2));
  color: var(--dsw-alias-label-secondary, #5f6368);
  font-size: 9.5px;
}
.duc-chart-tooltip-meta span { display: contents; }
.duc-chart-tooltip-meta b {
  overflow: hidden;
  color: var(--dsw-alias-label-primary, #202124);
  font-weight: 600;
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.duc-chart-tooltip-flags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; padding-top: 5px; border-top: 1px solid var(--dsw-alias-border-l3, rgba(127, 127, 127, 0.2)); }
.duc-flag-chip {
  padding: 1px 5px;
  border-radius: 8px;
  background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.14));
  color: var(--dsw-alias-label-secondary, #5f6368);
  font-size: 9px;
  font-weight: 600;
}
.duc-flag-chip:first-child { background: color-mix(in srgb, var(--duc-anomaly) 16%, transparent); color: var(--duc-anomaly); }
.duc-flag-chip-reason { border: 1px solid color-mix(in srgb, var(--duc-anomaly) 35%, transparent); }

/* v0.2：未定价模型 chip（面板成本说明） */
.duc-unknown-chip {
  display: inline-block;
  margin: 0 4px 0 6px;
  padding: 0 6px;
  border: 1px solid color-mix(in srgb, var(--duc-write) 45%, transparent);
  border-radius: 8px;
  color: var(--duc-write);
  font-size: 9.5px;
  font-weight: 600;
}

/* v0.2：每轮成本徽章（assistant 消息尾部，可关闭） */
.duc-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin: 0;
  padding: 0 7px;
  border: 1px solid var(--dsw-alias-border-l3, rgba(127, 127, 127, 0.3));
  border-radius: 9px;
  background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.08));
  color: var(--dsw-alias-label-secondary, rgba(255, 255, 255, 0.62));
  font: inherit;
  font-size: 10px;
  line-height: 16px;
  cursor: pointer;
  white-space: nowrap;
}
.duc-badge:hover { color: var(--dsw-alias-label-primary, rgba(255, 255, 255, 0.9)); }
.duc-badge:focus-visible { outline: 2px solid var(--duc-miss); outline-offset: 1px; }
.duc-badge-est { opacity: 0.82; }
.duc-badge-unknown { border-color: color-mix(in srgb, var(--duc-write) 50%, transparent); }
.duc-badge-mark { color: var(--duc-write); font-size: 9px; }

/* v0.2：Dock 细上下文压力条 */
.duc-pressure {
  display: inline-block;
  width: 44px;
  height: 4px;
  overflow: hidden;
  border-radius: 2px;
  background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.2));
  cursor: default;
}
.duc-pressure i {
  display: block;
  height: 100%;
  border-radius: 2px;
  background: var(--duc-output);
  transition: width 240ms ease;
}
.duc-pressure[data-level="high"] i { background: var(--duc-write); }
.duc-pressure[data-level="critical"] i { background: var(--duc-anomaly); }

.duc-chart-tooltip {
  position: absolute;
  z-index: 2;
  top: 20px;
  width: 186px;
  padding: 8px 9px;
  transform: translateX(-50%);
  box-sizing: border-box;
  border: 1px solid var(--dsw-alias-border-l3, rgba(127, 127, 127, 0.32));
  border-radius: 7px;
  background: var(--dsw-alias-bg-layer-3, var(--dsw-alias-bg-layer-2, #fff));
  box-shadow: 0 8px 22px rgba(15, 23, 42, 0.16);
  color: var(--dsw-alias-label-primary, #202124);
  pointer-events: none;
}
body[data-ds-dark-theme] .duc-chart-tooltip { box-shadow: 0 10px 24px rgba(0, 0, 0, 0.36); }
.duc-chart-tooltip-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; padding-bottom: 5px; border-bottom: 1px solid var(--dsw-alias-border-l3, rgba(127, 127, 127, 0.2)); }
.duc-chart-tooltip-head strong { font-size: 11px; font-weight: 600; }
.duc-chart-tooltip-head b { font-size: 12px; font-weight: 700; }
.duc-chart-tooltip-grid { display: grid; gap: 3px; padding-top: 5px; }
.duc-chart-tooltip-grid span { display: grid; grid-template-columns: 7px minmax(0, 1fr) auto 26px; align-items: center; gap: 5px; min-width: 0; }
.duc-chart-tooltip-grid i { width: 7px; height: 7px; border-radius: 2px; }
.duc-chart-tooltip-grid em { overflow: hidden; color: var(--dsw-alias-label-secondary, #5f6368); font-size: 9.5px; font-style: normal; text-overflow: ellipsis; white-space: nowrap; }
.duc-chart-tooltip-grid b { font-size: 9.5px; font-weight: 600; }
.duc-chart-tooltip-grid small { color: var(--dsw-alias-label-tertiary, #80868b); font-size: 9px; text-align: right; }

.duc-chart-actions { display: flex; align-items: center; gap: 7px; }
.duc-chart-explainer {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-top: 5px;
  color: var(--dsw-alias-label-tertiary, rgba(255, 255, 255, 0.58));
  font-size: 10.5px;
  line-height: 1.45;
}
.duc-chart-explainer b { color: var(--dsw-alias-label-secondary, rgba(255, 255, 255, 0.72)); font-weight: 500; text-align: right; }
.duc-root:lang(en) .duc-chart-explainer { display: block; }
.duc-root:lang(en) .duc-chart-explainer b { display: block; margin-top: 1px; text-align: left; }
.duc-view-toggle { display: inline-flex; overflow: hidden; border: 1px solid var(--dsw-alias-border-l3, rgba(127, 127, 127, 0.3)); border-radius: 6px; }
.duc-view-toggle button {
  min-width: 44px;
  margin: 0;
  padding: 0 7px;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-label-tertiary, rgba(255, 255, 255, 0.58));
  font: inherit;
  font-size: 10px;
  line-height: 18px;
  cursor: pointer;
}
.duc-view-toggle button + button { border-left: 1px solid var(--dsw-alias-border-l3, rgba(127, 127, 127, 0.3)); }
.duc-view-toggle button:hover { color: var(--dsw-alias-label-primary, rgba(255, 255, 255, 0.9)); }
.duc-view-toggle button[aria-pressed="true"] { background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.14)); color: var(--dsw-alias-label-primary, rgba(255, 255, 255, 0.92)); font-weight: 600; }

.duc-legend { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 6px; font-size: 10.5px; color: var(--dsw-alias-label-tertiary, rgba(255, 255, 255, 0.62)); }
.duc-legend i,
.duc-cost-split i { display: inline-block; width: 7px; height: 7px; border-radius: 2px; margin-right: 4px; vertical-align: 0; }

.duc-cost-split { display: flex; align-items: center; gap: 18px; margin-top: 8px; color: var(--dsw-alias-label-secondary, rgba(255, 255, 255, 0.72)); }
.duc-cost-split span { white-space: nowrap; }
.duc-cost-split b { margin-left: 3px; color: var(--dsw-alias-label-primary, rgba(255, 255, 255, 0.92)); font-weight: 600; }

.duc-note { margin-top: 7px; font-size: 10.5px; line-height: 1.55; color: var(--dsw-alias-label-tertiary, rgba(255, 255, 255, 0.6)); }
.duc-empty { padding: 10px 0 2px; font-size: 11px; color: var(--dsw-alias-label-tertiary, rgba(255, 255, 255, 0.6)); }

.duc-refresh {
  margin: 0;
  border: 1px solid var(--dsw-alias-border-l3, rgba(127, 127, 127, 0.35));
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, rgba(255, 255, 255, 0.6));
  font-size: 10.5px;
  line-height: 18px;
  padding: 0 8px;
  cursor: pointer;
}
.duc-refresh:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.15)); color: var(--dsw-alias-label-primary, rgba(255, 255, 255, 0.9)); }
.duc-refresh:active { transform: translateY(1px); }

.duc-err {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-top: 8px;
  color: var(--dsw-static-amber-500, #e8a33d);
}
.duc-err button {
  border: 1px solid var(--dsw-alias-border-l3, rgba(127, 127, 127, 0.35));
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font-size: 11px;
  padding: 2px 8px;
  cursor: pointer;
}
.duc-err button:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.15)); }

.duc-bal {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 7px;
}
.duc-balance-primary { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.duc-bal .amount { font-size: 19px; font-weight: 700; letter-spacing: -0.015em; }
.duc-status-ok,
.duc-status-warn { font-size: 10.5px; font-weight: 600; }
.duc-status-ok { color: var(--duc-output); }
.duc-status-warn { color: var(--duc-write); }
.duc-balance-breakdown { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; color: var(--dsw-alias-label-tertiary, rgba(255, 255, 255, 0.6)); font-size: 10.5px; }
.duc-balance-breakdown span { white-space: nowrap; }
.duc-balance-breakdown b { margin-left: 3px; color: var(--dsw-alias-label-secondary, rgba(255, 255, 255, 0.74)); font-weight: 600; }

.duc-balance-skeleton { display: flex; flex-direction: column; gap: 7px; padding-top: 9px; }
.duc-balance-skeleton i,
.duc-balance-skeleton span { display: block; border-radius: 4px; background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.1)); }
.duc-balance-skeleton i { width: 88px; height: 19px; }
.duc-balance-skeleton span { width: 58%; height: 10px; }

@media (max-width: 420px) {
  .duc-panel { padding-inline: 12px; }
  .duc-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .duc-cell:nth-child(odd) { border-left: 0; }
  .duc-cell:nth-child(n + 3) { border-top: 1px solid var(--dsw-alias-border-l3, rgba(127, 127, 127, 0.18)); }
  .duc-cost-split { gap: 12px; }
  .duc-balance-breakdown { grid-template-columns: 1fr; gap: 3px; }
  .duc-chart-explainer { display: block; }
  .duc-chart-explainer b { display: block; margin-top: 1px; text-align: left; }
}

@media (prefers-reduced-motion: reduce) {
  .duc-toggle:active,
  .duc-refresh:active,
  .duc-chart-scroll-btn:active { transform: none; }
  .duc-chart-segment,
  .duc-chart-scroll-btn { transition: none; }
  .duc-pressure i { transition: none; }
}
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
