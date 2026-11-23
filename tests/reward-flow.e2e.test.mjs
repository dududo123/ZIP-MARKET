import assert from 'node:assert/strict';

process.env.SUPABASE_URL='https://reward-flow.mock.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY='sb_secret_reward_flow';
process.env.JWT_SECRET='reward-flow-secret-long-enough-for-tests';
process.env.INITIAL_ADMIN_PASSWORD='admin1234';

const participant={id:'11111111-1111-4111-8111-111111111111',employee_no:'TEST001',name:'테스트',credit_balance:1000,created_at:'2026-11-23T00:00:00Z'};
const games=[];
const completions=[];
const transactions=[];
let createSequence=0;
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
const bodyOf=(options)=>options.body?JSON.parse(options.body):{};

function gameByIdentifier(value){
  const wanted=String(value||'').toLowerCase();
  return games.find(game=>[game.id,game.slug,game.public_id,game.name].some(item=>String(item||'').toLowerCase()===wanted));
}

globalThis.fetch=async(url,options={})=>{
  const u=String(url),body=bodyOf(options),method=options.method||'GET';
  if(u.endsWith('/rpc/zip_market_initialize_admin')) return json({initialized:true,createdNow:false});
  if(u.endsWith('/rpc/zip_market_auth_admin')) return json({authenticated:body.p_password==='admin1234'});
  if(u.endsWith('/rpc/zip_market_auth_participant')) return json({authenticated:body.p_employee_no==='TEST001'&&body.p_password==='1234',participant});
  if(u.endsWith('/rpc/zip_market_admin_create_game')){
    createSequence+=1;
    const id=`22222222-2222-4222-8222-${String(createSequence).padStart(12,'0')}`;
    const game={id,slug:`custom-${createSequence}`,public_id:`game-custom-${createSequence}`,name:body.p_name,image_url:body.p_image_url,reward:body.p_reward,points:body.p_reward,active:true,builtin:false,created_at:'2026-11-23T00:01:00Z',updated_at:'2026-11-23T00:01:00Z'};
    games.push(game);return json({...game,publicId:game.public_id,identifiers:[game.id,game.slug,game.public_id]});
  }
  if(u.endsWith('/rpc/zip_market_admin_update_game_reward')){
    const game=gameByIdentifier(body.p_game_identifier);
    if(!game)return json({code:'P0002',message:'GAME_NOT_FOUND'},404);
    game.reward=body.p_reward;game.points=body.p_reward;game.updated_at='2026-11-23T00:02:00Z';
    return json({...game,publicId:game.public_id,identifiers:[game.id,game.slug,game.public_id]});
  }
  if(u.endsWith('/rpc/zip_market_resolve_game')){
    const game=gameByIdentifier(body.p_game_identifier);
    if(!game)return json({code:'P0002',message:'GAME_NOT_FOUND'},404);
    return json({id:game.id,slug:game.slug,publicId:game.public_id,public_id:game.public_id,name:game.name,identifiers:[game.id,game.slug,game.public_id,game.name]});
  }
  if(u.endsWith('/rpc/zip_market_complete_game')){
    const game=gameByIdentifier(body.p_game_id);
    if(completions.some(row=>row.participant_id===body.p_participant_id&&row.game_id===game.id)) return json({code:'23505',message:'ALREADY_COMPLETED'},409);
    const paidReward=game.reward;
    completions.push({participant_id:body.p_participant_id,game_id:game.id,reward:paidReward,rewarded_amount:paidReward,completed_at:'2026-11-23T00:03:00Z'});
    participant.credit_balance+=paidReward;
    transactions.unshift({id:`tx-${transactions.length+1}`,participant_id:participant.id,amount:paidReward,type:'adjustment',description:`${game.name} 완료 보상`,balance_after:participant.credit_balance,reference:`game:${game.id}`,created_at:'2026-11-23T00:03:00Z'});
    return json({ok:true,gameId:game.id,reward:paidReward,balance:participant.credit_balance,participant});
  }
  if(u.endsWith('/rpc/zip_market_pay_credit')){
    participant.credit_balance-=body.p_amount;
    transactions.unshift({id:`tx-${transactions.length+1}`,participant_id:participant.id,amount:-body.p_amount,type:'payment',description:body.p_description,balance_after:participant.credit_balance,created_at:'2026-11-23T00:00:30Z'});
    return json({ok:true,balance:participant.credit_balance});
  }
  if(u.includes('/participants?'))return json([participant]);
  if(u.includes('/transactions?'))return json(transactions);
  if(u.includes('/games?'))return json(games);
  if(u.includes('/game_completions?'))return json(completions.map(({game_id,completed_at})=>({game_id,completed_at})));
  return json({message:`unhandled ${method} ${u}`},500);
};

