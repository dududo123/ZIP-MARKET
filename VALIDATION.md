# ZIP! MARKET v8.5 validation record

## Strict suites

- SQL structural/syntax checks
- Parsed Netlify API ↔ Supabase RPC contract checks
- Old/new transaction schema simulation with `kind NOT NULL`
- Explicit initial-credit compatibility insert checks
- Single registration success and invalid/duplicate errors
- Atomic Excel success, invalid-row rollback, duplicate-in-file rollback, existing-employee/race rollback
- Participant login after registration
- Executable frontend `resetFormSafely` and Excel parser tests
- `/api/health` and direct Function routing
- Administrator and participant login success/failure
- Payment and invalid amount
- Games, rewards, creation, completion, and deletion
- Participant child deletion order
- QR and response-envelope compatibility
- History navigation, modals, and transaction display
- Jua/Pretendard fonts and responsive contain images
- DOM references, supplied images, and JavaScript syntax
- Clean archive extraction and complete rerun before delivery

Expected error-path logs (`LOGIN_FAILED`, duplicate employee, invalid row, invalid amount, unauthorized, and not found) are intentional assertions, not test failures.

## Production boundary

The container does not possess production Supabase secrets. The exact production database cannot be mutated here. The repair SQL is idempotent, data-preserving, contains database-side catalog verification, and is accompanied by schema-compatibility simulation for the production `kind NOT NULL` failure shape.
