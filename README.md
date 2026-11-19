# ZIP! MARKET v8.2.0 — schema/API 일치 복구본

이 배포본은 v8.1의 `SCHEMA_MISSING` 오류를 수정합니다. Netlify Function이 호출하는 RPC 이름·매개변수와 `supabase/schema.sql`에 생성되는 함수가 정확히 일치합니다.

## 오류 원인

v8.1 Function은 아래 RPC를 호출하지만 운영 Supabase에는 함수가 없거나 이전 이름만 남아 있었습니다.

- `zip_market_initialize_admin(p_initial_password)`
- `zip_market_auth_admin(p_initial_password, p_password)`

PostgREST가 함수를 찾지 못해 `/api/health`와 관리자 로그인이 모두 `PGRST202 / schema cache` 오류로 중단된 것입니다.

## 가장 안전한 적용 순서

1. 이 폴더의 **전체 파일**을 GitHub 프로젝트에 덮어씁니다.
2. Supabase → SQL Editor → New query에서 `supabase/schema.sql` 전체를 실행합니다.
   - 기존 참가자·게임·거래·완료 기록을 삭제하지 않습니다.
   - 누락된 열, 함수, 인덱스와 권한만 멱등 방식으로 추가·갱신합니다.
3. Netlify 환경변수 4개를 유지합니다.
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY` (`sb_secret_...` 또는 legacy `service_role`)
   - `JWT_SECRET` (충분히 긴 임의 문자열)
   - `INITIAL_ADMIN_PASSWORD`
4. GitHub에 Commit/Push한 뒤 Netlify에서 새 배포를 실행합니다.
5. `https://사이트주소/api/health`를 확인합니다.

정상 응답 예시:

```json
{
  "ok": true,
  "database": true,
  "adminInitialized": true,
  "transport": "direct-rest",
  "schema": "zip-market-v8.2",
  "version": "8.2.0"
}
```

그 후 관리자 로그인 → 참가자 로그인 순서로 확인합니다.

## 이미 v8.1을 배포했고 스키마만 빠진 경우

`supabase/schema-repair.sql` 전체만 Supabase SQL Editor에서 실행해도 됩니다. 이 파일은 `schema.sql`과 동일한 안전한 멱등 복구 SQL입니다. 스키마 복구 후 PostgREST 캐시가 즉시 갱신되도록 마지막에 `notify pgrst, 'reload schema'`가 포함되어 있습니다.

## 환경 파일 주의

- `.env.example`: 변수 **이름만** 있으므로 GitHub 업로드 가능
- `.env`: 실제 비밀값이 있으므로 GitHub 업로드 금지
- 브라우저 코드에는 Supabase Secret Key가 포함되지 않습니다.

## 유지·검증한 기능

- 사용자 로그인: 사번 + 비밀번호
- 관리자 로그인 및 관리자 비밀번호 변경/복구
- Supabase 직접 REST 연동(Realtime/WebSocket 의존성 없음)
- 참가자 개별·Excel 붙여넣기 등록, 검색 초기화, +100C 지급, 삭제
- 100/200/300C 결제, 관리자 자유 금액 결제 QR
- iPhone 호환 QR 카메라·사진 스캔 (`html5-qrcode`)
- 게임 목록, 게임 추가·완료 QR·삭제, 참가자 게임 완료
- 모바일/PC 브라우저 뒤로가기 내부 화면 복원
- 결제 팝업 우측 상단 X, 바깥 영역, ESC, 뒤로가기로 취소
- 사용내역 최근 5개와 아래 화살표 펼치기
- iPhone 13 mini 대응 `object-fit: contain` 이미지
- 제목/브랜드 `Jua`, 본문 `Pretendard` 우선 폰트 스택
- 원본 로고·결제·게임 WebP 6개 포함

## 로컬 정적 확인

```bash
npm test
npm run check
python3 -m http.server 8888 -d public
```

로컬 정적 서버에서는 UI를 확인할 수 있지만 API 로그인은 Netlify Function과 Supabase가 연결된 배포 환경에서 확인해야 합니다.

## 데이터 삭제 동작

- 참가자 삭제: 외래키 `ON DELETE CASCADE`로 해당 거래내역·게임 완료 기록도 삭제
- 게임 삭제: 해당 게임의 참가자 완료 기록도 삭제
- 두 작업 모두 관리자 JWT가 있어야 Netlify Function에서 실행됩니다.
