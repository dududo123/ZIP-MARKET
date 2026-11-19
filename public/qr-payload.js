(() => {
  'use strict';

  const APP = 'zip-market';

  const decode = (value) => {
    try { return decodeURIComponent(String(value || '')); }
    catch { return String(value || ''); }
  };

  const normalizeApp = (value) => String(value || '')
    .toLowerCase()
    .replace(/[!\s_.:/-]+/g, '');

  function normalizeObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

    if (typeof value.payload === 'string') {
      try { return parse(value.payload); }
      catch { return null; }
    }

    const app = normalizeApp(value.app || value.application || value.service);
    if (app !== 'zipmarket') return null;

    const rawType = String(value.type || value.kind || value.action || '').toLowerCase().replace(/[\s_-]+/g, '');
    if (['payment', 'pay', 'creditpayment'].includes(rawType)) {
      const amount = Number(value.amount ?? value.credit ?? value.credits);
      if (!Number.isSafeInteger(amount) || amount <= 0) return null;
      return {
        app: APP,
        v: Number(value.v || value.version || 1),
        type: 'payment',
        amount,
        description: String(value.description || value.label || `${amount}C 결제`)
      };
    }

    if (['game', 'gamecomplete', 'completion'].includes(rawType)) {
      const gameId = String(value.gameId ?? value.game_id ?? value.id ?? '').trim();
      if (!gameId || gameId.length > 200) return null;
      return {
        app: APP,
        v: Number(value.v || value.version || 1),
        type: 'game',
        gameId
      };
    }
    return null;
  }

  function parseCompact(text) {
    const parts = text.split('|');
    if (normalizeApp(parts[0]) !== 'zipmarket') return null;
    const type = String(parts[1] || '').toUpperCase();
    if (type === 'PAY' || type === 'PAYMENT') {
      const amount = Number(parts[2]);
      if (!Number.isSafeInteger(amount) || amount <= 0) return null;
      return { app: APP, v: 2, type: 'payment', amount, description: decode(parts.slice(3).join('|')) || `${amount}C 결제` };
    }
    if (type === 'GAME') {
      const gameId = decode(parts.slice(2).join('|')).trim();
      if (!gameId || gameId.length > 200) return null;
      return { app: APP, v: 2, type: 'game', gameId };
    }
    return null;
  }

  function parseUrl(text) {
    if (!/^(?:https?:\/\/|zip-market:|zipmarket:)/i.test(text)) return null;
    try {
      const url = new URL(text);
      const embedded = url.searchParams.get('qr') || url.searchParams.get('payload');
      if (embedded) return parse(embedded);
      if (url.hash && url.hash.length > 1) {
        try { return parse(decode(url.hash.slice(1))); }
        catch { /* continue with query/path */ }
      }
      const pathType = `${url.hostname}${url.pathname}`.toLowerCase();
      const type = url.searchParams.get('type') || (pathType.includes('game') ? 'game' : (pathType.includes('pay') ? 'payment' : ''));
      return normalizeObject({
        app: APP,
        type,
        amount: url.searchParams.get('amount') || url.searchParams.get('credit'),
        description: url.searchParams.get('description') || url.searchParams.get('label'),
        gameId: url.searchParams.get('gameId') || url.searchParams.get('game_id') || url.searchParams.get('id')
      });
    } catch { return null; }
  }

  function parse(input) {
    if (input && typeof input === 'object') {
      const normalized = normalizeObject(input);
      if (normalized) return normalized;
      throw new Error('ZIP! MARKET QR 코드가 아닙니다.');
    }

    const text = String(input ?? '').replace(/^\uFEFF/, '').trim();
    if (!text) throw new Error('QR 코드 내용이 비어 있습니다.');

    let parsed = parseCompact(text) || parseUrl(text);
    if (!parsed && /^[{[]/.test(text)) {
      try { parsed = normalizeObject(JSON.parse(text)); }
      catch { parsed = null; }
    }
    if (!parsed) throw new Error('ZIP! MARKET QR 코드가 아닙니다.');
    return parsed;
  }

  function serialize(payload) {
    const normalized = normalizeObject({ app: APP, ...payload });
    if (!normalized) throw new Error('QR 코드 정보가 올바르지 않습니다.');
    if (normalized.type === 'payment') {
      return `ZIPMARKET|PAY|${normalized.amount}|${encodeURIComponent(normalized.description || `${normalized.amount}C 결제`)}`;
    }
    return `ZIPMARKET|GAME|${encodeURIComponent(normalized.gameId)}`;
  }

  globalThis.ZipMarketQr = { parse, serialize, normalizeObject };
})();
