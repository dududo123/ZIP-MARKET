import assert from 'node:assert/strict';

process.env.SUPABASE_URL='https://mock.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY='sb_secret_mock';
process.env.JWT_SECRET='a-very-long-mock-jwt-secret-for-tests';
process.env.INITIAL_ADMIN_PASSWORD='admin1234';

const participantId='11111111-1111-1111-1111-111111111111';
const gameId='balloon';
const calls=[];
let participantAuth = new Map([['TEST001','1234']]);
let adminPassword='admin1234';
const createdGameNames=new Set();
const jsonResponse=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
globalThis.fetch=async(url,options={})=>{
  const body=options.body?JSON.parse(options.body):null;
  calls.push({url:String(url),method:options.method||'GET',body});
  const u=String(url);
  if(u.endsWith('/rpc/zip_market_initialize_admin')) return jsonResponse({initialized:true,createdNow:false});
  if(u.endsWith('/rpc/zip_market_auth_admin')) return jsonResponse({authenticated:body.p_password===adminPassword});
  if(u.endsWith('/rpc/zip_market_auth_participant')) {
    if(participantAuth.get(body.p_employee_no)===body.p_password) return jsonResponse({authenticated:true,participant:{id:participantId,employee_no:body.p_employee_no,name:'테스트',credit_balance:1000}});
    return jsonResponse({authenticated:false});
  }
  if(u.endsWith('/rpc/zip_market_pay_credit')) return jsonResponse({ok:true,balance:900});
  if(u.endsWith('/rpc/zip_market_complete_game')) return jsonResponse({ok:true,gameId,reward:100,balance:1100,participant:{id:participantId,employee_no:'TEST001',name:'테스트',credit_balance:1100}});
  if(u.endsWith('/rpc/zip_market_grant_credit')) return jsonResponse({ok:true,balance:1100});
  if(u.endsWith('/rpc/zip_market_admin_create_participant')) { if(participantAuth.has(body.p_employee_no)) return jsonResponse({code:'23505',message:'EMPLOYEE_NO_ALREADY_EXISTS'},409); participantAuth.set(body.p_employee_no,body.p_password); return jsonResponse({id:participantId,employee_no:body.p_employee_no,name:body.p_name,credit_balance:body.p_initial_credit}); }
  if(u.endsWith('/rpc/zip_market_admin_create_participants')) {
    const rows=body.p_participants;
    const duplicate=rows.find((row,index)=>participantAuth.has(row.employeeNo)||rows.findIndex(candidate=>candidate.employeeNo===row.employeeNo)!==index);
    if(duplicate)return jsonResponse({code:'23505',message:`ROW_1: EMPLOYEE_NO_ALREADY_EXISTS (${duplicate.employeeNo})`},409);
    rows.forEach(row=>participantAuth.set(row.employeeNo,row.password));
    return jsonResponse({createdCount:rows.length,results:rows.map((row,index)=>({row:index+1,employeeNo:row.employeeNo,participant:{employee_no:row.employeeNo}}))});
  }
  if(u.endsWith('/rpc/zip_market_set_admin_password')) {adminPassword=body.p_password;return jsonResponse({updated:true});}
  if(u.endsWith('/rpc/zip_market_admin_create_game')) {
    if(createdGameNames.has(body.p_name.toLowerCase()))return jsonResponse({code:'23505',message:'GAME_NAME_ALREADY_EXISTS'},409);
    createdGameNames.add(body.p_name.toLowerCase());
    return jsonResponse({id:'new-game-9f25a1bc',slug:'new-game-9f25a1bc',name:body.p_name,image_url:body.p_image_url,reward:body.p_reward});
  }
  if((options.method||'GET')==='DELETE') return new Response(null,{status:204});
  if(u.includes('/participants?')) return jsonResponse([{id:participantId,employee_no:'TEST001',name:'테스트',credit_balance:1000,created_at:'2026-01-01T00:00:00Z'}]);
  if(u.includes('/transactions?')) return jsonResponse([{id:'t1',amount:-100,type:'payment',description:'테스트 결제',balance_after:900,created_at:'2026-01-01T00:00:00Z'}]);
  if(u.includes('/games?')) return jsonResponse([{id:gameId,name:'풍선 게임',image_url:'/assets/game-balloon.webp'}]);
  if(u.includes('/game_completions?')) return jsonResponse([]);
  return jsonResponse({message:'unhandled mock route'},500);
};

