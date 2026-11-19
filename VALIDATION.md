# ZIP! MARKET v8.7 validation record

## 통과 대상

- SQL 함수 본문, 괄호, dollar quote, 안전한 search path 구조 검사
- API ↔ Supabase 10개 RPC 이름·인수명·타입·JSON 키·반환형·권한 계약
- 구형 문자형 게임 ID 및 신형 UUID 게임 ID 모델
- 구형 필수 `game_completions.reward`, 신규 `rewarded_amount`, 누적 스키마 동시 채움
- 게임 완료 예약 → 잔액 증가 → 거래 기록 순서와 예외 시 전체 롤백 모델
- 같은 참가자/게임 두 번째 완료 시 잔액·완료·거래 불변 검사
- 게임 이름 중복 잠금/검사, text/UUID/numeric ID 생성 분기와 ID 비NULL 검사
- 기존 default SVG/PNG/JPG 경로의 WebP 마이그레이션 및 신규 저장 경로
- 제공 `game-default.webp` 900×600 파일과 SHA-256 일치, 오래된 SVG 미포함
- v8.7 asset URL query cache bust 및 Netlify must-revalidate 헤더
- 관리자 비밀번호 저장, 변경 후 새 비밀번호 성공·초기 비밀번호 실패 API 검사
- 실제 관리자 비밀번호 폼의 두 입력값 초기화 및 null-safe DOM 검사
- 참가자/관리자 로그인 성공·실패
- 참가자 단일 등록 및 Excel 원자적 일괄등록/롤백
- 결제 QR 파서, 직접 결제, 요청 ID 멱등성, 잘못된 금액
- 참가자/게임 삭제 순서, 사용내역 5건/펼치기, 모달·뒤로가기
- Jua/Pretendard, 이미지 contain/3:2/모바일 1열
- `/api/health`, 직접 Function 주소, 404, OPTIONS, 응답 envelope
- 전체 JavaScript 문법 및 최종 ZIP 해제 후 동일 테스트 재실행

의도적으로 발생시키는 `LOGIN_FAILED`, 중복 참가자/게임, 잘못된 행/금액, 미인증과 404 로그는 실패 경로 assertion이며 테스트 실패가 아닙니다.

## 운영 환경 경계

로컬 검증 환경에는 운영 Supabase 비밀값이 없습니다. 따라서 운영 데이터베이스를 직접 변경하지 않습니다. 대신 안전 복구 SQL은 데이터 삭제 명령을 포함하지 않으며, 실행 마지막에 운영 DB 자체에서 필수 열·NULL 제약·호환 트리거·기본 이미지 마이그레이션·RPC 시그니처·반환형·권한을 검사하고 이상이 있으면 성공으로 끝내지 않습니다.
