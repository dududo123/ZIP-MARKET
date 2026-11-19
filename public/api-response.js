(() => {
  'use strict';

  class ApiResponseError extends Error {
    constructor(message, options = {}) {
      super(message);
      this.name = 'ApiResponseError';
      this.code = options.code || 'API_RESPONSE_ERROR';
      this.status = Number(options.status) || 0;
      this.detail = options.detail || '';
      this.retryable = Boolean(options.retryable);
    }
  }

  function parseJsonText(text, status = 0) {
    const clean = String(text ?? '').replace(/^\uFEFF/, '').trim();
    if (!clean) return {};
    if (/^<!doctype\s+html|^<html[\s>]/i.test(clean)) {
      throw new ApiResponseError(`서버가 JSON 대신 HTML을 반환했습니다. (HTTP ${status || '?'})`, {
        code: 'NON_JSON_RESPONSE', status, retryable: true
      });
    }

    let value = clean;
    for (let depth = 0; depth < 3 && typeof value === 'string'; depth += 1) {
      try { value = JSON.parse(value); }
      catch {
        throw new ApiResponseError(`서버 응답을 JSON으로 해석할 수 없습니다. (HTTP ${status || '?'})`, {
          code: 'NON_JSON_RESPONSE', status, retryable: true
        });
      }
    }
    return value;
  }

  function decodeBase64(value) {
    try {
      if (typeof atob === 'function') return decodeURIComponent(Array.from(atob(value), c => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`).join(''));
      return value;
    } catch { return value; }
  }

  function normalizePayload(payload, httpStatus = 200) {
    let status = Number(httpStatus) || 200;
    let data = payload;

    // Netlify legacy Function envelopes can be returned by a proxy as JSON.
    // Unwrap them so both old and modern deployments remain readable.
    if (data && typeof data === 'object' && !Array.isArray(data)
        && Object.prototype.hasOwnProperty.call(data, 'statusCode')
        && Object.prototype.hasOwnProperty.call(data, 'body')) {
      status = Number(data.statusCode) || status;
      let body = data.body;
      if (data.isBase64Encoded && typeof body === 'string') body = decodeBase64(body);
      data = typeof body === 'string' ? parseJsonText(body, status) : (body ?? {});
    }

    if (typeof data === 'string') data = parseJsonText(data, status);
    return { status, data: data ?? {} };
  }

  async function readApiResponse(response) {
    const text = await response.text();
    const parsed = parseJsonText(text, response.status);
    const normalized = normalizePayload(parsed, response.status);
    const ok = response.ok && normalized.status >= 200 && normalized.status < 300;

    if (!ok) {
      const body = normalized.data && typeof normalized.data === 'object' ? normalized.data : {};
      const message = body.message || body.error || `요청을 처리하지 못했습니다. (HTTP ${normalized.status})`;
      throw new ApiResponseError(body.detail ? `${message} (${body.detail})` : message, {
        code: body.code || 'API_REQUEST_FAILED',
        status: normalized.status,
        detail: body.detail || '',
        retryable: normalized.status === 404
      });
    }

    if (!normalized.data || typeof normalized.data !== 'object' || Array.isArray(normalized.data)) {
      throw new ApiResponseError('서버 응답 형식이 올바르지 않습니다.', {
        code: 'INVALID_API_SHAPE', status: normalized.status
      });
    }
    return normalized.data;
  }

  globalThis.ZipMarketApiResponse = { ApiResponseError, parseJsonText, normalizePayload, readApiResponse };
})();
