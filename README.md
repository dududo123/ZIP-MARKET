# ZIP! MARKET v8 — 사용자·관리자 로그인 복구 통합본

## 실제 로그인 장애 원인

최신 프로젝트가 기존 Supabase 데이터베이스와 **서로 다른 열 이름**을 사용하고 있었습니다.

| 기존 운영 DB(V5 계열) | 오류가 난 최신 코드 |
|---|---|
| `participants.employee_no` | `participants.employee_id` |
| `participants.credit_balance` | `participants.credits` |
| `transactions.amount` 중심 | 존재하지 않는 `balance_after` 필수 조회 |

또한 최신 `schema.sql`은 `create table if not exists`만 사용했기 때문에, 이미 존재하는 테이블의 열 이름을 바꾸지 못합니다. 그 결과 사용자 로그인과 관리자 로그인 모두 로그인 직후 참가자/목록 조회 단계에서 실패할 수 있었습니다.

v8은 다음 방식으로 복구합니다.

- 기존 운영 DB의 `employee_no`, `credit_balance`를 그대로 사용
- 기존 참가자·크레딧·게임·내역 데이터 삭제 없음
- 기존 V5 열 이름을 사용하는 인증 함수를 `schema.sql`로 안전하게 추가
- `@supabase/supabase-js`를 사용하지 않고 Supabase REST Data API를 직접 호출
- 기존 bcrypt 비밀번호는 Supabase `pgcrypto`에서 검증
- 관리자 DB 비밀번호와 `INITIAL_ADMIN_PASSWORD`가 다르면 현재 환경변수 비밀번호로 로그인할 때 자동 동기화
- `/api` 리다이렉트가 누락돼도 Function 직접 주소로 한 번 더 요청
- JSON이 아닌 서버 오류를 더 이상 단순한 “요청을 처리하지 못했습니다”로 숨기지 않고 원인을 표시

## V5 이전 폰트 복원

V5 이전의 실제 v4 원본에서 사용한 구성을 그대로 복원했습니다.

- 본문·입력창: **Pretendard**
- 제목·버튼·브랜드 요소: **Jua(주아)**
- 폰트 로드 실패 시 Apple SD Gothic Neo, Noto Sans KR, 맑은 고딕 순으로 대체

## 배포 순서

1. 압축을 풀고 GitHub 저장소 내용을 이 프로젝트 파일로 **전체 교체**합니다.
2. Supabase → SQL Editor에서 `supabase/schema.sql` 전체를 한 번 실행합니다.
   - 기존 데이터는 삭제하지 않습니다.
   - 기존 열 이름을 바꾸지 않고 로그인 인증 함수, 새 게임 보상, 원자적 크레딧 처리 함수만 안전하게 보강합니다.
   - 이 SQL을 실행하지 않으면 로그인 화면에 `SCHEMA_MISSING` 안내가 표시됩니다.
3. Netlify Environment variables에 아래 4개가 있는지 확인합니다.
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY` (`sb_secret_...` 또는 기존 `eyJ...` service_role)
   - `JWT_SECRET`
   - `INITIAL_ADMIN_PASSWORD`
4. Netlify에서 한 번 배포합니다.
5. 배포 후 `https://사이트주소/api/health`를 엽니다.

정상 예시:

```json
{
  "ok": true,
  "database": true,
  "adminInitialized": true,
  "transport": "direct-rest",
  "schema": "v5-compatible",
  "version": "8.0.0"
}
```

6. 관리자 로그인은 현재 Netlify의 `INITIAL_ADMIN_PASSWORD` 값으로 확인합니다.
7. 기존에 등록된 참가자의 사번과 비밀번호로 사용자 로그인을 확인합니다.

## 유지된 기능

- 사용자·관리자 로그인 및 로그인 복원
- Supabase 연동
- 참가자 개별·일괄 등록, 검색 초기화, 삭제
- 크레딧 지급·차감·고정 금액 결제
- 관리자 결제 QR, 중복 결제 방지
- iPhone 카메라 및 사진 QR 인식
- 게임 추가·삭제·완료 QR·중복 완료 방지·보상
- 모바일·PC 뒤로가기 내부 기록
- 결제 팝업 우측 상단 X, 바깥 영역, ESC, 뒤로가기로 취소
- 사용내역 최근 5개와 `⌄ 나머지 내역도 보기`
- iPhone 13 mini(375px)에서 로고·결제·게임 이미지가 잘리지 않는 `object-fit: contain`
- 로그인 데이터 묶음 반환과 병렬 조회
- QR 라이브러리 지연 로딩

## 폴더 구조

```text
netlify/functions/api.mjs   Netlify 서버 API
public/index.html           화면 구조
public/styles.css           반응형 디자인 및 폰트
src/app.js                  사용자·관리자 화면 동작
supabase/schema.sql         기존 데이터 보존형 DB 보강 SQL
scripts/build.mjs           dist 빌드
```

## 보안

- Supabase Secret/service_role 키는 브라우저 코드에 포함하지 않습니다.
- 모든 DB 요청은 Netlify Function에서만 실행됩니다.
- 로그인 세션과 QR payload는 `JWT_SECRET`으로 서명합니다.
- 결제·관리자 크레딧 조정·게임 보상은 SQL 함수에서 처리해 중복 및 동시 요청을 방지합니다.
