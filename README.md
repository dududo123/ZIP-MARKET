# ZIP! MARKET v8.3.0 — 관리자 로그인·서버 응답 복구본

이 버전은 `/api/health`는 정상인데 관리자 로그인에서 **“서버 응답을 읽을 수 없습니다”**가 표시되는 문제를 해결합니다. 화면 디자인과 기존 데이터 구조는 유지하고, Netlify Function 반환 방식과 브라우저 응답 해석을 함께 보강했습니다.

## 확인된 구조적 원인

이전 프로젝트에는 서로 다른 세대의 Netlify 응답 방식이 섞일 수 있었습니다.

- 최신 Netlify Function: Web `Response` 객체 반환
- 이전 방식: `{ statusCode, headers, body }` 객체 반환
- 프런트엔드: 응답 본문을 한 번만 `JSON.parse`

배포 프록시나 캐시가 이전 응답을 한 번 더 감싸면 로그인 응답 자체는 성공해도 브라우저가 토큰을 찾지 못하거나, HTML/문자열 응답을 JSON으로 읽다가 오류가 발생할 수 있습니다.

## v8.3 수정 내용

### 서버

- `netlify/functions/api.mjs`를 최신 Netlify 기본 내보내기 형식으로 통일
- 모든 경로에서 실제 Web `Response` 반환
- `/api/*`와 `/.netlify/functions/api/*` 경로 모두 정규화
- 관리자·사용자 로그인 RPC가 단일 객체 또는 1개짜리 배열로 와도 처리
- 성공·오류 모두 JSON과 명시적 HTTP 상태로 반환
- `/api/health`에 `runtime: "netlify-modern-response"`, `version: "8.3.0"` 추가

### 브라우저

- 직접 JSON 응답 처리
- 이전 Netlify `{ statusCode, body }` 응답 자동 해제
- 이중 JSON 문자열 자동 해제
- SPA의 HTML 404가 오면 직접 Function URL로 한 번 재시도
- 관리자 로그인 성공 응답에 토큰이 없으면 원인을 명확하게 표시
- 기존 관리자 로그인 화면, 사용자 화면, 폰트, 이미지, QR, 게임 기능 유지

### 라우팅

- `netlify.toml`에서 `/api/*` 규칙을 SPA `/*` 규칙보다 먼저 적용
- `public/_redirects`에도 동일한 보조 규칙 포함

## 적용 방법

1. 압축을 풀어 GitHub 저장소의 프로젝트 파일을 **전체 교체**합니다.
2. 실제 비밀값이 들어 있는 `.env` 파일은 업로드하지 않습니다. `.env.example`은 업로드해도 됩니다.
3. GitHub Commit/Push 후 Netlify에서 **Clear cache and deploy site**로 한 번 배포합니다.
4. 이번 수정은 DB 스키마 변경이 없으므로, v8.2에서 `schema.sql` 또는 `schema-repair.sql`을 이미 실행했다면 다시 실행하지 않습니다.
5. 배포 후 `https://사이트주소/api/health`를 확인합니다.

정상 응답의 핵심 값:

```json
{
  "ok": true,
  "database": true,
  "adminInitialized": true,
  "runtime": "netlify-modern-response",
  "schema": "zip-market-v8.3",
  "version": "8.3.0"
}
```

6. 관리자 로그인 → 참가자 로그인 순서로 확인합니다.

## 환경변수

기존 Netlify 환경변수 4개를 그대로 유지합니다.

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `JWT_SECRET`
- `INITIAL_ADMIN_PASSWORD`

## 로컬 검증

```bash
npm test
npm run check
```

테스트 범위:

- modern Web `Response` 반환 여부
- `/api/*` 및 직접 Function 경로
- health 및 환경 진단
- 관리자·사용자 로그인과 JWT
- 결제, 게임 완료, 참가자 삭제
- 직접 JSON, legacy envelope, 이중 JSON, HTML 404 응답
- Supabase RPC/스키마 계약
- 기존 QR, 뒤로가기, 이미지, 참가자·게임 관리 기능 정적 계약
