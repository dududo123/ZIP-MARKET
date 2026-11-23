# ZIP! MARKET v9.0 검증 기록

## 자동 검증 완료

- JavaScript 문법 및 Netlify Function Web `Response` 형식
- SQL 구문 구조, 12개 RPC 시그니처·권한·PostgREST 캐시 갱신
- 신규 게임 생성: 프리셋이 아닌 275 C 자유 입력 → DB 저장 → 관리자 재조회
- 기존 게임 보상 수정: 425 C 저장 → 관리자 및 사용자 대시보드 재조회
- 사용자 GAME 카드에 현재 reward 데이터 연결
- 완료 QR 식별자 해석 후 현재 DB reward 425 C 지급
- 완료 기록 `reward`/`rewarded_amount` 및 거래내역에 425 C 스냅샷
- 같은 참가자의 같은 게임 재완료 시 `ALREADY_COMPLETED`, 추가 지급 없음
- 완료 후 게임 보상을 900 C로 변경해도 과거 425 C 지급 기록·거래·잔액 불변
- 정상 결제 경로 회귀 테스트
- v8.9의 UUID/text/numeric ID, slug, public_id, `game-` 접두사 및 과거 QR 호환 테스트
- 로그인, 참가자 개별/Excel 등록, 비밀번호 변경, 삭제, 뒤로가기, 사용내역 펼침, 폰트, 기본 이미지, 반응형 UI 회귀 테스트

## 운영환경 미확인 범위

검증 컨테이너는 실제 운영 Supabase 및 Netlify 자격증명에 접근하거나 운영 DB를 변경하지 않았습니다. 따라서 SQL 실행·Netlify 배포 후 실제 관리자 화면 저장과 휴대폰 QR 스캔은 운영환경에서 최종 확인해야 합니다.
