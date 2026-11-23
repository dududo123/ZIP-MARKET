# ZIP! MARKET v8.8.0 — 게임 생성·완료 QR 호환성 복구

운영 화면에서 확인된 `games.builtin NOT NULL` 생성 실패와, 올바른 게임 완료 QR을 스캔해도 “해당 게임의 QR 코드가 아닙니다”라고 거부되는 문제를 함께 수정한 Netlify 전체 프로젝트입니다. 기존 로그인, 참가자 단일/Excel 등록, 비밀번호 변경, 결제 QR, 직접 크레딧 결제, 삭제, 사용내역, 뒤로가기, 폰트, 반응형 이미지와 기본 게임 이미지 기능은 유지합니다.

## 핵심 수정

### 1. 구형·신형 `games` 스키마에서 안전한 게임 생성

- 안전 복구 SQL이 `id`, `name`, `reward`, `image_url`, `active`, `builtin=false`, `slug`, `public_id`, `created_at`, `updated_at`을 백필하고 필수 열로 검증합니다.
- 기본 이미지는 API·SQL·화면 모두 정확히 `/assets/game-default.webp`를 사용합니다.
- `zip_market_admin_create_game` RPC는 실제 `games.id` 타입(UUID, 문자형, 숫자형)을 확인해 ID를 생성합니다.
- RPC는 `name/title`, `reward/points`, `image_url/image`, 활성·삭제 플래그, `builtin=false`, 공개 식별자와 타임스탬프를 실제 존재하는 열에 함께 기록합니다.
- 추가 `NOT NULL` 열은 기본값이 있으면 PostgreSQL 기본값을 보존하고, 기본값이 없으면 자료형에 맞는 안전한 호환값을 채웁니다. 지원할 수 없는 사용자 정의 필수 자료형은 NULL INSERT 대신 명확한 설치 오류로 중단합니다.
- 기존 행은 삭제하지 않으며 같은 이름의 동시 생성은 중복 보상 없이 안전하게 거절합니다.

### 2. 관리자 QR ↔ 사용자 스캐너 계약 통일

- 새 관리자 완료 QR은 `ZIPMARKET|GAME|<식별자>` 형식으로 생성합니다.
- 스캐너는 현재 형식뿐 아니라 기존 compact, JSON, URL, `GAME:<id>`, `ZIP_MARKET_GAME:<id>` 형식을 계속 읽습니다.
- `gameId`, `game_id`, `id`, `slug`, `publicId`, `public_id`, UUID와 문자 ID를 정규화합니다.
- 사용자가 선택한 게임은 서버에서 받은 `id + slug + public_id` 별칭 전체와 비교하므로, QR이 다른 세대의 식별자를 사용해도 같은 실제 게임이면 통과합니다.
- 결제 QR 파서는 의도적으로 완화하지 않아 기존 결제 안전성을 유지합니다.

### 3. 완료·보상·중복 차단

- 완료 RPC는 `id`, `slug`, `public_id` 중 어느 식별자로도 실제 게임을 찾습니다.
- 완료 기록, 보상 크레딧, 거래내역은 하나의 PostgreSQL 트랜잭션에서 처리됩니다.
- 같은 참가자·게임 조합은 한 번만 보상되며 중간 오류 시 전체 작업이 롤백됩니다.

## 적용 순서 — 반드시 SQL이 먼저입니다

1. Supabase → **SQL Editor** → **New query**
2. 별도 제공된 `ZIP_MARKET_v8.8_SAFE_REPAIR.sql` 전체를 붙여넣고 **Run**
3. 마지막 결과에서 `schema_version = 8.8.0`과 10개 RPC를 확인
4. ZIP을 풀어 GitHub 저장소 파일 전체를 교체하고 Commit
5. `.env.example`은 업로드해도 되지만 실제 `.env`는 업로드하지 않음
6. 기존 Netlify 환경변수 유지
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `JWT_SECRET`
   - `INITIAL_ADMIN_PASSWORD`
7. Netlify에서 **Clear cache and deploy site** 실행
8. `/api/health` 확인

예상 핵심 응답:

```json
{
  "ok": true,
  "database": true,
  "schema": "zip-market-v8.8",
  "version": "8.8.0"
}
```

## 배포 후 점검 순서

1. 관리자·사용자 로그인
2. 기존 참가자 유지, 단일 등록과 Excel 일괄등록
3. 새 게임 생성 및 `/assets/game-default.webp` 표시
4. 관리자에서 기존 게임과 새 게임의 완료 QR 생성
5. 사용자에서 해당 게임 카드를 누른 뒤 QR 스캔
6. 완료 표시, 보상 크레딧, 거래내역 확인
7. 같은 QR 재스캔 시 추가 보상 차단 확인
8. 결제 QR과 직접 100/200/300C 결제 확인
9. 관리자 비밀번호 변경 후 새 비밀번호 재로그인
10. 참가자·게임 삭제, 뒤로가기와 반응형 이미지 확인

## 로컬 검증

```bash
npm run check
npm test
```

테스트는 API/RPC 서명, old/new `games` 필수 열, UUID·문자·숫자 ID 생성, 추가 NOT NULL 처리, 현재·레거시 QR 왕복, 선택 게임 별칭 검증, 완료·보상·거래의 원자성, 중복 보상 롤백, 기본 이미지 내용과 경로, JavaScript/SQL 구조, 로그인·등록·결제·삭제·내역·내비게이션·폰트·반응형 이미지 회귀를 포함합니다.
