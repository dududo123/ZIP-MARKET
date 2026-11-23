# ZIP! MARKET v8.8 validation record

## Reported failures reproduced from screenshots

- Game creation attempted a row whose `builtin` value was NULL, violating the production `games.builtin NOT NULL` constraint.
- A valid completion QR could contain a different identifier generation (`id`, `slug`, or `public_id`) from the selected game card and was rejected before the completion API call.

## Verified repairs

- Canonical game creation values: ID, name/title, reward/points, image, active flags, `builtin=false`, public identifiers, timestamps.
- Dynamic insert preserves DB defaults and fills additional compatible no-default NOT NULL columns.
- Default artwork path is exactly `/assets/game-default.webp`; packaged WebP is 900×600 and SHA-256 `7a7425587a79b889cbec7f7dd6ce892394ae48dad036b57082780f55a4c9a144`.
- API returns `id`, `slug`, and `public_id`; administrator and participant use the same identifier set.
- Current compact QR plus legacy compact/JSON/URL formats parse to one canonical payload.
- UUID, text ID, slug and public ID completion paths resolve the actual game row.
- Completion, credit award and transaction creation remain atomic; duplicate scans roll back without a second reward.
- Existing payment parsing and all previously working features remain covered by regression tests.

## Commands passed

```text
npm run check
npm test
```

The suite includes JavaScript syntax, SQL delimiter/structure checks, 10 RPC contracts, API routes and response envelopes, schema compatibility, QR matrix and round trips, in-memory transaction rollback models, static asset integrity and existing-feature regression checks.

Live production mutation was not performed in the validation container; deployment still requires running the supplied safe SQL in the target Supabase project before deploying the Netlify code.
