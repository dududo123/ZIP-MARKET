import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import QRCode from 'qrcode';

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const path=req=>new URL(req.url).pathname.replace(/^\/api\/?/,'');
const secret=()=>new TextEncoder().encode(process.env.JWT_SECRET||'');
function envState(){return {supabaseUrl:Boolean(process.env.SUPABASE_URL),supabaseKey:Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),jwtSecret:Boolean(process.env.JWT_SECRET),initialAdminPassword:Boolean(process.env.INITIAL_ADMIN_PASSWORD)}}
function db(){const state=envState();if(!state.supabaseUrl)throw new Error('MISSING_SUPABASE_URL');if(!state.supabaseKey)throw new Error('MISSING_SUPABASE_SERVICE_ROLE_KEY');return createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}})}
async function token(req){const h=req.headers.get('authorization')||'';if(!h.startsWith('Bearer '))throw new Error('UNAUTHORIZED');return (await jwtVerify(h.slice(7),secret())).payload}
async function issue(payload){if(!process.env.JWT_SECRET)throw new Error('MISSING_JWT_SECRET');return new SignJWT(payload).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('12h').sign(secret())}
async function ensureAdmin(client){
  const {data,error}=await client.from('app_settings').select('value').eq('key','admin_password').maybeSingle();
  if(error)throw new Error(`APP_SETTINGS_READ_FAILED:${error.message}`);
  if(data)return {initialized:true,created:false};
  if(!process.env.INITIAL_ADMIN_PASSWORD)throw new Error('MISSING_INITIAL_ADMIN_PASSWORD');
  const hash=await bcrypt.hash(process.env.INITIAL_ADMIN_PASSWORD,10);
  const {error:insertError}=await client.from('app_settings').insert({key:'admin_password',value:hash});
  if(insertError)throw new Error(`APP_SETTINGS_INSERT_FAILED:${insertError.message}`);
  return {initialized:true,created:true};
}
function requireAdmin(p){if(p.role!=='admin')throw new Error('FORBIDDEN')}

