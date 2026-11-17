# Contributing to Playlist Lens

Thanks for helping improve Playlist Lens. This project stays small on purpose: no analytics, no backend, and the smallest permission surface that still works on YouTube playlists.

## Before you start

1. Open an issue for larger changes so we can agree on scope.
2. Keep the extension private and offline — no new tracking, remote code, or broad host permissions without a clear justification.
3. Match existing style in `src/` (plain DOM APIs, no bundler).

## Development setup

```bash
npm ci
npm run verify
```

## Tests

- **Unit:** `npm test` — logic in `src/lib/lens.js`.
- **E2e:** `npx playwright install chromium` then `PLAYLIST_LENS_OFFLINE=1 npm run e2e`.
- Add or extend unit tests for any behaviour you change in `lens.js` or settings handling.

## Pull requests

- One focused change set per PR when possible.
- Bump `version` in `src/manifest.json` and `package.json` for user-facing releases; update [CHANGELOG.md](CHANGELOG.md).
- CI must pass (`lint`, `test`, `build`).
- Screenshots: if UI changes, run offline e2e so `store/` and `tests/screenshots/` stay current (or explain why not).

## YouTube DOM breaks

If a playlist page stops showing the bar, check `src/selectors.js` first. Prefer adding selectors over rewriting `content.js`.

## Code of conduct

Be respectful in issues and reviews. Maintainers may close contributions that add tracking, unnecessary permissions, or unrelated refactors.