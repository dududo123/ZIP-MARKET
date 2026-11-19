import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../public/qr-payload.js', import.meta.url), 'utf8');
const context = { URL, globalThis: {} };
vm.runInNewContext(source, context, { filename: 'qr-payload.js' });
const { parse, serialize } = context.globalThis.ZipMarketQr;

const paymentText = serialize({ type: 'payment', amount: 275, description: '플리마켓 결제' });
assert.match(paymentText, /^ZIPMARKET\|PAY\|275\|/);
assert.deepEqual(JSON.parse(JSON.stringify(parse(paymentText))), {
  app: 'zip-market', v: 2, type: 'payment', amount: 275, description: '플리마켓 결제'
});

const gameText = serialize({ type: 'game', gameId: 'balloon' });
assert.equal(gameText, 'ZIPMARKET|GAME|balloon');
assert.equal(parse(gameText).gameId, 'balloon', 'legacy text game IDs must remain valid');

const uuid = '22222222-2222-2222-2222-222222222222';
assert.equal(parse(JSON.stringify({ app: 'zip-market', v: 1, type: 'game', gameId: uuid })).gameId, uuid);
assert.equal(parse(JSON.stringify({ app: 'ZIP! MARKET', type: 'payment', amount: 100, description: '100C' })).amount, 100);
assert.equal(parse('zip-market://game?gameId=pingpong').gameId, 'pingpong');
assert.equal(parse('https://example.test/qr?type=payment&amount=300&description=QR%20PAY').description, 'QR PAY');
assert.throws(() => parse('https://example.test/not-a-market-code'), /ZIP! MARKET/);
assert.throws(() => parse('{"type":"payment","amount":100}'), /ZIP! MARKET/);

console.log('qr-payload.test: compact, JSON, URL, payment, UUID/text game IDs and rejection paths passed');
