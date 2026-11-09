# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/). 中文版见 [CHANGELOG_ZH.md](./CHANGELOG_ZH.md).

## [1.1.9] - 2026-11-10

### Added

- **Claude cost estimation** — built-in Anthropic Claude official API standard rates (USD per 1M tokens, verified 2026-11-05 against https://platform.claude.com/docs/en/about-claude/pricing): Fable 5.1 / 5, Mythos 5.1 / 5, Opus 5.5 / 5 / 4.8 / 4.7 / 4.6 / 4.5 / 4.1 / 4, Sonnet 5.5 / 5 / 4.6 / 4.5 / 4, Haiku 4.5. Flat across peak/off-peak; CNY converted at the shared display FX rate (config/default, saved last successful rate or manual refresh). Claude Haiku 5.5 is intentionally not listed (prompt-length tiered pricing cannot be determined from per-round totals).
- **Separate cache-write pricing** — `BucketPrices` gains an optional `cacheWrite` rate (5-minute TTL write price for Claude); `pricing.json` accepts it too. When absent, cache writes are still billed at the cache-miss rate (DeepSeek behavior unchanged).
- **Model-id normalization** — `normalizeModelId` lower-cases, strips the `anthropic/` prefix and rewrites dotted Claude versions (`claude-opus-5.5` → `claude-opus-5-5`); used by the host resolver, `pricing.json` keys and the client snapshot lookup.
- **Unpriced rounds** — `RoundCost` / `ChartCost` / resolver results gain `unpriced`. Session totals that include unpriced rounds are shown as `≥` (lower bound) with a panel note; the current-model price line is hidden instead of showing `$0/1M`; compaction cost is left blank instead of `$0`.

### Changed

- **Unlisted Claude models are no longer billed at the DeepSeek fallback rate** — any model id containing `claude` (including Bedrock ids such as `anthropic.claude-…` / `us.anthropic.claude-…` and display names) that has no price resolves to zero rates and is marked unpriced, instead of the `deepseek-flash` fallback estimate that understated them by tens of times. DeepSeek models and a missing model name keep the flash fallback. This also changes the exported `pricingFor()` / `estimateCost()`: for such models they now return `UNPRICED_PRICING` / `0` (still `estimated: true`).
- **Longest-key price matching** — price-key lookup (`matchPricingKey`, shared by builtin, `pricing.json` and the client snapshot) now picks the exact key, else the longest matching prefix regardless of insertion order, so `claude-opus-5-5-20261101` resolves to Opus 5.5 rather than Opus 5. Claude keys only match the exact id or the id plus a dated snapshot suffix (`-YYYYMMDD` / `-latest`), so an unlisted newer version (e.g. `claude-opus-5-6`) is unpriced instead of borrowing a sibling's rate. Non-Claude keys keep the lenient prefix semantics.

### Fixed

- **Host/client pricing parity** — a user-file prefix override now wins over a builtin exact key on both paths; matching stays exact-then-longest within each source.
- **Complete cost breakdown** — cache-read cost is included in the panel's components and composition bar, with wrapping for narrow layouts.
- **Shared FX valuation** — all single-currency prices (including Claude, USD-only overrides and legacy CNY entries) retain their source currency and use one validated display rate. Native dual quotes stay unchanged. Refreshes revalue history, compactions, live estimates and badges; in-flight history is keyed by session and rate with stale-response guards. Restoring a saved rate no longer blocks configured-currency initialization.
- **Pricing explanations** — the panel shows the actual shared conversion policy, separate cache-write rate and builtin Claude's 5-minute TTL/standard-price limits instead of implying an unrelated live rate was used.
- **Anomaly detection** skips unpriced rounds, so their zero cost no longer drags the baseline down and causes later priced rounds to be flagged as spikes.

### Compatibility

- The Claude PR author reported checks against the installed DSH 0.2.2-rc.1 app bundle (not an independent clean-profile install): the peer-range admission check passes (`includePrerelease`), the missing `dsh-client-ui-slots` package is skipped by `dsh.client.inject`, both slots and their standard props are unchanged, and the fold handles 0.2.2-rc.1 session logs. DeepSeek model ids and list prices are unchanged (`deepseek-flash` = DeepSeek-V4.1-Flash-1017, `deepseek-v4-pro` = DeepSeek-V4-Pro-0813).

### Validation and upgrade notes

- Source validation: Node 20.19.5 / 22.17.0 / 24.22.2, **85 tests passed, zero skipped** (including version/documentation consistency); package dry-run and extracted runtime/type checks passed. No dependency upgrades or peer-range changes.
- Isolated Chrome with a synthetic Host/session exercised the real components/hooks and plugin routes: configured rate 7.1 → refreshed rate 7.3, history/indicator/badge agreement, CNY/USD switching, saved-rate reload, complete cost breakdown and English 360px layout. This is not installed-DSH or clean-profile certification; no new 0.1.x/0.2.x clean-profile evidence is claimed.
- Install the explicit version once it is available on npm, restart `dsh web`, and reload the browser. Existing config and pricing files remain compatible; USD-only overrides are now accepted. Single-currency converted historical amounts can change with the selected display rate; native dual-currency quotes remain unchanged. No session-log migration is required.
- The version-record date is 2026-11-10 (Asia/Shanghai). Content is finalized for maintainer-controlled npm publication; a dated changelog alone does not prove npm availability. Publish from the final verified release commit, not the earlier implementation commit. If publication occurs on a different date, update both changelogs together.

## [1.1.8] - 2026-10-22

### Fixed

- **DSH 0.2.x compatibility (plugin admission gate)** — DSH 0.2.1-rc.2 only loads a plugin when `package.json` declares `engines.dsh`, or when every `peerDependencies` range whose package name is `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` matches the running DSH runtime version. 1.1.7 declared all four DSH client peers with `>=0.1.0-rc.6 <0.2.0`, so startup was denied with the user-visible warning `dsh-usage-chart@1.1.7 与 DSH 0.2.1-rc.2 不兼容（要求 @deepseek-ai/dsh-client-locale >=0.1.0-rc.6 <0.2.0, ...）…`. The peer ranges now cover both client-SDK generations:
  - `@deepseek-ai/dsh-client-locale`, `@deepseek-ai/dsh-client-ui-conversation`, and `@deepseek-ai/dsh-client-ui-slots` widened from `>=0.1.0-rc.6 <0.2.0` to `>=0.1.0-rc.6 <0.3.0-0`. The `-0` upper bound matters because DSH compares ranges with `includePrerelease`: it still admits 0.2.x prereleases (like 0.2.1-rc.2) but keeps future 0.3.0 prereleases out.
  - The retired `@deepseek-ai/dsh-client-runtime` peer is removed. DSH 0.2.x replaced it with the `dsh-client-modules` module system (plus `dsh-client-ui-renderer`, the `dsh-client-ui-session` standard kit, and `dsh-client-store`); its last published version was `0.1.1-rc.2`, so no 0.2.x-compatible release exists.
  - DSH 0.1.x stays supported on the code level: the 0.1.x paths (`provenance`, `assistant/chunk`, and `user/message.source` — a `{ kind }` object on both lines since dsh-llm 0.1.0-rc.2, with bare strings kept as a legacy fallback) are kept, and the APIs the plugin uses are the same on both lines. The 0.2.1-rc.2 side was verified against the installed app bundle and the published 0.2.1-rc.2 package typings: slots `conversation.composer.dock` and `conversation.chat.assistant-actions` still exist and render; session-scope standard props still deliver `useSession` / `sessionId` / `useProjection` (ui-session) and `useChat` (ui-chat); `useChat` snapshots still expose `legacy.nodes`; the `tokenUsage` / `contextPressure` / `contextBreakdown` projections keep their fields; `ctx.locale.getLocale()` / `subscribe` and `ctx.slots.inject` / `register` are unchanged; and the host `webServer.register` / `sessions.get` / `snapshotEvents` / `credentials.resolve` services are unchanged. No live 0.1.x install was re-run after `dsh-client-runtime` left `dsh.client.inject`.
- **Assistant-node model identity on DSH 0.2.x** — the assistant-node model identity now also reads the 0.2.x `providerMetadata` field. The DSH 0.1.x `provenance` source is still preferred when present, and `requestConfig` remains the last-resort fallback, so model labels and per-message cost attribution no longer lose the model on 0.2.x.
- **Self-contained client type declarations** — the emitted client `.d.ts` files no longer import the retired `@deepseek-ai/dsh-client-runtime` package. Type-checking the plugin in a 0.2.x-only DSH tree can no longer fail on a dangling import of a package DSH no longer ships; 0.1.x trees keep working as before.
- **DSH 0.2.x session-log vocabulary** — DSH 0.2.x dropped `assistant/chunk` events and folds streaming usage into `assistant/message` (`usage` + `stream`). The host fold now follows the official token-meter accounting on these logs:
  - Message usage comes from `data.usage`, falling back to the last usage record in `stream`.
  - Failed or retried requests, which 0.2.x persists only as `assistant/attempt` with usage inside `stream`, are counted in totals and per-round costs, and each attempt is billed separately across retry boundaries.
  - TTFT is the first token-bearing stream record: structural `block-start` / `usage` / `finish` records and empty fragments are skipped, while raw `*-delta` chunks and name-bearing tool-call fragments count even when their argument text is empty.
  - Output TPS divides output tokens by the summed streaming time of each `assistant/message` / `assistant/attempt`, so tool execution and the wait between steps no longer drag it down; a turn whose output arrives as a single fragment reports no TPS. Logs without a stream timeline keep the 0.1.x anchors (first usage sample → turn end).
  - `user/message.source` is a `{ kind }` object (0.1.x has used the same typed shape since dsh-llm 0.1.0-rc.2; only legacy logs may still carry a bare string, which the fold keeps accepting). `user` and `user-*` map to `human`, goal/continuation and agent kinds keep their name, and other runtime injections such as `tool-jobs` become `agent.<kind>`, so the input-source label no longer shows them as human.

### Release preparation

- Synchronize the npm lockfile root peer ranges/metadata with `package.json`, removing the retired runtime entries without upgrading the locked dependency versions.
- Include the exact preview screenshot filenames referenced by both READMEs in the npm package, and update the bilingual documentation, architecture, roadmap, and release checklist. Add manifest regressions for lockfile-root consistency and preview inclusion.
- Verified against the official DSH 0.2.1-rc.2 release notes and the `llm-deepseek` catalog that `DeepSeek-V4.1-Flash-1017` keeps the model id `deepseek-flash`, so the v1.1.5 rate table already prices it (no pricing change needed). Admission deliberately stays on the peer-range fallback rather than `engines.dsh`: DSH 0.2.x prefers `engines.dsh` when present but honors the peer ranges otherwise, and the peers keep each client-SDK package version-gated.

### Tests

- New manifest tests assert the widened peer ranges, that the retired `@deepseek-ai/dsh-client-runtime` peer/inject entry is gone, and that the built client bundle and published client type declarations no longer reference the retired package. New fold tests feed DSH 0.2.x-shaped logs (no `assistant/chunk`, `assistant/message` / `assistant/attempt` with `usage` + `stream`, object `user/message.source`) and assert totals, stream-only usage, TTFT from token-bearing records (raw delta chunks, name-bearing tool-call fragments), TPS over streaming time across steps, failed-attempt and retry billing, and source normalization; the retired-runtime check now scans every published client `.d.ts`; a client test covers the `provenance` → `providerMetadata` → `requestConfig` model fallback. `npm run verify` passes (typecheck + build + `node --test`, all 57 tests). The compatibility surface was checked against the installed DSH 0.2.1-rc.2 app bundle and the published 0.2.1-rc.2 package typings, and a headless-browser smoke test of a DSH 0.2.1-rc.2 Web instance loaded the linked 1.1.8 build: the boot graph included the plugin, the dock indicator rendered live usage/cost against a real session (zh copy through the `locale` service) and the expanded panel rendered session totals, context breakdown and the token projections, with no plugin console errors.

## [1.1.7] - 2026-09-24

### Fixed

- **DSH 0.1.2+ conversation nodes** — [PR #12](https://github.com/Max-Samson/dsh-usage-chart/pull/12): the dock indicator and assistant cost badges now read `legacy.nodes` from the independent `chat` slot source (`useChat`). Older DSH versions still use the session snapshot's `chat.legacy.nodes` or top-level `nodes`. Both hooks are called in a fixed order to preserve React hook state; the session fallback selects only the node list, avoiding rerenders from unrelated session updates.
- **Panel placement under themed docks** — [PR #14](https://github.com/Max-Samson/dsh-usage-chart/pull/14): the fixed usage panel converts viewport coordinates to its nearest CSS containing block when a dock or ancestor uses `transform`, `filter`, `backdrop-filter`, containment, or related properties. The follow-up handles borders, the root element, and additional `will-change` values, while ignoring `contain: style`, which does not establish the required containing block.
- **Session total across models and billing periods** — [PR #15](https://github.com/Max-Samson/dsh-usage-chart/pull/15): the indicator and panel sum the host's per-round CNY/USD costs instead of repricing all session tokens with one model and one current billing tier. This preserves each round's model and peak/off-peak start time. If history is unavailable or a round lacks cost, the client falls back to an estimate from the `/pricing` snapshot.
- **Merge regression and live-cost synchronization** — commits `9753856` and `cc0963f`: restored PR #12's `useChat` connection in the indicator after PR #15's merge had reverted it and left `ChatNodesHook` unimported. The indicator and panel now share one history result, model attribution, and session cost. When live token usage exceeds the fetched history, they display the sum of fetched rounds plus a marked estimate for only the new tokens, then refresh the host fold after 750 ms of quiet. A panel refresh updates the indicator too; failed history requests can be retried, and stale responses from another session cannot replace the selected session.

### Tests

- Added regression coverage for chat-source priority and legacy fallback, stable selector use, per-round currency sums, stale-history deltas, and the dock indicator's actual component wiring and model/cost display. `npm run verify` passes all 46 tests. A local headless-browser probe also exercised the live-cost transition and matching panel total; a running DSH Web installation should still be smoke-tested before publishing.

## [1.1.6] - 2026-09-19

### Fixed

- **Host pricing file source lifecycle (`pricing.json` override & change watcher)** — [PR #10](https://github.com/Max-Samson/dsh-usage-chart/pull/10):
  - Fixed premature disposal of `filePricingSource` during plugin registration: `ctx.effect(() => fileSource.dispose(), ...)` called `dispose()` synchronously while building the fiber and registered `undefined` as the cleanup handler, aborting initial asynchronous file loading and disabling the file change watcher. Resolved by returning a disposer function: `ctx.effect(() => () => fileSource.dispose(), ...)`.
  - Updated test mocks in `tests/core.test.mjs`, `tests/pricing.test.mjs`, and `tests/rounds.test.mjs` to properly track and execute Cordis effect disposers in `after()`.
  - Added regression test covering the `/pricing` route with user `pricing.json` overrides enabled at startup.

## [1.1.5] - 2026-09-12

### Changed

- **DeepSeek official pricing update (2026-09-10) & `deepseek-flash` support** — [PR #8](https://github.com/Max-Samson/dsh-usage-chart/pull/8):
  - **New `deepseek-flash` model pricing**: Updated builtin pricing according to the official DeepSeek pricing table (verified 2026-09-10). The new `deepseek-flash` rates are:
    - **Off-peak** (Beijing Mon–Fri non-peak & weekends): CNY 1.0 / 0.02 / 4.0 per 1M tokens (cache-miss input / cache-hit input / output); USD 0.15 / 0.003 / 0.6 per 1M tokens.
    - **Peak** (Beijing Mon–Fri 09:00–12:00 & 14:00–18:00): CNY 2.0 / 0.04 / 8.0 per 1M tokens; USD 0.30 / 0.006 / 1.2 per 1M tokens.
  - **Backward compatibility for legacy model names**: `deepseek-v4-flash` and `deepseek-v4-flash-vision-exp` are mapped to `deepseek-flash` in `BUILTIN_PRICING` so historical session logs continue resolving without falling back to unknown-model estimates.
  - **Fallback pricing**: Default unlisted model fallback (`FALLBACK_PRICING`) now points to the new `deepseek-flash` pricing.
  - **Docs & test synchronization**: Updated custom `pricing.json` example in `README.md` and `README_ZH.md` (`verifiedAt: 1788998400000`), and aligned test cases across `tests/core.test.mjs`, `tests/pricing.test.mjs`, and `tests/rounds.test.mjs` (`BUILTIN_VERIFIED_AT` set to `2026-09-10T00:00:00Z`).

## [1.1.4] - 2026-09-08

### Fixed

- **`dsh-session >= 0.1.2-rc.1` compatibility (snapshotEvents())** — [PR #7](https://github.com/Max-Samson/dsh-usage-chart/pull/7): `dsh-session` removed its public `events` property in `0.1.2-rc.1` (replaced by the `snapshotEvents()` method); the `/usage` route then threw `TypeError: events is not iterable`, which `dsh-host-webserver` wrapped as a bare `400` empty response, and the per-round chart disappeared (the client fell back to the empty observed-rounds path). Reproduced live on `dsh-session 0.1.2-rc.1`: `/usage?session=<loaded>` returned an empty `400` while `/usage?session=<unknown>` returned the plugin `404` JSON and folding the same log offline succeeded — confirming the crash was only the new runtime API shape. The host now reads events via capability detection — prefers `session.snapshotEvents()` when the function is present and falls back to the legacy `session.events ?? []` (so a missing API can never crash the route again). The vendored `SessionEventLike` type adds the `time` field (Unix epoch ms) and a `SessionHandle` shape (optional `events` + optional `snapshotEvents`) so `SessionStoreService.get()/list()` stay valid across both API generations. Verified against the upstream `deepseek-harness` source: `Session.events` was removed from `0.1.2-alpha.4` onward (official architecture note `2026-08-21-session-log-read-intent`); the installed `0.1.0-rc.6` still exposes `events`, so the fallback path remains covered.
- **Test coverage for the new `snapshotEvents()` access path**: added `tests/rounds.test.mjs` → `/usage route prefers snapshotEvents() when the new API is present`, mocking a session handle that exposes only `snapshotEvents()` (its `get events()` throws, proving the route never reads the removed property), asserts `time` is consumed (duration/peak billing) and that `snapshotEvents()` wins when both APIs are present.

## [1.1.2] - 2026-08-26

### Improved & Fixed

- **Compact 2-Column Hover Tooltip & Overflow Elimination**:
  - **Height Reduction**: Redesigned `.duc-chart-tooltip` into a compact 2-column grid (2×2 token breakdown + 2-column metadata pairs), reducing card height from ~280px to ~120px (>55% reduction).
  - **Top-Aligned Positioning**: Adjusted placement from `top: 20px` to `top: 2px` (240px width), ensuring the hover card stays strictly within the 132px chart boundary and never expands container scroll height or triggers popover scrollbars.

## [1.1.1] - 2026-08-26

### Improved & Fixed

- **Compact Panel UI & Vertical Overflow Elimination**:
  - **Height Reduction**: Tightened `.duc-section` vertical padding from `12px` to `8px`, compacted `.duc-cell` padding from `8px 9px` to `5px 8px`, reduced bar heights and line-heights. Overall panel height shrinks from ~800px to ~560px (~170px reduction), allowing the full dashboard to fit comfortably in viewport without vertical scrolling.
  - **Removed Redundant Legend**: Eliminated the duplicate 4-color legend row in the "Session Usage" section (values are already labeled in the 4 grid cards above; chart legend remains intact in the per-round section).
  - **Lightweight Compaction Empty State**: When no compaction has occurred, the placeholder row is omitted to save vertical space; compaction details are shown only when compactions exist.
  - **SVG Chart Height Optimization**: Reduced `RoundBars` baseline height from `96px` to `76px` (canvas height reduced from `166px` to `132px`), keeping all scroll arrows, duration lines, anomaly markers, and hover tooltips aligned and legible.
  - **Robustness Defense**: Added fallback defaults for missing `currency` parameter (`'cny'`) and safe optional chaining on `round.cost` in `RoundBars`.

## [1.1.0] - 2026-08-26

Milestone release: **Context Explainability & Compaction Diagnostics**. Turns "why context grows, which round got compacted, how many tokens were freed, and how much the summarize step cost" into an interpretable view (dock indicator + dedicated panel diagnostics section), alongside user/message input source attribution.

### Added

- **Context & Compaction Diagnostics Section**: added a dedicated diagnostics section in the panel showing System Prompt, Tools Schema, and Message History token counts and percentage breakdown, complete with a multi-segment color bar (system blue, tools amber, messages green) and an explicit heuristic-approximation note based on the official `contextBreakdown` projection.
- **Compaction Lifecycle Folding & Cost Accounting**: host-side `foldCompactions` (`src/usage/compactions.ts`) parses `compaction/start`, `compaction/summary`, `compaction/prune`, and `compaction/end` events from session logs, tracking shadowed token count, shadowed range/seqs, round attribution, summarize model, and dual-currency summarize cost (peak/off-peak tier aware).
- **Compaction Timeline & Savings**: the diagnostics section summarizes total freed tokens and total compaction occurrences, listing each compaction record (round, freed tokens, summarize cost).
- **Context Occupancy Recommendations**: actionable recommendations based on `contextPressure` occupancy (≥75% suggests starting a new session or trimming large file injections; ≥90% warns of imminent context exhaustion).
- **Segmented Dock Pressure Bar**: consumes official `contextBreakdown` projection to render system (blue), tools (amber), and messages (green) multi-segment bars on the composer dock indicator with detailed tooltip percentages, smoothly falling back to single-color bar when breakdown is unavailable.
- **Per-Round User Source Attribution**: `foldRounds` captures `userSource` (`human`, `agent.inject`, `continuation`) from `user/message` events and displays the attribution badge in the chart tooltip explainer card.
- **New Exports**: `foldCompactions` function and `CompactionRecord` type.

## [1.0.2] - 2026-08-26

### Fixed

- **Weekend off-peak tier rule**: `isPeakHour` and `tierAt` now take day-of-week into account — peak hours strictly apply to **Monday through Friday 09:00–12:00 and 14:00–18:00 (Beijing time / UTC+8)**; all hours on Saturday and Sunday are now correctly classified as off-peak (leisure/discount period).
- **Builtin pricing coverage**: added `deepseek-v4-flash-vision-exp` to builtin pricing table (identical pricing to flash); updated `BUILTIN_VERIFIED_AT` to `2026-08-26`.

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
