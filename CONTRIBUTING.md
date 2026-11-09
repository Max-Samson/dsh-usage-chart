# Contributing

Thanks for improving `dsh-usage-chart`.

## Development workflow

1. Use Node.js 20 or newer and install dependencies with `npm ci`; the release workflow uses Node.js 24. The committed npm lockfile is the CI/release source of truth. Do not introduce a second package-manager lockfile unless the workflow is deliberately migrated.
2. Keep Host-only code in `src/index.ts` and browser code in `src/client/`.
3. Add or update tests for behavior changes.
4. Run `npm run verify` and `npm pack --dry-run` before opening a pull request.
5. Update both changelogs and READMEs for user-visible changes; keep architecture/roadmap notes current when contracts change. Keep in-progress entries pending; when the maintainer finalizes a release, date both changelogs consistently. A dated entry does not prove npm publication; adjust it if publication moves to another day.

Pull requests should be focused and should not include generated `lib/`, local profiles, API keys, logs, or screenshots containing account information.

For UI changes, run the visual probe scripts against a running DSH Web before opening a PR:
`node scripts/verify-render.mjs` (plus `shot.mjs`, `probe-panel.mjs`, `probe-popover.mjs`).
They resolve Chrome, target URL, session, and screenshot output through `DSH_PROBE_*`
environment variables — see the README's development section for the table.

## Pricing and FX regression contract

Preserve source priority (file before builtin) on both Host and Client, including prefix overrides versus exact builtin keys. Test the real exported pricing snapshot, not only independent synthetic tables. Single-currency entries must retain `PriceTier.baseCurrency` and use `pricingAtRate` with the shared display rate; do not introduce model-specific FX constants or rewrite explicit dual-currency prices. History requests/cache identities include session plus rate, and stale responses must not overwrite a new identity. Cover rounds, compactions, live estimates, unit-price notes and badges when changing the valuation path. Panel components and composition bars must include input, cache-read and output costs.

`tests/pricing-consistency.test.mjs`, `tests/currency-history.test.mjs` and `tests/usage-panel.test.mjs` cover this contract. Keep browser/installation evidence separate from pure, mocked-hook or static-render checks.

## Compatibility

This plugin supports DSH 0.1.x and 0.2.x Host/Client bundle conventions; its peer ranges cover both. `@deepseek-ai/dsh-client-runtime` was retired in DSH 0.2.0 — do not reintroduce imports, build externals, or peer entries for it. Changes to injected services, slots, module-loader externals, or `cordis.patch.yml` must include clean Web-profile installation evidence for each supported DSH line. Record the exact runtime/plugin versions, installation source, and result separately. Unit/shape tests or a linked-build browser probe do not certify clean-profile installation; explicitly document any untested line.

Before a release, check `package.json` against the lockfile root (including peer metadata), run `npm run verify`, and inspect `npm pack --dry-run` for the exported runtime/type files and README screenshots. Tag the final verified commit, not an earlier merge commit.
