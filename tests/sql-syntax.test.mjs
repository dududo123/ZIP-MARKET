import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

for (const file of ['schema.sql','schema-repair.sql']) {
  const sql = await readFile(new URL(`../supabase/${file}`, import.meta.url), 'utf8');
  const dollarTokens = [...sql.matchAll(/\$\$/g)];
  assert.equal(dollarTokens.length % 2, 0, `${file}: unbalanced $$ delimiters`);

  let stripped = sql.replace(/--.*$/gm,'').replace(/\$\$[\s\S]*?\$\$/g,'').replace(/'(?:''|[^'])*'/g,"''");
  let depth = 0;
  for (const char of stripped) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    assert.ok(depth >= 0, `${file}: closing parenthesis without opener`);
  }
  assert.equal(depth, 0, `${file}: unbalanced parentheses`);

  const createFunctions = [...sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+public\.(\w+)/gi)].map(m=>m[1]);
  const bodies = [...sql.matchAll(/\bas\s+\$\$[\s\S]*?\$\$\s*;/gi)];
  assert.equal(bodies.length, createFunctions.length, `${file}: every function must have one terminated body`);

  for (const required of ['create table if not exists public.participants','alter table public.participants','create trigger zip_market_participant_compat_trg','do $$','to_regprocedure','pg_get_function_result']) {
    assert.ok(sql.toLowerCase().includes(required.toLowerCase()), `${file}: missing required SQL construct: ${required}`);
  }
  assert.match(sql,/set\s+search_path\s*=\s*public\s*,\s*extensions\s*,\s*pg_catalog/i,`${file}: safe search_path missing`);
  assert.match(sql,/create\s+extension\s+if\s+not\s+exists\s+pgcrypto/i,`${file}: pgcrypto initialization missing`);
}
console.log('sql-syntax.test: dollar quotes, function bodies, parentheses, required DDL and safe search paths passed');
