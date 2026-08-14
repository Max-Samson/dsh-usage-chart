# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

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
