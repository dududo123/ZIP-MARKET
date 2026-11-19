# ZIP! MARKET 5.0 — 배포용 전체 프로젝트

이번 통합본은 부분 패치가 아니라 GitHub 저장소에 그대로 올릴 수 있는 전체 프로젝트입니다.

## 이번 수정 내용

- 크레딧 결제 팝업 오른쪽 위에 항상 보이는 **원형 X 닫기 버튼** 추가
- X 버튼, 팝업 바깥 영역, ESC, 브라우저 뒤로가기로 결제를 실행하지 않고 팝업 닫기
- 모바일·PC 브라우저의 뒤로가기가 로그인 → 사용자 화면 → 결제/GAME 탭 → 팝업 등 ZIP! MARKET 내부 방문 순서를 먼저 따라가도록 SPA History 구현
- 사용자 로그인 응답 한 번에 잔액·사용내역·게임·완료게임을 병렬 조회
- QR 라이브러리를 실제 스캔/QR 생성 시에만 내려받는 지연 로딩 적용
- 정적 JS/CSS 압축, 이미지 WebP 최적화, 장기 브라우저 캐시 적용
- iPhone 13 mini(375px 폭)에서 GAME 이미지를 `object-fit: contain`으로 전체 표시하고 1열로 전환
- 사용내역은 최근 5개만 기본 표시. **⌄ 나머지 내역도 보기**를 누르면 전체 펼침/접기
- 사용자·관리자 로그인, Supabase 연동, 크레딧 지급·결제, iPhone 카메라/사진 QR, 게임, 참가자 삭제, 게임 삭제 유지
- 참가자 검색 초기화, 관리자 비밀번호 자동 초기화/동기화, 결제 중복 사용 방지 유지

## 프로젝트 구조

```text
zip-market-deploy/
├─ netlify/functions/api.mjs   # 서버 API
├─ public/                     # Netlify 배포 정적 파일
│  ├─ index.html
│  └─ assets/
├─ src/                        # 프론트엔드 소스
├─ scripts/build.mjs           # 압축 빌드
├─ supabase/schema.sql         # DB 테이블·권한·원자적 결제 함수
├─ netlify.toml
└─ package.json
```

## 1. Supabase 설정

기존 ZIP! MARKET DB를 그대로 사용한다면 데이터 삭제 없이 `supabase/schema.sql`을 SQL Editor에서 실행하세요. `create table if not exists`와 `create or replace function`만 사용하므로 기존 행을 지우지 않습니다.

필요 테이블:

- `app_settings`
- `participants`
- `transactions`
- `games`
- `game_completions`

## 2. Netlify 환경변수

Netlify → Project configuration → Environment variables에 아래 4개가 필요합니다.

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
JWT_SECRET
INITIAL_ADMIN_PASSWORD
```

- 모두 `All scopes` 사용 가능
- `SUPABASE_SERVICE_ROLE_KEY`, `JWT_SECRET`, `INITIAL_ADMIN_PASSWORD`는 secret 값으로 보호
- Secret Key는 브라우저 코드가 아니라 Netlify Function에서만 사용됩니다.

## 3. GitHub/Netlify 배포

1. 이 폴더의 **내용 전체**를 GitHub 저장소 최상위에 올립니다.
2. Netlify Build settings:
   - Build command: `npm run build`
   - Publish directory: `public`
   - Functions directory: `netlify/functions`
3. 배포 후 `/api/health`를 열어 `ok: true`, `database: true`, `adminInitialized: true`를 확인합니다.
4. 이전 자바스크립트 캐시를 피하려면 배포 뒤 브라우저에서 한 번 새로고침합니다.

## QR 사용 조건

- 카메라 QR은 HTTPS에서 동작합니다(Netlify 기본 주소는 HTTPS).
- iPhone Safari/Naver 앱 내 브라우저에서 카메라 권한을 허용해야 합니다.
- 카메라를 열 수 없으면 **사진에서 QR 읽기**를 사용할 수 있습니다.

## 로컬 확인

```bash
npm install
npm run check
npm run dev
```

## 주요 보안·데이터 처리

- 비밀번호는 bcrypt 해시로 저장됩니다.
- 로그인·QR 토큰은 서버의 `JWT_SECRET`으로 서명됩니다.
- 결제 QR 중복 사용을 확인합니다.
- `zip_market_redeem_credit` DB 함수가 잔액 차감과 내역 기록을 한 트랜잭션으로 처리합니다.
- 참가자 삭제 시 연결된 사용내역/게임 완료내역, 게임 삭제 시 완료내역을 먼저 제거합니다.
