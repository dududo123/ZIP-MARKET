# ZIP! MARKET v8.4 validation record

Validation date: 2026-11-19

## Commands

```bash
npm test
npm run check
```

## Passed suites

1. `sql-syntax.test.mjs`
   - balanced dollar quotes and parentheses
   - terminated function bodies
   - required tables, compatibility trigger, pgcrypto, safe search paths
2. `rpc-contract.test.mjs`
   - parsed all Netlify `rpc()` calls
   - parsed SQL function signatures in both SQL files
   - exact function names, parameter names/types/order, JSONB returns
   - targeted legacy function drops before creation
   - `service_role` grants and public/anon/authenticated revokes
   - PostgREST schema/config reload notifications
3. `contract.test.mjs`
   - API endpoints, schema/API references, routing, modern Response format
4. `api.routes.test.mjs`
   - `/api/health` and direct Function health route
   - administrator login success and failure
   - participant login success and failure
   - participant dashboard and transaction response
   - valid and invalid payment
   - game completion
   - participant creation and credit grant
   - administrator password update
   - game creation/deletion and participant deletion order
   - unauthenticated, unknown-route, and OPTIONS responses
5. `response-shapes.test.mjs`
   - direct JSON, legacy Netlify envelope, double-encoded JSON, errors, and HTML fallback
6. `static.test.mjs`
   - 39 literal DOM references
   - six supplied images
   - cache-busted script/CSS version and load order
7. `feature-regression.test.mjs`
   - payment options, transaction display and expansion
   - games, QR, deletion, history navigation and modals
   - Jua/Pretendard fonts
   - responsive image containment and 390px breakpoint
8. `npm run check`
   - JavaScript syntax for API, frontend response parser, app, and strict tests
9. Local HTTP smoke test
   - index, app JS, response parser, CSS, logo, three payment images, and two game images returned HTTP 200
10. Archive verification
   - rerun all tests from a clean extraction before delivery

The expected failure-path tests intentionally produce server log entries for `LOGIN_FAILED`, `INVALID_AMOUNT`, `AUTH_REQUIRED`, and `NOT_FOUND`; their returned HTTP status and JSON error codes are asserted.

## Important limitation

The live production Supabase secrets are not available inside the test container. Therefore the production database itself cannot be mutated or logged into here. The delivered repair SQL includes a database-side fail-fast verification block and final catalog query; operators must confirm its eight rows in Supabase before treating the live deployment as repaired.
