# ZIP! MARKET v6 — Netlify 전체 프로젝트

관리자·사용자 로그인, Supabase 데이터, 크레딧 결제, QR 스캔, 게임, 삭제 기능과 모바일 UX를 포함한 배포용 전체 프로젝트입니다.

## 이번 버전의 핵심 수정

- **로그인 오류 제거**: 서버 코드에서 `@supabase/supabase-js`/Realtime을 완전히 제거하고 Supabase Data API를 `fetch`로 직접 호출합니다. 따라서 `Node.js detected but native WebSocket not found`가 발생하지 않습니다.
- Netlify 런타임을 **Node.js 22**로 고정했습니다 (`.nvmrc`, `netlify.toml`, `package.json`).
- 한글 글꼴은 외부 웹폰트 없이 `Pretendard → SUIT → Noto Sans KR → Apple SD Gothic Neo → 맑은 고딕` 순서의 안전한 시스템 폰트 스택을 사용합니다.
- 로그인 로고는 고정 높이/`cover`를 사용하지 않고 `height:auto` + `object-fit:contain`으로 표시되어 작은 휴대폰에서도 전체가 보입니다.

## 유지된 기능

### 사용자
- 사번·비밀번호 로그인
- 잔여 크레딧, 100/200/300 C 결제
- 결제 팝업 우측 상단 X, 취소, 바깥 영역, ESC, 뒤로가기로 닫기
- iPhone 카메라 QR 스캔 및 사진 QR 읽기
- 게임 목록·완료 QR·중복 보상 방지
- 사용내역 최근 5개와 `⌄ 나머지 내역도 보기`
- 모바일/PC 브라우저 내부 뒤로가기 기록
- iPhone 13 mini를 포함한 1열 카드와 잘리지 않는 이미지

### 관리자
- 관리자 로그인 및 초기 비밀번호 자동 동기화
- 참가자 개별·엑셀 붙여넣기 등록
- 참가자 검색·초기화·100 C 지급·삭제
- 게임 추가·완료 QR 생성·게임 및 연결 완료기록 삭제
- 자유 금액 결제 QR 생성
- 관리자 비밀번호 변경

### 안정성·성능
- 로그인 응답 한 번에 사용자·거래·게임·완료정보를 병렬 조회
- 결제는 DB 함수에서 잔액 확인과 차감을 원자적으로 처리
- 결제 QR/재시도는 nonce로 중복 차감 방지
- 게임 보상은 사용자·게임 조합당 한 번만 지급
- WebP 장기 캐시, QR 라이브러리 `defer` 로딩, 요청 시간 제한 적용

## 배포 순서

1. 이 폴더의 전체 내용을 GitHub 저장소 루트에 업로드합니다.
2. Supabase **SQL Editor**에서 `supabase/schema.sql` 전체를 실행합니다.
   - `create table if not exists`와 `add column if not exists`를 사용하므로 기존 행을 삭제하지 않습니다.
   - 그래도 운영 데이터가 있다면 먼저 Supabase 백업을 권장합니다.
3. Netlify **Project configuration → Environment variables**에서 아래 4개를 유지/등록합니다.

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
JWT_SECRET
INITIAL_ADMIN_PASSWORD
```

- `SUPABASE_SERVICE_ROLE_KEY`는 브라우저용 Publishable Key가 아니라 Supabase의 서버용 `sb_secret_...` 또는 legacy `service_role` 키입니다.
- `JWT_SECRET`은 32자 이상의 임의 문자열을 권장합니다.
- Secret 값은 GitHub 파일에 넣지 마세요.

4. Netlify에서 배포합니다. 빌드 명령과 publish/functions 경로는 `netlify.toml`에 포함되어 있습니다.
5. 배포 후 아래 주소를 엽니다.

```text
https://내-사이트.netlify.app/api/health
```

정상 예시:

```json
{
  "ok": true,
  "database": true,
  "adminInitialized": true,
  "transport": "direct-rest",
  "runtime": "v22.x.x"
}
```

6. 사이트에서 `INITIAL_ADMIN_PASSWORD` 값으로 관리자 로그인 → 참가자 등록 → 등록한 사번/비밀번호로 사용자 로그인을 확인합니다.

## 이미지 교체

사용자가 제공한 원본 6개를 `public/assets`에 포함했습니다.

```text
logo.webp
pay-100.webp
pay-200.webp
pay-300.webp
game-pingpong.webp
game-balloon.webp
```

같은 이름으로 덮어쓰면 코드 수정 없이 이미지가 바뀝니다. 게임 추가 시 이미지 URL을 비워두면 `/assets/logo.webp`를 안전한 기본 이미지로 사용합니다.

## 엑셀 붙여넣기 형식

관리자 페이지의 일괄 등록 칸에 다음 열을 탭 또는 쉼표로 구분해 붙여넣습니다.

```text
사번    이름    비밀번호    초기크레딧
20220412    홍길동    1234    1000
```

한 번에 최대 500명을 등록할 수 있습니다.

## 로컬 확인

Node.js 22에서:

```bash
npm install
npm run check
npx netlify dev
```

로컬 환경변수는 Netlify CLI 또는 로컬 `.env`에만 넣고 커밋하지 마세요.

## 파일 구조

```text
public/                 정적 페이지, CSS, 빌드된 app.js, 이미지
src/app.js              사용자·관리자 UI와 QR 기능 원본
netlify/functions/api.mjs  WebSocket 없는 Netlify API
supabase/schema.sql     테이블·권한·원자적 DB 함수
scripts/                빌드·프로젝트 검사
netlify.toml            Node 22, redirect, cache 설정
```

## 기존 데이터 호환 메모

`schema.sql`은 기존 `participants`, `transactions`, `games`, `game_completions`, `app_settings` 테이블을 그대로 사용하고 필요한 표준 열을 추가합니다. 구버전의 `employee_number`, `employee_id`, `balance`, `spent`, `title` 열은 가능한 경우 표준 열로 복사합니다. SQL 실행 중 기존 스키마의 사용자 지정 제약조건 때문에 오류가 나면 오류가 난 SQL과 해당 테이블의 열 목록을 확인해야 합니다.
