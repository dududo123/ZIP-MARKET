# ZIP! MARKET v8.5.0 — participant registration compatibility repair

This complete project fixes both administrator registration paths against the existing production database:

- Single participant registration
- Excel/bulk participant registration

It preserves the v8.4 UI, authentication, credits, payments, games, QR, deletion, navigation, fonts, responsive images, and all six supplied images.

## Confirmed failures and causes

### Database failure

The production `transactions` table contains an older required column:

```text
kind NOT NULL
```

The v8.4 participant-creation RPC inserted only the newer columns (`type`, `description`, `balance_after`, and `reference`). A registration with 10,000 initial credits therefore attempted to create a transaction where `kind` was null, and PostgreSQL rolled back the participant creation.

v8.5 repairs and synchronizes these compatibility fields:

- `kind`
- `type`
- `label`
- `description`
- `balance_after`
- `reference`
- `created_at`

Every initial-credit, administrator grant, payment, and game-reward insert now supplies all of them explicitly. A database trigger also normalizes future/legacy inserts.

### Frontend failure

The old asynchronous handlers called:

```js
e.currentTarget.reset()
```

after one or more `await` operations. At that point the event's `currentTarget` can be null, producing:

```text
Cannot read properties of null (reading 'reset')
```

v8.5 captures the form element before awaiting, confirms that it is an `HTMLFormElement`, and uses `resetFormSafely()` on the correct form:

- Single registration resets `#participant-create-form` and focuses `employeeNo`.
- Bulk registration resets `#participant-bulk-form` and focuses its textarea.

## Safe application order

### 1. Run the Supabase repair first

1. Open **Supabase → SQL Editor → New query**.
2. Open `supabase/schema-repair.sql` from this project.
3. Copy the entire file into the new query.
4. Ensure no partial text is selected.
5. Press **Run** once.

The SQL is data-preserving:

- no `DROP TABLE`;
- no `DELETE FROM`;
- no `TRUNCATE`;
- no participant, transaction, game, completion, or setting rows removed.

It backfills missing compatibility values before applying NOT NULL guarantees, recreates the registration RPCs, grants only `service_role`, verifies the catalog, and refreshes PostgREST.

### 2. Deploy the complete project

1. Replace the GitHub repository with the complete v8.5 project.
2. Keep `.env.example`; never upload a real `.env`.
3. Preserve the four Netlify variables:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `JWT_SECRET`
   - `INITIAL_ADMIN_PASSWORD`
4. Use **Clear cache and deploy site** once.
5. Check `/api/health`, administrator login, single registration, Excel registration, and participant login.

Expected health version:

```json
{
  "ok": true,
  "database": true,
  "schema": "zip-market-v8.5",
  "version": "8.5.0"
}
```

## Registration behavior

### Single registration

- Validates required employee number, name, password, and nonnegative integer credit.
- Creates participant and initial-credit transaction atomically.
- Converts duplicate employee numbers to a clear `EMPLOYEE_NO_ALREADY_EXISTS` message.
- A newly registered participant can log in using the supplied password.

### Excel registration

Expected columns per non-empty row:

```text
employee number<TAB>name<TAB>password<TAB>initial credit
```

The browser reports row-specific errors for:

- missing columns;
- missing employee number, name, or password;
- noninteger or negative credit;
- duplicate employee number within the pasted data.

The server sends all valid rows to one database RPC. The RPC performs two passes:

1. Validate every row and every duplicate before writing.
2. Create all rows in one PostgreSQL transaction.

If any validation, existing-employee, race, or transaction error occurs, the entire RPC is rolled back. It cannot leave earlier Excel rows registered while later rows fail.

## Exact registration RPCs

```text
zip_market_admin_create_participant(
  p_employee_no text,
  p_name text,
  p_password text,
  p_initial_credit integer
) returns jsonb

zip_market_admin_create_participants(
  p_participants jsonb
) returns jsonb
```

## Verification

Run:

```bash
npm test
npm run check
```

The suite covers SQL/API signatures and privileges, old/new transaction schemas including required `kind`, single registration, atomic Excel success and rollback cases, duplicate employee numbers, participant login after registration, executable form reset and Excel parser tests, API routes, administrator login, payment, games, deletion, QR, history, transaction display, fonts, responsive images, static resources, and JavaScript syntax.
