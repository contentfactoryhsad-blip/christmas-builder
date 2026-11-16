/**
 * 사용 기록 — 블프 빌더(src/app/utils/usageClient.ts · hubCountry.ts)를 이 빌더(모듈 JS)로 옮긴 것.
 * 다운로드가 끝난 뒤 한 줄 남기고(/api/log-usage → logs/usage.csv), 파일별 썸네일을 올린다(/api/output).
 * 관리자 화면(stats.html)이 읽는다. 어느 단계든 실패하면 조용히 넘어간다 — 다운로드에는 영향이 없다.
 */

// 국가(법인) — 허브에서 넘어왔거나 첫 화면 팝업에서 고른 값 (countryPicker.js)
import { getHubCountry } from './countryPicker.js';

/** 한 줄 남긴다 — { item, detail, files, output } */
export async function logUsage(rec) {
  try {
    const country = getHubCountry()?.country;
    await fetch('/api/log-usage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ builder: 'christmas', ...rec, ...(country ? { country } : {}) }),
      keepalive: true, // 다운로드 직후 창을 닫아도 전송이 살아남는다
    });
  } catch { /* 조용히 무시 */ }
}

/** 긴 변 600px JPEG — 원본 PNG 의 1/10 이하라 서버에 계속 쌓아도 부담이 적다 */
export async function makeThumb(png, longSide = 600) {
  try {
    const bmp = await createImageBitmap(png);
    const k = Math.min(1, longSide / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * k));
    c.height = Math.max(1, Math.round(bmp.height * k));
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close();
    return await new Promise(r => c.toBlob(r, 'image/jpeg', 0.8));
  } catch { return null; }
}

/** 서버가 받는 이름 꼴(영숫자 · - · _ , 80자) */
export const thumbName = s => s.replace(/\.[a-z0-9]+$/i, '').replace(/[^a-z0-9_-]+/gi, '_').slice(0, 80);

export const newOutputId = () => (typeof crypto.randomUUID === 'function'
  ? crypto.randomUUID()
  : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

/** 썸네일을 4장씩 나눠 올린다 — 회사망에서 다른 요청을 막지 않게 */
export async function uploadOutput(id, thumbs) {
  const queue = [...thumbs];
  const worker = async () => {
    for (let t = queue.shift(); t; t = queue.shift()) {
      try {
        await fetch(`/api/output?id=${encodeURIComponent(id)}&name=${encodeURIComponent(t.name)}`, {
          method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: t.blob,
        });
      } catch { /* 조용히 무시 */ }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
}
