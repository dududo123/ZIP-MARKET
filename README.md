# ZIP MARKET iPhone QR + Speed Fix

GitHub 저장소에서 다음 항목을 교체하세요.
- `public/index.html`
- `src/app.js` (새 폴더)
- `netlify/functions/api.mjs`
- `package.json`
- `netlify.toml`
- `public/assets/*`

주요 변경:
- iOS Safari/Naver 인앱 브라우저 대응: BarcodeDetector 제거, html5-qrcode 사용
- 카메라 QR + 사진 파일 QR 스캔 제공
- 로그인 API가 사용자/거래/게임/완료 상태를 한 번에 반환
- 결제/게임 완료 후에도 한 번의 응답으로 화면 갱신
- 관리자 초기화 체크를 일반 사용자 요청마다 반복하지 않음
- 이미지 장기 캐시, app.js 캐시 적용

GitHub Commit 후 Netlify가 `npm run build`를 실행합니다.
Deploy log에서 esbuild 성공과 Function 배포를 확인하세요.
