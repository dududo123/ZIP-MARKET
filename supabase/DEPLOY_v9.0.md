# Supabase v9.0 적용

1. Supabase → SQL Editor → New query를 엽니다.
2. `ZIP_MARKET_v9.0_SAFE_GAME_REWARD_REPAIR.sql` 전체를 붙여넣습니다.
3. 일부만 선택하지 말고 전체를 한 번에 Run 합니다.
4. 마지막 결과에서 `schema_version = 9.0.0`과 12개 RPC를 확인합니다.
5. SQL 성공 후 Netlify v9.0 프로젝트를 배포합니다.

이 SQL은 테이블을 DROP하거나 참가자·게임·거래·완료 행을 DELETE하지 않습니다. 게임 보상 수정 RPC를 추가하며, 과거 완료 보상 스냅샷은 수정하지 않습니다.
