# Supabase v8.9 적용

1. Supabase SQL Editor에서 **New query**를 만듭니다.
2. `schema-repair.sql` 전체를 붙여넣고 Run 합니다.
3. 기존 쿼리나 테이블은 삭제하지 않습니다.
4. 마지막 결과에서 `schema_version = 8.9.0`과 11개 RPC를 확인합니다.
5. SQL 성공 후에만 Netlify v8.9 프로젝트를 배포합니다.

이 SQL은 기존 참가자, 게임, 거래, 완료 기록을 삭제하지 않으며 `games.builtin`, 공개 식별자, 필수 타임스탬프와 게임 생성/완료 RPC 계약을 비파괴 방식으로 복구합니다.
