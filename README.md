# ZIP! MARKET v8.9.0 — 게임 완료 QR 식별자 복구

첨부 화면의 `게임을 찾을 수 없습니다. (GAME_NOT_FOUND)`를 기준으로 게임 완료 QR의 생성 → 파싱 → 선택 게임 검증 → API → Supabase 완료 RPC 전 구간을 수정한 전체 Netlify 프로젝트입니다.

## 확인된 원인

v8.8 QR 정규화가 `game-pingpong`, `game-<uuid>`처럼 실제로 저장된 `public_id`의 `game-` 접두사를 프로토콜 표식으로 오인해 제거했습니다. QR 해독 자체는 성공했지만 잘린 식별자가 완료 RPC로 전달되어 실제 `games` 행을 찾지 못했습니다.

## v8.9 수정 사항

- 관리자 완료 QR은 `games.public_id`를 우선 사용하여 `ZIPMARKET|GAME|<canonical-public-id>`로 생성합니다.
- `game-`으로 시작하는 실제 식별자는 더 이상 파서에서 잘리지 않습니다.
- `id`(UUID·문자·숫자), `slug`, `public_id`, 게임명 안전 별칭과 기존 compact/JSON/URL QR 형식을 하나의 텍스트 resolver로 해석합니다.
- v8.8에서 이미 출력된, `game-`가 잘린 QR도 원래 행으로 역매핑합니다.
- 게임별 스캐너는 선택 카드의 모든 별칭을 실제 게임 행으로 해석한 뒤 비교합니다.
- 일반 QR 스캐너와 게임별 스캐너는 동일한 canonical 완료 경로를 사용합니다.
- API는 문자열 식별자를 UUID 전용 비교에 넘기지 않습니다. 먼저 `zip_market_resolve_game(text)`으로 canonical 행을 찾은 뒤 canonical 기본키를 `zip_market_complete_game(uuid,text)`에 전달합니다.
- 완료 RPC는 canonical 게임 행을 다시 고정한 다음 완료 기록·보상 크레딧·거래내역을 같은 PostgreSQL 트랜잭션에서 처리합니다.
- 동일 참가자·게임은 한 번만 보상하며 중복 스캔은 `ALREADY_COMPLETED`로 차단합니다.
- 기존 결제 QR 파싱과 결제 처리 코드는 유지했습니다.
- 기존 게임 중 비어 있는 `slug`와 `public_id`를 데이터 삭제 없이 백필합니다.

## 적용 순서 — SQL을 먼저 실행

1. Supabase → **SQL Editor** → **New query**
2. 별도 파일 `ZIP_MARKET_v8.9_SAFE_GAME_IDENTITY_REPAIR.sql` 전체를 붙여넣고 실행
3. 마지막 결과에서 `schema_version = 8.9.0`과 11개 RPC 확인
4. 이 ZIP을 풀어 GitHub 저장소 파일 전체 교체 후 Commit
5. Netlify 기존 환경변수 유지
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `JWT_SECRET`
   - `INITIAL_ADMIN_PASSWORD`
6. Netlify에서 **Clear cache and deploy site**
7. `/api/health`에서 `schema: zip-market-v8.9`, `version: 8.9.0` 확인

## 배포 후 필수 점검

1. 관리자에서 **탁구공 넣기** 완료 QR 새로 생성
2. 사용자 GAME → **탁구공 넣기** 카드 → QR 스캔
3. 완료 표시, +100 C(설정 보상), 거래내역 확인
4. 같은 QR 재스캔 시 추가 보상 차단 확인
5. 새 게임 생성 → 기본 ORAC 이미지 → 관리자 완료 QR 생성
6. 새 게임을 일반 QR 스캐너와 해당 게임 카드 스캐너에서 각각 확인
7. 기존에 출력한 게임 QR도 확인
8. 결제 QR 및 직접 100/200/300 C 결제 확인

## 로컬 검증

```bash
npm run check
npm test
```

테스트에는 첨부 화면의 **탁구공 넣기** 시나리오, 새 게임, 일반/게임별 스캐너, canonical 및 v8.8 출력 QR, UUID·slug·public_id·게임명 별칭, 완료·보상·거래 원자성, 중복 차단, 결제 QR 회귀와 `GAME_NOT_FOUND` 방지가 포함됩니다.
