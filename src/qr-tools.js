import { Html5Qrcode } from 'html5-qrcode';
import QRCode from 'qrcode';

let activeScanner = null;

export async function makeQrDataUrl(text) {
  return QRCode.toDataURL(text, { width: 720, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#061b3a', light: '#ffffff' } });
}

export async function stopScanner() {
  if (!activeScanner) return;
  const scanner = activeScanner;
  activeScanner = null;
  try {
    if (scanner.isScanning) await scanner.stop();
  } catch (_) {}
  try { await scanner.clear(); } catch (_) {}
}

export async function startCamera(elementId, onDecoded, onScanError = () => {}) {
  await stopScanner();
  const element = document.getElementById(elementId);
  if (!element) throw new Error('스캐너 화면을 찾을 수 없습니다.');
  element.innerHTML = '';
  const scanner = new Html5Qrcode(elementId, { verbose: false });
  activeScanner = scanner;
  await scanner.start(
    { facingMode: 'environment' },
    { fps: 10, qrbox: (w, h) => { const size = Math.floor(Math.min(w, h) * .72); return { width: size, height: size }; }, aspectRatio: 1 },
    async (text) => { await stopScanner(); onDecoded(text); },
    onScanError
  );
}

export async function scanImageFile(elementId, file) {
  await stopScanner();
  const element = document.getElementById(elementId);
  if (!element) throw new Error('스캐너 화면을 찾을 수 없습니다.');
  element.innerHTML = '';
  const scanner = new Html5Qrcode(elementId, { verbose: false });
  activeScanner = scanner;
  try { return await scanner.scanFile(file, true); }
  finally { await stopScanner(); }
}
