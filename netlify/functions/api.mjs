import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

const VERSION = '8.6.0';
const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, authorization',
  'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS'
};

class ApiError extends Error {
  constructor(status, code, message, detail) {
    super(message);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

const friendlyDatabaseError = (error) => {
  const detail = String(error?.detail || error?.message || '');
  const rowMatch = detail.match(/ROW_(\d+):\s*([A-Z_]+)(?:\s*\(([^)]+)\))?/i);
  const labels = {
    EMPLOYEE_NO_REQUIRED: '사번이 없습니다.',
    NAME_REQUIRED: '이름이 없습니다.',
    PASSWORD_REQUIRED: '비밀번호가 없습니다.',
    INVALID_INITIAL_CREDIT: '초기 크레딧은 0 이상의 정수여야 합니다.',
    DUPLICATE_EMPLOYEE_NO_IN_FILE: 'Excel 내용에 같은 사번이 중복되어 있습니다.',
    EMPLOYEE_NO_ALREADY_EXISTS: '이미 등록된 사번입니다.'
  };
  if (rowMatch) {
    const row = Number(rowMatch[1]);
    const code = rowMatch[2].toUpperCase();
    const employeeNo = rowMatch[3] ? ` (${rowMatch[3]})` : '';
    return new ApiError(code.includes('DUPLICATE') || code.includes('ALREADY_EXISTS') ? 409 : 400, code, `${row}행: ${labels[code] || code}${employeeNo}`, detail);
  }
  if (/EMPLOYEE_NO_ALREADY_EXISTS|duplicate key|participants_employee/i.test(detail)) {
    return new ApiError(409, 'EMPLOYEE_NO_ALREADY_EXISTS', '이미 등록된 사번입니다.', detail);
  }
  if (/INSUFFICIENT_CREDIT/i.test(detail)) return new ApiError(409, 'INSUFFICIENT_CREDIT', '크레딧이 부족합니다.', detail);
  if (/ALREADY_COMPLETED|game_completions_participant_game/i.test(detail)) return new ApiError(409, 'ALREADY_COMPLETED', '이미 완료한 게임입니다.', detail);
  if (/GAME_NOT_FOUND/i.test(detail)) return new ApiError(404, 'GAME_NOT_FOUND', '게임을 찾을 수 없습니다.', detail);
  if (/PARTICIPANT_NOT_FOUND/i.test(detail)) return new ApiError(404, 'PARTICIPANT_NOT_FOUND', '참가자를 찾을 수 없습니다.', detail);
  return error;
};

const env = () => ({
  supabaseUrl: (process.env.SUPABASE_URL || '').replace(/\/$/, ''),
  supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  jwtSecret: process.env.JWT_SECRET || '',
  initialAdminPassword: process.env.INITIAL_ADMIN_PASSWORD || ''
});

const response = (status, body, extraHeaders = {}) => new Response(
  status === 204 ? null : JSON.stringify(body),
  { status, headers: { ...JSON_HEADERS, ...extraHeaders } }
);

const safeJson = async (request) => {
  const value = await request.text();
  if (!value) return {};
  try { return JSON.parse(value); }
  catch { throw new ApiError(400, 'INVALID_JSON', '요청 본문이 올바른 JSON이 아닙니다.'); }
};

const b64url = (value) => Buffer.from(value).toString('base64url');
const signToken = (payload) => {
  const { jwtSecret } = env();
  const now = Math.floor(Date.now() / 1000);
  const encodedHeader = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const encodedPayload = b64url(JSON.stringify({ ...payload, iat: now, exp: now + 60 * 60 * 12 }));
  const input = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac('sha256', jwtSecret).update(input).digest('base64url');
  return `${input}.${signature}`;
};

const verifyToken = (request, requiredRole) => {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) throw new ApiError(401, 'AUTH_REQUIRED', '로그인이 필요합니다.');
  const parts = token.split('.');
  if (parts.length !== 3) throw new ApiError(401, 'INVALID_TOKEN', '로그인 정보가 올바르지 않습니다.');
  const { jwtSecret } = env();
  const expected = createHmac('sha256', jwtSecret).update(`${parts[0]}.${parts[1]}`).digest();
  const actual = Buffer.from(parts[2], 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new ApiError(401, 'INVALID_TOKEN', '로그인 정보가 만료되었거나 올바르지 않습니다.');
  }
  let payload;
  try { payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); }
  catch { throw new ApiError(401, 'INVALID_TOKEN', '로그인 정보가 올바르지 않습니다.'); }
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) throw new ApiError(401, 'TOKEN_EXPIRED', '로그인이 만료되었습니다.');
  if (requiredRole && payload.role !== requiredRole) throw new ApiError(403, 'FORBIDDEN', '접근 권한이 없습니다.');
  return payload;
};

