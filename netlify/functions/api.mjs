import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import QRCode from 'qrcode';

const db=()=>createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const secret=()=>new TextEncoder().encode(process.env.JWT_SECRET);
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const path=req=>new URL(req.url).pathname.replace(/^\/api\/?/,'');
async function token(req){const h=req.headers.get('authorization')||'';if(!h.startsWith('Bearer '))throw new Error('UNAUTHORIZED');return (await jwtVerify(h.slice(7),secret())).payload}
async function issue(payload){return new SignJWT(payload).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('12h').sign(secret())}
async function seedAdmin(client){const {data}=await client.from('app_settings').select('value').eq('key','admin_password').maybeSingle();if(!data){const hash=await bcrypt.hash(process.env.INITIAL_ADMIN_PASSWORD||'admin',10);await client.from('app_settings').insert({key:'admin_password',value:hash})}}
function requireAdmin(p){if(p.role!=='admin')throw new Error('FORBIDDEN')}

export default async(req)=>{try{const client=db(), route=path(req), method=req.method;await seedAdmin(client);
 if(route==='health')return json({ok:true});
 if(route==='login'&&method==='POST'){const b=await req.json();const {data:u}=await client.from('participants').select('*').eq('employee_no',String(b.employeeNo||'')).maybeSingle();if(!u||!await bcrypt.compare(String(b.password||''),u.password_hash))return json({error:'LOGIN_FAILED'},401);return json({token:await issue({sub:u.id,role:'user'}),user:{name:u.name,employeeNo:u.employee_no,balance:u.balance,spent:u.spent}})}
 if(route==='admin/login'&&method==='POST'){const b=await req.json();const {data}=await client.from('app_settings').select('value').eq('key','admin_password').single();if(!data||!await bcrypt.compare(String(b.password||''),data.value))return json({error:'LOGIN_FAILED'},401);return json({token:await issue({sub:'admin',role:'admin'})})}
 const who=await token(req);
 if(route==='me'&&method==='GET'){const {data:u}=await client.from('participants').select('id,employee_no,name,balance,spent').eq('id',who.sub).single();const {data:tx}=await client.from('transactions').select('amount,kind,label,created_at').eq('participant_id',who.sub).order('created_at',{ascending:false}).limit(100);const {data:done}=await client.from('game_completions').select('game_id').eq('participant_id',who.sub);return json({user:u,transactions:tx||[],completed:(done||[]).map(x=>x.game_id)})}
 if(route==='games'&&method==='GET'){const {data}=await client.from('games').select('*').eq('active',true).order('created_at');return json({games:data||[]})}
 if(route==='payment'&&method==='POST'){const b=await req.json();const amount=Math.floor(Number(b.amount));const {data,error}=await client.rpc('pay_credit',{p_user:who.sub,p_amount:amount,p_label:`${amount} C 결제`});if(error)throw error;return json(data[0])}
 if(route==='game/complete'&&method==='POST'){const b=await req.json();const {data,error}=await client.rpc('complete_game',{p_user:who.sub,p_game:String(b.gameId)});if(error)throw error;return json(data[0])}
 requireAdmin(who);
 if(route==='admin/users'&&method==='GET'){const q=new URL(req.url).searchParams.get('q')||'';let query=client.from('participants').select('id,employee_no,name,balance,spent').order('created_at');if(q)query=query.or(`employee_no.ilike.%${q}%,name.ilike.%${q}%`);const {data,error}=await query.limit(500);if(error)throw error;return json({users:data||[]})}
 if(route==='admin/users'&&method==='POST'){const b=await req.json(),rows=Array.isArray(b.users)?b.users:[b];const made=[];for(const x of rows){const hash=await bcrypt.hash(String(x.password||'1234'),8);const credit=Math.max(0,Math.floor(Number(x.credit)||0));const {data,error}=await client.from('participants').insert({employee_no:String(x.employeeNo),name:String(x.name),password_hash:hash,balance:credit}).select('id,employee_no,name,balance,spent').single();if(error)throw error;if(credit)await client.from('transactions').insert({participant_id:data.id,amount:credit,kind:'initial',label:'초기 크레딧'});made.push(data)}return json({users:made},201)}
 if(route==='admin/credit'&&method==='POST'){const b=await req.json(),amount=Math.floor(Number(b.amount));const {data:u,error}=await client.from('participants').select('balance').eq('id',b.userId).single();if(error)throw error;await client.from('participants').update({balance:u.balance+amount}).eq('id',b.userId);await client.from('transactions').insert({participant_id:b.userId,amount,kind:'admin',label:'관리자 크레딧 조정'});return json({ok:true})}
 if(route==='admin/games'&&method==='POST'){const b=await req.json();const id=(b.id||b.name).toLowerCase().replace(/[^a-z0-9가-힣]+/g,'-').replace(/^-|-$/g,'').slice(0,32);const {data,error}=await client.from('games').insert({id,name:b.name,reward:Math.floor(Number(b.reward)),image_url:b.imageUrl||null,builtin:false}).select().single();if(error)throw error;return json({game:data},201)}
 if(route.startsWith('admin/games/')&&method==='DELETE'){await client.from('games').delete().eq('id',route.split('/').pop());return json({ok:true})}
 if(route==='admin/password'&&method==='POST'){const b=await req.json();const {data}=await client.from('app_settings').select('value').eq('key','admin_password').single();if(!await bcrypt.compare(String(b.current||''),data.value))return json({error:'CURRENT_PASSWORD_INVALID'},400);if(String(b.next||'').length<4)return json({error:'PASSWORD_TOO_SHORT'},400);await client.from('app_settings').update({value:await bcrypt.hash(String(b.next),10),updated_at:new Date().toISOString()}).eq('key','admin_password');return json({ok:true})}
 if(route==='admin/qr'&&method==='POST'){const b=await req.json();const value=b.type==='game'?`zipmarket:game:${b.gameId}`:`zipmarket:pay:${Math.floor(Number(b.amount))}`;return json({value,dataUrl:await QRCode.toDataURL(value,{width:320,margin:2})})}
 return json({error:'NOT_FOUND'},404);
}catch(e){console.error(e);const m=e.message||'';const status=m==='UNAUTHORIZED'?401:m==='FORBIDDEN'?403:400;return json({error:m||'SERVER_ERROR'},status)}};