const {default:handler}=await import('../netlify/functions/api.mjs');
const request=(path,method='GET',body,token,direct=false)=>new Request(
  `https://zip-market.test${direct?`/.netlify/functions/api${path}`:`/api${path}`}`,
  {method,headers:{...(body!==undefined?{'content-type':'application/json'}:{}),...(token?{authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body)}
);

// /api/health and direct Function route.
for (const direct of [false,true]) {
  const res=await handler(request('/health','GET',undefined,undefined,direct));
  assert.ok(res instanceof Response);assert.equal(res.status,200);
  const body=await res.json();assert.equal(body.ok,true);assert.equal(body.database,true);assert.equal(body.schema,'zip-market-v8.8');assert.equal(body.version,'8.8.0');
}
assert.deepEqual(calls.find(c=>c.url.endsWith('/rpc/zip_market_initialize_admin')).body,{p_initial_password:'admin1234'});

// Administrator login success and failure.
const adminSuccess=await handler(request('/auth/admin','POST',{password:'admin1234'}));
assert.equal(adminSuccess.status,200);const adminBody=await adminSuccess.json();assert.equal(adminBody.role,'admin');assert.ok(adminBody.token);
assert.deepEqual(calls.find(c=>c.url.endsWith('/rpc/zip_market_auth_admin')).body,{p_initial_password:'admin1234',p_password:'admin1234'});
const adminFailure=await handler(request('/auth/admin','POST',{password:'wrong'}));
assert.equal(adminFailure.status,401);assert.equal((await adminFailure.json()).code,'LOGIN_FAILED');

// Participant login success and failure, including dashboard transactions.
const userSuccess=await handler(request('/auth/participant','POST',{employeeNo:'TEST001',password:'1234'}));
assert.equal(userSuccess.status,200);const userBody=await userSuccess.json();assert.equal(userBody.participant.employee_no,'TEST001');assert.equal(userBody.transactions[0].balance_after,900);assert.ok(userBody.token);
assert.deepEqual(calls.find(c=>c.url.endsWith('/rpc/zip_market_auth_participant')).body,{p_employee_no:'TEST001',p_password:'1234'});
const userFailure=await handler(request('/auth/participant','POST',{employeeNo:'TEST001',password:'wrong'}));
assert.equal(userFailure.status,401);assert.equal((await userFailure.json()).code,'LOGIN_FAILED');

// Payment and game completion.
const paymentRequestId='web-test-payment-001';
const payment=await handler(request('/participant/pay','POST',{amount:100,description:'테스트 결제',requestId:paymentRequestId},userBody.token));
assert.equal(payment.status,200);
assert.deepEqual(calls.find(c=>c.url.endsWith('/rpc/zip_market_pay_credit')).body,{p_participant_id:participantId,p_amount:100,p_description:'테스트 결제',p_request_id:paymentRequestId});
const invalidPayment=await handler(request('/participant/pay','POST',{amount:0},userBody.token));
assert.equal(invalidPayment.status,400);assert.equal((await invalidPayment.json()).code,'INVALID_AMOUNT');
const completion=await handler(request('/participant/complete-game','POST',{gameId},userBody.token));
assert.equal(completion.status,200);
assert.deepEqual(calls.find(c=>c.url.endsWith('/rpc/zip_market_complete_game')).body,{p_participant_id:participantId,p_game_id:gameId});
const legacyCompletion=await handler(request('/participant/complete-game','POST',{public_id:'game-balloon'},userBody.token));
assert.equal(legacyCompletion.status,200);
assert.deepEqual(calls.filter(c=>c.url.endsWith('/rpc/zip_market_complete_game')).at(-1).body,{p_participant_id:participantId,p_game_id:'game-balloon'});

// Admin create/grant/password and both deletion routes.
const createParticipant=await handler(request('/admin/participants','POST',{employeeNo:'NEW001',name:'신규',password:'1234',initialCredit:500},adminBody.token));
assert.equal(createParticipant.status,201);
const newLogin=await handler(request('/auth/participant','POST',{employeeNo:'NEW001',password:'1234'}));
assert.equal(newLogin.status,200,'newly registered participant must be able to log in');
const duplicateParticipant=await handler(request('/admin/participants','POST',{employeeNo:'NEW001',name:'중복',password:'1234',initialCredit:0},adminBody.token));
assert.equal(duplicateParticipant.status,409);assert.equal((await duplicateParticipant.json()).code,'EMPLOYEE_NO_ALREADY_EXISTS');
const invalidSingle=await handler(request('/admin/participants','POST',{employeeNo:'BAD001',name:'잘못',password:'1234',initialCredit:-1},adminBody.token));
assert.equal(invalidSingle.status,400);assert.equal((await invalidSingle.json()).code,'INVALID_INITIAL_CREDIT');
const bulk=await handler(request('/admin/participants/bulk','POST',{participants:[
  {employeeNo:'BULK001',name:'일괄1',password:'1111',initialCredit:1000},
  {employeeNo:'BULK002',name:'일괄2',password:'2222',initialCredit:2000}
]},adminBody.token));
assert.equal(bulk.status,201);assert.equal((await bulk.json()).createdCount,2);
const bulkRpc=calls.find(c=>c.url.endsWith('/rpc/zip_market_admin_create_participants'));
assert.equal(bulkRpc.body.p_participants.length,2);
const beforeInvalidCalls=calls.filter(c=>c.url.endsWith('/rpc/zip_market_admin_create_participants')).length;
const invalidBulk=await handler(request('/admin/participants/bulk','POST',{participants:[
  {employeeNo:'OKROW',name:'정상',password:'1111',initialCredit:100},
  {employeeNo:'BADROW',name:'',password:'2222',initialCredit:100}
]},adminBody.token));
assert.equal(invalidBulk.status,400);assert.match((await invalidBulk.json()).message,/2행/);
assert.equal(calls.filter(c=>c.url.endsWith('/rpc/zip_market_admin_create_participants')).length,beforeInvalidCalls,'invalid bulk must not call database');
const duplicateBulk=await handler(request('/admin/participants/bulk','POST',{participants:[
  {employeeNo:'DUPROW',name:'첫째',password:'1111',initialCredit:100},
  {employeeNo:'DUPROW',name:'둘째',password:'2222',initialCredit:100}
]},adminBody.token));
assert.equal(duplicateBulk.status,409);assert.equal((await duplicateBulk.json()).code,'DUPLICATE_EMPLOYEE_NO_IN_FILE');
const grant=await handler(request(`/admin/participants/${participantId}/credit`,'POST',{amount:100},adminBody.token));
assert.equal(grant.status,200);
const password=await handler(request('/admin/password','POST',{password:'next1234'},adminBody.token));
assert.equal(password.status,200);
const changedPasswordLogin=await handler(request('/auth/admin','POST',{password:'next1234'}));
assert.equal(changedPasswordLogin.status,200,'changed administrator password must authenticate');
const oldPasswordLogin=await handler(request('/auth/admin','POST',{password:'admin1234'}));
assert.equal(oldPasswordLogin.status,401,'bootstrap password must not remain a recovery login after change');
const createGame=await handler(request('/admin/games','POST',{name:'새 게임'},adminBody.token));
assert.equal(createGame.status,201);const createdGame=await createGame.json();assert.ok(createdGame.game.id);assert.equal(createdGame.game.image_url,'/assets/game-default.webp');
assert.deepEqual(calls.find(c=>c.url.endsWith('/rpc/zip_market_admin_create_game')).body,{p_name:'새 게임',p_image_url:'/assets/game-default.webp',p_reward:100});
const duplicateGame=await handler(request('/admin/games','POST',{name:'새 게임'},adminBody.token));
assert.equal(duplicateGame.status,409);assert.equal((await duplicateGame.json()).code,'GAME_NAME_ALREADY_EXISTS');
const deleteGame=await handler(request(`/admin/games/${gameId}`,'DELETE',undefined,adminBody.token));
assert.equal(deleteGame.status,200);
const deleteParticipant=await handler(request(`/admin/participants/${participantId}`,'DELETE',undefined,adminBody.token));
assert.equal(deleteParticipant.status,200);

const deletes=calls.filter(c=>c.method==='DELETE').map(c=>c.url.split('/rest/v1/')[1]);
assert.deepEqual(deletes.slice(0,2),[`game_completions?game_id=eq.${gameId}`,`games?id=eq.${gameId}`]);
assert.deepEqual(deletes.slice(2,5),[`game_completions?participant_id=eq.${participantId}`,`transactions?participant_id=eq.${participantId}`,`participants?id=eq.${participantId}`]);

const unauth=await handler(request('/admin/dashboard'));
assert.equal(unauth.status,401);assert.equal((await unauth.json()).code,'AUTH_REQUIRED');
const missing=await handler(request('/unknown'));
assert.equal(missing.status,404);assert.equal((await missing.json()).code,'NOT_FOUND');
const options=await handler(request('/health','OPTIONS'));
assert.equal(options.status,204);

console.log('api.routes.test: /api health, direct route, admin/user success+failure, payment, games, CRUD, deletion order, auth and 404 passed');
