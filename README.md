# ZIP MARKET complete v3
GitHub 저장소의 아래 항목을 모두 덮어쓴 뒤 Commit 하세요.
- package.json
- netlify.toml
- public/
- src/
- netlify/functions/api.mjs

추가 기능
- 게임 삭제
- 참가자 삭제 (관련 transactions/game_completions는 FK cascade로 삭제)
- 참가자 검색 초기화 버튼 수정
- 새 게임의 기본 이미지: ORAC 4명이 GAME 노트북 앞에 모인 이미지
- iPhone 카메라/사진 QR 스캔 유지

주의: 테이블 DELETE 권한이 없다면 Supabase SQL Editor에서 아래를 실행하세요.
grant delete on table public.participants, public.games, public.transactions, public.game_completions to service_role;
