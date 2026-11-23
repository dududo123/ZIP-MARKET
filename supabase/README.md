# Supabase 적용 순서

- 기존 ZIP! MARKET 운영 DB: `schema-repair.sql` 전체 실행
- 빈 신규 DB: `schema.sql` 전체 실행
- 두 파일을 연속 실행할 필요는 없습니다. 내용은 동일한 멱등 계약이며 첫 줄의 용도 설명만 다릅니다.

Supabase → SQL Editor → New query에서 선택한 파일 전체를 실행하세요. 마지막 결과에서 `schema_version = 8.8.0`과 10개 RPC 행을 확인한 다음 Netlify를 배포합니다.
