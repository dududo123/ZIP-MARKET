/* ZIP! MARKET Netlify modern Function response repair
 * Replace the existing netlify/functions/api.* entry with this .mjs file.
 * This adapter guarantees every invocation returns a Web Response.
 */

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

function env() {
  return {
    url: process.env.SUPABASE_URL || '',
    key: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    jwt: process.env.JWT_SECRET || '',
    admin: process.env.INITIAL_ADMIN_PASSWORD || ''
  };
}

async function supabase(path, { method = 'GET', body, headers = {} } = {}) {
  const e = env();
  if (!e.url || !e.key) throw new Error('SUPABASE_ENV_MISSING');
  const res = await fetch(`${e.url}${path}`, {
    method,
    headers: {
      apikey: e.key,
      authorization: `Bearer ${e.key}`,
      'content-type': 'application/json',
      ...headers
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = data?.message || data?.msg || data?.error_description || data?.error || text || `HTTP_${res.status}`;
    const er = new Error(msg); er.status = res.status; er.detail = data; throw er;
  }
  return data;
}

async function rpc(name, args = {}) {
  return supabase(`/rest/v1/rpc/${encodeURIComponent(name)}`, { method: 'POST', body: args });
}

async function handler(req) {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api\/?/, '');

  // Robust health endpoint: never returns a legacy object.
  if (path === 'health') {
    const e = env();
    const out = {
      ok: false,
      database: false,
      environment: { supabaseUrl: !!e.url, supabaseKey: !!e.key, jwtSecret: !!e.jwt, initialAdminPassword: !!e.admin },
      transport: 'direct-rest',
      runtime: 'netlify-modern-response',
      version: '8.2.1-response-fix'
    };
    try {
      await supabase('/rest/v1/app_settings?select=key&limit=1');
      out.database = true;
      // Verify repaired RPC actually exists. This is idempotent according to the v8.2 contract.
      if (e.admin) await rpc('zip_market_initialize_admin', { p_initial_password: e.admin });
      out.adminInitialized = true;
      out.ok = true;
      return json(out);
    } catch (error) {
      out.code = String(error.message || '').includes('schema cache') || String(error.message || '').includes('function') ? 'SCHEMA_MISSING' : 'BACKEND_ERROR';
      out.message = error.message || 'Backend error';
      out.detail = error.detail || null;
      return json(out, 500);
    }
  }

  // Forward login RPCs used by the v8.2 frontend.
  if (path === 'admin/login' && req.method === 'POST') {
    try {
      const b = await req.json(); const e = env();
      const result = await rpc('zip_market_auth_admin', { p_initial_password: e.admin, p_password: String(b.password || '') });
      return json({ ok: true, result });
    } catch (error) { return json({ ok: false, error: error.message, detail: error.detail || null }, error.status === 401 ? 401 : 500); }
  }
  if (path === 'login' && req.method === 'POST') {
    try {
      const b = await req.json();
      const result = await rpc('zip_market_auth_participant', { p_employee_no: String(b.employeeNo || ''), p_password: String(b.password || '') });
      return json({ ok: true, result });
    } catch (error) { return json({ ok: false, error: error.message, detail: error.detail || null }, error.status === 401 ? 401 : 500); }
  }

  return json({ ok: false, error: 'NOT_FOUND', path }, 404);
}

export default async (req) => {
  try {
    const response = await handler(req);
    if (response instanceof Response) return response;
    return json({ ok: false, error: 'INVALID_HANDLER_RESPONSE' }, 500);
  } catch (error) {
    console.error('ZIP_MARKET_FUNCTION_ERROR', error);
    return json({ ok: false, error: error?.message || 'SERVER_ERROR' }, 500);
  }
};

export const config = { path: '/api/*' };
