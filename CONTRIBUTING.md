# Contributing

Thanks for improving `dsh-usage-chart`.

## Development workflow

1. Use Node.js 20 or newer and install dependencies with `npm ci`.
2. Keep Host-only code in `src/index.ts` and browser code in `src/client/`.
3. Add or update tests for behavior changes.
4. Run `npm run verify` and `npm pack --dry-run` before opening a pull request.
5. Update `CHANGELOG.md` for user-visible changes.

Pull requests should be focused and should not include generated `lib/`, local profiles, API keys, logs, or screenshots containing account information.

For UI changes, run the visual probe scripts against a running DSH Web before opening a PR:
`node scripts/verify-render.mjs` (plus `shot.mjs`, `probe-panel.mjs`, `probe-popover.mjs`).
They resolve Chrome, target URL, session, and screenshot output through `DSH_PROBE_*`
environment variables — see the README's development section for the table.

## Compatibility

This plugin follows DSH 0.1.x Host/Client bundle conventions. Changes to injected services, slots, module-loader externals, or `cordis.patch.yml` must include an installation smoke test against a clean Web profile.
