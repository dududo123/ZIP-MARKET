import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import QRCode from 'qrcode';
let client;
const db=()=>client??=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const route=req=>new URL(req.url).pathname.replace(/^\/api\/?/,'');
const secret=()=>new TextEncoder().encode(process.env.JWT_SECRET);
async function auth(req){const h=req.headers.get('authorization')||'';if(!h.startsWith('Bearer '))throw new Error('UNAUTHORIZED');return (await jwtVerify(h.slice(7),secret())).payload}
async function issue(x){return new SignJWT(x).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('12h').sign(secret())}
async function ensureAdmin(c){const {data,error}=await c.from('app_settings').select('value').eq('key','admin_password').maybeSingle();if(error)throw error;if(data)return;if(!process.env.INITIAL_ADMIN_PASSWORD)throw new Error('MISSING_INITIAL_ADMIN_PASSWORD');const {error:e}=await c.from('app_settings').insert({key:'admin_password',value:await bcrypt.hash(process.env.INITIAL_ADMIN_PASSWORD,10)});if(e)throw e}
async function snapshot(c,id){const [{data:u,error:ue},{data:tx,error:te},{data:done,error:de},{data:games,error:ge}]=await Promise.all([c.from('participants').select('id,employee_no,name,balance,spent').eq('id',id).single(),c.from('transactions').select('amount,kind,label,created_at').eq('participant_id',id).order('created_at',{ascending:false}).limit(30),c.from('game_completions').select('game_id').eq('participant_id',id),c.from('games').select('*').eq('active',true).order('created_at')]);if(ue||te||de||ge)throw ue||te||de||ge;return{user:u,transactions:tx||[],completed:(done||[]).map(x=>x.game_id),games:games||[]}}
export default async req=>{try{const c=db(),p=route(req),m=req.method;
 if(p==='health'){const {error}=await c.from('app_settings').select('key').limit(1);if(error)throw error;return json({ok:true,database:true})}
 if(p==='login'&&m==='POST'){const b=await req.json();const {data:u,error}=await c.from('participants').select('*').eq('employee_no',String(b.employeeNo||'')).maybeSingle();if(error)throw error;if(!u||!await bcrypt.compare(String(b.password||''),u.password_hash))return json({error:'LOGIN_FAILED'},401);return json({token:await issue({sub:u.id,role:'user'}),...(await snapshot(c,u.id))})}
 if(p==='admin/login'&&m==='POST'){await ensureAdmin(c);const b=await req.json();const {data,error}=await c.from('app_settings').select('value').eq('key','admin_password').single();if(error)throw error;if(!await bcrypt.compare(String(b.password||''),data.value))return json({error:'LOGIN_FAILED'},401);return json({token:await issue({sub:'admin',role:'admin'})})}
 const who=await auth(req);
 if(p==='bootstrap'&&m==='GET')return json(await snapshot(c,who.sub));
 if(p==='payment'&&m==='POST'){const amount=Math.floor(Number((await req.json()).amount));const {error}=await c.rpc('pay_credit',{p_user:who.sub,p_amount:amount,p_label:`${amount} C 결제`});if(error)throw error;return json(await snapshot(c,who.sub))}
 if(p==='game/complete'&&m==='POST'){const {gameId}=await req.json();const {error}=await c.rpc('complete_game',{p_user:who.sub,p_game:String(gameId)});if(error)throw error;return json(await snapshot(c,who.sub))}
 if(who.role!=='admin')throw new Error('FORBIDDEN');
 if(p==='admin/users'&&m==='GET'){const q=new URL(req.url).searchParams.get('q')||'';let z=c.from('participants').select('id,employee_no,name,balance,spent').order('created_at').limit(500);if(q)z=z.or(`employee_no.ilike.%${q}%,name.ilike.%${q}%`);const{data,error}=await z;if(error)throw error;return json({users:data||[]})}
 if(p==='admin/users'&&m==='POST'){const b=await req.json(),rows=Array.isArray(b.users)?b.users:[b];for(const x of rows){const credit=Math.max(0,Math.floor(+x.credit||0));const{data,error}=await c.from('participants').insert({employee_no:String(x.employeeNo),name:String(x.name),password_hash:await bcrypt.hash(String(x.password||'1234'),8),balance:credit}).select('id').single();if(error)throw error;if(credit)await c.from('transactions').insert({participant_id:data.id,amount:credit,kind:'initial',label:'초기 크레딧'})}return json({ok:true},201)}
 if(p==='admin/credit'&&m==='POST'){const b=await req.json();const{data:u,error}=await c.from('participants').select('balance').eq('id',b.userId).single();if(error)throw error;await c.from('participants').update({balance:u.balance+Math.floor(+b.amount)}).eq('id',b.userId);await c.from('transactions').insert({participant_id:b.userId,amount:Math.floor(+b.amount),kind:'admin',label:'관리자 크레딧 조정'});return json({ok:true})}
 if(p==='admin/games'&&m==='POST'){const b=await req.json(),id=(b.name||'game').toLowerCase().replace(/[^a-z0-9가-힣]+/g,'-').replace(/^-|-$/g,'').slice(0,32);const{data,error}=await c.from('games').insert({id,name:b.name,reward:Math.floor(+b.reward),image_url:b.imageUrl||null,builtin:false}).select().single();if(error)throw error;return json({game:data},201)}
 if(p==='admin/qr'&&m==='POST'){const b=await req.json(),v=b.type==='game'?`zipmarket:game:${b.gameId}`:`zipmarket:pay:${Math.floor(+b.amount)}`;return json({value:v,dataUrl:await QRCode.toDataURL(v,{width:320,margin:2})})}
 return json({error:'NOT_FOUND'},404);
}catch(e){console.error(e);return json({error:e.message||'SERVER_ERROR'},e.message==='UNAUTHORIZED'?401:500)}};
