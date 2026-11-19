import assert from 'node:assert/strict';
await import('../public/api-response.js');
const { readApiResponse, normalizePayload, ApiResponseError }=globalThis.ZipMarketApiResponse;

const direct=await readApiResponse(new Response(JSON.stringify({ok:true,token:'direct'}),{status:200,headers:{'content-type':'application/json'}}));
assert.equal(direct.token,'direct');

const legacyEnvelope={statusCode:200,headers:{'content-type':'application/json'},body:JSON.stringify({ok:true,token:'legacy'})};
const legacy=await readApiResponse(new Response(JSON.stringify(legacyEnvelope),{status:200,headers:{'content-type':'application/json'}}));
assert.equal(legacy.token,'legacy');

const doubleEncoded=await readApiResponse(new Response(JSON.stringify(JSON.stringify({ok:true,token:'double'})),{status:200}));
assert.equal(doubleEncoded.token,'double');

const legacyFailure={statusCode:401,body:JSON.stringify({ok:false,code:'LOGIN_FAILED',message:'관리자 비밀번호가 올바르지 않습니다.'})};
await assert.rejects(
  readApiResponse(new Response(JSON.stringify(legacyFailure),{status:200})),
  error=>error instanceof ApiResponseError&&error.code==='LOGIN_FAILED'&&error.status===401
);

await assert.rejects(
  readApiResponse(new Response('<!doctype html><title>Page not found</title>',{status:404,headers:{'content-type':'text/html'}})),
  error=>error instanceof ApiResponseError&&error.code==='NON_JSON_RESPONSE'&&error.retryable
);

assert.deepEqual(normalizePayload({statusCode:200,body:'{"ok":true}'},200),{status:200,data:{ok:true}});
console.log('response-shapes.test: direct, legacy envelope, double-encoded, error and HTML fallback shapes passed');
