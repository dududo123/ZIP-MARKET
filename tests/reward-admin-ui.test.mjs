import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const [html,app,css,api,sql]=await Promise.all([
  readFile(new URL('../public/index.html',import.meta.url),'utf8'),
  readFile(new URL('../public/app.js',import.meta.url),'utf8'),
  readFile(new URL('../public/styles.css',import.meta.url),'utf8'),
  readFile(new URL('../netlify/functions/api.mjs',import.meta.url),'utf8'),
  readFile(new URL('../supabase/schema-repair.sql',import.meta.url),'utf8')
]);
for(const reward of [50,100,200,300,500]) assert.ok(html.includes(`data-reward-preset="${reward}"`),`missing ${reward}C preset`);
assert.match(html,/name="reward"[^>]*type="number"[^>]*min="0"[^>]*step="1"/,'create form must have unrestricted integer reward input');
assert.match(app,/body:\{name:String\(form\.get\('name'\)[\s\S]*reward\}\}\)/,'create request must submit entered reward');
assert.ok(app.includes('game-reward-input')&&app.includes('save-game-reward'),'existing game cards need reward input and save button');
assert.match(app,/\/admin\/games\/\$\{encodeURIComponent\(save\.dataset\.id\)\}\/reward[\s\S]*method:'PATCH'/,'existing reward save must call PATCH API');
assert.ok(app.includes('완료 시 +${escapeHtml(rewardText(game.reward))}'),'participant card must display current reward');
assert.ok(css.includes('.game-reward-editor')&&css.includes('.reward-presets'),'reward controls must be styled');
assert.ok(api.includes("rpc('zip_market_admin_update_game_reward'"),'API reward update RPC missing');
assert.match(sql,/create function public\.zip_market_admin_update_game_reward[\s\S]*set reward = p_reward,[\s\S]*points = p_reward/i,'database reward update must persist both compatibility columns');
const completion=sql.slice(sql.indexOf('create function public.zip_market_complete_game'),sql.indexOf('-- Compatibility aliases'));
assert.match(completion,/v_reward := greatest\(coalesce\(v_game\.reward, 0\), 0\)/,'completion must read current game reward');
assert.match(completion,/insert into public\.game_completions[\s\S]*v_reward, v_reward/,'completion must snapshot paid reward');
const rewardUpdate=sql.slice(sql.indexOf('create function public.zip_market_admin_update_game_reward'),sql.indexOf('create function public.zip_market_complete_game'));
assert.doesNotMatch(rewardUpdate,/game_completions|transactions/i,'reward edit must not rewrite prior completions or transactions');
console.log('reward-admin-ui.test: create presets+free input, existing card save, API/DB persistence, participant display and completion snapshot passed');
