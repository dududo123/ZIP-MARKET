import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

const VERSION = '8.1.0';

class AppError extends Error {
  constructor(status, code, message = code, detail = '') {
    super(message);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

const json = (statusCode, body) => ({
  statusCode,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-zip-market-version': VERSION
  },
  body: JSON.stringify(body)
});

const safeDetail = value => String(value || '')
  .replace(/sb_(secret|publishable)_[A-Za-z0-9_-]+/g, 'sb_$1_***')
  .slice(0, 700);

function requiredEnv() {
  const values = {
    url: (process.env.SUPABASE_URL || '').replace(/\/$/, ''),
    key: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    jwt: process.env.JWT_SECRET || '',
    admin: process.env.INITIAL_ADMIN_PASSWORD || ''
  };
  const missing = Object.entries(values).filter(([, value]) => !value).map(([key]) => key);
  if (missing.length) {
    throw new AppError(500, 'ENV_MISSING', '필수 Netlify 환경변수가 없습니다.', missing.join(','));
  }
  return values;
}

async function db(endpoint, options = {}) {
  const { url, key } = requiredEnv();
  const headers = {
    apikey: key,
    'content-type': 'application/json',
    accept: 'application/json'
  };
  // Supabase의 신규 sb_secret 키는 apikey로만, 기존 JWT service_role 키는 Bearer로도 전달합니다.
  if (key.startsWith('eyJ')) headers.authorization = `Bearer ${key}`;
  if (options.prefer) headers.prefer = options.prefer;

  let response;
  try {
    response = await fetch(`${url}/rest/v1/${endpoint}`, {
      method: options.method || 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(12000)
    });
  } catch (error) {
    throw new AppError(502, 'SUPABASE_UNREACHABLE', 'Supabase에 연결하지 못했습니다.', safeDetail(error.message));
  }

  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  if (!response.ok) {
    const detail = payload?.message || payload?.error_description || payload?.hint || text || `HTTP_${response.status}`;
    throw new AppError(502, 'DATABASE_ERROR', 'Supabase 데이터 처리에 실패했습니다.', safeDetail(detail));
  }
  return payload;
}

const filter = value => encodeURIComponent(String(value));
const bodyOf = event => {
  if (!event.body) return {};
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
    return JSON.parse(raw);
  } catch {
    throw new AppError(400, 'INVALID_JSON', '요청 형식이 올바르지 않습니다.');
  }
};
const bearer = event => (event.headers?.authorization || event.headers?.Authorization || '').replace(/^Bearer\s+/i, '').trim();
const b64url = value => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
const parseDuration = duration => {
  const match = String(duration).match(/^(\d+)([mhd])$/);
  if (!match) return Number(duration) || 3600;
  return Number(match[1]) * ({ m: 60, h: 3600, d: 86400 }[match[2]]);
};

function signToken(payload, expires = '12h') {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url({ alg: 'HS256', typ: 'JWT' });
  const body = b64url({ ...payload, iat: now, exp: now + parseDuration(expires) });
  const input = `${header}.${body}`;
  const signature = createHmac('sha256', requiredEnv().jwt).update(input).digest('base64url');
  return `${input}.${signature}`;
}

function verifyToken(token) {
  try {
    const [header, body, signature, ...extra] = String(token).split('.');
    if (!header || !body || !signature || extra.length) throw new Error('format');
    const expected = createHmac('sha256', requiredEnv().jwt).update(`${header}.${body}`).digest();
    const actual = Buffer.from(signature, 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error('signature');
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) throw new Error('expired');
    return payload;
  } catch {
    throw new AppError(401, 'TOKEN_EXPIRED', '로그인이 만료되었습니다. 다시 로그인해 주세요.');
  }
}

function requireAuth(event, role) {
  const payload = verifyToken(bearer(event));
  if (payload.role !== role || !payload.sub) throw new AppError(401, 'AUTH_REQUIRED', '로그인이 필요합니다.');
  return payload;
}

function normalizedPath(event) {
  let path = event.path || event.rawPath || '/';
  path = path.replace(/^\/\.netlify\/functions\/api/, '').replace(/^\/api/, '');
  if (!path.startsWith('/')) path = `/${path}`;
  return path.replace(/\/+$/, '') || '/';
}

