# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/). 中文版见 [CHANGELOG_ZH.md](./CHANGELOG_ZH.md).

## [0.2.0] - 2026-08-15

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
