# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/). 中文版见 [CHANGELOG_ZH.md](./CHANGELOG_ZH.md).

## [1.0.1] - 2026-08-17

Billing updated to the latest DeepSeek pricing (official pricing pages, fetched 2026-08-17): prices are now quoted in **two currencies — CNY (Chinese page) and USD (English page) — per 1M tokens** with **peak / off-peak tiers** — peak hours (Beijing time 09:00–12:00 and 14:00–18:00, i.e. UTC 01:00–04:00 and 06:00–10:00) are billed at 2× the off-peak rate.

### Added

- **Peak/off-peak tiered billing**: the builtin price table stores both `peak` and `offPeak` unit prices per model; each round's cost is billed with the tier of its start time (`tierAt` resolves Beijing time = UTC+8). Unknown timestamps fall back to the peak tier (conservative estimate).
- **Official dual-currency pricing**: each tier carries both the official CNY quote and the official USD quote; costs are computed with the list price of the selected display currency — **no FX conversion**, consistent with the official bill. The CNY/USD toggle now drives the indicator, the panel, the chart cost view and the cost badge.
- `pricing.json` now accepts the dual-currency tiered shape `{ "peak": { "cny": {…}, "usd": {…} }, "offPeak": {…} }`; legacy shapes are still accepted (single-currency tiers or the flat shape are treated as CNY, with USD derived at the default rate 6.76).
- New exports: `costSplitAt`, `tierAt`, `isPeakHour`, `formatCny`, and the `CostCurrency` / `PriceTier` / `PriceTierId` / `BucketPrices` types.
- The cost note in the panel now shows both tiers: e.g. cache-miss input `1.5/3.0` (off-peak/peak) in the selected currency.
- **Live billing-tier tag**: the panel's session-usage header shows a red (peak) / green (off-peak) tag for the current billing period (Beijing time, auto-flips at hour boundaries), and each round's tooltip shows its own billing tier.
- **Per-round cost always visible**: in the cost chart view every bar shows its own cost value (not only the current round), and the observed-rounds fallback (no host history) now derives per-round cost client-side from the `/pricing` snapshot + per-turn model/start time, so the cost view works even without host history.

### Changed

- Builtin list price updated to the official prices (flash: CNY off-peak 1.5 / 0.05 / 4.5, peak 3.0 / 0.10 / 9.0; USD off-peak 0.22 / 0.007 / 0.66, peak 0.44 / 0.014 / 1.32; pro: CNY off-peak 4.5 / 0.15 / 13.5, peak 9.0 / 0.30 / 27.0; USD off-peak 0.66 / 0.022 / 1.98, peak 1.32 / 0.044 / 3.96 — miss input / hit input / output); `BUILTIN_VERIFIED_AT` updated to 2026-08-17.
- Cost computation is now currency-parameterized: `costSplit(usage, pricing, tier, currency)` and `costSplitAt(usage, pricing, timeMs, currency)` return a currency-neutral `CostSplit` (`input` / `cacheRead` / `output` / `total`) in the requested currency. `formatMoney` / `formatPricePerM` drop the FX-rate parameter (amounts are already in the display currency); `toDisplayAmount` is removed. `estimateCost` keeps returning `{ cny, estimated }` (official CNY prices).
- `foldRounds` bills each round with the tier of its `turn/start` time (fallback: `turn/end`, then peak) and publishes **both** `cny` and `usd` cost splits in the `/usage` payload, so the client can switch currencies without re-deriving.
- The FX rate (`config.cnyPerUsd`, `/rate`, "Refresh rate") is now informational only ("1 USD ≈ X CNY" note); costs never depend on it for official models.

### Fixed

- The old builtin table (single-currency USD, flat price) no longer matched the official tiered billing in either currency, so costs were stale; the whole pipeline now follows the current official pricing pages (CNY + USD).

## [1.0.0] - 2026-08-15

First complete release — the in-session usage interpreter is feature-complete (per-round chart with full-history horizontal scroll + cost/timing/anomaly explainer + multi-currency costs with live rates + account balance).

### Changed

- Per-round chart no longer truncates to the latest 12 rounds: **all** rounds render into a horizontally scrollable area with a fixed slim bar width (30px), so bars stay constant-width and never look crowded. It auto-scrolls to the latest round, and arrow buttons + edge fades appear when content overflows; the scrollbar is slimmed down.
- Per-bar value labels adapt to density: in scrollable (dense) mode only the current round keeps its top-of-bar value (details stay in the hover explainer card); otherwise overly long labels (e.g. `$0.0013`, `123.4K`) are elided so neighbouring labels never overlap.
- Chart minimum width adapts to the panel width: short histories fill/center without stretching bar widths; the tooltip follows the active bar across scrolling (content coordinate − scroll offset, clamped to the visible area).

### Fixed

- The tooltip could not be positioned correctly once the chart could scroll; it now tracks the bar precisely at any scroll position.
- Short histories could overflow on narrow panels; the adaptive minimum width removes the needless scroll.
- The balance no-key test now isolates `$DEEPSEEK_API_KEY`, so the suite passes on hosts that have the key in the environment; added coverage for the env fallback itself.

## [0.3.0] - 2026-08-15

### Added

- Cost display currency: `config.currency` ('usd' | 'cny') and `config.cnyPerUsd` (default 6.76); costs render in the chosen currency.
- USD/CNY toggle in the cost section; the choice is remembered in the browser (localStorage).
- Rate-refresh button: fetches the latest USD→CNY rate through the new same-origin `/dsh-usage-chart/rate` proxy (`config.fxUrl`) and re-estimates immediately.
- `/dsh-usage-chart/meta` route serving display-currency config to the client.

