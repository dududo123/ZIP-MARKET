(() => {
  'use strict';

  const APP = 'zip-market';
  const GAME_TYPES = new Set(['game', 'gamecomplete', 'completion', 'completegame', 'gamecompletion']);
  const PAYMENT_TYPES = new Set(['payment', 'pay', 'creditpayment', 'purchase']);

  const decode = (value) => {
    let result = String(value ?? '');
    for (let count = 0; count < 3; count += 1) {
      try {
        const next = decodeURIComponent(result);
        if (next === result) break;
        result = next;
      } catch { break; }
    }
    return result;
  };

  const normalizeApp = (value) => String(value || '')
    .toLowerCase()
    .replace(/[!\s_.:/-]+/g, '');

  // Remove only unambiguous protocol wrappers. A stored identifier such as
  // "game-pingpong" or "game-<uuid>" is data, not a wrapper, and must survive.
  function normalizeGameId(value) {
    let result = decode(value).replace(/^\uFEFF/, '').trim();
    for (let count = 0; count < 3; count += 1) {
      const previous = result;
      result = result
        .replace(/^zip[!\s_.-]*market\s*\|\s*(?:game(?:[_\s-]*(?:complete|completion))?|completion|complete[_\s-]*game)\s*\|\s*/i, '')
        .replace(/^zip[!\s_.-]*market\s*[:/]\s*(?:game(?:[_\s-]*(?:complete|completion))?|completion|complete[_\s-]*game)\s*[:/]\s*/i, '')
        .replace(/^(?:game[_\s-]*(?:complete|completion)|completion|complete[_\s-]*game)\s*[:|/]\s*/i, '')
        .replace(/^game\s*[:|/]\s*/i, '')
        .trim();
      if (result === previous) break;
    }
    return result;
  }

  function safeAlias(value) {
    return normalizeGameId(value)
      .normalize('NFKC')
      .toLocaleLowerCase('en-US')
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '');
  }

  function identifierVariants(value) {
    const exact = normalizeGameId(value);
    if (!exact) return [];
    const variants = new Set([exact, exact.toLocaleLowerCase('en-US'), safeAlias(exact)]);
    if (/^game[-_:]/i.test(exact)) {
      const stripped = exact.replace(/^game[-_:]+/i, '');
      variants.add(stripped);
      variants.add(stripped.toLocaleLowerCase('en-US'));
      variants.add(safeAlias(stripped));
    } else {
      variants.add(`game-${exact}`);
      variants.add(`game-${exact.toLocaleLowerCase('en-US')}`);
    }
    return [...variants].filter(Boolean);
  }

  function normalizeObject(value, options = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

    if (value.payload !== undefined) {
      try { return parse(value.payload); }
      catch { /* continue with fields on the outer legacy object */ }
    }
    if (value.data && typeof value.data === 'object') {
      const nested = normalizeObject(value.data, { allowMissingApp: true });
      if (nested) return nested;
    }

    const appValue = value.app ?? value.application ?? value.service ?? value.product;
    const app = normalizeApp(appValue);
    const hasRecognizedApp = app === 'zipmarket';
    const rawType = String(value.type ?? value.kind ?? value.action ?? value.qrType ?? '').toLowerCase().replace(/[\s_-]+/g, '');
    const allowLegacyGame = GAME_TYPES.has(rawType) && (options.allowMissingApp || appValue == null);
    if (!hasRecognizedApp && !allowLegacyGame) return null;

    if (PAYMENT_TYPES.has(rawType)) {
      const amount = Number(value.amount ?? value.credit ?? value.credits ?? value.value);
      if (!Number.isSafeInteger(amount) || amount <= 0) return null;
      return {
        app: APP,
        v: Number(value.v || value.version || 1),
        type: 'payment',
        amount,
        description: String(value.description || value.label || value.name || `${amount}C 결제`)
      };
    }

    if (GAME_TYPES.has(rawType)) {
      const gameId = normalizeGameId(
        value.publicId ?? value.public_id ?? value.gamePublicId ?? value.game_public_id ??
        value.gameId ?? value.game_id ?? value.game ?? value.gameSlug ?? value.game_slug ??
        value.slug ?? value.id ?? value.value ?? ''
      );
      if (!gameId || gameId.length > 200) return null;
      return {
        app: APP,
        v: Number(value.v || value.version || 1),
        type: 'game',
        gameId,
        publicId: gameId
      };
    }
    return null;
  }

  function parseCompact(text) {
    const pipeParts = text.split('|');
    if (normalizeApp(pipeParts[0]) === 'zipmarket') {
      const type = String(pipeParts[1] || '').toUpperCase().replace(/[\s_-]+/g, '');
      if (type === 'PAY' || type === 'PAYMENT') {
        const amount = Number(pipeParts[2]);
        if (!Number.isSafeInteger(amount) || amount <= 0) return null;
        return { app: APP, v: 2, type: 'payment', amount, description: decode(pipeParts.slice(3).join('|')) || `${amount}C 결제` };
      }
      if (GAME_TYPES.has(type.toLowerCase())) {
        const gameId = normalizeGameId(pipeParts.slice(2).join('|'));
        if (!gameId || gameId.length > 200) return null;
        return { app: APP, v: 3, type: 'game', gameId, publicId: gameId };
      }
    }

    const legacy = text.match(/^(?:zip[!\s_.-]*market(?:\s*[:/]\s*|[_\s-]+))?(game(?:[_\s-]*(?:complete|completion))?|completion|complete[_\s-]*game)\s*[:|/]\s*(.+)$/i);
    if (legacy) {
      const gameId = normalizeGameId(legacy[2]);
      if (gameId && gameId.length <= 200) return { app: APP, v: 1, type: 'game', gameId, publicId: gameId };
    }
    return null;
  }

  function parseUrl(text) {
    if (!/^(?:https?:\/\/|zip-market:|zipmarket:)/i.test(text)) return null;
    try {
      const url = new URL(text);
      const embedded = url.searchParams.get('qr') || url.searchParams.get('payload') || url.searchParams.get('data');
      if (embedded) return parse(embedded);
      if (url.hash && url.hash.length > 1) {
        try { return parse(decode(url.hash.slice(1))); }
        catch { /* continue with query/path */ }
      }
      const pathType = `${url.hostname}${url.pathname}`.toLowerCase();
      const type = url.searchParams.get('type') || url.searchParams.get('kind') || (pathType.includes('game') ? 'game' : (pathType.includes('pay') ? 'payment' : ''));
      return normalizeObject({
        app: APP,
        type,
        amount: url.searchParams.get('amount') || url.searchParams.get('credit'),
        description: url.searchParams.get('description') || url.searchParams.get('label'),
        publicId: url.searchParams.get('publicId') || url.searchParams.get('public_id') || url.searchParams.get('gamePublicId'),
        gameId: url.searchParams.get('gameId') || url.searchParams.get('game_id') || url.searchParams.get('slug') || url.searchParams.get('id') || (pathType.includes('game') ? url.pathname.split('/').filter(Boolean).pop() : '')
      }, { allowMissingApp: true });
    } catch { return null; }
  }

  function parse(input) {
    if (input && typeof input === 'object') {
      const normalized = normalizeObject(input, { allowMissingApp: true });
      if (normalized) return normalized;
      throw new Error('ZIP! MARKET QR 코드가 아닙니다.');
    }

    const text = String(input ?? '').replace(/^\uFEFF/, '').trim();
    if (!text) throw new Error('QR 코드 내용이 비어 있습니다.');

    let parsed = parseCompact(text) || parseUrl(text);
    if (!parsed && /^[{[]/.test(text)) {
      try { parsed = normalizeObject(JSON.parse(text), { allowMissingApp: true }); }
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
    return `ZIPMARKET|GAME|${encodeURIComponent(normalized.publicId || normalized.gameId)}`;
  }

  globalThis.ZipMarketQr = { parse, serialize, normalizeObject, normalizeGameId, safeAlias, identifierVariants };
})();
