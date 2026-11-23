import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';

const [sql,api,app,html,netlify,asset] = await Promise.all([
  readFile(new URL('../supabase/schema-repair.sql',import.meta.url),'utf8'),
  readFile(new URL('../netlify/functions/api.mjs',import.meta.url),'utf8'),
  readFile(new URL('../public/app.js',import.meta.url),'utf8'),
  readFile(new URL('../public/index.html',import.meta.url),'utf8'),
  readFile(new URL('../netlify.toml',import.meta.url),'utf8'),
  readFile(new URL('../public/assets/game-default.webp',import.meta.url))
]);

// Exact user-provided ORAC artwork and path.
assert.equal(createHash('sha256').update(asset).digest('hex'),'7a7425587a79b889cbec7f7dd6ce892394ae48dad036b57082780f55a4c9a144');
assert.ok(asset.length>30000,'game-default.webp is unexpectedly small');
await assert.rejects(stat(new URL('../public/assets/game-default.svg',import.meta.url)),'stale SVG fallback must not be packaged');
assert.ok(html.includes('value="/assets/game-default.webp"'));
assert.ok(app.includes("const DEFAULT_GAME_ASSET = '/assets/game-default.webp'"));
assert.ok(app.includes('?v=${VERSION}'),'rendered local game assets must be cache-busted');
assert.match(netlify,/for = "\/assets\/game-default\.webp"[\s\S]*max-age=0, must-revalidate/i);
assert.doesNotMatch(api,/game-default\.svg/);
assert.match(api,/body\.imageUrl \|\| '\/assets\/game-default\.webp'/);

