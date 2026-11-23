import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';

const [html,app]=await Promise.all([
  readFile(new URL('../public/index.html',import.meta.url),'utf8'),
  readFile(new URL('../public/app.js',import.meta.url),'utf8')
]);
const ids=new Set([...html.matchAll(/\bid=["']([^"']+)/g)].map(match=>match[1]));
const referencedIds=new Set([...app.matchAll(/\$\(["']#([A-Za-z0-9_-]+)["']/g)].map(match=>match[1]));
const missing=[...referencedIds].filter(id=>!ids.has(id));
assert.deepEqual(missing,[],'app.js contains missing DOM id references');

for(const name of ['logo.webp','pay-100.webp','pay-200.webp','pay-300.webp','game-pingpong.webp','game-balloon.webp','game-default.webp']){
  const file=await stat(new URL(`../public/assets/${name}`,import.meta.url));
  assert.ok(file.size>1000,`${name} appears missing or empty`);
}
for(const source of ['/api-response.js?v=8.9.0','/qr-payload.js?v=8.9.0','/app.js?v=8.9.0','/styles.css?v=8.9.0']) assert.ok(html.includes(source),`cache-busted source missing: ${source}`);
assert.ok(html.indexOf('/api-response.js?v=8.9.0')<html.indexOf('/qr-payload.js?v=8.9.0')&&html.indexOf('/qr-payload.js?v=8.9.0')<html.indexOf('/app.js?v=8.9.0'),'response and QR parsers must load before app.js');
console.log(`static.test: ${referencedIds.size} DOM references, seven images and script order passed`);
