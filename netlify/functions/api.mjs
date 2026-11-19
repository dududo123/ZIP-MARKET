import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';

let supabaseClient;
const jsonHeaders={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const response=(status,body)=>({statusCode:status,headers:jsonHeaders,body:JSON.stringify(body)});
const fail=(status,error)=>response(status,{error});

function env(){
 const config={url:process.env.SUPABASE_URL,key:process.env.SUPABASE_SERVICE_ROLE_KEY,jwtSecret:process.env.JWT_SECRET,initialAdminPassword:process.env.INITIAL_ADMIN_PASSWORD};
 if(!config.url)throw new Error('SUPABASE_URL 환경변수가 없습니다.');
 if(!config.key)throw new Error('SUPABASE_SERVICE_ROLE_KEY 환경변수가 없습니다.');
 if(!config.jwtSecret)throw new Error('JWT_SECRET 환경변수가 없습니다.');
 return config;
}
function db(){const c=env();if(!supabaseClient)supabaseClient=createClient(c.url,c.key,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{'x-application-name':'zip-market-5'}}});return supabaseClient;}
function parseBody(event){if(!event.body)return {};try{return JSON.parse(event.isBase64Encoded?Buffer.from(event.body,'base64').toString('utf8'):event.body);}catch{throw Object.assign(new Error('요청 형식이 올바르지 않습니다.'),{status:400});}}
function routeOf(event){let p=event.path||event.rawPath||'/';p=p.replace(/^\/\.netlify\/functions\/api/,'').replace(/^\/api/,'');return p||'/';}
function bearer(event){const h=event.headers?.authorization||event.headers?.Authorization||'';return h.startsWith('Bearer ')?h.slice(7):'';}
function auth(event,role){try{const payload=jwt.verify(bearer(event),env().jwtSecret,{algorithms:['HS256']});if(payload.role!==role)throw new Error();return payload;}catch{throw Object.assign(new Error('로그인이 만료되었습니다. 다시 로그인해 주세요.'),{status:401});}}
function signSession(payload,expiresIn){return jwt.sign(payload,env().jwtSecret,{algorithm:'HS256',expiresIn,issuer:'zip-market'});}
function cleanText(v,max=120){return String(v??'').trim().slice(0,max);}
function validUuid(v){return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v));}
function throwDb(error,label='데이터베이스 오류'){if(error)throw new Error(`${label}: ${error.message}`);}
function participantDto(p){return {id:p.id,employeeNo:p.employee_no,name:p.name,creditBalance:Number(p.credit_balance||0),createdAt:p.created_at};}
function transactionDto(t){return {id:t.id,amount:Number(t.amount||0),type:t.type,description:t.description,createdAt:t.created_at};}
function gameDto(g){return {id:g.id,name:g.name,imageUrl:g.image_url||'/assets/game-default.webp',createdAt:g.created_at};}

async function readAdminSetting(){const {data,error}=await db().from('app_settings').select('value').eq('key','admin_password').maybeSingle();throwDb(error,'관리자 설정 조회 실패');return data?.value||null;}
async function writeAdminSetting(hash){const {error}=await db().from('app_settings').upsert({key:'admin_password',value:hash,updated_at:new Date().toISOString()},{onConflict:'key'});throwDb(error,'관리자 설정 저장 실패');}
async function ensureAdminPassword(){let saved=await readAdminSetting();if(saved)return {hash:saved,created:false};const initial=env().initialAdminPassword;if(!initial)throw new Error('INITIAL_ADMIN_PASSWORD 환경변수가 없습니다.');saved=await bcrypt.hash(initial,10);await writeAdminSetting(saved);return {hash:saved,created:true};}
async function verifyPassword(input,stored){if(!stored)return false;if(/^\$2[aby]\$/.test(stored))return bcrypt.compare(input,stored);const a=Buffer.from(String(input)),b=Buffer.from(String(stored));return a.length===b.length&&crypto.timingSafeEqual(a,b);
}
async function adminBootstrap(){
 const [peopleRes,gamesRes]=await Promise.all([
  db().from('participants').select('id,employee_no,name,credit_balance,created_at').order('created_at',{ascending:false}).limit(1000),
  db().from('games').select('id,name,image_url,created_at').order('created_at',{ascending:true}).limit(1000)
 ]);throwDb(peopleRes.error,'참가자 목록 조회 실패');throwDb(gamesRes.error,'게임 목록 조회 실패');
 return {participants:(peopleRes.data||[]).map(participantDto),games:(gamesRes.data||[]).map(gameDto)};
}
async function userDashboard(participant){
 const [transactionsRes,gamesRes,completedRes]=await Promise.all([
  db().from('transactions').select('id,amount,type,description,created_at').eq('participant_id',participant.id).order('created_at',{ascending:false}).limit(1000),
  db().from('games').select('id,name,image_url,created_at').order('created_at',{ascending:true}).limit(1000),
  db().from('game_completions').select('game_id').eq('participant_id',participant.id).limit(1000)
 ]);throwDb(transactionsRes.error,'사용내역 조회 실패');throwDb(gamesRes.error,'게임 조회 실패');throwDb(completedRes.error,'게임 완료 조회 실패');
 return {user:participantDto(participant),transactions:(transactionsRes.data||[]).map(transactionDto),games:(gamesRes.data||[]).map(gameDto),completedGameIds:(completedRes.data||[]).map(x=>x.game_id)};
}
async function currentParticipant(id){const {data,error}=await db().from('participants').select('*').eq('id',id).maybeSingle();throwDb(error,'사용자 조회 실패');if(!data)throw Object.assign(new Error('사용자를 찾을 수 없습니다.'),{status:404});return data;}

