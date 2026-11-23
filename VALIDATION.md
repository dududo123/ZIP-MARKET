# ZIP! MARKET v8.9 validation record

## Screenshot failure reproduced

The QR decoder succeeded, but the completion request ended with `GAME_NOT_FOUND`. The prior normalizer removed the stored `game-` data prefix from canonical `public_id` values, so a valid administrator QR no longer matched `games.id`, `games.slug`, or `games.public_id`.

## Verified repair

- Canonical administrator QR retains the complete stable `public_id`.
- Current compact QR and legacy compact, JSON, URL, `GAME:<id>`, `ZIP_MARKET_GAME:<id>` payloads parse consistently.
- Text resolver covers UUID/text/numeric `id`, `slug`, `public_id`, normalized game-name aliases, and v8.8 already-printed stripped aliases.
- API resolves a canonical row before completion and never sends a slug to a UUID-only lookup.
- Per-game selected-card validation resolves aliases before rejecting.
- Completion, reward, and transaction creation remain atomic; duplicates cannot add a second reward.
- Existing payment QR behavior remains unchanged.
- Empty existing `slug` and `public_id` values are backfilled without deleting rows.

## Commands passed

```text
npm run check
npm test
```

The successful suite includes JavaScript syntax, SQL structure, 11 RPC contracts, API routes and response envelopes, QR round trips, screenshot scenario for `탁구공 넣기`, newly added games, general and per-game scanner models, canonical and already-printed QR aliases, completion/reward/transaction state, duplicate blocking, payment preservation, static assets, and existing-feature regressions.

Live production mutation was not performed in the validation container. Deployment requires running the supplied v8.9 safe SQL before deploying the Netlify project.
