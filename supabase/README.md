# Supabase SQL

- `schema.sql`: 신규/기존 환경용 전체 멱등 스키마
- `schema-repair.sql`: 기존 운영 데이터를 유지하는 안전 복구본

Supabase → SQL Editor → New query에서 선택한 파일 전체를 실행하세요. 마지막 결과에서 `schema_version = 9.0.0`과 12개 RPC 행을 확인한 다음 Netlify를 배포합니다.
