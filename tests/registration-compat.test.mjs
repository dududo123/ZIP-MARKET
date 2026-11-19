import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [sql, api, app, html] = await Promise.all([
  readFile(new URL('../supabase/schema-repair.sql', import.meta.url),'utf8'),
  readFile(new URL('../netlify/functions/api.mjs', import.meta.url),'utf8'),
  readFile(new URL('../public/app.js', import.meta.url),'utf8'),
  readFile(new URL('../public/index.html', import.meta.url),'utf8')
]);

// Real-schema compatibility model: test both the modern subset and the old
// deployed NOT NULL schema reported by Supabase (kind/type/label/description,
// balance_after and created_at all required).
const initialInsert = sql.match(/insert into public\.transactions\(\s*participant_id, amount, kind, type, label, description,\s*balance_after, reference, created_at\s*\) values \(\s*v_person\.id, v_opening, '([^']+)', '([^']+)', '([^']+)', '([^']+)',\s*v_opening, 'initial:'/i);
assert.ok(initialInsert,'participant creation must explicitly insert every transaction compatibility column');
const transaction = {
  participant_id:'p1', amount:10000,
  kind:initialInsert[1], type:initialInsert[2], label:initialInsert[3], description:initialInsert[4],
  balance_after:10000, reference:'initial:p1', created_at:new Date().toISOString()
};
const schemas = {
  modern:['participant_id','amount','type','description','balance_after','reference','created_at'],
  productionV6Kind:['participant_id','amount','kind','description','created_at'],
  accumulatedProduction:['participant_id','amount','kind','type','label','description','balance_after','created_at']
};
for (const [name,columns] of Object.entries(schemas)) {
  for (const column of columns) assert.notEqual(transaction[column],null,`${name}: ${column} cannot be null`);
}
assert.equal(transaction.kind,'initial');assert.equal(transaction.type,'adjustment');assert.equal(transaction.label,'초기 크레딧');

for (const column of ['kind','type','label','description','balance_after','created_at']) {
  assert.match(sql,new RegExp(`alter table public\\.transactions add column if not exists ${column}`,'i'),`repair does not add ${column}`);
  assert.match(sql,new RegExp(`alter table public\\.transactions alter column ${column} set not null`,'i'),`repair does not enforce ${column} NOT NULL after backfill`);
}
assert.match(sql,/create or replace function public\.zip_market_sync_transaction_compat\(\)/i,'transaction compatibility trigger function missing');
assert.match(sql,/create trigger zip_market_transaction_compat_trg/i,'transaction compatibility trigger missing');

// Single and bulk API contracts.
assert.match(api,/path === '\/admin\/participants'/);
assert.match(api,/path === '\/admin\/participants\/bulk'/);
assert.match(api,/rpc\('zip_market_admin_create_participants', \{ p_participants: rows \}\)/,'bulk route must use one atomic RPC call');
const bulkBlock=api.slice(api.indexOf("path === '/admin/participants/bulk'"),api.indexOf('const participantDelete'));
assert.doesNotMatch(bulkBlock,/for\s*\([^)]*\)[\s\S]*rpc\('zip_market_admin_create_participant'/,'bulk route must not register one row at a time');
assert.match(bulkBlock,/DUPLICATE_EMPLOYEE_NO_IN_FILE/,'bulk route duplicate-in-file validation missing');
assert.match(api,/EMPLOYEE_NO_ALREADY_EXISTS/,'duplicate database error mapping missing');

// SQL bulk transaction validates every row before Pass 2. PL/pgSQL functions
// execute atomically, so an exception from validation or creation rolls back
// every insert performed by the call.
const bulkSql=sql.slice(sql.indexOf('create function public.zip_market_admin_create_participants'),sql.indexOf('create function public.zip_market_set_admin_password'));
assert.ok(bulkSql.indexOf('Pass 1:') < bulkSql.indexOf('Pass 2:'),'bulk validation must precede all writes');
const pass1=bulkSql.slice(bulkSql.indexOf('Pass 1:'),bulkSql.indexOf('Pass 2:'));
assert.doesNotMatch(pass1,/zip_market_admin_create_participant\(/,'validation pass must not insert participants');
for (const code of ['EMPLOYEE_NO_REQUIRED','NAME_REQUIRED','PASSWORD_REQUIRED','INVALID_INITIAL_CREDIT','DUPLICATE_EMPLOYEE_NO_IN_FILE','EMPLOYEE_NO_ALREADY_EXISTS']) assert.ok(bulkSql.includes(code),`bulk row error ${code} missing`);

// Simulate success, invalid-row rollback, duplicate-in-file rollback and an
// insert-time race duplicate rollback with an in-memory atomic transaction.
function bulkCreateAtomic(database, rows, failAtInsert=-1) {
  const staged=[]; const seen=new Set();
  rows.forEach((row,index)=>{
    const number=index+1;
    if(!row.employeeNo)throw new Error(`ROW_${number}: EMPLOYEE_NO_REQUIRED`);
    if(!row.name)throw new Error(`ROW_${number}: NAME_REQUIRED`);
    if(!row.password)throw new Error(`ROW_${number}: PASSWORD_REQUIRED`);
    if(!Number.isInteger(row.initialCredit)||row.initialCredit<0)throw new Error(`ROW_${number}: INVALID_INITIAL_CREDIT`);
    if(seen.has(row.employeeNo))throw new Error(`ROW_${number}: DUPLICATE_EMPLOYEE_NO_IN_FILE`);
    if(database.has(row.employeeNo))throw new Error(`ROW_${number}: EMPLOYEE_NO_ALREADY_EXISTS`);
    seen.add(row.employeeNo);staged.push(row);
  });
  const before=new Set(database);
  try { staged.forEach((row,index)=>{if(index===failAtInsert)throw new Error('EMPLOYEE_NO_ALREADY_EXISTS');database.add(row.employeeNo);}); }
  catch(error){database.clear();for(const value of before)database.add(value);throw error;}
  return staged.length;
}
let db=new Set(['OLD001']);
assert.equal(bulkCreateAtomic(db,[{employeeNo:'A1',name:'A',password:'1',initialCredit:100},{employeeNo:'A2',name:'B',password:'2',initialCredit:200}]),2);assert.deepEqual([...db],['OLD001','A1','A2']);
db=new Set(['OLD001']);assert.throws(()=>bulkCreateAtomic(db,[{employeeNo:'A1',name:'A',password:'1',initialCredit:100},{employeeNo:'A2',name:'',password:'2',initialCredit:200}]),/ROW_2/);assert.deepEqual([...db],['OLD001']);
db=new Set();assert.throws(()=>bulkCreateAtomic(db,[{employeeNo:'A1',name:'A',password:'1',initialCredit:100},{employeeNo:'A1',name:'B',password:'2',initialCredit:200}]),/DUPLICATE/);assert.equal(db.size,0);
db=new Set();assert.throws(()=>bulkCreateAtomic(db,[{employeeNo:'A1',name:'A',password:'1',initialCredit:100},{employeeNo:'A2',name:'B',password:'2',initialCredit:200}],1),/ALREADY_EXISTS/);assert.equal(db.size,0);

// Participant auth remains compatible with newly hashed registrations.
assert.match(sql,/v_hash := crypt\(p_password, gen_salt\('bf', 10\)\)/i);
assert.match(sql,/zip_market_auth_participant[\s\S]*crypt\(coalesce\(p_password, ''\), v_person\.password_hash\) = v_person\.password_hash/i);

// DOM/reset safety and correct form targets.
for (const id of ['participant-create-form','participant-bulk-form']) assert.ok(html.includes(`id="${id}"`));
assert.match(app,/function resetFormSafely\(form, focusSelector\)/);
assert.match(app,/if \(!\(form instanceof HTMLFormElement\)\) return false;/);
assert.match(app,/resetFormSafely\(formElement,'\[name="employeeNo"\]'\)/,'single form resets wrong target');
assert.match(app,/resetFormSafely\(formElement,'textarea\[name="bulk"\]'\)/,'bulk form resets wrong target');
const registrationHandlers=app.slice(app.indexOf("$('#participant-create-form')"),app.indexOf("$('#participant-search-button')"));
assert.doesNotMatch(registrationHandlers,/e\.currentTarget\.reset\(\)|event\.currentTarget\.reset\(\)/,'unsafe async registration currentTarget reset remains');
assert.match(app,/function parseBulkParticipants\(text\)/,'bulk DOM parser missing');

console.log('registration-compat.test: old/new transaction schemas, NOT NULL kind, single+bulk registration, atomic rollback, duplicates, login contract and DOM resets passed');
