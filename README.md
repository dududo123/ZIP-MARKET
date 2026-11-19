# ZIP! MARKET v7 — 로그인·기존 폰트 복원 통합본

## 이번 버전에서 실제로 고친 원인

화면에 표시된 `Node.js detected but native WebSocket not found`는 브라우저 로그인 폼이나 Supabase 테이블 자체의 오류가 아니라, Netlify Function에서 `@supabase/supabase-js`가 Realtime/WebSocket 전송 계층을 초기화하면서 발생한 런타임 오류였습니다.

v7은 서버 코드에서 `@supabase/supabase-js`를 완전히 제거하고 **Supabase REST Data API를 직접 호출**합니다.

- `sb_secret_...` 키: `apikey` 헤더에만 전달
- legacy `eyJ...` service_role 키: `apikey` + `Authorization: Bearer` 전달
- Realtime/WebSocket 코드 없음
- Node.js 22 고정
- 사용자 로그인과 관리자 로그인이 같은 안정적인 REST 전송 계층 사용
- DB 관리자 암호와 `INITIAL_ADMIN_PASSWORD`가 어긋난 경우 현재 환경변수 비밀번호로 로그인하면 DB 해시를 자동 동기화

## 폰트

기존 홈페이지 캡처의 둥글고 키치한 한글 표시와 맞는 **Jua(주아) 한글 폰트** 구성을 복원했습니다.

- Google Fonts의 Jua를 비동기로 불러와 첫 화면과 로그인 동작을 막지 않음
- 한글·영문 모두 Jua로 표시
- 폰트 네트워크가 막혀도 `Apple SD Gothic Neo → Malgun Gothic → Noto Sans KR` 순으로 대체되어 한글이 깨지지 않음

## 배포

1. 이 프로젝트의 파일을 GitHub 저장소에 **전체 교체**합니다.
2. Supabase → SQL Editor에서 `supabase/schema.sql` 전체를 한 번 실행합니다.
   - `create table if not exists` 기반이라 기존 참가자 데이터를 지우지 않습니다.
3. Netlify Environment variables에 다음 4개가 있는지 확인합니다.
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY` (`sb_secret_...` 권장, legacy service_role도 지원)
   - `JWT_SECRET`
   - `INITIAL_ADMIN_PASSWORD`
4. Netlify에서 1회 배포합니다.
5. `https://사이트주소/api/health`를 엽니다.

정상 예시:

```json
{
  "ok": true,
  "database": true,
  "adminInitialized": true,
  "transport": "direct-rest",
  "version": "7.0.0"
}
```

## 로그인 확인 순서

1. `/api/health`가 위와 같이 정상인지 확인합니다.
2. 관리자 로그인에서 현재 Netlify의 `INITIAL_ADMIN_PASSWORD` 값을 입력합니다.
   - DB에 예전 암호 해시가 남아 있어도 현재 환경변수 값과 일치하면 자동 복구됩니다.
3. 관리자 페이지에서 참가자를 등록합니다.
4. 등록한 사번과 비밀번호로 사용자 로그인을 확인합니다.

## 유지된 기능

- 사용자·관리자 로그인과 로그인 복원
- Supabase 연동
- 참가자 개별·일괄 등록, 검색 초기화, 삭제
- 크레딧 지급·차감, 고정 금액 결제, 관리자 결제 QR
- 결제 QR 중복 사용 방지와 원자적 잔액 차감
- iPhone 카메라 및 사진 QR 인식
- 게임 추가·삭제·완료 QR·중복 보상 방지
- 모바일·PC 브라우저 뒤로가기로 이전 내부 화면/팝업 복원
- 결제 팝업 우측 상단 X, 바깥 영역, ESC, 뒤로가기로 취소
- 사용내역 최근 5개와 `⌄ 나머지 내역도 보기`
- iPhone 13 mini(375px)에서 로고·결제·게임 이미지 `object-fit: contain`
- 로그인 응답에 사용자 화면 데이터를 함께 반환하고, 독립 DB 조회는 병렬 처리
- QR 라이브러리는 QR 기능을 처음 열 때만 지연 로딩

## 보안 메모

- `SUPABASE_SERVICE_ROLE_KEY`는 절대 브라우저 코드나 GitHub에 넣지 않습니다.
- 모든 DB 호출은 Netlify Function 안에서만 수행됩니다.
- 사용자/관리자 JWT와 QR payload는 `JWT_SECRET`으로 서명합니다.
- 결제와 게임 보상은 PostgreSQL 함수에서 행 잠금 후 처리해 중복/동시 요청을 방지합니다.
