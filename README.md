# ZIP! MARKET v9.0.0 — 게임별 완료 보상 관리자 설정

v8.9의 결제·로그인·참가자 등록·Excel 등록·관리자 비밀번호·QR 식별자 호환·중복 보상 차단을 유지하면서, 관리자가 화면에서 게임별 완료 보상을 만들고 수정할 수 있게 연결한 전체 Netlify 프로젝트입니다.

## 구현 내용

- 신규 게임 폼: 50/100/200/300/500 C 프리셋과 자유 숫자 입력
- 신규 게임 생성 시 입력한 `reward`를 DB에 저장
- 기존 게임 카드: 현재 보상 숫자 입력칸 + `보상 저장` 버튼
- 저장 후 관리자 대시보드를 다시 조회해 DB 반영값 표시
- 사용자 GAME 카드: `완료 시 +N C` 표시
- 완료 QR: 금액이 아니라 기존 게임 식별자를 유지
- 완료 처리: 스캔 시 DB의 현재 `games.reward`를 조회해 지급
- 완료 기록의 `reward`/`rewarded_amount`와 거래내역에 실제 지급액을 스냅샷으로 저장
- 이후 관리자가 reward를 바꿔도 과거 완료 기록·거래내역·잔액은 변경하지 않음

## 배포 순서

1. Supabase → SQL Editor → New query
2. 별도 제공된 `ZIP_MARKET_v9.0_SAFE_GAME_REWARD_REPAIR.sql` 전체 붙여넣기 후 Run
3. 마지막 결과에서 `schema_version = 9.0.0` 확인
4. ZIP 압축 해제
5. GitHub 저장소 파일을 압축 해제한 프로젝트로 전체 교체
6. 실제 `.env`는 업로드하지 않고 기존 Netlify 환경변수 4개 유지
7. Netlify에서 Clear cache and deploy site
8. `/api/health`에서 `schema: zip-market-v9.0`, `version: 9.0.0` 확인

## 검증

`npm run check && npm test`

검증 상세는 `VALIDATION.md`를 참고하세요. 실제 운영 Supabase/Netlify에는 자동으로 변경을 적용하지 않았습니다.
