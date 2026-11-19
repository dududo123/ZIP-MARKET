import { access, readFile } from 'node:fs/promises';
const required = [
  'public/index.html','public/styles.css','public/app.js','public/assets/logo.webp',
  'public/assets/pay-100.webp','public/assets/pay-200.webp','public/assets/pay-300.webp',
  'public/assets/game-pingpong.webp','public/assets/game-balloon.webp',
  'netlify/functions/api.mjs','supabase/schema.sql','netlify.toml','README.md'
];
await Promise.all(required.map(path => access(path)));
const [html, css, api, pkg] = await Promise.all([
  readFile('public/index.html','utf8'), readFile('public/styles.css','utf8'),
  readFile('netlify/functions/api.mjs','utf8'), readFile('package.json','utf8')
]);
const checks = [
  [html.includes('assets/logo.webp'), 'logo is referenced'],
  [/object-fit\s*:\s*contain/.test(css), 'images use contain'],
  [css.includes('Pretendard'), 'Korean font stack is present'],
  [!api.includes('@supabase/supabase-js'), 'Supabase WebSocket client is absent'],
  [api.includes('/user/login') && api.includes('/admin/login'), 'login routes exist'],
  [api.includes('/admin/participants') && api.includes('/admin/games'), 'admin routes exist'],
  [JSON.parse(pkg).engines.node.startsWith('>=22'), 'Node 22 is pinned']
];
for (const [ok, label] of checks) { if (!ok) throw new Error(`Check failed: ${label}`); console.log(`✓ ${label}`); }