async function supabase(path, options = {}) {
  const { supabaseUrl, supabaseKey } = env();
  const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    method: options.method || 'GET',
    headers: {
      apikey: supabaseKey,
      authorization: `Bearer ${supabaseKey}`,
      'content-type': 'application/json',
      accept: 'application/json',
      ...(options.prefer ? { Prefer: options.prefer } : {}),
      ...(options.headers || {})
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); }
    catch { data = text; }
  }
  if (!res.ok) {
    const detail = typeof data === 'string' ? data : [data?.message, data?.details, data?.hint].filter(Boolean).join(' | ');
    const missing = res.status === 404 || data?.code === 'PGRST202' || /schema cache|Could not find the function/i.test(detail || '');
    throw new ApiError(missing ? 503 : res.status, missing ? 'SCHEMA_MISSING' : (data?.code || 'DATABASE_ERROR'), missing ? 'Supabase schema.sql이 적용되지 않았습니다.' : '데이터베이스 요청에 실패했습니다.', detail);
  }
  return data;
}

const rpc = (name, args = {}) => supabase(`rpc/${name}`, { method: 'POST', body: args });
const query = (table, search) => supabase(`${table}?${search}`);

const normalizePath = (request) => {
  let path = new URL(request.url).pathname || '/';
  path = path.replace(/^\/\.netlify\/functions\/api/, '').replace(/^\/api/, '');
  return path || '/';
};

const normalizeRpcResult = (value) => Array.isArray(value) && value.length === 1 ? value[0] : value;

const requireEnvironment = () => {
  const config = env();
  const missing = Object.entries(config).filter(([, value]) => !value).map(([key]) => key);
  if (missing.length) throw new ApiError(500, 'ENV_MISSING', 'Netlify 환경변수가 누락되었습니다.', missing.join(', '));
  return config;
};

async function health() {
  const config = requireEnvironment();
  const initialized = normalizeRpcResult(await rpc('zip_market_initialize_admin', { p_initial_password: config.initialAdminPassword }));
  return {
    ok: true,
    environment: { supabaseUrl: true, supabaseKey: true, jwtSecret: true, initialAdminPassword: true },
    database: true,
    adminInitialized: Boolean(initialized?.initialized),
    adminCreatedNow: Boolean(initialized?.createdNow),
    transport: 'direct-rest',
    runtime: 'netlify-modern-response',
    schema: 'zip-market-v8.6',
    version: VERSION
  };
}

async function participantDashboard(participantId) {
  const id = encodeURIComponent(participantId);
  const [people, transactions, games, completions] = await Promise.all([
    query('participants', `select=id,employee_no,name,credit_balance,created_at&id=eq.${id}&limit=1`),
    query('transactions', `select=id,amount,type,description,balance_after,created_at&participant_id=eq.${id}&order=created_at.desc&limit=100`),
    query('games', 'select=id,name,image_url,created_at&order=created_at.asc'),
    query('game_completions', `select=game_id,completed_at&participant_id=eq.${id}`)
  ]);
  if (!people?.[0]) throw new ApiError(404, 'PARTICIPANT_NOT_FOUND', '참가자를 찾을 수 없습니다.');
  return { participant: people[0], transactions: transactions || [], games: games || [], completions: completions || [] };
}

async function adminDashboard(search = '') {
  const filter = search
    ? `&or=(employee_no.ilike.*${encodeURIComponent(search)}*,name.ilike.*${encodeURIComponent(search)}*)`
    : '';
  const [participants, games] = await Promise.all([
    query('participants', `select=id,employee_no,name,credit_balance,created_at&order=created_at.desc${filter}`),
    query('games', 'select=id,name,image_url,created_at&order=created_at.asc')
  ]);
  return { participants: participants || [], games: games || [] };
}

