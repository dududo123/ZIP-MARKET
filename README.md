# ZIP MARKET /api 404 Routing Fix

현재 화면의 Netlify `Page not found`는 API 코드나 Supabase schema 오류가 아니라 `/api/health`가 Function으로 rewrite되지 않는 라우팅 오류입니다.

## 적용 방법 A (권장)
1. GitHub 저장소 최상위의 `netlify.toml`을 이 패치의 `netlify.toml`로 교체합니다.
2. `netlify/functions/api.mjs`는 기존 수정본을 그대로 둡니다.
3. Commit 후 Netlify에서 배포합니다.
4. `/api/health` 확인.

## 적용 방법 B (추가 안전장치)
`public-_redirects.txt`의 파일명을 `_redirects`로 바꾼 뒤 GitHub의 `public/_redirects`로 업로드합니다.
이 파일을 사용할 때도 API 규칙이 SPA fallback보다 위에 있어야 합니다.

정상 GitHub 구조:
- netlify.toml
- package.json
- public/index.html
- public/_redirects (선택)
- netlify/functions/api.mjs

## Netlify 설정 확인
Netlify Project configuration > Build settings:
- Base directory: 비움
- Publish directory: public
- Functions directory: netlify/functions

`netlify.toml`은 저장소 루트에 있어야 합니다.
