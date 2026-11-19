import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
const js = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');

test('every static element ID referenced by app.js exists', () => {
  const ids = new Set([...js.matchAll(/\$\('#([A-Za-z][\w-]*)[^']*'\)|getElementById\('([^']+)'\)/g)].map(match => match[1] || match[2]));
  for (const id of ids) assert.match(html, new RegExp(`id=["']${id}["']`), `missing #${id}`);
});

test('pre-V5 fonts and iPhone image containment are retained', () => {
  assert.match(html, /family=Jua/);
  assert.match(html, /pretendard/i);
  assert.match(css, /font-family:Pretendard/);
  assert.match(css, /font-family:'Jua'/);
  assert.match(css, /object-fit:contain/);
  assert.match(css, /max-width:430px/);
});

test('critical UX controls remain present', () => {
  for (const id of ['adminLoginModal','paymentModal','qrModal','toggleHistory','resetSearch','participantList','adminGameList']) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(js, /history\.pushState/);
  assert.match(js, /data-delete-person/);
  assert.match(js, /data-delete-game/);
  assert.match(js, /나머지 내역도 보기/);
});
