import { cp, mkdir, rm } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await cp('public', 'dist', { recursive: true });
await cp('src/app.js', 'dist/app.js');
console.log('ZIP! MARKET v8 build complete.');
