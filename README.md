# ZIP! MARKET Netlify 배포 프로젝트

## 1. Supabase 준비
1. Supabase에서 새 프로젝트를 생성합니다.
2. SQL Editor에서 `supabase/schema.sql` 전체를 실행합니다.
3. Project Settings > API에서 `Project URL`과 `service_role key`를 확인합니다.

## 2. Netlify 환경변수
Netlify Site configuration > Environment variables에 아래 값을 추가합니다.
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `JWT_SECRET` (32자 이상의 임의 문자열)
- `INITIAL_ADMIN_PASSWORD` (초기 관리자 암호)

## 3. 배포
GitHub 저장소에 이 폴더를 올리고 Netlify에서 Import an existing project로 연결합니다.
- Build command: 비워둠
- Publish directory: `public`
- Functions directory: `netlify/functions`

또는 Netlify CLI:
```bash
npm install
npx netlify login
npx netlify init
npx netlify deploy --build --prod
```

## 4. 최초 테스트 참가자
관리자 로그인 후 참가자를 개별 등록하거나 엑셀 붙여넣기로 등록합니다.
엑셀 열 순서: 사번 / 이름 / 초기비밀번호 / 초기크레딧

## 5. 로컬 테스트
`.env.example`을 `.env`로 복사하고 실제 값을 넣은 후:
```bash
npm install
npx netlify dev
```

## 중요
- `SUPABASE_SERVICE_ROLE_KEY`는 절대 브라우저 코드나 GitHub 공개 저장소에 넣지 마세요.
- 카메라 QR 스캔은 HTTPS에서 작동합니다.
- iPhone Safari 등 BarcodeDetector 미지원 브라우저는 후속 단계에서 html5-qrcode 폴백이 필요할 수 있습니다.
