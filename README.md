# 관리자 LOGIN_FAILED 수정

원인: Supabase app_settings의 admin_password 해시가 예전에 설정한 INITIAL_ADMIN_PASSWORD 기준으로 남아있으면, Netlify 환경변수의 현재 비밀번호와 불일치하여 LOGIN_FAILED가 발생합니다.

수정: admin/login에서 DB 해시 검증이 실패하더라도 사용자가 입력한 값이 현재 Netlify의 INITIAL_ADMIN_PASSWORD와 정확히 같으면, DB의 admin_password 해시를 현재 비밀번호로 자동 동기화한 뒤 로그인합니다.

적용:
1. GitHub의 `netlify/functions/api.mjs`만 이 파일로 교체
2. Commit
3. Netlify 배포
4. Netlify Environment Variables의 `INITIAL_ADMIN_PASSWORD`에 설정된 값을 관리자 로그인에 입력

다른 UI 파일은 바꿀 필요가 없습니다.
