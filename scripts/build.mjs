import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';

await Promise.all([
  build({ entryPoints: ['src/app.js'], bundle: true, minify: true, format: 'iife', target: ['es2020'], outfile: 'public/app.min.js', legalComments: 'none', external: ['/qr-tools.min.js*'] }),
  build({ entryPoints: ['src/qr-tools.js'], bundle: true, minify: true, format: 'esm', target: ['es2020'], outfile: 'public/qr-tools.min.js', legalComments: 'none' }),
  build({ entryPoints: ['src/styles.css'], bundle: true, minify: true, outfile: 'public/styles.min.css', legalComments: 'none' })
]);

const html = await readFile('public/index.html', 'utf8');
await writeFile('public/index.html', html.replaceAll('__BUILD_VERSION__', '5.0.0'));
console.log('ZIP! MARKET production assets built.');