async function route(request) {
  requireEnvironment();
  const url = new URL(request.url);
  const path = normalizePath(request);
  const method = request.method.toUpperCase();
  const body = ['POST', 'PUT', 'PATCH'].includes(method) ? await safeJson(request) : {};

  if (method === 'OPTIONS') return response(204, {});
  if (method === 'GET' && path === '/health') return response(200, await health());

  if (method === 'POST' && path === '/auth/admin') {
    const { initialAdminPassword } = env();
    const result = normalizeRpcResult(await rpc('zip_market_auth_admin', { p_initial_password: initialAdminPassword, p_password: String(body.password || '') }));
    if (!result?.authenticated) throw new ApiError(401, 'LOGIN_FAILED', '관리자 비밀번호가 올바르지 않습니다.');
    return response(200, { ok: true, role: 'admin', token: signToken({ role: 'admin', sub: 'admin' }) });
  }

  if (method === 'POST' && path === '/auth/participant') {
    const result = normalizeRpcResult(await rpc('zip_market_auth_participant', { p_employee_no: String(body.employeeNo || ''), p_password: String(body.password || '') }));
    if (!result?.authenticated || !result?.participant?.id) throw new ApiError(401, 'LOGIN_FAILED', '사번 또는 비밀번호가 올바르지 않습니다.');
    const token = signToken({ role: 'participant', sub: result.participant.id, employeeNo: result.participant.employee_no });
    const dashboard = await participantDashboard(result.participant.id);
    return response(200, { ok: true, role: 'participant', token, ...dashboard });
  }

  if (method === 'GET' && path === '/participant/dashboard') {
    const auth = verifyToken(request, 'participant');
    return response(200, { ok: true, ...(await participantDashboard(auth.sub)) });
  }

  if (method === 'POST' && path === '/participant/pay') {
    const auth = verifyToken(request, 'participant');
    const amount = Number(body.amount);
    if (!Number.isInteger(amount) || amount <= 0) throw new ApiError(400, 'INVALID_AMOUNT', '결제 금액이 올바르지 않습니다.');
    const suppliedRequestId = String(body.requestId || '').trim();
    if (suppliedRequestId && !/^[A-Za-z0-9._-]{8,100}$/.test(suppliedRequestId)) throw new ApiError(400, 'INVALID_REQUEST_ID', '결제 요청 정보가 올바르지 않습니다.');
    const requestId = suppliedRequestId || `legacy-${randomUUID()}`;
    try {
      const result = await rpc('zip_market_pay_credit', { p_participant_id: auth.sub, p_amount: amount, p_description: String(body.description || `${amount}C 결제`), p_request_id: requestId });
      return response(200, { ok: true, result, ...(await participantDashboard(auth.sub)) });
    } catch (error) { throw friendlyDatabaseError(error); }
  }

  if (method === 'POST' && path === '/participant/complete-game') {
    const auth = verifyToken(request, 'participant');
    const gameId = String(body.gameId || '').trim();
    if (!gameId || gameId.length > 200) throw new ApiError(400, 'INVALID_GAME_ID', '게임 정보가 없습니다.');
    try {
      const result = await rpc('zip_market_complete_game', { p_participant_id: auth.sub, p_game_id: gameId });
      return response(200, { ok: true, result, ...(await participantDashboard(auth.sub)) });
    } catch (error) { throw friendlyDatabaseError(error); }
  }

  if (path.startsWith('/admin')) verifyToken(request, 'admin');

  if (method === 'GET' && path === '/admin/dashboard') {
    return response(200, { ok: true, ...(await adminDashboard(url.searchParams.get('search') || '')) });
  }

  if (method === 'POST' && path === '/admin/participants') {
    const employeeNo = String(body.employeeNo || '').trim();
    const name = String(body.name || '').trim();
    const password = String(body.password || '');
    const initialCreditText = String(body.initialCredit ?? '').trim();
    if (!employeeNo) throw new ApiError(400, 'EMPLOYEE_NO_REQUIRED', '사번을 입력해 주세요.');
    if (!name) throw new ApiError(400, 'NAME_REQUIRED', '이름을 입력해 주세요.');
    if (!password) throw new ApiError(400, 'PASSWORD_REQUIRED', '초기 비밀번호를 입력해 주세요.');
    if (!/^(0|[1-9]\d*)$/.test(initialCreditText)) throw new ApiError(400, 'INVALID_INITIAL_CREDIT', '초기 크레딧은 0 이상의 정수여야 합니다.');
    try {
      const person = await rpc('zip_market_admin_create_participant', {
        p_employee_no: employeeNo,
        p_name: name,
        p_password: password,
        p_initial_credit: Number(initialCreditText)
      });
      return response(201, { ok: true, participant: normalizeRpcResult(person) });
    } catch (error) {
      throw friendlyDatabaseError(error);
    }
  }

  if (method === 'POST' && path === '/admin/participants/bulk') {
    if (!Array.isArray(body.participants) || body.participants.length < 1 || body.participants.length > 500) {
      throw new ApiError(400, 'INVALID_BULK_DATA', 'Excel 등록 데이터는 1행 이상 500행 이하여야 합니다.');
    }
    const rows = body.participants.map((item, index) => ({
      employeeNo: String(item?.employeeNo || '').trim(),
      name: String(item?.name || '').trim(),
      password: String(item?.password || ''),
      initialCredit: item?.initialCredit
    }));
    for (let index = 0; index < rows.length; index += 1) {
      const item = rows[index];
      const row = index + 1;
      if (!item.employeeNo) throw new ApiError(400, 'EMPLOYEE_NO_REQUIRED', `${row}행: 사번이 없습니다.`);
      if (!item.name) throw new ApiError(400, 'NAME_REQUIRED', `${row}행: 이름이 없습니다.`);
      if (!item.password) throw new ApiError(400, 'PASSWORD_REQUIRED', `${row}행: 비밀번호가 없습니다.`);
      const creditText = String(item.initialCredit ?? '').trim();
      if (!/^(0|[1-9]\d*)$/.test(creditText)) throw new ApiError(400, 'INVALID_INITIAL_CREDIT', `${row}행: 초기 크레딧은 0 이상의 정수여야 합니다.`);
      item.initialCredit = Number(creditText);
      const first = rows.findIndex((candidate) => candidate.employeeNo === item.employeeNo);
      if (first !== index) throw new ApiError(409, 'DUPLICATE_EMPLOYEE_NO_IN_FILE', `${row}행: Excel 내용에 같은 사번이 중복되어 있습니다. (${item.employeeNo})`);
    }
    try {
      const result = normalizeRpcResult(await rpc('zip_market_admin_create_participants', { p_participants: rows }));
      return response(201, { ok: true, createdCount: Number(result?.createdCount || rows.length), results: result?.results || [] });
    } catch (error) {
      throw friendlyDatabaseError(error);
    }
  }

  const participantDelete = path.match(/^\/admin\/participants\/([0-9a-f-]+)$/i);
  if (method === 'DELETE' && participantDelete) {
    const participantId = encodeURIComponent(participantDelete[1]);
    // Explicit child deletion also repairs older schemas whose FKs were created without ON DELETE CASCADE.
    await supabase(`game_completions?participant_id=eq.${participantId}`, { method: 'DELETE', prefer: 'return=minimal' });
    await supabase(`transactions?participant_id=eq.${participantId}`, { method: 'DELETE', prefer: 'return=minimal' });
    await supabase(`participants?id=eq.${participantId}`, { method: 'DELETE', prefer: 'return=minimal' });
    return response(200, { ok: true });
  }

  const grantCredit = path.match(/^\/admin\/participants\/([0-9a-f-]+)\/credit$/i);
  if (method === 'POST' && grantCredit) {
    const amount = Number(body.amount);
    if (!Number.isInteger(amount) || amount <= 0) throw new ApiError(400, 'INVALID_AMOUNT', '지급 금액이 올바르지 않습니다.');
    const result = await rpc('zip_market_grant_credit', { p_participant_id: grantCredit[1], p_amount: amount, p_description: String(body.description || '관리자 지급') });
    return response(200, { ok: true, result });
  }

  if (method === 'POST' && path === '/admin/password') {
    if (String(body.password || '').length < 4) throw new ApiError(400, 'PASSWORD_TOO_SHORT', '비밀번호는 4자 이상이어야 합니다.');
    await rpc('zip_market_set_admin_password', { p_password: String(body.password) });
    return response(200, { ok: true });
  }

  if (method === 'POST' && path === '/admin/games') {
    const name = String(body.name || '').trim();
    if (!name) throw new ApiError(400, 'GAME_NAME_REQUIRED', '게임 이름을 입력해 주세요.');
    const imageUrl = String(body.imageUrl || '/assets/game-default.svg').trim();
    const data = await supabase('games?select=id,name,image_url,created_at', { method: 'POST', prefer: 'return=representation', body: { name, image_url: imageUrl } });
    return response(201, { ok: true, game: data?.[0] });
  }

  const gameDelete = path.match(/^\/admin\/games\/([^/]{1,200})$/i);
  if (method === 'DELETE' && gameDelete) {
    const gameId = encodeURIComponent(decodeURIComponent(gameDelete[1]));
    await supabase(`game_completions?game_id=eq.${gameId}`, { method: 'DELETE', prefer: 'return=minimal' });
    await supabase(`games?id=eq.${gameId}`, { method: 'DELETE', prefer: 'return=minimal' });
    return response(200, { ok: true });
  }

  throw new ApiError(404, 'NOT_FOUND', '요청한 API를 찾을 수 없습니다.');
}

export default async function handler(request) {
  try {
    if (!(request instanceof Request)) {
      throw new ApiError(500, 'RUNTIME_REQUEST_ERROR', 'Netlify 요청 형식을 읽을 수 없습니다.');
    }
    return await route(request);
  } catch (error) {
    console.error('[ZIP MARKET API]', error.code || error.name, error.detail || error.message);
    const status = Number(error.status) || 500;
    const body = {
      ok: false,
      database: error.code === 'SCHEMA_MISSING' ? false : undefined,
      code: error.code || 'INTERNAL_ERROR',
      message: error.message || '서버 오류가 발생했습니다.',
      ...(error.detail ? { detail: error.detail } : {}),
      runtime: 'netlify-modern-response',
      version: VERSION
    };
    return response(status, body);
  }
}