const positiveInt = (value, name = '값') => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new AppError(400, 'INVALID_AMOUNT', `${name}이 올바르지 않습니다.`);
  return parsed;
};
const nonNegativeInt = value => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new AppError(400, 'INVALID_AMOUNT', '크레딧이 올바르지 않습니다.');
  return parsed;
};

function participantDto(row) {
  return {
    id: row.id,
    employee_id: row.employee_no,
    name: row.name,
    credits: Number(row.credit_balance || 0),
    created_at: row.created_at
  };
}

function transactionDtos(rows, currentBalance) {
  let running = Number(currentBalance || 0);
  return (rows || []).map(row => {
    const dto = {
      id: row.id,
      type: row.type,
      amount: Number(row.amount || 0),
      balance_after: running,
      description: row.description,
      created_at: row.created_at
    };
    running -= dto.amount;
    return dto;
  });
}

function gameDto(row) {
  return {
    id: row.id,
    name: row.name,
    image_url: row.image_url || '/assets/game-default.webp?v=8',
    reward: Number(row.reward ?? 0),
    created_at: row.created_at
  };
}

async function getParticipant(id) {
  const rows = await db(`participants?id=eq.${filter(id)}&select=id,employee_no,name,password_hash,credit_balance,created_at&limit=1`);
  if (!rows?.[0]) throw new AppError(404, 'PARTICIPANT_NOT_FOUND', '참가자를 찾을 수 없습니다.');
  return rows[0];
}

async function listGames() {
  // reward 열은 v8 schema.sql에서 추가됩니다. 아직 SQL을 실행하지 않았어도 로그인은 유지합니다.
  try {
    const rows = await db('games?select=id,name,image_url,reward,created_at&order=created_at.asc&limit=500');
    return (rows || []).map(gameDto);
  } catch (error) {
    if (!/reward.*does not exist|column.*reward|schema cache/i.test(error.detail || '')) throw error;
    const rows = await db('games?select=id,name,image_url,created_at&order=created_at.asc&limit=500');
    return (rows || []).map(gameDto);
  }
}

async function userSnapshot(participantId) {
  const participant = await getParticipant(participantId);
  const [transactions, games, completions] = await Promise.all([
    db(`transactions?participant_id=eq.${filter(participantId)}&select=id,type,amount,description,created_at&order=created_at.desc&limit=200`),
    listGames(),
    db(`game_completions?participant_id=eq.${filter(participantId)}&select=game_id,created_at&limit=500`)
  ]);
  return {
    participant: participantDto(participant),
    transactions: transactionDtos(transactions, participant.credit_balance),
    games,
    completedGameIds: (completions || []).map(row => row.game_id)
  };
}

async function adminSnapshot() {
  const [participants, games] = await Promise.all([
    db('participants?select=id,employee_no,name,credit_balance,created_at&order=created_at.desc&limit=2000'),
    listGames()
  ]);
  return { participants: (participants || []).map(participantDto), games };
}

async function rpc(name, body) {
  try {
    return await db(`rpc/${name}`, { method: 'POST', body });
  } catch (error) {
    if (/function .* does not exist|schema cache|could not find the function/i.test(error.detail || '')) {
      throw new AppError(500, 'SCHEMA_MISSING', 'Supabase schema.sql이 적용되지 않았습니다.', error.detail);
    }
    throw error;
  }
}

async function ensureAdminPassword() {
  await rpc('zip_market_initialize_admin', { p_initial_password: requiredEnv().admin });
  return { created: false };
}

