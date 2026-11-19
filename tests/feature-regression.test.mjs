import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';

const [html, app, css, api, schema] = await Promise.all([
  readFile(new URL('../public/index.html', import.meta.url),'utf8'),
  readFile(new URL('../public/app.js', import.meta.url),'utf8'),
  readFile(new URL('../public/styles.css', import.meta.url),'utf8'),
  readFile(new URL('../netlify/functions/api.mjs', import.meta.url),'utf8'),
  readFile(new URL('../supabase/schema-repair.sql', import.meta.url),'utf8')
]);

// Payment, transaction history and display.
for (const amount of ['100','200','300']) assert.match(html,new RegExp(`data-amount="${amount}"`),`payment ${amount}C missing`);
assert.ok(app.includes("slice(0,5)"),'transaction list must collapse to five rows');
assert.ok(app.includes('historyExpanded'),'transaction history expansion state missing');
assert.ok(app.includes('item.description')&&app.includes('item.amount')&&app.includes('item.created_at'),'transaction fields not rendered');
assert.ok(api.includes("'/participant/pay'"),'payment route missing');
assert.match(schema,/create function public\.zip_market_pay_credit[\s\S]*insert into public\.transactions/i,'atomic payment transaction missing');

// Games, QR and deletion.
for (const id of ['open-scanner','camera-start','qr-output','game-create-form','admin-games']) assert.ok(html.includes(`id="${id}"`),`${id} missing`);
assert.ok(!html.includes('id="qr-file"')&&!app.includes('scanFile'),'unused photo QR reader must remain removed');
assert.ok(app.includes('Html5Qrcode'),'iPhone-compatible QR scanner missing');
assert.ok(app.includes("payload.type==='payment'")&&app.includes("payload.type==='game'"),'payment/game QR dispatch missing');
assert.ok(app.includes('game-qr')&&app.includes('delete-game'),'game QR/delete controls missing');
assert.ok(app.includes('game-card-button')&&app.includes('openScannerFor(card.dataset.gameId'),'game card must launch its QR scanner');
assert.ok(api.includes("'/participant/complete-game'")&&api.includes("'/admin/games'"),'game API routes missing');
assert.match(schema,/create function public\.zip_market_complete_game[\s\S]*on conflict \(participant_id, game_id\) do nothing/i,'duplicate-safe game completion missing');

// Participant deletion and dependent cleanup.
const completionDelete=api.indexOf('game_completions?participant_id=eq.');
const transactionDelete=api.indexOf('transactions?participant_id=eq.');
const participantDelete=api.indexOf('participants?id=eq.');
assert.ok(completionDelete>=0&&completionDelete<transactionDelete&&transactionDelete<participantDelete,'participant child deletion order regressed');
assert.ok(app.includes('delete-participant'),'participant delete UI missing');
assert.ok(app.includes('resetFormSafely'),'null-safe administrator form reset missing');
assert.ok(app.includes('parseBulkParticipants'),'Excel row validation missing');
assert.ok(api.includes("rpc('zip_market_admin_create_participants'"),'atomic Excel bulk RPC route missing');

// Navigation, modals and back behavior.
assert.ok(app.includes("addEventListener('popstate'")||app.includes('addEventListener("popstate"'),'history popstate handler missing');
assert.ok(app.includes('history.pushState')&&app.includes('history.back()'),'internal history navigation missing');
for (const id of ['admin-login-modal','payment-modal','scanner-modal','qr-display-modal']) assert.ok(html.includes(`id="${id}"`),`${id} missing`);
assert.ok(html.includes('modal-close')&&app.includes("e.key==='Escape'"),'modal close controls missing');

// Fonts and responsive images.
assert.match(html,/family=Jua/i,'Jua web font missing');
assert.match(html,/pretendard/i,'Pretendard stylesheet missing');
assert.match(css,/font-family:Pretendard/i,'Pretendard CSS stack missing');
assert.match(css,/font-family:\s*['"]Jua['"]/i,'Jua heading font missing');
assert.match(css,/object-fit:contain/i,'responsive contain images missing');
assert.match(css,/@media\(max-width:390px\)/i,'small iPhone breakpoint missing');
assert.match(css,/\.image-card-grid\{[^}]*grid-template-columns/i,'responsive image grid missing');
assert.match(css,/\.image-frame\{[^}]*aspect-ratio:3\/2/i,'image frame must follow artwork ratio instead of fixed height');

for(const name of ['logo.webp','pay-100.webp','pay-200.webp','pay-300.webp','game-pingpong.webp','game-balloon.webp']){
  const file=await stat(new URL(`../public/assets/${name}`,import.meta.url));
  assert.ok(file.size>1000,`${name} appears empty`);
  assert.ok(html.includes(`/assets/${name}`)||name.startsWith('game-'),`${name} is not referenced`);
}

console.log('feature-regression.test: payment, games, deletion, QR, history, transactions, fonts and responsive images passed');
