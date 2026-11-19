import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://example.supabase.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test_only';
process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-characters';
process.env.INITIAL_ADMIN_PASSWORD = 'admin-pass';

const participantId = '11111111-1111-4111-8111-111111111111';
const gameId = '22222222-2222-4222-8222-222222222222';
const seenHeaders = [];

const participant = {
  id: participantId,
  employee_no: '20220412',
  name: '테스트 참가자',
  password_hash: '$2a$10$placeholder',
  credit_balance: 500,
  created_at: '2026-11-19T00:00:00Z'
};
const game = { id: gameId, name: '탁구공 게임', image_url: '/assets/game-pingpong.webp', reward:100, created_at: '2026-11-19T00:00:00Z' };

function reply(value, status = 200) {
  return new Response(value === null ? '' : JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(input);
  const endpoint = `${url.pathname.replace('/rest/v1/', '')}${url.search}`;
  seenHeaders.push(init.headers || {});
  if (endpoint.startsWith('rpc/zip_market_initialize_admin')) return reply(true);
  if (endpoint.startsWith('rpc/zip_market_auth_participant')) {
    const body = JSON.parse(init.body);
    return reply(body.p_employee_no === '20220412' && body.p_password === '1234' ? [{ id:participantId }] : []);
  }
  if (endpoint.startsWith('rpc/zip_market_auth_admin')) {
    const body = JSON.parse(init.body);
    return reply(body.p_password === 'admin-pass');
  }
  if (endpoint.startsWith('rpc/zip_market_redeem_credit')) return reply(400);
  if (endpoint.startsWith('rpc/zip_market_adjust_credit')) return reply(600);
  if (endpoint.startsWith('rpc/zip_market_complete_game')) return reply(600);
  if (endpoint.startsWith('rpc/zip_market_create_participants')) return reply(1);
  if (endpoint.startsWith('rpc/zip_market_set_admin_password')) return reply(true);
  if (endpoint.startsWith('participants')) {
    if (endpoint.includes(`id=eq.${participantId}`)) return reply([participant]);
    if (endpoint.includes('select=id&limit=1')) return reply([{ id: participantId }]);
    return reply([participant]);
  }
  if (endpoint.startsWith('transactions')) return reply([{ id:'tx1', type:'payment', amount:-100, description:'100 C 결제', created_at:'2026-11-19T01:00:00Z' }]);
  if (endpoint.startsWith('game_completions')) return reply([]);
  if (endpoint.startsWith('games')) {
    if (endpoint.includes('select=id&limit=1')) return reply([{ id: gameId }]);
    return reply([game]);
  }
  return reply({ message: `Unhandled ${endpoint}` }, 500);
};

const { handler } = await import('../netlify/functions/api.mjs');
const event = (method, path, body, headers = {}) => ({ httpMethod:method, path, headers, body:body === undefined ? null : JSON.stringify(body) });
const parsed = response => JSON.parse(response.body);

test('health verifies old V5 tables and compatible auth functions', async () => {
  const response = await handler(event('GET', '/api/health'));
  assert.equal(response.statusCode, 200);
  assert.deepEqual(parsed(response), {
    ok:true, database:true, adminInitialized:true, adminCreatedNow:false,
    transport:'direct-rest', schema:'v5-compatible', keyType:'secret', version:'8.0.0'
  });
  assert.equal(seenHeaders.at(-1).authorization, undefined);
});

test('user login authenticates employee_no and returns a complete snapshot', async () => {
  const response = await handler(event('POST', '/api/login', { employeeId:'20220412', password:'1234' }));
  const body = parsed(response);
  assert.equal(response.statusCode, 200);
  assert.equal(body.ok, true);
  assert.equal(body.participant.employee_id, '20220412');
  assert.equal(body.participant.credits, 500);
  assert.equal(body.transactions.length, 1);
  assert.equal(body.games.length, 1);
  assert.equal(body.games[0].reward, 100);
  assert.ok(body.token.split('.').length === 3);

  const session = await handler(event('GET', '/api/session', undefined, { authorization:`Bearer ${body.token}` }));
  assert.equal(session.statusCode, 200);
  assert.equal(parsed(session).participant.id, participantId);
});

test('incorrect user password is rejected explicitly', async () => {
  const response = await handler(event('POST', '/api/login', { employeeId:'20220412', password:'wrong' }));
  assert.equal(response.statusCode, 401);
  assert.equal(parsed(response).code, 'LOGIN_FAILED');
});

test('administrator login succeeds and returns existing participants', async () => {
  const response = await handler(event('POST', '/.netlify/functions/api/admin/login', { password:'admin-pass' }));
  const body = parsed(response);
  assert.equal(response.statusCode, 200);
  assert.equal(body.ok, true);
  assert.equal(body.participants[0].employee_id, '20220412');
  assert.equal(body.games[0].name, '탁구공 게임');
});


test('credit, QR, game, participant, and deletion routes remain operational', async () => {
  const userLogin = parsed(await handler(event('POST', '/api/login', { employeeId:'20220412', password:'1234' })));
  const adminLogin = parsed(await handler(event('POST', '/api/admin/login', { password:'admin-pass' })));
  const userHeaders = { authorization:`Bearer ${userLogin.token}` };
  const adminHeaders = { authorization:`Bearer ${adminLogin.token}` };

  const directPay = await handler(event('POST', '/api/pay', { amount:100 }, userHeaders));
  assert.equal(directPay.statusCode, 200);

  const paymentQr = parsed(await handler(event('POST', '/api/admin/payment-qr', { amount:200 }, adminHeaders)));
  assert.match(paymentQr.qrPayload, /^[^.]+\.[^.]+\.[^.]+$/);
  const paymentRedeem = await handler(event('POST', '/api/redeem', { qrPayload:paymentQr.qrPayload }, userHeaders));
  assert.equal(paymentRedeem.statusCode, 200);

  const gameQr = parsed(await handler(event('POST', `/api/admin/games/${gameId}/qr`, {}, adminHeaders)));
  const gameRedeem = await handler(event('POST', '/api/redeem', { qrPayload:gameQr.qrPayload }, userHeaders));
  assert.equal(gameRedeem.statusCode, 200);

  const credit = await handler(event('POST', `/api/admin/participants/${participantId}/credit`, { amount:100 }, adminHeaders));
  assert.equal(credit.statusCode, 200);

  const createParticipant = await handler(event('POST', '/api/admin/participants', {
    employeeId:'NEW001', name:'새 참가자', password:'1234', credits:100
  }, adminHeaders));
  assert.equal(createParticipant.statusCode, 201);

  const createGame = await handler(event('POST', '/api/admin/games', { name:'새 게임', reward:100 }, adminHeaders));
  assert.equal(createGame.statusCode, 201);

  const deleteGame = await handler(event('DELETE', `/api/admin/games/${gameId}`, undefined, adminHeaders));
  const deleteParticipant = await handler(event('DELETE', `/api/admin/participants/${participantId}`, undefined, adminHeaders));
  assert.equal(deleteGame.statusCode, 200);
  assert.equal(deleteParticipant.statusCode, 200);
});
