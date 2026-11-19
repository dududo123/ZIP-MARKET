import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
function extract(name,nextName){
  const start=app.indexOf(`  function ${name}`);
  const end=app.indexOf(`  function ${nextName}`,start+1);
  assert.ok(start>=0&&end>start,`cannot extract ${name}`);
  return app.slice(start,end).replace(/^  /gm,'');
}
const source=`${extract('resetFormSafely','resetPasswordInputsSafely')}\n${extract('resetPasswordInputsSafely','parseBulkParticipants')}\n${extract('parseBulkParticipants','escapeHtml')}\nthis.api={resetFormSafely,resetPasswordInputsSafely,parseBulkParticipants};`;

class FakeForm {
  constructor(){this.resetCount=0;this.focused=false;this.targets=[];this.passwords=[{value:'secret1',focus:()=>{this.focused=true;}},{value:'secret2',focus:()=>{this.focused=true;}}];}
  reset(){this.resetCount+=1;}
  querySelector(selector){this.targets.push(selector);return{focus:()=>{this.focused=true;}};}
  querySelectorAll(selector){this.targets.push(selector);return selector==='input[type="password"]'?this.passwords:[];}
}
const context={HTMLFormElement:FakeForm};vm.createContext(context);vm.runInContext(source,context);
const {resetFormSafely,resetPasswordInputsSafely,parseBulkParticipants}=context.api;

const single=new FakeForm();assert.equal(resetFormSafely(single,'[name="employeeNo"]'),true);assert.equal(single.resetCount,1);assert.equal(single.focused,true);assert.deepEqual(single.targets,['[name="employeeNo"]']);
const bulk=new FakeForm();assert.equal(resetFormSafely(bulk,'textarea[name="bulk"]'),true);assert.equal(bulk.resetCount,1);assert.deepEqual(bulk.targets,['textarea[name="bulk"]']);
assert.equal(resetFormSafely(null,'x'),false);assert.equal(resetFormSafely({},'x'),false);
const passwordForm=new FakeForm();assert.equal(resetPasswordInputsSafely(passwordForm),true);assert.equal(passwordForm.resetCount,1);assert.deepEqual(passwordForm.passwords.map(input=>input.value),['','']);assert.equal(passwordForm.focused,true);assert.deepEqual(passwordForm.targets,['input[type="password"]']);
assert.equal(resetPasswordInputsSafely(null),false);assert.equal(resetPasswordInputsSafely({}),false);

let result=parseBulkParticipants('E001\t홍길동\t1234\t10000\nE002\t김마켓\t5678\t0');
assert.equal(result.errors.length,0);assert.equal(result.participants.length,2);assert.equal(result.participants[0].initialCredit,10000);
result=parseBulkParticipants('E001\t홍길동\t1234\t100\nE001\t김마켓\t5678\t200');assert.match(result.errors[0],/2행.*중복/);
result=parseBulkParticipants('E001\t\t1234\t100');assert.match(result.errors[0],/1행.*이름/);
result=parseBulkParticipants('E001\t홍길동\t1234\t10.5');assert.match(result.errors[0],/1행.*정수/);
result=parseBulkParticipants('');assert.match(result.errors[0],/붙여넣어/);

console.log('frontend-reset.test: participant, Excel and administrator password DOM reset helpers passed with null and data validation cases');
