import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../public/qr-payload.js', import.meta.url), 'utf8');
const context = { URL, globalThis: {} };
vm.runInNewContext(source, context, { filename: 'qr-payload.js' });
const { parse, serialize, normalizeGameId, identifierVariants } = context.globalThis.ZipMarketQr;

const paymentText = serialize({ type: 'payment', amount: 275, description: '플리마켓 결제' });
assert.match(paymentText, /^ZIPMARKET\|PAY\|275\|/);
assert.deepEqual(JSON.parse(JSON.stringify(parse(paymentText))), {
  app: 'zip-market', v: 2, type: 'payment', amount: 275, description: '플리마켓 결제'
});

const gameText = serialize({ type: 'game', gameId: 'balloon' });
assert.equal(gameText, 'ZIPMARKET|GAME|balloon');
assert.equal(parse(gameText).gameId, 'balloon', 'legacy text game IDs must remain valid');

const canonicalPublicId = 'game-pingpong-3f12ab90';
const canonicalText = serialize({ type: 'game', publicId: canonicalPublicId });
assert.equal(canonicalText, `ZIPMARKET|GAME|${canonicalPublicId}`);
assert.equal(parse(canonicalText).publicId, canonicalPublicId, 'canonical game- prefix must never be stripped');
assert.equal(normalizeGameId(canonicalPublicId), canonicalPublicId, 'game- is identifier data, not a protocol wrapper');
assert.ok(identifierVariants(canonicalPublicId).includes('pingpong-3f12ab90'), 'already printed v8.8 stripped alias must stay compatible');

const uuid = '22222222-2222-2222-2222-222222222222';
assert.equal(parse(JSON.stringify({ app: 'zip-market', v: 1, type: 'game', gameId: uuid })).gameId, uuid);
assert.equal(parse(JSON.stringify({ app: 'ZIP! MARKET', type: 'payment', amount: 100, description: '100C' })).amount, 100);
assert.equal(parse('zip-market://game?gameId=pingpong').gameId, 'pingpong');
assert.equal(parse('https://example.test/qr?type=payment&amount=300&description=QR%20PAY').description, 'QR PAY');

// Current and previously generated game-completion payloads remain valid.
const legacyGameCases = new Map([
  ['GAME:pingpong', 'pingpong'],
  ['ZIP_MARKET_GAME:pingpong', 'pingpong'],
  ['zipmarket:game:pingpong', 'pingpong'],
  ['ZIP! MARKET|GAME_COMPLETE|pingpong', 'pingpong'],
  [JSON.stringify({ type: 'game', id: 'pingpong' }), 'pingpong'],
  [JSON.stringify({ kind: 'game_complete', public_id: 'pingpong' }), 'pingpong'],
  [JSON.stringify({ app: 'zip_market', action: 'completion', game_slug: 'pingpong' }), 'pingpong'],
  [JSON.stringify({ payload: JSON.stringify({ type: 'game', gameId: uuid }) }), uuid],
  ['https://example.test/game/pingpong', 'pingpong']
]);
for (const [payload, expected] of legacyGameCases) assert.equal(parse(payload).gameId, expected, payload);
assert.equal(normalizeGameId(' ZIPMARKET|GAME|pingpong '), 'pingpong');
assert.equal(normalizeGameId('game_complete:pingpong'), 'pingpong');

// Do not broaden payment parsing: an app marker is still required for payment.
assert.throws(() => parse('https://example.test/not-a-market-code'), /ZIP! MARKET/);
assert.throws(() => parse('{"type":"payment","amount":100}'), /ZIP! MARKET/);
assert.throws(() => parse('PAY:100'), /ZIP! MARKET/);

console.log('qr-payload.test: current/legacy round trips, ID/slug/UUID normalization, payment safety and rejection paths passed');