async function health(){const flags={supabaseUrl:Boolean(process.env.SUPABASE_URL),supabaseKey:Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),jwtSecret:Boolean(process.env.JWT_SECRET),initialAdminPassword:Boolean(process.env.INITIAL_ADMIN_PASSWORD)};try{const result=await ensureAdminPassword();return response(200,{ok:true,environment:flags,database:true,adminInitialized:true,adminCreatedNow:result.created,version:'5.0.0'});}catch(e){return response(500,{ok:false,environment:flags,database:false,adminInitialized:false,error:e.message});}}
async function userLogin(body){const employeeNo=cleanText(body.employeeNo,40),password=String(body.password||'');if(!employeeNo||!password)return fail(400,'사번과 비밀번호를 입력해 주세요.');const {data,error}=await db().from('participants').select('*').eq('employee_no',employeeNo).maybeSingle();throwDb(error,'사용자 로그인 조회 실패');if(!data||!(await verifyPassword(password,data.password_hash||data.password)))return fail(401,'사번 또는 비밀번호가 올바르지 않습니다.');const token=signSession({role:'user',sub:data.id},'24h');return response(200,{token,...await userDashboard(data)});}
async function adminLogin(body){const password=String(body.password||'');if(!password)return fail(400,'관리자 비밀번호를 입력해 주세요.');const setting=await ensureAdminPassword();let ok=await verifyPassword(password,setting.hash);const initial=env().initialAdminPassword;
 // 기존 DB 비밀번호와 현재 Netlify 초기 비밀번호가 어긋난 경우 자동 동기화합니다.
 if(!ok&&initial&&password===initial){await writeAdminSetting(await bcrypt.hash(initial,10));ok=true;}
 if(!ok)return fail(401,'LOGIN_FAILED');const token=signSession({role:'admin',sub:'admin'},'12h');return response(200,{token,...await adminBootstrap()});}

