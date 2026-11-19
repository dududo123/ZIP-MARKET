import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

class AppError extends Error {
  constructor(status, code, message = code, detail = '') { super(message); this.status = status; this.code = code; this.detail = detail; }
}
const json = (statusCode, body) => ({ statusCode, headers: { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store', 'x-zip-market-version':'7.0.0' }, body:JSON.stringify(body) });
const requiredEnv = () => {
  const values = { url:(process.env.SUPABASE_URL || '').replace(/\/$/,''), key:process.env.SUPABASE_SERVICE_ROLE_KEY || '', jwt:process.env.JWT_SECRET || '', admin:process.env.INITIAL_ADMIN_PASSWORD || '' };
  const missing = Object.entries(values).filter(([,value])=>!value).map(([key])=>key);
  if (missing.length) throw new AppError(500,'ENV_MISSING','필수 Netlify 환경변수가 없습니다.',missing.join(','));
  return values;
};
const safeDetail = value => String(value || '').replace(/sb_(secret|publishable)_[A-Za-z0-9_-]+/g,'sb_$1_***').slice(0,500);

async function db(endpoint, options = {}) {
  const { url, key } = requiredEnv();
  const headers = { apikey:key, 'content-type':'application/json', accept:'application/json' };
  // sb_secret은 JWT가 아니므로 apikey에만, legacy service_role JWT만 Bearer에 전달합니다.
  if (key.startsWith('eyJ')) headers.authorization = `Bearer ${key}`;
  if (options.prefer) headers.prefer = options.prefer;
  const response = await fetch(`${url}/rest/v1/${endpoint}`, { method:options.method || 'GET', headers, body:options.body === undefined ? undefined : JSON.stringify(options.body), signal:AbortSignal.timeout(12000) });
  const text = await response.text(); let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  if (!response.ok) {
    const message = payload?.message || payload?.error_description || payload?.hint || text || `HTTP_${response.status}`;
    throw new AppError(502,'DATABASE_ERROR','Supabase 데이터 처리에 실패했습니다.',safeDetail(message));
  }
  return payload;
}
const filter = value => encodeURIComponent(String(value));
const bodyOf = event => { if(!event.body)return {}; try{return JSON.parse(event.body);}catch{throw new AppError(400,'INVALID_JSON','요청 형식이 올바르지 않습니다.');} };
const bearer = event => (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer\s+/i,'').trim();
const b64url = value => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
const parseDuration = duration => { const match=String(duration).match(/^(\d+)([mhd])$/); if(!match)return Number(duration)||3600; return Number(match[1])*({m:60,h:3600,d:86400}[match[2]]); };
function signToken(payload, expires = '12h') {
  const now=Math.floor(Date.now()/1000); const header=b64url({alg:'HS256',typ:'JWT'}); const body=b64url({...payload,iat:now,exp:now+parseDuration(expires)}); const input=`${header}.${body}`;
  const signature=createHmac('sha256',requiredEnv().jwt).update(input).digest('base64url'); return `${input}.${signature}`;
}
function verifyToken(token) {
  try {
    const [header,body,signature,...extra]=String(token).split('.'); if(!header||!body||!signature||extra.length)throw new Error('format');
    const expected=createHmac('sha256',requiredEnv().jwt).update(`${header}.${body}`).digest(); const actual=Buffer.from(signature,'base64url');
    if(actual.length!==expected.length||!timingSafeEqual(actual,expected))throw new Error('signature');
    const payload=JSON.parse(Buffer.from(body,'base64url').toString('utf8')); if(!payload.exp||payload.exp<Math.floor(Date.now()/1000))throw new Error('expired'); return payload;
  } catch { throw new AppError(401,'TOKEN_EXPIRED','로그인이 만료되었습니다. 다시 로그인해 주세요.'); }
}
function requireAuth(event, role) { const payload=verifyToken(bearer(event)); if(payload.role!==role||!payload.sub)throw new AppError(401,'AUTH_REQUIRED','로그인이 필요합니다.'); return payload; }

async function userSnapshot(participantId) {
  const [participants,transactions,games,completions]=await Promise.all([
    db(`participants?id=eq.${filter(participantId)}&select=id,employee_id,name,credits,created_at&limit=1`),
    db(`transactions?participant_id=eq.${filter(participantId)}&select=id,type,amount,balance_after,description,created_at&order=created_at.desc&limit=200`),
    db('games?select=id,name,image_url,reward,created_at&order=created_at.asc&limit=200'),
    db(`game_completions?participant_id=eq.${filter(participantId)}&select=game_id,created_at&limit=500`)
  ]);
  if(!participants?.[0])throw new AppError(404,'PARTICIPANT_NOT_FOUND','참가자를 찾을 수 없습니다.');
  return { participant:participants[0], transactions:transactions||[], games:games||[], completedGameIds:(completions||[]).map(row=>row.game_id) };
}
async function adminSnapshot(){const [participants,games]=await Promise.all([db('participants?select=id,employee_id,name,credits,created_at&order=created_at.desc&limit=2000'),db('games?select=id,name,image_url,reward,created_at&order=created_at.asc&limit=500')]);return{participants:participants||[],games:games||[]};}
async function rpc(name,body){
  try{return await db(`rpc/${name}`,{method:'POST',body});}
  catch(error){const detail=`${error.detail||''} ${error.message||''}`;for(const code of ['INSUFFICIENT_CREDIT','DUPLICATE_PAYMENT','ALREADY_COMPLETED','PARTICIPANT_NOT_FOUND','GAME_NOT_FOUND','INVALID_AMOUNT','DUPLICATE_EMPLOYEE_ID']){if(detail.includes(code)){const messages={INSUFFICIENT_CREDIT:'크레딧이 부족합니다.',DUPLICATE_PAYMENT:'이미 처리된 결제 QR입니다.',ALREADY_COMPLETED:'이미 완료한 게임입니다.',PARTICIPANT_NOT_FOUND:'참가자를 찾을 수 없습니다.',GAME_NOT_FOUND:'게임을 찾을 수 없습니다.',INVALID_AMOUNT:'금액이 올바르지 않습니다.',DUPLICATE_EMPLOYEE_ID:'이미 등록된 사번이 포함되어 있습니다.'};throw new AppError(code==='INSUFFICIENT_CREDIT'?400:409,code,messages[code]);}}throw error;}
}
function signQr(payload,expires){return signToken({...payload,issuer:'zip-market',tokenType:'ZIPQR'},expires);}
function verifyQr(token){const payload=verifyToken(token);if(payload.issuer!=='zip-market'||payload.tokenType!=='ZIPQR')throw new AppError(400,'INVALID_QR','유효하지 않거나 만료된 ZIP! QR입니다.');return payload;}
function normalizedPath(event){let path=event.path||'/';path=path.replace(/^\/\.netlify\/functions\/api/,'').replace(/^\/api/,'');if(!path.startsWith('/'))path=`/${path}`;return path.replace(/\/+$/,'')||'/';}
const positiveInt=(value,name='값')=>{const parsed=Number(value);if(!Number.isSafeInteger(parsed)||parsed<=0)throw new AppError(400,'INVALID_AMOUNT',`${name}이 올바르지 않습니다.`);return parsed;};
const nonNegativeInt=value=>{const parsed=Number(value);if(!Number.isSafeInteger(parsed)||parsed<0)throw new AppError(400,'INVALID_AMOUNT','크레딧이 올바르지 않습니다.');return parsed;};

async function route(event){
  const method=event.httpMethod||'GET'; const path=normalizedPath(event);
  if(method==='GET'&&(path==='/'||path==='/health')){
    try{const env=requiredEnv();const init=await rpc('zip_initialize_admin',{p_initial_password:env.admin});await Promise.all([db('participants?select=id&limit=1'),db('games?select=id&limit=1')]);return json(200,{ok:true,database:true,adminInitialized:Boolean(init),transport:'direct-rest',keyType:env.key.startsWith('sb_secret_')?'secret':'legacy-service-role',version:'7.0.0'});}catch(error){return json(error.status||500,{ok:false,database:false,code:error.code||'HEALTH_FAILED',message:error.message,detail:safeDetail(error.detail)});}
  }
  if(method==='POST'&&path==='/login'){
    const {employeeId='',password=''}=bodyOf(event);if(!employeeId.trim()||!password)throw new AppError(400,'LOGIN_INPUT_REQUIRED','사번과 비밀번호를 입력해 주세요.');
    const rows=await rpc('zip_auth_participant',{p_employee_id:employeeId.trim(),p_password:password});const participant=Array.isArray(rows)?rows[0]:rows;
    if(!participant?.id)throw new AppError(401,'LOGIN_FAILED','사번 또는 비밀번호가 올바르지 않습니다.');
    return json(200,{ok:true,token:signToken({role:'user',sub:participant.id},'12h'),...(await userSnapshot(participant.id))});
  }
  if(method==='POST'&&path==='/admin/login'){
    const {password=''}=bodyOf(event);if(!password)throw new AppError(400,'LOGIN_INPUT_REQUIRED','관리자 비밀번호를 입력해 주세요.');
    const valid=await rpc('zip_auth_admin',{p_password:password,p_initial_password:requiredEnv().admin});if(valid!==true)throw new AppError(401,'LOGIN_FAILED','관리자 비밀번호가 올바르지 않습니다.');
    return json(200,{ok:true,token:signToken({role:'admin',sub:'admin'},'12h'),...(await adminSnapshot())});
  }
  if(method==='GET'&&path==='/session'){const auth=requireAuth(event,'user');return json(200,{ok:true,...(await userSnapshot(auth.sub))});}
  if(method==='POST'&&path==='/pay'){const auth=requireAuth(event,'user');const amount=positiveInt(bodyOf(event).amount,'결제 금액');await rpc('zip_process_payment',{p_participant_id:auth.sub,p_amount:amount,p_reference:`direct:${randomUUID()}`,p_description:`${amount} C 결제`});return json(200,{ok:true,...(await userSnapshot(auth.sub))});}
  if(method==='POST'&&path==='/redeem'){
    const auth=requireAuth(event,'user');const payload=verifyQr(bodyOf(event).qrPayload||'');
    if(payload.kind==='payment'){const amount=positiveInt(payload.amount,'결제 금액');await rpc('zip_process_payment',{p_participant_id:auth.sub,p_amount:amount,p_reference:`payment:${payload.qid}`,p_description:`${amount} C QR 결제`});}
    else if(payload.kind==='game')await rpc('zip_complete_game',{p_participant_id:auth.sub,p_game_id:payload.gameId});else throw new AppError(400,'INVALID_QR','ZIP! MARKET 결제 또는 게임 QR이 아닙니다.');
    return json(200,{ok:true,...(await userSnapshot(auth.sub))});
  }
  if(path.startsWith('/admin/'))requireAuth(event,'admin');
  if(method==='GET'&&path==='/admin/snapshot')return json(200,{ok:true,...(await adminSnapshot())});
  if(method==='POST'&&path==='/admin/participants'){
    const input=bodyOf(event);const list=Array.isArray(input.participants)?input.participants:[input];if(!list.length||list.length>500)throw new AppError(400,'INVALID_PARTICIPANTS','참가자 목록이 올바르지 않습니다.');
    const clean=list.map(item=>{const employeeId=String(item.employeeId||'').trim(),name=String(item.name||'').trim(),password=String(item.password||'');if(!employeeId||!name||!password)throw new AppError(400,'PARTICIPANT_INPUT_REQUIRED','사번, 이름, 비밀번호를 모두 입력해 주세요.');return{employeeId,name,password,credits:nonNegativeInt(item.credits||0)};});
    await rpc('zip_create_participants',{p_participants:clean});return json(201,{ok:true,...(await adminSnapshot())});
  }
  let match=path.match(/^\/admin\/participants\/([0-9a-f-]+)$/i);
  if(method==='DELETE'&&match){await db(`participants?id=eq.${filter(match[1])}`,{method:'DELETE',prefer:'return=minimal'});return json(200,{ok:true});}
  match=path.match(/^\/admin\/participants\/([0-9a-f-]+)\/credit$/i);
  if(method==='POST'&&match){const amount=Number(bodyOf(event).amount);if(!Number.isSafeInteger(amount)||amount===0)throw new AppError(400,'INVALID_AMOUNT','조정 금액이 올바르지 않습니다.');await rpc('zip_adjust_credit',{p_participant_id:match[1],p_amount:amount,p_description:'관리자 크레딧 조정',p_reference:`admin:${randomUUID()}`});return json(200,{ok:true,...(await adminSnapshot())});}
  if(method==='POST'&&path==='/admin/games'){const input=bodyOf(event),name=String(input.name||'').trim();if(!name)throw new AppError(400,'GAME_NAME_REQUIRED','게임 이름을 입력해 주세요.');await db('games',{method:'POST',body:{name,image_url:String(input.imageUrl||'').trim()||'/assets/game-default.webp?v=7',reward:nonNegativeInt(input.reward??100)},prefer:'return=representation'});return json(201,{ok:true,...(await adminSnapshot())});}
  match=path.match(/^\/admin\/games\/([0-9a-f-]+)$/i);
  if(method==='DELETE'&&match){await db(`game_completions?game_id=eq.${filter(match[1])}`,{method:'DELETE',prefer:'return=minimal'});await db(`games?id=eq.${filter(match[1])}`,{method:'DELETE',prefer:'return=minimal'});return json(200,{ok:true});}
  if(method==='POST'&&path==='/admin/payment-qr'){const amount=positiveInt(bodyOf(event).amount,'결제 금액');return json(200,{ok:true,qrPayload:signQr({kind:'payment',qid:randomUUID(),amount},'8h'),caption:`${amount.toLocaleString('ko-KR')} C 결제`});}
  match=path.match(/^\/admin\/games\/([0-9a-f-]+)\/qr$/i);
  if(method==='POST'&&match){const rows=await db(`games?id=eq.${filter(match[1])}&select=id,name&limit=1`);if(!rows?.[0])throw new AppError(404,'GAME_NOT_FOUND','게임을 찾을 수 없습니다.');return json(200,{ok:true,qrPayload:signQr({kind:'game',gameId:match[1]},'365d'),caption:`${rows[0].name} 완료 QR`});}
  if(method==='POST'&&path==='/admin/password'){const password=String(bodyOf(event).password||'');if(password.length<4)throw new AppError(400,'PASSWORD_TOO_SHORT','비밀번호는 4자 이상이어야 합니다.');await rpc('zip_set_admin_password',{p_password:password});return json(200,{ok:true});}
  throw new AppError(404,'NOT_FOUND','요청한 API를 찾을 수 없습니다.');
}

export const handler=async event=>{if(event.httpMethod==='OPTIONS')return{statusCode:204,headers:{allow:'GET,POST,DELETE,OPTIONS'},body:''};try{return await route(event);}catch(error){console.error('[ZIP API]',error.code||error.name,safeDetail(error.detail||error.message));const known=error instanceof AppError;return json(known?error.status:500,{ok:false,code:known?error.code:'SERVER_ERROR',message:known?error.message:'서버 처리 중 오류가 발생했습니다.',detail:known?safeDetail(error.detail):''});}};
