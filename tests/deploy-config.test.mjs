import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Netlify function bundle cannot be reclassified as ESM by package.json', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const netlify = await readFile(new URL('../netlify.toml', import.meta.url), 'utf8');
  const api = await readFile(new URL('../netlify/functions/api.mjs', import.meta.url), 'utf8');
  assert.notEqual(pkg.type, 'module');
  assert.doesNotMatch(netlify, /included_files\s*=\s*\[[^\]]*package\.json/);
  assert.match(api, /export const handler/);
});
