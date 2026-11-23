import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [api, schema, repair] = await Promise.all([
  readFile(new URL('../netlify/functions/api.mjs', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/schema-repair.sql', import.meta.url), 'utf8')
]);

const expected = {
  zip_market_initialize_admin: [['p_initial_password','text']],
  zip_market_auth_admin: [['p_initial_password','text'],['p_password','text']],
  zip_market_auth_participant: [['p_employee_no','text'],['p_password','text']],
  zip_market_admin_create_participant: [['p_employee_no','text'],['p_name','text'],['p_password','text'],['p_initial_credit','integer']],
  zip_market_admin_create_participants: [['p_participants','jsonb']],
  zip_market_set_admin_password: [['p_password','text']],
  zip_market_grant_credit: [['p_participant_id','uuid'],['p_amount','integer'],['p_description','text']],
  zip_market_pay_credit: [['p_participant_id','uuid'],['p_amount','integer'],['p_description','text'],['p_request_id','text']],
  zip_market_admin_create_game: [['p_name','text'],['p_image_url','text'],['p_reward','integer']],
  zip_market_admin_update_game_reward: [['p_game_identifier','text'],['p_reward','integer']],
  zip_market_resolve_game: [['p_game_identifier','text']],
  zip_market_complete_game: [['p_participant_id','uuid'],['p_game_id','text']]
};

function parseSqlFunctions(sql) {
  const functions = new Map();
  const regex = /create\s+function\s+public\.(\w+)\s*\(([\s\S]*?)\)\s*returns\s+(\w+)/gi;
  for (const match of sql.matchAll(regex)) {
    const args = match[2].trim() ? match[2].split(',').map(raw => {
      const cleaned = raw.replace(/--.*$/gm,'').trim();
      const parsed = cleaned.match(/^(p_\w+)\s+([a-zA-Z0-9_]+)/);
      return parsed ? [parsed[1], parsed[2].toLowerCase()] : null;
    }).filter(Boolean) : [];
    functions.set(match[1], { args, returns: match[3].toLowerCase(), index: match.index });
  }
  return functions;
}

function parseApiRpcCalls(source) {
  const calls = new Map();
  const regex = /rpc\('([^']+)'\s*,\s*\{([\s\S]*?)\}\)/g;
  for (const match of source.matchAll(regex)) {
    const keys = [...match[2].matchAll(/\b(p_\w+)\s*:/g)].map(item => item[1]);
    if (!calls.has(match[1])) calls.set(match[1], []);
    calls.get(match[1]).push(keys);
  }
  return calls;
}

for (const [label, sql] of [['schema.sql', schema], ['schema-repair.sql', repair]]) {
  const functions = parseSqlFunctions(sql);
  for (const [name, args] of Object.entries(expected)) {
    assert.ok(functions.has(name), `${label}: missing public.${name}`);
    assert.deepEqual(functions.get(name).args, args, `${label}: ${name} parameter name/type/order mismatch`);
    assert.equal(functions.get(name).returns, 'jsonb', `${label}: ${name} must return jsonb`);
    const drop = new RegExp(`drop\\s+function\\s+if\\s+exists\\s+public\\.${name}\\s*\\(`,'i').exec(sql);
    assert.ok(drop, `${label}: ${name} must explicitly drop incompatible legacy signatures first`);
    assert.ok(drop.index < functions.get(name).index, `${label}: ${name} drop must precede creation`);

    const signatureTypes = args.map(([,type])=>type).join('\\s*,\\s*');
    assert.match(sql, new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${name}\\s*\\(\\s*${signatureTypes}\\s*\\)\\s+to\\s+service_role`,'i'), `${label}: service_role grant missing for ${name}`);
    assert.match(sql, new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${name}[\\s\\S]*?from\\s+public\\s*,\\s*anon\\s*,\\s*authenticated`,'i'), `${label}: public/anon/authenticated revoke missing for ${name}`);
  }
  assert.match(sql, /notify\s+pgrst\s*,\s*'reload schema'/i, `${label}: PostgREST schema reload missing`);
  assert.match(sql, /notify\s+pgrst\s*,\s*'reload config'/i, `${label}: PostgREST config reload missing`);
  assert.match(sql, /ZIP_MARKET_RPC_MISSING/, `${label}: fail-fast installation verification missing`);
  assert.doesNotMatch(sql, /^\s*drop\s+table/im, `${label}: repair must never drop tables`);
  assert.doesNotMatch(sql, /^\s*delete\s+from/im, `${label}: repair must never delete rows`);
}

const calls = parseApiRpcCalls(api);
for (const [name, args] of Object.entries(expected)) {
  assert.ok(calls.has(name), `API never calls ${name}`);
  const expectedNames = args.map(([arg]) => arg);
  for (const actualNames of calls.get(name)) assert.deepEqual(actualNames, expectedNames, `API ${name} JSON keys mismatch`);
}

assert.match(repair, /jsonb_build_object\('initialized',\s*true,\s*'createdNow'/i);
assert.match(repair, /jsonb_build_object\('authenticated',\s*v_valid\)/i);
assert.match(repair, /'participant',\s*jsonb_build_object/i);
assert.match(repair, /jsonb_typeof\(p_participants\)\s*<>\s*'array'/i,'bulk RPC must validate JSON array');
assert.match(repair, /Pass 1:[\s\S]*Pass 2:/i,'bulk RPC must validate all rows before inserts');
assert.match(repair, /create function public\.zip_market_admin_create_participants[\s\S]*?return jsonb_build_object\('createdCount'/i,'bulk RPC return shape missing');
assert.doesNotMatch(repair, /not\s+v_valid\s+and\s+p_password\s*=\s*p_initial_password/i,'bootstrap password must not overwrite a changed administrator password');
assert.match(repair, /zip_market_pay_credit[\s\S]*p_request_id[\s\S]*'idempotent'/i,'payment RPC must be idempotent by request ID');
assert.match(repair, /zip_market_resolve_game[\s\S]*lower\(id::text\)[\s\S]*lower\(slug\)[\s\S]*lower\(public_id::text\)/i,'game resolver must accept ID, slug and public_id');
assert.match(repair, /zip_market_complete_game[\s\S]*zip_market_resolve_game\(p_game_id\)[\s\S]*game_completions/i,'game completion must resolve the canonical game row before inserting');
assert.match(repair, /zip_market_admin_create_game[\s\S]*'builtin', false[\s\S]*jsonb_populate_record\(null::public\.games/i,'game creation must populate the real old/new row type including builtin');
assert.equal(schema.split('\n').slice(1).join('\n'), repair.split('\n').slice(1).join('\n'), 'schema.sql and repair SQL logic diverged');
console.log('rpc-contract.test: parsed twelve API RPC contracts and both SQL files; signatures, parameters, returns, grants, revokes and cache refresh match exactly');
