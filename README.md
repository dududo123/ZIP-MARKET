# ZIP! MARKET v8.7.0 — 게임 DB 호환성·관리자 비밀번호 최종 복구

v8.6에서 정상화한 로그인, 참가자 등록, Excel 등록, 결제 QR, 직접 크레딧 결제, 결제 멱등성, 카메라 자동 시작, 게임 카드 스캔, 삭제, 내역, 뒤로가기, 폰트와 반응형 이미지를 유지하면서 운영 DB에서 확인된 네 가지 오류를 수정한 전체 배포 프로젝트입니다.

## v8.7 수정 사항

### 1. 게임 완료 및 보상
- 운영 DB의 기존 필수 열 `game_completions.reward`와 신규 열 `rewarded_amount`를 모두 추가·백필·동기화합니다.
- 완료 기록에 `participant_id`, 실제 `game_id`, `reward`, `rewarded_amount`, `created_at`, `completed_at`을 모두 기록합니다.
- 게임은 기존 문자형 ID(`balloon` 등), UUID ID 또는 `slug`로 찾습니다.
- 참가자 행 잠금 → 중복 완료 검사 → 완료 기록 → 잔액 증가 → 거래 기록을 하나의 PostgreSQL RPC 트랜잭션으로 처리합니다.
- 중복 또는 중간 오류가 발생하면 완료·잔액·거래가 전부 롤백됩니다.
- 성공 응답에는 갱신된 참가자 ID, 사번, 이름과 `credit_balance`가 포함됩니다.

### 2. 관리자 비밀번호
- 비동기 요청 전에 실제 `#admin-password-form`을 보관하고, 성공 후 그 폼의 두 비밀번호 입력값을 직접 비웁니다.
- 폼을 찾지 못하면 예외 대신 안내 메시지를 표시합니다.
- 변경 비밀번호는 `app_settings.admin_password`에 bcrypt로 저장됩니다.
- `INITIAL_ADMIN_PASSWORD`는 최초 생성에만 사용되며, 변경된 비밀번호를 되돌리는 복구 로그인으로 사용되지 않습니다.

### 3. 신규 게임 기본 이미지
- 제공된 ORAC 캐릭터 4명이 `GAME` 노트북 주위에 있는 파일을 정확히 `public/assets/game-default.webp`로 포함했습니다.
- 파일 SHA-256: `7a7425587a79b889cbec7f7dd6ce892394ae48dad036b57082780f55a4c9a144`
- API와 관리자 입력 기본값은 모두 `/assets/game-default.webp`입니다.
- 기존 `/assets/game-default.svg`, PNG/JPG 및 기타 default fallback 경로는 안전 복구 SQL 실행 시 `/assets/game-default.webp`로 바뀝니다.
- 화면에서는 `?v=8.7.0`을 붙이고, Netlify는 이 파일을 `must-revalidate`로 제공해 이전 이미지 캐시를 방지합니다.

### 4. 게임 생성
- API의 직접 `games` INSERT를 제거하고 `zip_market_admin_create_game` RPC를 사용합니다.
- RPC가 운영 DB의 실제 `games.id` 타입을 확인합니다.
  - UUID 스키마: UUID 생성
  - 문자형 구형 스키마: 안정적인 고유 slug 사용
  - 숫자형 스키마: 트랜잭션 잠금 후 다음 ID 생성
- `slug`, 이름/제목, 이미지 열, 보상/포인트, 활성/삭제 플래그와 타임스탬프를 구형·신형 호환 열에 함께 기록합니다.
- 같은 이름의 동시 생성은 advisory lock으로 직렬화한 뒤 명확한 중복 오류를 반환합니다.

## 적용 순서 — SQL을 먼저 실행하세요

### 1. Supabase 안전 복구 SQL
1. Supabase → **SQL Editor** → **New query**
2. 별도 제공된 `ZIP_MARKET_v8.7_SAFE_REPAIR.sql` 또는 프로젝트의 `supabase/schema-repair.sql` 전체 복사
3. 새 쿼리에 붙여넣고 아무 텍스트도 선택하지 않은 상태로 **Run**
4. 마지막 결과에서 `schema_version = 8.7.0`과 10개 RPC를 확인

SQL은 `DROP TABLE`, `DELETE FROM`, `TRUNCATE`를 사용하지 않습니다. 참가자·게임·거래·완료 데이터를 삭제하지 않고 열, 기본값, 트리거, RPC와 권한만 비파괴 방식으로 보완합니다. 마지막 단계에서 필수 완료 열, 기본 이미지 경로, 호환 트리거, RPC 반환형과 권한을 DB 카탈로그로 자체 검증합니다.

### 2. GitHub와 Netlify
1. ZIP을 풀고 GitHub 저장소 파일을 v8.7 전체 프로젝트로 교체합니다.
2. `.env.example`은 올려도 되지만 실제 `.env`는 올리지 않습니다.
3. 기존 Netlify 환경변수를 유지합니다.
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `JWT_SECRET`
   - `INITIAL_ADMIN_PASSWORD`
4. Netlify에서 **Clear cache and deploy site**를 한 번 실행합니다.

### 3. 배포 확인

`/api/health` 예상 핵심 값:

```json
{
  "ok": true,
  "database": true,
  "schema": "zip-market-v8.7",
  "version": "8.7.0"
}
```

권장 순서:
1. 관리자 로그인
2. 관리자 비밀번호 변경 → 입력 두 칸이 비워지는지 확인 → 로그아웃 → 새 비밀번호 로그인
3. 새 게임 생성 → ID 오류 없이 ORAC 기본 이미지 표시 확인
4. 동일 게임 이름 재등록 → 명확한 중복 안내 확인
5. 게임 완료 QR 생성·스캔 → 완료 표시, 1회 보상과 거래내역 확인
6. 같은 QR 재스캔 → 추가 보상 없이 이미 완료 안내 확인
7. 결제 QR 및 100/200/300C 직접 결제가 계속 정상인지 확인

## 검증 명령

```bash
npm test
npm run check
```

테스트는 구형 문자 ID·신형 UUID ID, `reward`/`rewarded_amount` 열 조합, 게임 완료 원자 처리와 중복 롤백, 생성 ID 비NULL, 중복 이름, 관리자 비밀번호 변경 후 로그인, 실제 DOM 입력 초기화, 기본 이미지 경로·내용·SHA-256·캐시, API/RPC 계약, health/라우팅, SQL·JavaScript 구문, 참가자/관리자 로그인, 단일/Excel 등록, 결제 QR, 직접 결제, 삭제, 내역, 뒤로가기, 폰트와 반응형 이미지를 포함합니다.
