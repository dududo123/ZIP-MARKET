# Supabase application order

Use **one** of these files, not both:

- Existing ZIP! MARKET database: run `schema-repair.sql`.
- Empty/new database: run `schema.sql`.

Both contain the same audited idempotent database contract. The repair file is named separately so an operator can clearly select it for the current production database.

Run the selected file in a new Supabase SQL Editor query, execute the entire file, and verify the final `schema_version` plus eight RPC rows before deploying Netlify.