async function processPayment(participantId, amount, reference, description) {
  try {
    await rpc('zip_market_redeem_credit', {
      p_participant_id: participantId,
      p_amount: amount,
      p_description: description,
      p_reference: reference
    });
    return;
  } catch (error) {
    const detail = `${error.detail || ''} ${error.message || ''}`;
    if (detail.includes('INSUFFICIENT_CREDIT')) throw new AppError(400, 'INSUFFICIENT_CREDIT', '크레딧이 부족합니다.');
    if (detail.includes('duplicate') || detail.includes('DUPLICATE_PAYMENT')) throw new AppError(409, 'DUPLICATE_PAYMENT', '이미 처리된 결제 QR입니다.');
    if (!/function .* does not exist|schema cache/i.test(detail)) throw error;
  }

  // V5 RPC가 아직 적용되지 않은 프로젝트를 위한 보수적 대체 경로입니다.
  const participant = await getParticipant(participantId);
  const current = Number(participant.credit_balance || 0);
  if (current < amount) throw new AppError(400, 'INSUFFICIENT_CREDIT', '크레딧이 부족합니다.');
  const updated = await db(`participants?id=eq.${filter(participantId)}&credit_balance=eq.${current}`, {
    method: 'PATCH',
    body: { credit_balance: current - amount, updated_at: new Date().toISOString() },
    prefer: 'return=representation'
  });
  if (!updated?.length) throw new AppError(409, 'BALANCE_CHANGED', '다른 결제가 먼저 처리되었습니다. 다시 시도해 주세요.');
  await db('transactions', {
    method: 'POST',
    body: { participant_id: participantId, amount: -amount, type: 'payment', description, reference },
    prefer: 'return=minimal'
  });
}

async function adjustCredit(participantId, amount) {
  try {
    await rpc('zip_market_adjust_credit', {
      p_participant_id: participantId,
      p_amount: amount,
      p_description: '관리자 크레딧 조정',
      p_reference: `admin:${randomUUID()}`
    });
    return;
  } catch (error) {
    const detail = `${error.detail || ''} ${error.message || ''}`;
    if (detail.includes('INSUFFICIENT_CREDIT')) throw new AppError(400, 'INSUFFICIENT_CREDIT', '차감할 크레딧이 부족합니다.');
    if (!/function .* does not exist|schema cache/i.test(detail)) throw error;
  }
  const participant = await getParticipant(participantId);
  const current = Number(participant.credit_balance || 0);
  const next = current + amount;
  if (next < 0) throw new AppError(400, 'INSUFFICIENT_CREDIT', '차감할 크레딧이 부족합니다.');
  await db(`participants?id=eq.${filter(participantId)}`, {
    method: 'PATCH', body: { credit_balance: next, updated_at: new Date().toISOString() }, prefer: 'return=minimal'
  });
  await db('transactions', {
    method: 'POST',
    body: { participant_id: participantId, amount, type: amount > 0 ? 'grant' : 'adjustment', description: '관리자 크레딧 조정', reference: `admin:${randomUUID()}` },
    prefer: 'return=minimal'
  });
}

async function completeGame(participantId, gameId) {
  try {
    await rpc('zip_market_complete_game', { p_participant_id: participantId, p_game_id: gameId });
    return;
  } catch (error) {
    const detail = `${error.detail || ''} ${error.message || ''}`;
    if (detail.includes('ALREADY_COMPLETED') || detail.includes('duplicate')) throw new AppError(409, 'ALREADY_COMPLETED', '이미 완료한 게임입니다.');
    if (detail.includes('GAME_NOT_FOUND')) throw new AppError(404, 'GAME_NOT_FOUND', '게임을 찾을 수 없습니다.');
    if (!/function .* does not exist|schema cache/i.test(detail)) throw error;
  }
  await db('game_completions', {
    method: 'POST', body: { participant_id: participantId, game_id: gameId }, prefer: 'return=minimal'
  });
}

function signQr(payload, expires) {
  return signToken({ ...payload, issuer: 'zip-market', tokenType: 'ZIPQR' }, expires);
}
function verifyQr(token) {
  const payload = verifyToken(token);
  if (payload.issuer !== 'zip-market' || payload.tokenType !== 'ZIPQR') {
    throw new AppError(400, 'INVALID_QR', '유효하지 않거나 만료된 ZIP! QR입니다.');
  }
  return payload;
}

