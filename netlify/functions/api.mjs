import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const JWT_SECRET = process.env.JWT_SECRET || '';
const INITIAL_ADMIN_PASSWORD = process.env.INITIAL_ADMIN_PASSWORD || '';
const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
let adminReady = false;

const ok = (body, statusCode = 200) => ({ statusCode, headers: JSON_HEADERS, body: JSON.stringify(body) });
const fail = (message, statusCode = 400, code = 'REQUEST_FAILED') => ok({ error: code, message }, statusCode);
const b64 = value => Buffer.from(value).toString('base64url');
const jsonB64 = value => b64(JSON.stringify(value));
function sign(payload, expiresInSeconds = 14400) {
  if (!JWT_SECRET) throw new Error('JWT_SECRET 환경변수가 없습니다.');
  const now = Math.floor(Date.now() / 1000), header = { alg: 'HS256', typ: 'JWT' }, data = { ...payload, iat: now, exp: now + expiresInSeconds };
  const unsigned = `${jsonB64(header)}.${jsonB64(data)}`;
  return `${unsigned}.${createHmac('sha256', JWT_SECRET).update(unsigned).digest('base64url')}`;
}
function verify(token, role) {
  if (!token || token.split('.').length !== 3) throw Object.assign(new Error('로그인이 필요합니다.'), { status: 401 });
  const [header, payload, signature] = token.split('.'), expected = createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
  const a = Buffer.from(signature), b = Buffer.from(expected); if (a.length !== b.length || !timingSafeEqual(a, b)) throw Object.assign(new Error('로그인 정보가 올바르지 않습니다.'), { status: 401 });
  const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); if (data.exp < Math.floor(Date.now() / 1000)) throw Object.assign(new Error('로그인이 만료되었습니다. 다시 로그인해 주세요.'), { status: 401 });
  if (role && data.role !== role) throw Object.assign(new Error('접근 권한이 없습니다.'), { status: 403 }); return data;
}
function bearer(event) { return (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer\s+/i, ''); }
function requireEnv() {
  const missing = [['SUPABASE_URL',SUPABASE_URL],['SUPABASE_SERVICE_ROLE_KEY',SUPABASE_KEY],['JWT_SECRET',JWT_SECRET]].filter(([,v])=>!v).map(([k])=>k);
  if (missing.length) throw new Error(`Netlify 환경변수가 없습니다: ${missing.join(', ')}`);
}
async function sb(path, { method = 'GET', body, prefer = 'return=representation' } = {}) {
  requireEnv();
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method, headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Accept: 'application/json', Prefer: prefer },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const text = await response.text(); let data = text ? (()=>{try{return JSON.parse(text)}catch{return text}})() : null;
  if (!response.ok) { const detail = typeof data === 'object' ? (data.message || data.details || data.hint) : data; const err = new Error(detail || `Supabase 요청 실패 (${response.status})`); err.status = response.status === 404 ? 500 : response.status; err.db = data; throw err; }
  return data;
}
const enc = value => encodeURIComponent(String(value));
const one = rows => Array.isArray(rows) ? rows[0] : rows;

