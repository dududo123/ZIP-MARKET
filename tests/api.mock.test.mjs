import assert from 'node:assert/strict';

process.env.SUPABASE_URL='https://mock.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY='sb_secret_mock';
process.env.JWT_SECRET='a-very-long-mock-jwt-secret-for-tests';
process.env.INITIAL_ADMIN_PASSWORD='admin1234';

const calls=[];
const jsonResponse=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
globalThis.fetch=async(url,options={})=>{
  calls.push({url:String(url),method:options.method||'GET',body:options.body?JSON.parse(options.body):null});
  const u=String(url);
  if(u.endsWith('/rpc/zip_market_initialize_admin')) return jsonResponse({initialized:true,createdNow:false});
  if(u.endsWith('/rpc/zip_market_auth_admin')) return jsonResponse({authenticated:true});
  if(u.endsWith('/rpc/zip_market_auth_participant')) return jsonResponse({authenticated:true,participant:{id:'11111111-1111-1111-1111-111111111111',employee_no:'TEST001',name:'테스트',credit_balance:1000}});
  if(u.endsWith('/rpc/zip_market_pay_credit')) return jsonResponse({ok:true,balance:900});
  if(u.endsWith('/rpc/zip_market_complete_game')) return jsonResponse({ok:true,gameId:'22222222-2222-2222-2222-222222222222'});
  if((options.method||'GET')==='DELETE') return new Response(null,{status:204});
  if(u.includes('/participants?')) return jsonResponse([{id:'11111111-1111-1111-1111-111111111111',employee_no:'TEST001',name:'테스트',credit_balance:1000,created_at:'2026-01-01T00:00:00Z'}]);
  if(u.includes('/transactions?')) return jsonResponse([]);
  if(u.includes('/games?')) return jsonResponse([{id:'22222222-2222-2222-2222-222222222222',name:'풍선 게임',image_url:'/assets/game-balloon.webp'}]);
  if(u.includes('/game_completions?')) return jsonResponse([]);
  return jsonResponse({message:'unhandled mock route'},500);
};

const {default:handler}=await import('../netlify/functions/api.mjs');
const request=(path,method='GET',body,token,direct=false)=>new Request(
  `https://zip-market.test${direct?`/.netlify/functions/api${path}`:`/api${path}`}`,
  {method,headers:{...(body!==undefined?{'content-type':'application/json'}:{}),...(token?{authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body)}
);

const health=await handler(request('/health'));
assert.ok(health instanceof Response,'modern Netlify function must return Web Response');
assert.equal(health.status,200);
const healthBody=await health.json();
assert.equal(healthBody.schema,'zip-market-v8.3');
assert.equal(healthBody.runtime,'netlify-modern-response');
assert.deepEqual(calls.at(-1).body,{p_initial_password:'admin1234'});

const directHealth=await handler(request('/health','GET',undefined,undefined,true));
assert.equal(directHealth.status,200,'direct Function URL path must also work');

const admin=await handler(request('/auth/admin','POST',{password:'admin1234'}));
assert.equal(admin.status,200);const adminBody=await admin.json();assert.equal(adminBody.role,'admin');assert.ok(adminBody.token);
const adminRpc=calls.find(c=>c.url.endsWith('/rpc/zip_market_auth_admin'));
assert.deepEqual(adminRpc.body,{p_initial_password:'admin1234',p_password:'admin1234'});

const user=await handler(request('/auth/participant','POST',{employeeNo:'TEST001',password:'1234'}));
assert.equal(user.status,200);const userBody=await user.json();assert.equal(userBody.participant.employee_no,'TEST001');assert.ok(userBody.token);
const userRpc=calls.find(c=>c.url.endsWith('/rpc/zip_market_auth_participant'));
assert.deepEqual(userRpc.body,{p_employee_no:'TEST001',p_password:'1234'});

const payment=await handler(request('/participant/pay','POST',{amount:100,description:'테스트 결제'},userBody.token));
assert.equal(payment.status,200);
assert.deepEqual(calls.find(c=>c.url.endsWith('/rpc/zip_market_pay_credit')).body,{p_participant_id:'11111111-1111-1111-1111-111111111111',p_amount:100,p_description:'테스트 결제'});

const complete=await handler(request('/participant/complete-game','POST',{gameId:'22222222-2222-2222-2222-222222222222'},userBody.token));
assert.equal(complete.status,200);

const deleteParticipant=await handler(request('/admin/participants/11111111-1111-1111-1111-111111111111','DELETE',undefined,adminBody.token));
assert.equal(deleteParticipant.status,200);
const deletionOrder=calls.filter(c=>c.method==='DELETE').map(c=>c.url.split('/rest/v1/')[1]);
assert.deepEqual(deletionOrder.slice(0,3),[
  'game_completions?participant_id=eq.11111111-1111-1111-1111-111111111111',
  'transactions?participant_id=eq.11111111-1111-1111-1111-111111111111',
  'participants?id=eq.11111111-1111-1111-1111-111111111111'
]);

const unauth=await handler(request('/admin/dashboard'));
assert.equal(unauth.status,401);assert.equal((await unauth.json()).code,'AUTH_REQUIRED');
console.log('api.mock.test: modern Response, routing, health, both logins, payment, completion, deletion and auth errors passed');