async function route(event) {
  const method = event.httpMethod || 'GET';
  const path = normalizedPath(event);

  if (method === 'GET' && (path === '/' || path === '/health')) {
    try {
      const env = requiredEnv();
      const admin = await ensureAdminPassword();
      await Promise.all([
        db('participants?select=id&limit=1'),
        db('games?select=id&limit=1')
      ]);
      return json(200, {
        ok: true,
        database: true,
        adminInitialized: true,
        adminCreatedNow: admin.created,
        transport: 'direct-rest',
        schema: 'v5-compatible',
        keyType: env.key.startsWith('sb_secret_') ? 'secret' : 'legacy-service-role',
        version: VERSION
      });
    } catch (error) {
      return json(error.status || 500, {
        ok: false,
        database: false,
        code: error.code || 'HEALTH_FAILED',
        message: error.message,
        detail: safeDetail(error.detail)
      });
    }
  }

  if (method === 'POST' && (path === '/login' || path === '/user/login')) {
    const input = bodyOf(event);
    const employeeNo = String(input.employeeId || input.employeeNo || '').trim();
    const password = String(input.password || '');
    if (!employeeNo || !password) throw new AppError(400, 'LOGIN_INPUT_REQUIRED', '사번과 비밀번호를 입력해 주세요.');
    const result = await rpc('zip_market_auth_participant', { p_employee_no: employeeNo, p_password: password });
    const authenticated = Array.isArray(result) ? result[0] : result;
    if (!authenticated?.id) throw new AppError(401, 'LOGIN_FAILED', '사번 또는 비밀번호가 올바르지 않습니다.');
    return json(200, {
      ok: true,
      token: signToken({ role: 'user', sub: authenticated.id }, '12h'),
      ...(await userSnapshot(authenticated.id))
    });
  }

  if (method === 'POST' && path === '/admin/login') {
    const password = String(bodyOf(event).password || '');
    if (!password) throw new AppError(400, 'LOGIN_INPUT_REQUIRED', '관리자 비밀번호를 입력해 주세요.');
    const valid = await rpc('zip_market_auth_admin', {
      p_password: password,
      p_initial_password: requiredEnv().admin
    });
    if (valid !== true) throw new AppError(401, 'LOGIN_FAILED', '관리자 비밀번호가 올바르지 않습니다.');
    return json(200, {
      ok: true,
      token: signToken({ role: 'admin', sub: 'admin' }, '12h'),
      ...(await adminSnapshot())
    });
  }

  if (method === 'GET' && path === '/session') {
    const auth = requireAuth(event, 'user');
    return json(200, { ok: true, ...(await userSnapshot(auth.sub)) });
  }

  if (method === 'POST' && path === '/pay') {
    const auth = requireAuth(event, 'user');
    const amount = positiveInt(bodyOf(event).amount, '결제 금액');
    await processPayment(auth.sub, amount, `direct:${randomUUID()}`, `${amount} C 결제`);
    return json(200, { ok: true, ...(await userSnapshot(auth.sub)) });
  }

  if (method === 'POST' && path === '/redeem') {
    const auth = requireAuth(event, 'user');
    const payload = verifyQr(bodyOf(event).qrPayload || '');
    if (payload.kind === 'payment') {
      const amount = positiveInt(payload.amount, '결제 금액');
      await processPayment(auth.sub, amount, `payment:${payload.qid}`, `${amount} C QR 결제`);
    } else if (payload.kind === 'game') {
      await completeGame(auth.sub, payload.gameId);
    } else {
      throw new AppError(400, 'INVALID_QR', 'ZIP! MARKET 결제 또는 게임 QR이 아닙니다.');
    }
    return json(200, { ok: true, ...(await userSnapshot(auth.sub)) });
  }

  if (path.startsWith('/admin/')) requireAuth(event, 'admin');

  if (method === 'GET' && (path === '/admin/snapshot' || path === '/admin/bootstrap')) {
    return json(200, { ok: true, ...(await adminSnapshot()) });
  }

  if (method === 'POST' && path === '/admin/participants') {
    const input = bodyOf(event);
    const list = Array.isArray(input.participants) ? input.participants : [input];
    if (!list.length || list.length > 500) throw new AppError(400, 'INVALID_PARTICIPANTS', '참가자 목록이 올바르지 않습니다.');
    const rows = list.map(item => {
      const employeeNo = String(item.employeeId || item.employeeNo || '').trim();
      const name = String(item.name || '').trim();
      const password = String(item.password || '');
      if (!employeeNo || !name || !password) throw new AppError(400, 'PARTICIPANT_INPUT_REQUIRED', '사번, 이름, 비밀번호를 모두 입력해 주세요.');
      return { employeeNo, name, password, credits: nonNegativeInt(item.credits || 0) };
    });
    try {
      await rpc('zip_market_create_participants', { p_participants: rows });
    } catch (error) {
      if (/DUPLICATE_EMPLOYEE_ID|duplicate|unique/i.test(error.detail || '')) throw new AppError(409, 'DUPLICATE_EMPLOYEE_ID', '이미 등록된 사번이 포함되어 있습니다.');
      throw error;
    }
    return json(201, { ok: true, ...(await adminSnapshot()) });
  }

  let match = path.match(/^\/admin\/participants\/([0-9a-f-]+)$/i);
  if (method === 'DELETE' && match) {
    await db(`participants?id=eq.${filter(match[1])}`, { method: 'DELETE', prefer: 'return=minimal' });
    return json(200, { ok: true });
  }

  match = path.match(/^\/admin\/participants\/([0-9a-f-]+)\/credit$/i);
  if (method === 'POST' && match) {
    const amount = Number(bodyOf(event).amount);
    if (!Number.isSafeInteger(amount) || amount === 0) throw new AppError(400, 'INVALID_AMOUNT', '조정 금액이 올바르지 않습니다.');
    await adjustCredit(match[1], amount);
    return json(200, { ok: true, ...(await adminSnapshot()) });
  }

  if (method === 'POST' && path === '/admin/games') {
    const input = bodyOf(event);
    const name = String(input.name || '').trim();
    if (!name) throw new AppError(400, 'GAME_NAME_REQUIRED', '게임 이름을 입력해 주세요.');
    const base = { name, image_url: String(input.imageUrl || '').trim() || '/assets/game-default.webp?v=8' };
    try {
      await db('games', { method: 'POST', body: { ...base, reward: nonNegativeInt(input.reward ?? 100) }, prefer: 'return=minimal' });
    } catch (error) {
      if (!/reward.*does not exist|column.*reward|schema cache/i.test(error.detail || '')) throw error;
      await db('games', { method: 'POST', body: base, prefer: 'return=minimal' });
    }
    return json(201, { ok: true, ...(await adminSnapshot()) });
  }

  match = path.match(/^\/admin\/games\/([0-9a-f-]+)$/i);
  if (method === 'DELETE' && match) {
    await db(`game_completions?game_id=eq.${filter(match[1])}`, { method: 'DELETE', prefer: 'return=minimal' });
    await db(`games?id=eq.${filter(match[1])}`, { method: 'DELETE', prefer: 'return=minimal' });
    return json(200, { ok: true });
  }

  if (method === 'POST' && path === '/admin/payment-qr') {
    const amount = positiveInt(bodyOf(event).amount, '결제 금액');
    return json(200, {
      ok: true,
      qrPayload: signQr({ kind: 'payment', qid: randomUUID(), amount }, '8h'),
      caption: `${amount.toLocaleString('ko-KR')} C 결제`
    });
  }

  match = path.match(/^\/admin\/games\/([0-9a-f-]+)\/qr$/i);
  if (method === 'POST' && match) {
    const rows = await db(`games?id=eq.${filter(match[1])}&select=id,name&limit=1`);
    if (!rows?.[0]) throw new AppError(404, 'GAME_NOT_FOUND', '게임을 찾을 수 없습니다.');
    return json(200, {
      ok: true,
      qrPayload: signQr({ kind: 'game', gameId: match[1] }, '365d'),
      caption: `${rows[0].name} 완료 QR`
    });
  }

  if ((method === 'POST' || method === 'PUT') && path === '/admin/password') {
    const password = String(bodyOf(event).password || '');
    if (password.length < 4) throw new AppError(400, 'PASSWORD_TOO_SHORT', '비밀번호는 4자 이상이어야 합니다.');
    await rpc('zip_market_set_admin_password', { p_password: password });
    return json(200, { ok: true });
  }

  throw new AppError(404, 'NOT_FOUND', '요청한 API를 찾을 수 없습니다.');
}

export const handler = async event => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: { allow: 'GET,POST,PUT,PATCH,DELETE,OPTIONS' }, body: '' };
  }
  try {
    return await route(event);
  } catch (error) {
    console.error('[ZIP API]', error.code || error.name, safeDetail(error.detail || error.message));
    const known = error instanceof AppError;
    return json(known ? error.status : 500, {
      ok: false,
      code: known ? error.code : 'SERVER_ERROR',
      message: known ? error.message : '서버 처리 중 오류가 발생했습니다.',
      detail: known ? safeDetail(error.detail) : safeDetail(error.message)
    });
  }
};