async function ensureAdmin() {
  if (adminReady) return false;
  if (!INITIAL_ADMIN_PASSWORD) throw new Error('INITIAL_ADMIN_PASSWORD 환경변수가 없습니다.');
  const result = await sb('rpc/initialize_admin', { method:'POST', body:{p_password:INITIAL_ADMIN_PASSWORD} });
  adminReady = true; return !!result?.created;
}
async function dashboard(participantId) {
  const [users, transactions, games, completions] = await Promise.all([
    sb(`participants?id=eq.${enc(participantId)}&select=id,employee_no,name,credits,total_used&limit=1`),
    sb(`transactions?participant_id=eq.${enc(participantId)}&select=id,amount,kind,description,created_at&order=created_at.desc&limit=100`),
    sb('games?active=eq.true&select=code,name,image_url,reward,active,created_at&order=created_at.asc'),
    sb(`game_completions?participant_id=eq.${enc(participantId)}&select=game_code`)
  ]);
  const user = one(users); if (!user) throw Object.assign(new Error('사용자 정보를 찾을 수 없습니다.'),{status:404});
  return { user, transactions: transactions || [], games: games || [], completedGames: (completions || []).map(x=>x.game_code) };
}
async function adminGames() { return await sb('games?select=code,name,image_url,reward,active,created_at&order=created_at.asc'); }
function cleanEmployee(value) { return String(value || '').trim(); }
function cleanCode(value) { return String(value || '').trim().toLowerCase().replace(/[^a-z0-9가-힣_-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,60); }

export const handler = async event => {
  if (event.httpMethod === 'OPTIONS') return {statusCode:204,headers:{...JSON_HEADERS,'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Allow-Methods':'GET,POST,DELETE,OPTIONS'},body:''};
  try {
    const url = new URL(event.rawUrl || `https://local${event.path}`); let path = url.pathname.replace(/^\/\.netlify\/functions\/api/,'').replace(/^\/api/,'') || '/';
    const method = event.httpMethod || 'GET'; let body = {}; if (event.body) { try { body = JSON.parse(event.body); } catch { return fail('요청 형식이 올바르지 않습니다.',400,'INVALID_JSON'); } }

    if (path === '/health' && method === 'GET') {
      const environment = { supabaseUrl:!!SUPABASE_URL, supabaseKey:!!SUPABASE_KEY, jwtSecret:!!JWT_SECRET, initialAdminPassword:!!INITIAL_ADMIN_PASSWORD };
      try { requireEnv(); const created = await ensureAdmin(); return ok({ok:true,environment,database:true,adminInitialized:true,adminCreatedNow:created,transport:'direct-rest',runtime:process.version}); }
      catch(error){ return ok({ok:false,environment,database:false,adminInitialized:false,error:error.message},503); }
    }

    if (path === '/user/login' && method === 'POST') {
      const employeeNo = cleanEmployee(body.employeeNo), password = String(body.password || ''); if (!employeeNo || !password) return fail('사번과 비밀번호를 입력해 주세요.');
      const rows = await sb('rpc/authenticate_participant',{method:'POST',body:{p_employee_no:employeeNo,p_password:password}}); const user = one(rows);
      if (!user) return fail('사번 또는 비밀번호가 올바르지 않습니다.',401,'LOGIN_FAILED');
      const token = sign({role:'user',sub:user.id,employeeNo:user.employee_no},28800); return ok({token,dashboard:await dashboard(user.id)});
    }

    if (path === '/admin/login' && method === 'POST') {
      await ensureAdmin(); const password = String(body.password || ''); if (!password) return fail('관리자 비밀번호를 입력해 주세요.');
      const checked = await sb('rpc/verify_admin_password',{method:'POST',body:{p_password:password}}); let matched = !!checked?.matched;
      if (!matched && INITIAL_ADMIN_PASSWORD && password === INITIAL_ADMIN_PASSWORD) { await sb('rpc/set_admin_password',{method:'POST',body:{p_password:password}}); matched = true; }
      if (!matched) return fail('관리자 비밀번호가 올바르지 않습니다.',401,'LOGIN_FAILED'); return ok({token:sign({role:'admin',sub:'admin'},14400)});
    }

    if (path === '/user/pay' && method === 'POST') {
      const auth=verify(bearer(event),'user'), amount=Number(body.amount), description=String(body.description||'크레딧 결제').slice(0,120), nonce=String(body.idempotencyKey||randomUUID());
      if(!Number.isInteger(amount)||amount<1||amount>1000000)return fail('결제 금액이 올바르지 않습니다.');
      await sb('rpc/pay_credit_once',{method:'POST',body:{p_participant_id:auth.sub,p_amount:amount,p_description:description,p_nonce:nonce}}); return ok({dashboard:await dashboard(auth.sub)});
    }

    if (path === '/user/scan' && method === 'POST') {
      const auth=verify(bearer(event),'user'), qr=verify(String(body.token||''),'qr'); let message='QR 처리가 완료됐습니다.';
      if(qr.purpose==='payment'){await sb('rpc/pay_credit_once',{method:'POST',body:{p_participant_id:auth.sub,p_amount:Number(qr.amount),p_description:String(qr.description||'QR 결제'),p_nonce:String(qr.jti)}});message=`${Number(qr.amount)} C 결제가 완료됐습니다.`;}
      else if(qr.purpose==='game'){const result=await sb('rpc/complete_game',{method:'POST',body:{p_participant_id:auth.sub,p_game_code:qr.gameCode}});const r=one(result)||result;message=r?.already_completed?'이미 완료한 게임입니다.':`${Number(r?.reward||0)} C를 받았습니다.`;}
      else return fail('지원하지 않는 QR입니다.',400,'INVALID_QR'); return ok({message,dashboard:await dashboard(auth.sub)});
    }

    if (path === '/admin/participants' && method === 'GET') {
      verify(bearer(event),'admin'); const rows=await sb('participants?select=id,employee_no,name,credits,total_used,created_at&order=created_at.desc&limit=2000'); return ok({participants:rows||[]});
    }
    if (path === '/admin/participants' && method === 'POST') {
      verify(bearer(event),'admin'); const employee_no=cleanEmployee(body.employeeNo),name=String(body.name||'').trim(),password=String(body.password||''),credits=Number(body.credits||0);
      if(!employee_no||!name||password.length<4||!Number.isInteger(credits)||credits<0)return fail('참가자 정보를 다시 확인해 주세요.');
      const result=await sb('rpc/bulk_upsert_participants',{method:'POST',body:{p_rows:[{employeeNo:employee_no,name,password,credits}]}}); return ok({created:result?.created||1},201);
    }
    if (path === '/admin/participants/bulk' && method === 'POST') {
      verify(bearer(event),'admin'); const input=Array.isArray(body.rows)?body.rows:[]; if(!input.length||input.length>500)return fail('1명 이상 500명 이하로 입력해 주세요.');
      const records=[]; for(const item of input){const employeeNo=cleanEmployee(item.employeeNo),name=String(item.name||'').trim(),password=String(item.password||'1234'),credits=Number(item.credits||0);if(!employeeNo||!name||password.length<4||!Number.isInteger(credits)||credits<0)return fail(`${employeeNo||'알 수 없는 사번'} 행을 확인해 주세요.`);records.push({employeeNo,name,password,credits});}
      const result=await sb('rpc/bulk_upsert_participants',{method:'POST',body:{p_rows:records}}); return ok({created:result?.created||records.length});
    }
    let match=path.match(/^\/admin\/participants\/([^/]+)\/credit$/);
    if(match&&method==='POST'){verify(bearer(event),'admin');const amount=Number(body.amount);if(!Number.isInteger(amount)||amount<1)return fail('지급 금액이 올바르지 않습니다.');await sb('rpc/add_credit',{method:'POST',body:{p_participant_id:decodeURIComponent(match[1]),p_amount:amount,p_description:String(body.description||'관리자 크레딧 지급')}});return ok({ok:true});}
    match=path.match(/^\/admin\/participants\/([^/]+)$/);
    if(match&&method==='DELETE'){verify(bearer(event),'admin');const id=decodeURIComponent(match[1]);await Promise.all([sb(`transactions?participant_id=eq.${enc(id)}`,{method:'DELETE',prefer:'return=minimal'}),sb(`game_completions?participant_id=eq.${enc(id)}`,{method:'DELETE',prefer:'return=minimal'})]);await sb(`participants?id=eq.${enc(id)}`,{method:'DELETE',prefer:'return=minimal'});return ok({ok:true});}

    if(path==='/admin/games'&&method==='GET'){verify(bearer(event),'admin');return ok({games:await adminGames()});}
    if(path==='/admin/games'&&method==='POST'){verify(bearer(event),'admin');const code=cleanCode(body.code),name=String(body.name||'').trim(),reward=Number(body.reward||0),image_url=String(body.imageUrl||'/assets/logo.webp').trim()||'/assets/logo.webp';if(!code||!name||!Number.isInteger(reward)||reward<0)return fail('게임 정보를 다시 확인해 주세요.');const rows=await sb('games?on_conflict=code',{method:'POST',body:{code,name,reward,image_url,active:true},prefer:'resolution=merge-duplicates,return=representation'});return ok({game:one(rows)},201);}
    match=path.match(/^\/admin\/games\/([^/]+)\/qr$/);
    if(match&&method==='POST'){verify(bearer(event),'admin');const code=decodeURIComponent(match[1]),game=one(await sb(`games?code=eq.${enc(code)}&select=code,name,reward&limit=1`));if(!game)return fail('게임을 찾을 수 없습니다.',404);return ok({game,token:sign({role:'qr',purpose:'game',gameCode:game.code,jti:randomUUID()},86400)});}
    match=path.match(/^\/admin\/games\/([^/]+)$/);
    if(match&&method==='DELETE'){verify(bearer(event),'admin');const code=decodeURIComponent(match[1]);await sb(`game_completions?game_code=eq.${enc(code)}`,{method:'DELETE',prefer:'return=minimal'});await sb(`games?code=eq.${enc(code)}`,{method:'DELETE',prefer:'return=minimal'});return ok({ok:true});}
    if(path==='/admin/payment-qr'&&method==='POST'){verify(bearer(event),'admin');const amount=Number(body.amount),description=String(body.description||'현장 결제').trim().slice(0,120);if(!Number.isInteger(amount)||amount<1||amount>1000000)return fail('결제 금액이 올바르지 않습니다.');return ok({amount,description,token:sign({role:'qr',purpose:'payment',amount,description,jti:randomUUID()},86400)});}
    if(path==='/admin/password'&&method==='POST'){verify(bearer(event),'admin');const password=String(body.password||'');if(password.length<8)return fail('관리자 비밀번호는 8자 이상이어야 합니다.');await ensureAdmin();await sb('rpc/set_admin_password',{method:'POST',body:{p_password:password}});return ok({ok:true});}

    return fail('요청한 API를 찾을 수 없습니다.',404,'NOT_FOUND');
  } catch(error) {
    console.error('ZIP_MARKET_API_ERROR',error?.message,error?.db||''); let status=Number(error.status)||500; const known=[['INSUFFICIENT_CREDIT','크레딧이 부족합니다.'],['PARTICIPANT_NOT_FOUND','참가자를 찾을 수 없습니다.'],['GAME_NOT_FOUND','게임을 찾을 수 없습니다.'],['duplicate key','이미 등록된 사번 또는 코드입니다.']]; const friendly=known.find(([key])=>String(error.message).includes(key)); if(friendly&&status>=500)status=400; const message=friendly?.[1]||(status>=500?'서버 처리 중 오류가 발생했습니다. Netlify 환경변수와 Supabase schema.sql 적용 여부를 확인해 주세요.':error.message);
    return fail(message,status,status>=500?'SERVER_ERROR':'REQUEST_FAILED');
  }
};