async function createParticipant(body){const employeeNo=cleanText(body.employeeNo,40),name=cleanText(body.name,80),password=String(body.password||'');if(!employeeNo||!name||!password)return fail(400,'사번, 이름, 초기 비밀번호를 모두 입력해 주세요.');const password_hash=await bcrypt.hash(password,10);const {data,error}=await db().from('participants').insert({employee_no:employeeNo,name,password_hash,credit_balance:0}).select('*').single();if(error?.code==='23505')return fail(409,'이미 등록된 사번입니다.');throwDb(error,'참가자 등록 실패');return response(201,{participant:participantDto(data)});}
async function bulkParticipants(body){const rows=Array.isArray(body.participants)?body.participants.slice(0,500):[];if(!rows.length)return fail(400,'등록할 참가자가 없습니다.');let created=0,skipped=0;for(const p of rows){const employeeNo=cleanText(p.employeeNo,40),name=cleanText(p.name,80),password=String(p.password||'');if(!employeeNo||!name||!password){skipped++;continue;}const password_hash=await bcrypt.hash(password,8);const {error}=await db().from('participants').insert({employee_no:employeeNo,name,password_hash,credit_balance:0});if(error){if(error.code==='23505'){skipped++;continue;}throwDb(error,'참가자 일괄 등록 실패');}created++;}return response(201,{created,skipped});}
async function grantCredit(id,body){if(!validUuid(id))return fail(400,'잘못된 참가자 ID입니다.');const amount=Math.trunc(Number(body.amount));if(!Number.isInteger(amount)||amount<=0||amount>1000000)return fail(400,'지급 금액이 올바르지 않습니다.');const p=await currentParticipant(id);const next=Number(p.credit_balance||0)+amount;const {error}=await db().from('participants').update({credit_balance:next,updated_at:new Date().toISOString()}).eq('id',id);throwDb(error,'크레딧 지급 실패');const tx=await db().from('transactions').insert({participant_id:id,amount,type:'grant',description:'관리자 크레딧 지급'});throwDb(tx.error,'크레딧 내역 저장 실패');return response(200,{creditBalance:next});}
async function deleteParticipant(id){if(!validUuid(id))return fail(400,'잘못된 참가자 ID입니다.');for(const table of ['game_completions','transactions']){const {error}=await db().from(table).delete().eq('participant_id',id);throwDb(error,`${table} 삭제 실패`);}const {error}=await db().from('participants').delete().eq('id',id);throwDb(error,'참가자 삭제 실패');return response(200,{ok:true});}
async function createGame(body){const name=cleanText(body.name,80),imageUrl=cleanText(body.imageUrl,500)||'/assets/game-default.webp';if(!name)return fail(400,'게임 이름을 입력해 주세요.');if(!imageUrl.startsWith('/')&&!/^https:\/\//i.test(imageUrl))return fail(400,'이미지 주소는 HTTPS 또는 /assets 경로여야 합니다.');const {data,error}=await db().from('games').insert({name,image_url:imageUrl}).select('*').single();throwDb(error,'게임 추가 실패');return response(201,{game:gameDto(data)});}
async function deleteGame(id){if(!validUuid(id))return fail(400,'잘못된 게임 ID입니다.');const c=await db().from('game_completions').delete().eq('game_id',id);throwDb(c.error,'게임 완료기록 삭제 실패');const g=await db().from('games').delete().eq('id',id);throwDb(g.error,'게임 삭제 실패');return response(200,{ok:true});}
function makeQrToken(payload){return signSession({...payload,qr:true,jti:crypto.randomUUID()},'12h');}
async function paymentQr(body){const amount=Math.trunc(Number(body.amount)),description=cleanText(body.description,120)||'ZIP! MARKET 결제';if(!Number.isInteger(amount)||amount<=0||amount>1000000)return fail(400,'결제 금액이 올바르지 않습니다.');return response(200,{qrToken:makeQrToken({kind:'credit',amount,description})});}
async function gameQr(id){if(!validUuid(id))return fail(400,'잘못된 게임 ID입니다.');const {data,error}=await db().from('games').select('id,name').eq('id',id).maybeSingle();throwDb(error,'게임 조회 실패');if(!data)return fail(404,'게임을 찾을 수 없습니다.');return response(200,{qrToken:makeQrToken({kind:'game',gameId:data.id,gameName:data.name})});}
function extractQrToken(raw){const text=String(raw||'').trim();if(!text)return '';try{const j=JSON.parse(text);if(j.token)return j.token;}catch{}try{const u=new URL(text);return u.searchParams.get('token')||text;}catch{}return text;}
async function redeem(userId,body){const raw=extractQrToken(body.token);let qr;try{qr=jwt.verify(raw,env().jwtSecret,{algorithms:['HS256'],issuer:'zip-market'});}catch{return fail(400,'유효하지 않거나 만료된 QR 코드입니다.');}if(!qr.qr)return fail(400,'ZIP! MARKET QR 코드가 아닙니다.');const p=await currentParticipant(userId);
 if(qr.kind==='credit'){
  const exists=await db().from('transactions').select('id').eq('participant_id',userId).eq('reference',qr.jti).maybeSingle();throwDb(exists.error,'중복 결제 확인 실패');if(exists.data)return fail(409,'이미 사용한 결제 QR입니다.');
  const rpc=await db().rpc('zip_market_redeem_credit',{p_participant_id:userId,p_amount:Number(qr.amount),p_description:qr.description,p_reference:qr.jti});
  if(rpc.error){
   if(/INSUFFICIENT_CREDIT/i.test(rpc.error.message))return fail(409,'크레딧이 부족합니다.');
   // 구버전 DB에서 RPC를 아직 설치하지 않은 경우에도 동작하도록 안전한 대체 경로를 둡니다.
   if(!/function .* does not exist|schema cache/i.test(rpc.error.message))throwDb(rpc.error,'결제 실패');
   if(Number(p.credit_balance||0)<Number(qr.amount))return fail(409,'크레딧이 부족합니다.');const next=Number(p.credit_balance)-Number(qr.amount);const u=await db().from('participants').update({credit_balance:next,updated_at:new Date().toISOString()}).eq('id',userId).eq('credit_balance',p.credit_balance).select('credit_balance').maybeSingle();throwDb(u.error,'결제 잔액 변경 실패');if(!u.data)return fail(409,'다른 결제가 먼저 처리되었습니다. 잔액을 확인한 뒤 다시 시도해 주세요.');const t=await db().from('transactions').insert({participant_id:userId,amount:-Number(qr.amount),type:'payment',description:qr.description,reference:qr.jti});throwDb(t.error,'결제 내역 저장 실패');
  }
  return response(200,{message:`${Number(qr.amount).toLocaleString()} C 결제가 완료되었습니다.`,...await userDashboard(await currentParticipant(userId))});
 }
 if(qr.kind==='game'){
  const {data:game,error}=await db().from('games').select('id,name').eq('id',qr.gameId).maybeSingle();throwDb(error,'게임 조회 실패');if(!game)return fail(404,'삭제되었거나 존재하지 않는 게임입니다.');const {error:insertError}=await db().from('game_completions').upsert({participant_id:userId,game_id:game.id},{onConflict:'participant_id,game_id',ignoreDuplicates:true});throwDb(insertError,'게임 완료 저장 실패');return response(200,{message:`${game.name} 완료 처리되었습니다.`,...await userDashboard(await currentParticipant(userId))});
 }
 return fail(400,'지원하지 않는 QR 코드입니다.');
}
async function updateAdminPassword(body){const password=String(body.password||'');if(password.length<8)return fail(400,'관리자 비밀번호는 8자 이상이어야 합니다.');await writeAdminSetting(await bcrypt.hash(password,10));return response(200,{ok:true});}

export async function handler(event){
 if(event.httpMethod==='OPTIONS')return response(204,{});
 const path=routeOf(event),method=event.httpMethod||'GET';
 try{
  if(method==='GET'&&path==='/health')return await health();
  const body=['POST','PUT','PATCH'].includes(method)?parseBody(event):{};
  if(method==='POST'&&path==='/user/login')return await userLogin(body);
  if(method==='POST'&&path==='/admin/login')return await adminLogin(body);
  if(method==='POST'&&path==='/user/redeem'){const u=auth(event,'user');return await redeem(u.sub,body);}
  if(path.startsWith('/admin/'))auth(event,'admin');
  if(method==='GET'&&path==='/admin/bootstrap')return response(200,await adminBootstrap());
  if(method==='POST'&&path==='/admin/participants')return await createParticipant(body);
  if(method==='POST'&&path==='/admin/participants/bulk')return await bulkParticipants(body);
  let m=path.match(/^\/admin\/participants\/([^/]+)\/credit$/);if(method==='POST'&&m)return await grantCredit(m[1],body);
  m=path.match(/^\/admin\/participants\/([^/]+)$/);if(method==='DELETE'&&m)return await deleteParticipant(m[1]);
  if(method==='POST'&&path==='/admin/payment-qr')return await paymentQr(body);
  if(method==='POST'&&path==='/admin/games')return await createGame(body);
  m=path.match(/^\/admin\/games\/([^/]+)\/qr$/);if(method==='POST'&&m)return await gameQr(m[1]);
  m=path.match(/^\/admin\/games\/([^/]+)$/);if(method==='DELETE'&&m)return await deleteGame(m[1]);
  if(method==='PUT'&&path==='/admin/password')return await updateAdminPassword(body);
  return fail(404,'API 경로를 찾을 수 없습니다.');
 }catch(e){console.error('[ZIP MARKET API]',method,path,e);return fail(e.status||500,e.status?e.message:'서버 처리 중 오류가 발생했습니다. '+e.message);}
}