const {default:handler}=await import('../netlify/functions/api.mjs');
const request=(path,method='GET',body,token)=>new Request(`https://zip-market.test/api${path}`,{method,headers:{...(body!==undefined?{'content-type':'application/json'}:{}),...(token?{authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});

const adminLogin=await handler(request('/auth/admin','POST',{password:'admin1234'}));
assert.equal(adminLogin.status,200);const adminToken=(await adminLogin.json()).token;
const participantLogin=await handler(request('/auth/participant','POST',{employeeNo:'TEST001',password:'1234'}));
assert.equal(participantLogin.status,200);const participantToken=(await participantLogin.json()).token;

// Existing payment path remains operational before reward work.
const payment=await handler(request('/participant/pay','POST',{amount:100,description:'회귀 결제',requestId:'reward-flow-payment-001'},participantToken));
assert.equal(payment.status,200);assert.equal(participant.credit_balance,900);

// Create with a freely entered non-preset reward and read it back.
const createdResponse=await handler(request('/admin/games','POST',{name:'자유 보상 게임',imageUrl:'/assets/game-default.webp',reward:275},adminToken));
assert.equal(createdResponse.status,201);const created=(await createdResponse.json()).game;
assert.equal(created.reward,275);assert.equal(games[0].reward,275);
let dashboard=await handler(request('/admin/dashboard','GET',undefined,adminToken));
assert.equal((await dashboard.json()).games[0].reward,275,'created reward must survive a fresh dashboard read');

// Edit existing reward through PATCH and verify both admin and participant re-reads.
const updatedResponse=await handler(request(`/admin/games/${created.id}/reward`,'PATCH',{reward:425},adminToken));
assert.equal(updatedResponse.status,200);assert.equal((await updatedResponse.json()).game.reward,425);
dashboard=await handler(request('/admin/dashboard','GET',undefined,adminToken));
assert.equal((await dashboard.json()).games[0].reward,425);
let participantDashboard=await handler(request('/participant/dashboard','GET',undefined,participantToken));
assert.equal((await participantDashboard.json()).games[0].reward,425,'participant GAME data must expose current reward');

// Completion pays the current reward exactly once and snapshots it.
const completion=await handler(request('/participant/complete-game','POST',{publicId:created.public_id,expectedGameIds:[created.id,created.slug,created.public_id]},participantToken));
assert.equal(completion.status,200);assert.equal((await completion.json()).result.reward,425);
assert.equal(participant.credit_balance,1325);assert.equal(completions[0].reward,425);assert.equal(transactions[0].amount,425);
const duplicate=await handler(request('/participant/complete-game','POST',{publicId:created.public_id},participantToken));
assert.equal(duplicate.status,409);assert.equal((await duplicate.json()).code,'ALREADY_COMPLETED');
assert.equal(participant.credit_balance,1325,'duplicate completion must not add credit');assert.equal(completions.length,1);assert.equal(transactions.filter(row=>row.amount>0).length,1);

// A later reward edit is prospective only: old completion/transaction/balance do not change.
const futureUpdate=await handler(request(`/admin/games/${created.id}/reward`,'PATCH',{reward:900},adminToken));
assert.equal(futureUpdate.status,200);assert.equal(games[0].reward,900);
assert.equal(completions[0].reward,425);assert.equal(completions[0].rewarded_amount,425);assert.equal(transactions[0].amount,425);assert.equal(participant.credit_balance,1325);

console.log('reward-flow.e2e.test: payment regression, free reward create, save+reload, participant visibility, current-reward completion, duplicate block and no retroactive rewrite passed');