// Safe migration and old/new completion columns.
assert.match(sql,/update public\.games[\s\S]*set image_url = '\/assets\/game-default\.webp'[\s\S]*game-\)\?default/i);
for(const column of ['reward','rewarded_amount','created_at','completed_at']){
  assert.match(sql,new RegExp(`alter table public\\.game_completions add column if not exists ${column}`,'i'),`missing completion compatibility column ${column}`);
}
assert.match(sql,/create trigger zip_market_game_completion_compat_trg/i);
assert.match(sql,/new\.reward := greatest\(coalesce\(new\.reward, new\.rewarded_amount, 0\)/i);
assert.match(sql,/new\.rewarded_amount := greatest\(coalesce\(new\.rewarded_amount, new\.reward, 0\)/i);
const completionSql=sql.slice(sql.indexOf('create function public.zip_market_complete_game'),sql.indexOf('-- Compatibility aliases'));
assert.match(completionSql,/where id::text = \(public\.zip_market_resolve_game\(p_game_id\)->>'id'\)/i,'completion must use the text resolver and canonical primary key');
const resolverSql=sql.slice(sql.indexOf('create function public.zip_market_resolve_game'),sql.indexOf('create function public.zip_market_complete_game'));
assert.match(resolverSql,/lower\(id::text\)[\s\S]*lower\(slug\)[\s\S]*lower\(public_id::text\)/i,'resolver must match id, slug and public_id');
assert.match(resolverSql,/regexp_replace\(slug, '\^game\[-_:\]\+'/i,'resolver must accept v8.8 already-printed identifiers whose game- prefix was stripped');
assert.match(resolverSql,/zip_market_game_alias\(name\)/i,'resolver must accept a normalized name-safe alias');
assert.match(completionSql,/participant_id, game_id, reward, rewarded_amount, created_at, completed_at/i,'completion insert must populate old and new required columns');
assert.match(completionSql,/'participant', jsonb_build_object[\s\S]*'credit_balance', v_person\.credit_balance/i,'updated participant state missing');
assert.ok(completionSql.indexOf('insert into public.game_completions')<completionSql.indexOf('update public.participants'),'completion must be reserved before credit');
assert.ok(completionSql.indexOf('update public.participants')<completionSql.indexOf('insert into public.transactions'),'credit must precede reward transaction in the same RPC transaction');

// In-memory transaction model mirrors PostgreSQL exception rollback semantics.
function completeGameAtomic(db,{participantId,gamePublicId}){
  const snapshot=structuredClone(db);
  try{
    const game=db.games.find(item=>[item.id,item.slug,item.public_id].some(value=>String(value).toLowerCase()===gamePublicId.toLowerCase()));
    if(!game)throw new Error('GAME_NOT_FOUND');
    const participant=db.participants.find(item=>item.id===participantId);
    if(!participant)throw new Error('PARTICIPANT_NOT_FOUND');
    if(db.completions.some(item=>item.participant_id===participantId&&String(item.game_id)===String(game.id)))throw new Error('ALREADY_COMPLETED');
    const now='2026-11-19T00:00:00Z';
    db.completions.push({participant_id:participantId,game_id:game.id,reward:game.reward,rewarded_amount:game.reward,created_at:now,completed_at:now});
    participant.credit_balance+=game.reward;participant.credits=participant.credit_balance;
    db.transactions.push({participant_id:participantId,amount:game.reward,kind:'game',type:'adjustment',label:`${game.name} 완료 보상`,description:`${game.name} 완료 보상`,balance_after:participant.credit_balance,reference:`game:${game.id}`,created_at:now});
    return {participant:{...participant},reward:game.reward};
  }catch(error){Object.keys(db).forEach(key=>{db[key]=snapshot[key];});throw error;}
}
for(const variant of [
  {id:'balloon',slug:'balloon',public_id:'game-balloon'},
  {id:'22222222-2222-2222-2222-222222222222',slug:'balloon',public_id:'game-balloon'}
]){
  const db={games:[{...variant,name:'풍선 튕기기',reward:100}],participants:[{id:'p1',credit_balance:1000,credits:1000}],completions:[],transactions:[]};
  const result=completeGameAtomic(db,{participantId:'p1',gamePublicId:'balloon'});
  assert.equal(result.participant.credit_balance,1100);
  assert.deepEqual(Object.keys(db.completions[0]).sort(),['completed_at','created_at','game_id','participant_id','reward','rewarded_amount'].sort());
  assert.equal(db.transactions.length,1);
  const before=structuredClone(db);
  assert.throws(()=>completeGameAtomic(db,{participantId:'p1',gamePublicId:'balloon'}),/ALREADY_COMPLETED/);
  assert.deepEqual(db,before,'duplicate completion must roll back without a second credit or transaction');
}

// Game creation RPC: old text ID and new UUID ID paths, complete compatibility row,
// duplicate-name lock/check, and API RPC use (never a direct null-ID insert).
const createSql=sql.slice(sql.indexOf('create function public.zip_market_admin_create_game'),sql.indexOf('create function public.zip_market_complete_game'));
assert.match(createSql,/if v_id_udt = 'uuid'[\s\S]*elsif v_id_udt in \('int2', 'int4', 'int8', 'numeric'\)[\s\S]*else[\s\S]*v_id_text := v_slug/i);
assert.match(createSql,/'id', v_id_text[\s\S]*'slug', v_slug[\s\S]*'active', true[\s\S]*'builtin', false[\s\S]*'deleted', false/i);
assert.match(createSql,/column_name in \('public_id', 'public_slug', 'game_key', 'game_code', 'identifier'\)/i);
assert.match(createSql,/is_nullable = 'YES'[\s\S]*column_default is not null[\s\S]*ZIP_MARKET_UNSUPPORTED_GAMES_REQUIRED_COLUMN/i,'unknown NOT NULL columns must be filled or fail fast');
assert.match(createSql,/v_insert_columns[\s\S]*jsonb_populate_record\(null::public\.games, \$1\)[\s\S]*returning \*/i,'dynamic insert must preserve defaults while filling compatible columns');
assert.match(sql,/alter table public\.games alter column builtin set default false[\s\S]*alter table public\.games alter column builtin set not null/i);
assert.match(sql,/ZIP_MARKET_GAMES_REQUIRED_COLUMNS_INVALID[\s\S]*ZIP_MARKET_GAMES_REQUIRED_VALUES_NULL/i);
assert.match(createSql,/GAME_NAME_ALREADY_EXISTS/);
assert.match(api,/rpc\('zip_market_admin_create_game', \{ p_name: name, p_image_url: imageUrl, p_reward: reward \}\)/);
const createRoute=api.slice(api.indexOf("path === '/admin/games'"),api.indexOf('const gameDelete'));
assert.doesNotMatch(createRoute,/supabase\('games\?/,'game API must not directly insert without an ID');
function makeGame(idType,name){
  const slug=`game-${createHash('md5').update(name.toLowerCase()).digest('hex').slice(0,8)}`;
  const id=idType==='uuid'?'33333333-3333-4333-8333-333333333333':slug;
  return {id,slug,public_id:slug,name,title:name,image_url:'/assets/game-default.webp',image:'/assets/game-default.webp',reward:100,points:100,active:true,is_active:true,builtin:false,deleted:false,is_deleted:false,created_at:'now',updated_at:'now'};
}
for(const idType of ['text','uuid']){const game=makeGame(idType,'ORAC 게임');assert.ok(game.id);for(const key of ['slug','public_id','name','title','image_url','image','reward','points','active','is_active','builtin','deleted','is_deleted','created_at','updated_at'])assert.notEqual(game[key],null,`${idType}: ${key}`);}

// Password mutation stays persistent and frontend resets the captured real form.
assert.match(sql,/insert into public\.app_settings\(key, value, updated_at\)[\s\S]*on conflict \(key\) do update[\s\S]*value = excluded\.value/i);
assert.doesNotMatch(sql,/not\s+v_valid\s+and\s+p_password\s*=\s*p_initial_password/i);
const passwordHandler=app.slice(app.indexOf("$('#admin-password-form')"),app.indexOf('async function restoreSession'));
assert.match(passwordHandler,/const formElement=event\.currentTarget/);
assert.match(passwordHandler,/resetPasswordInputsSafely\(formElement\)/);
assert.doesNotMatch(passwordHandler,/event\.currentTarget\.reset\(\)|e\.currentTarget\.reset\(\)/);

console.log('game-compat.test: old/new completion rows, atomic reward+duplicate rollback, generated IDs, default asset hash/path/cache, password persistence and DOM reset contracts passed');