export default async(req)=>{try{
 const route=path(req), method=req.method, state=envState();
 // Real diagnostic: verifies env, DB read/write path, and admin initialization.
 if(route==='health'){
   const result={ok:false,environment:state,database:false,adminInitialized:false};
   try{
     const client=db();
     const {error:testError}=await client.from('app_settings').select('key').limit(1);
     if(testError)throw new Error(`DATABASE_READ_FAILED:${testError.message}`);
     result.database=true;
     const admin=await ensureAdmin(client);
     result.adminInitialized=admin.initialized;
     result.adminCreatedNow=admin.created;
     result.ok=true;
     return json(result);
   }catch(e){result.error=e.message;return json(result,500)}
 }
 const client=db(); await ensureAdmin(client);
 if(route==='login'&&method==='POST'){const b=await req.json();const {data:u,error}=await client.from('participants').select('*').eq('employee_no',String(b.employeeNo||'')).maybeSingle();if(error)throw error;if(!u||!await bcrypt.compare(String(b.password||''),u.password_hash))return json({error:'LOGIN_FAILED'},401);return json({token:await issue({sub:u.id,role:'user'}),user:{name:u.name,employeeNo:u.employee_no,balance:u.balance,spent:u.spent}})}
 if(route==='admin/login'&&method==='POST'){const b=await req.json();const {data,error}=await client.from('app_settings').select('value').eq('key','admin_password').single();if(error)throw new Error(`ADMIN_SETTING_READ_FAILED:${error.message}`);if(!await bcrypt.compare(String(b.password||''),data.value))return json({error:'LOGIN_FAILED'},401);return json({token:await issue({sub:'admin',role:'admin'})})}
 const who=await token(req);
 if(route==='me'&&method==='GET'){const {data:u,error}=await client.from('participants').select('id,employee_no,name,balance,spent').eq('id',who.sub).single();if(error)throw error;const {data:tx}=await client.from('transactions').select('amount,kind,label,created_at').eq('participant_id',who.sub).order('created_at',{ascending:false}).limit(100);const {data:done}=await client.from('game_completions').select('game_id').eq('participant_id',who.sub);return json({user:u,transactions:tx||[],completed:(done||[]).map(x=>x.game_id)})}
 if(route==='games'&&method==='GET'){const {data,error}=await client.from('games').select('*').eq('active',true).order('created_at');if(error)throw error;return json({games:data||[]})}
 if(route==='payment'&&method==='POST'){const b=await req.json();const amount=Math.floor(Number(b.amount));const {data,error}=await client.rpc('pay_credit',{p_user:who.sub,p_amount:amount,p_label:`${amount} C 결제`});if(error)throw error;return json(data[0])}
 if(route==='game/complete'&&method==='POST'){const b=await req.json();const {data,error}=await client.rpc('complete_game',{p_user:who.sub,p_game:String(b.gameId)});if(error)throw error;return json(data[0])}
 requireAdmin(who);
 if(route==='admin/users'&&method==='GET'){const q=new URL(req.url).searchParams.get('q')||'';let query=client.from('participants').select('id,employee_no,name,balance,spent').order('created_at');if(q)query=query.or(`employee_no.ilike.%${q}%,name.ilike.%${q}%`);const {data,error}=await query.limit(500);if(error)throw error;return json({users:data||[]})}
 if(route==='admin/users'&&method==='POST'){const b=await req.json(),rows=Array.isArray(b.users)?b.users:[b],made=[];for(const x of rows){const hash=await bcrypt.hash(String(x.password||'1234'),8),credit=Math.max(0,Math.floor(Number(x.credit)||0));const {data,error}=await client.from('participants').insert({employee_no:String(x.employeeNo),name:String(x.name),password_hash:hash,balance:credit}).select('id,employee_no,name,balance,spent').single();if(error)throw error;if(credit)await client.from('transactions').insert({participant_id:data.id,amount:credit,kind:'initial',label:'초기 크레딧'});made.push(data)}return json({users:made},201)}
 if(route==='admin/credit'&&method==='POST'){const b=await req.json(),amount=Math.floor(Number(b.amount));const {data:u,error}=await client.from('participants').select('balance').eq('id',b.userId).single();if(error)throw error;await client.from('participants').update({balance:u.balance+amount}).eq('id',b.userId);await client.from('transactions').insert({participant_id:b.userId,amount,kind:'admin',label:'관리자 크레딧 조정'});return json({ok:true})}
 if(route==='admin/games'&&method==='POST'){const b=await req.json();const id=(b.id||b.name).toLowerCase().replace(/[^a-z0-9가-힣]+/g,'-').replace(/^-|-$/g,'').slice(0,32);const {data,error}=await client.from('games').insert({id,name:b.name,reward:Math.floor(Number(b.reward)),image_url:b.imageUrl||null,builtin:false}).select().single();if(error)throw error;return json({game:data},201)}
 if(route.startsWith('admin/games/')&&method==='DELETE'){const {error}=await client.from('games').delete().eq('id',route.split('/').pop());if(error)throw error;return json({ok:true})}
 if(route==='admin/password'&&method==='POST'){const b=await req.json();const {data,error}=await client.from('app_settings').select('value').eq('key','admin_password').single();if(error)throw error;if(!await bcrypt.compare(String(b.current||''),data.value))return json({error:'CURRENT_PASSWORD_INVALID'},400);if(String(b.next||'').length<4)return json({error:'PASSWORD_TOO_SHORT'},400);const {error:updateError}=await client.from('app_settings').update({value:await bcrypt.hash(String(b.next),10),updated_at:new Date().toISOString()}).eq('key','admin_password');if(updateError)throw updateError;return json({ok:true})}
 if(route==='admin/qr'&&method==='POST'){const b=await req.json();const value=b.type==='game'?`zipmarket:game:${b.gameId}`:`zipmarket:pay:${Math.floor(Number(b.amount))}`;return json({value,dataUrl:await QRCode.toDataURL(value,{width:320,margin:2})})}
 return json({error:'NOT_FOUND'},404);
}catch(e){console.error('ZIP_MARKET_API_ERROR',e);const m=e.message||'SERVER_ERROR';const status=m==='UNAUTHORIZED'?401:m==='FORBIDDEN'?403:500;return json({error:m},status)}};