### Changed

- Per-model price notes follow the display currency and show the applied rate (e.g. `CNY（1 USD ≈ 6.76 CNY）`).

### Fixed

- Resilient rate refresh: falls back to a built-in FX source (frankfurter.dev) when the default (open.er-api.com) is unreachable or blocked; the last successful rate is persisted, so offline refreshes keep the previous rate instead of the fixed default.
- Client slots register via `ctx.slots.inject` (wait for declaration), fixing `slot "…" is not declared` when loader order changes.

## [0.2.0] - 2026-08-15## [0.2.0] - 2026-08-15

### Added

- **Per-round cost explainability (v0.2, see `docs/ROADMAP.md`)**: the host fold
  (`RoundFold`, `src/usage/rounds.ts`) now derives per-round duration
  (`turn/start → turn/end`), TTFT (start → first usage sample), output throughput
  (tokens/s), model attribution (`request/context` → `request/header` → cross-round
  carry-forward), end reason, and a per-round cost split (input / cache-read / output ×
  unit price).
- **Pricing governance**: `src/pricing.ts` is split into a pure math module
  (`pricing/calc.ts`, bundled by both halves) and a host-only `PricingSource` seam
  (`pricing/source.ts` — builtin list with a verification date + user-override
  `pricing.json` file adapter with change watching) plus a `PricingResolver`
  (`pricing/resolve.ts`, priority file > builtin > fallback, unknown models explicitly
  marked). New `/dsh-usage-chart/pricing` route exposes the resolved snapshot — the
  client's **only** price input (ADR 2); the old bundled pricing constants no longer
  drift from host resolution.
- **`/usage` route** now returns `rounds` (with cost/timing/model/endReason) instead of
  bare `turns` (`foldTurnUsage` kept as a v0.1-compatible wrapper).
- **RoundBars cost view**: a third chart mode stacks bars by cost (bucket × unit
  price); a duration polyline overlays bar tops; anomalously expensive rounds
  (relative to the previous N rounds, `src/client/diagnose/anomaly.ts`) get a warning
  marker with attributed reason chips; a per-round cache-hit mini tick sits under the
  baseline; the tooltip became an explainer card (tokens + cost + model + duration +
  TTFT + TPS + cache hit + end reason + anomaly chips).
- **Cost badge**: a dismissible `≈ $0.00xx` badge per assistant message
  (`conversation.chat.assistant-actions` slot, data from the host `/usage` history).
- **Dock context pressure bar**: slim `contextPressure` bar in the indicator
  (green → amber → red as occupancy rises).
- **Tests**: `tests/rounds.test.mjs` (fold timing/TTFT/TPS/model/cost + route),
  `tests/pricing.test.mjs` (resolver priority, file source with temp dir, unknown
  marking + route), `tests/anomaly.test.mjs` (spike flagging and attribution);
  28 tests pass via `npm run verify`.
- **Configuration**: optional `config.pricingFile` overrides the default
  `$DSH_HOME/data/dsh-usage-chart/pricing.json` (falls back to `~/.dsh/...`).

### Fixed

- Cost estimates are now single-sourced: real-time indicator cost and panel cost both
  consume the `/pricing` snapshot; the price source, verification date, and
  unknown-model marker are shown in the panel.
- Panel cost resolution now prefers the host fold's authoritative model attribution
  (ADR 1) over snapshot provenance, which can be absent for older sessions — the price
  source previously showed a spurious "fallback estimate" in that case.

### Upgrade note

- **Restart `dsh web` after upgrading to 0.2.0.** The Host process caches plugin code
  in memory (no hot reload): the new `/dsh-usage-chart/pricing` route and the
  `rounds`-shaped `/dsh-usage-chart/usage` response are only served after a restart.
  Until then the indicator silently omits the cost segment and the panel shows
  "Price snapshot unavailable".

## [0.1.1] - 2026-08-14

### Added

- Balance queries now resolve the DeepSeek API key through the DSH credentials service
  (`ctx.get('credentials')`), so a key configured in the web UI (Settings → Models) or in
  `.credentials.yaml` works without an environment variable or plugin config.

### Fixed

- Install warning `missing peer react@^18.2.0` (react is provided by the DSH web platform;
  the peer is now marked optional).
- Docs: document uninstall/cleanup steps in the README.

## [0.1.0] - 2026-08-14

### Added

- Composer usage indicator and expandable SVG dashboard.
- Session token, cache, context-pressure, model, and estimated-cost views.
- Per-turn usage chart with total/mix views, hover and keyboard tooltips, and a
  highlighted current-round band; host-side per-turn aggregation from the session log.
- Host-side DeepSeek balance proxy.
- Full zh/en localization: the indicator, dashboard, charts, and balance views follow
  the DSH in-app Language setting through the `locale` service (dictionaries registered
  under the `dsh-usage-chart` namespace; browser language only seeds the initial value).
- Release metadata, bilingual documentation, CI, contribution/security policies, and
  portable visual probe scripts (`scripts/*.mjs`).
- Privacy-safe README demo screenshot with fictional usage values and no account data.

### Fixed

- Light-mode readability: indicator, panel, and SVG charts now use DSH theme tokens
  (`--dsw-alias-label-*` / `--dsw-alias-bg-*`) and theme static palette colors, so text
  and chart segments stay legible in both light and dark appearances.

### Security

- Restrict Host JSON routes to same-origin GET requests.
- Require HTTPS for custom API endpoints, except loopback HTTP proxies.
- Validate token-usage samples before aggregation.
