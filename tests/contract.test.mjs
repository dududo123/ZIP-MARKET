import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [schema, api, app, parser, html, css, pkg, netlify, redirects] = await Promise.all([
  readFile(new URL('../supabase/schema.sql', import.meta.url),'utf8'),
  readFile(new URL('../netlify/functions/api.mjs', import.meta.url),'utf8'),
  readFile(new URL('../public/app.js', import.meta.url),'utf8'),
  readFile(new URL('../public/api-response.js', import.meta.url),'utf8'),
  readFile(new URL('../public/index.html', import.meta.url),'utf8'),
  readFile(new URL('../public/styles.css', import.meta.url),'utf8'),
  readFile(new URL('../package.json', import.meta.url),'utf8'),
  readFile(new URL('../netlify.toml', import.meta.url),'utf8'),
  readFile(new URL('../public/_redirects', import.meta.url),'utf8')
]);

const rpcContracts = {
  zip_market_initialize_admin: ['p_initial_password'],
  zip_market_auth_admin: ['p_initial_password','p_password'],
  zip_market_auth_participant: ['p_employee_no','p_password'],
  zip_market_admin_create_participant: ['p_employee_no','p_name','p_password','p_initial_credit'],
  zip_market_set_admin_password: ['p_password'],
  zip_market_grant_credit: ['p_participant_id','p_amount','p_description'],
  zip_market_pay_credit: ['p_participant_id','p_amount','p_description'],
  zip_market_complete_game: ['p_participant_id','p_game_id']
};
for (const [fn,args] of Object.entries(rpcContracts)) {
  assert.match(schema,new RegExp(`function\\s+public\\.${fn}\\s*\\(`,'i'),`schema missing ${fn}`);
  assert.ok(api.includes(`rpc('${fn}'`),`API does not call ${fn}`);
  for (const arg of args) { assert.ok(schema.includes(arg),`schema missing ${fn}.${arg}`); assert.ok(api.includes(arg),`API missing ${fn}.${arg}`); }
}

assert.ok(schema.includes("notify pgrst, 'reload schema'"));
assert.ok(!/^\s*drop\s+table/im.test(schema),'schema must not drop tables');
assert.ok(!pkg.includes('"type": "module"'),'package must not recreate the v8.1 module conflict');
assert.ok(!api.includes('@supabase/supabase-js'),'server must use direct REST without WebSocket dependency');
assert.ok(api.includes('new Response('),'Function must create Web Response objects');
assert.match(api,/export default async function handler\(request\)/,'modern Netlify default handler missing');
assert.ok(!api.includes('statusCode,\n  headers:'),'legacy Function response envelope must not be returned');
assert.ok(parser.includes('statusCode')&&parser.includes('NON_JSON_RESPONSE'),'frontend parser must unwrap legacy envelopes and detect HTML');
assert.ok(app.includes('readApiResponse'),'app must use the verified response parser');
assert.ok(netlify.indexOf('from = "/api/*"') < netlify.indexOf('from = "/*"'),'API redirect must precede SPA fallback');
assert.match(redirects,/^\/api\/\*/m,'public redirect fallback missing');

for (const endpoint of ['/auth/admin','/auth/participant','/participant/pay','/participant/complete-game','/admin/participants','/admin/games','/admin/password']) assert.ok(api.includes(endpoint),`missing endpoint ${endpoint}`);
for (const feature of ['history-toggle','modal-close','qr-file','participant-search-reset','delete-participant','delete-game']) assert.ok(html.includes(feature)||app.includes(feature),`missing UI feature ${feature}`);
assert.ok(css.includes('object-fit:contain'),'responsive images must preserve full artwork');
assert.ok(app.includes("popstate"),'internal browser back navigation missing');
assert.ok(app.includes("slice(0,5)"),'five-item transaction collapse missing');
assert.ok(app.includes('Html5Qrcode'),'iPhone-compatible QR scanner missing');

console.log('contract.test: all schema/API and feature contracts passed');
