import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const qrSource = await readFile(new URL('../public/qr-payload.js', import.meta.url), 'utf8');
const context = { URL, globalThis: {} };
vm.runInNewContext(qrSource, context, { filename: 'qr-payload.js' });
const { parse, serialize, identifierVariants, safeAlias } = context.globalThis.ZipMarketQr;

const games = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    slug: 'pingpong-91c1f30d',
    public_id: 'game-pingpong-91c1f30d',
    name: '탁구공 넣기', reward: 100
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    slug: 'game-2c12d430bba9',
    public_id: 'game-2c12d430bba9',
    name: '랜덤게임', reward: 100
  }
];

const variants = value => new Set(identifierVariants(value));
const rowIdentifiers = game => [game.id, game.slug, game.public_id, game.name, safeAlias(game.name)];
function resolveGame(identifier) {
  const wanted = variants(identifier);
  const matches = games.filter(game => rowIdentifiers(game).some(value => identifierVariants(value).some(alias => wanted.has(alias))));
  if (matches.length !== 1) throw new Error(matches.length ? 'GAME_IDENTIFIER_AMBIGUOUS' : 'GAME_NOT_FOUND');
  return matches[0];
}
function selectedMatches(scannedIdentifier, selectedGame) {
  return resolveGame(scannedIdentifier).id === selectedGame.id;
}
function complete(db, participantId, scannedIdentifier) {
  const game = resolveGame(scannedIdentifier);
  if (db.completions.some(row => row.participant_id === participantId && row.game_id === game.id)) throw new Error('ALREADY_COMPLETED');
  const person = db.participants.find(row => row.id === participantId);
  if (!person) throw new Error('PARTICIPANT_NOT_FOUND');
  db.completions.push({ participant_id: participantId, game_id: game.id, reward: game.reward });
  person.credit_balance += game.reward;
  db.transactions.push({ participant_id: participantId, amount: game.reward, reference: `game:${game.id}` });
  return game;
}

// Screenshot scenario: administrator QR uses canonical public_id for 탁구공 넣기.
const pingpong = games[0];
const canonicalPingpongQr = serialize({ type: 'game', publicId: pingpong.public_id });
assert.equal(canonicalPingpongQr, 'ZIPMARKET|GAME|game-pingpong-91c1f30d');
const canonicalPayload = parse(canonicalPingpongQr);
assert.equal(canonicalPayload.gameId, pingpong.public_id);
assert.equal(resolveGame(canonicalPayload.gameId).id, pingpong.id);
assert.equal(selectedMatches(canonicalPayload.gameId, pingpong), true, 'per-game scanner must accept canonical admin QR');

// Compatibility: v8.8 printed QR lost the game- data prefix.
const alreadyPrinted = parse('ZIPMARKET|GAME|pingpong-91c1f30d');
assert.equal(resolveGame(alreadyPrinted.gameId).id, pingpong.id);
assert.equal(selectedMatches(alreadyPrinted.gameId, pingpong), true, 'per-game scanner must accept already printed QR');

// Name-safe legacy alias and UUID are resolved before selected-game comparison.
assert.equal(resolveGame('탁구공-넣기').id, pingpong.id);
assert.equal(resolveGame(pingpong.id).id, pingpong.id);
assert.equal(selectedMatches('랜덤게임', pingpong), false, 'per-game scanner must still reject another game');

// Newly added/default-image game works in both general and per-game scanners.
const newGame = games[1];
const newGamePayload = parse(serialize({ type: 'game', publicId: newGame.public_id }));
assert.equal(resolveGame(newGamePayload.gameId).id, newGame.id, 'general scanner resolution failed for new game');
assert.equal(selectedMatches(newGamePayload.gameId, newGame), true, 'per-game scanner resolution failed for new game');
assert.equal(resolveGame('2c12d430bba9').id, newGame.id, 'v8.8 stripped new-game QR must remain valid');

// Completion, reward and duplicate blocking.
const db = { participants: [{ id: 'p1', credit_balance: 500 }], completions: [], transactions: [] };
complete(db, 'p1', canonicalPayload.gameId);
assert.equal(db.participants[0].credit_balance, 600);
assert.equal(db.completions[0].game_id, pingpong.id);
assert.equal(db.transactions[0].amount, 100);
const beforeDuplicate = structuredClone(db);
assert.throws(() => complete(db, 'p1', alreadyPrinted.gameId), /ALREADY_COMPLETED/);
assert.deepEqual(db, beforeDuplicate, 'duplicate scan must not add credit, completion, or transaction');
complete(db, 'p1', newGamePayload.gameId);
assert.equal(db.participants[0].credit_balance, 700);

// Payment QR behavior is intentionally unchanged.
const payment = parse(serialize({ type: 'payment', amount: 300, description: '300C 결제' }));
assert.deepEqual(JSON.parse(JSON.stringify(payment)), { app: 'zip-market', v: 2, type: 'payment', amount: 300, description: '300C 결제' });

assert.throws(() => resolveGame('does-not-exist'), /GAME_NOT_FOUND/);
console.log('game-identity-e2e.test: 탁구공 넣기, new games, general/per-game scanners, canonical and printed QR aliases, reward, duplicate block, payment preservation, and no false GAME_NOT_FOUND passed');
