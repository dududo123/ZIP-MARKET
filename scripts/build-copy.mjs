import { copyFile } from 'node:fs/promises';
await copyFile('src/app.js','public/app.js');
console.log('ZIP! MARKET frontend copied to public/app.js.');
