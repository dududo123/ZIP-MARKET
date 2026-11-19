# ZIP! MARKET v8.4.0 — Supabase RPC contract repair

This is a complete deployable project for the current `SCHEMA_MISSING` failure. It preserves the v8.3 UI and all six supplied images, while replacing the database contract with one exact, test-parsed contract shared by the Netlify API and Supabase.

## Confirmed cause

The deployed Function calls these PostgREST RPCs:

- `public.zip_market_initialize_admin(p_initial_password text)`
- `public.zip_market_auth_admin(p_initial_password text, p_password text)`
- `public.zip_market_auth_participant(p_employee_no text, p_password text)`

They are missing from PostgREST's schema cache. The prior migration history also contained a subtle PostgreSQL incompatibility: an older administrator function used the same SQL type signature `(text, text)` but the input names were ordered as `p_password, p_initial_password`. PostgreSQL cannot change input parameter names with `CREATE OR REPLACE FUNCTION`; it requires the old function to be dropped first. If that error occurs while a multi-statement migration is executed, later functions and the cache refresh are never installed.

v8.4 explicitly drops only the old ZIP! MARKET function overloads—never tables or rows—then recreates all eight canonical RPCs with exact parameter names, JSONB return shapes, privileges, and PostgREST cache notifications.

## Safe repair order

### 1. Repair Supabase first

In Supabase:

1. Open **SQL Editor → New query**.
2. Open `supabase/schema-repair.sql` from this project.
3. Copy the entire file into the new query.
4. Press **Run** once.

Do not paste it over an old saved query and do not run only a selected section.

The repair SQL:

- does not drop tables;
- does not delete or truncate rows;
- preserves participants, credits, games, transactions, completions, and settings;
- migrates and synchronizes both legacy column sets (`employee_no`/`credit_balance` and `employee_id`/`credits`);
- removes only incompatible ZIP! MARKET functions before recreating them;
- grants execution only to `service_role`;
- revokes direct RPC execution from `public`, `anon`, and `authenticated`;
- validates all eight function signatures, JSONB returns, and privileges;
- sends both `NOTIFY pgrst, 'reload schema'` and `NOTIFY pgrst, 'reload config'`.

At the end, the SQL result must contain:

- `schema_version = 8.4.0`;
- eight `zip_market_*` rows;
- `returns = jsonb` for every row;
- `service_role_execute = true`;
- `anon_execute = false`;
- `authenticated_execute = false`.

If the SQL Editor reports an error, do not deploy until that error is resolved. The final verification block deliberately fails instead of reporting a false success.

### 2. Check the already-deployed API

Open:

```text
https://YOUR-SITE.netlify.app/api/health
```

Once the SQL is installed and PostgREST has refreshed, it must no longer return `SCHEMA_MISSING`.

### 3. Deploy the complete v8.4 project

1. Replace the GitHub repository contents with this complete project.
2. Keep `.env.example`; never upload a real `.env` file.
3. Keep these Netlify environment variables:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `JWT_SECRET`
   - `INITIAL_ADMIN_PASSWORD`
4. In Netlify, run **Clear cache and deploy site** once.
5. Recheck `/api/health`.

Expected core response:

```json
{
  "ok": true,
  "database": true,
  "adminInitialized": true,
  "runtime": "netlify-modern-response",
  "schema": "zip-market-v8.4",
  "version": "8.4.0"
}
```

Then test administrator login and one existing participant login.

## Exact RPC contract

| Function | Exact parameters | Return |
|---|---|---|
| `zip_market_initialize_admin` | `p_initial_password text` | `jsonb` |
| `zip_market_auth_admin` | `p_initial_password text, p_password text` | `jsonb` |
| `zip_market_auth_participant` | `p_employee_no text, p_password text` | `jsonb` |
| `zip_market_admin_create_participant` | `p_employee_no text, p_name text, p_password text, p_initial_credit integer` | `jsonb` |
| `zip_market_set_admin_password` | `p_password text` | `jsonb` |
| `zip_market_grant_credit` | `p_participant_id uuid, p_amount integer, p_description text` | `jsonb` |
| `zip_market_pay_credit` | `p_participant_id uuid, p_amount integer, p_description text` | `jsonb` |
| `zip_market_complete_game` | `p_participant_id uuid, p_game_id uuid` | `jsonb` |

## Preserved UI and features

- Existing login, participant, and administrator UI
- Jua headings and Pretendard body font
- Supplied logo, 100/200/300 payment images, and two game images
- Participant registration, Excel paste, search/reset, credit grant, and deletion
- Credit payment and transaction history
- Recent five transactions plus expansion
- Payment QR and game-completion QR
- iPhone camera and QR-image scanning
- Game creation, reward, completion, and deletion
- Modal X/ESC/outside/back behavior
- Mobile and desktop internal history navigation
- Responsive `object-fit: contain` images and 390px iPhone layout

## Verification commands

```bash
npm test
npm run check
```

The test suite parses API RPC calls and SQL function signatures rather than checking names by simple substring alone. It verifies parameter names, types and order, JSONB returns, grants/revokes, PostgREST refresh, SQL structure, `/api/health`, direct Function routing, administrator and participant login success/failure, payment, games, CRUD/deletion order, QR, history, transactions, fonts, responsive images, DOM references, and response-envelope compatibility.
