// 제품 이미지 API — 크롤링, 프록시로 받기, 투명 여백 잘라내기.
// 팝업 흐름(갤러리 → 누끼 → 브러시 → 크롭)은 productImportFlow.js 가 묶는다.

/** 제품 페이지를 크롤링해 이미지 목록 + 모델명 + 제품명을 받는다. */
export async function scrapeProductImages(url) {
  try {
    const res = await fetch('/api/crawl-page', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { images: [], error: data.error || `Failed (${res.status})` };
    return { images: data.images || [], modelName: data.modelName || '', productName: data.productName || '' };
  } catch (err) {
    return { images: [], error: err.message || 'Network error' };
  }
}

export function getProxiedImageUrl(originalUrl) {
  // 사용자 업로드는 프록시가 필요 없다 (프록시도 거부한다).
  if (originalUrl.startsWith('data:') || originalUrl.startsWith('blob:')) return originalUrl;
  return `/api/proxy-image?url=${encodeURIComponent(originalUrl)}`;
}

/** URL 의 이미지를 dataURL 로 받는다. 캔버스가 픽셀을 읽어야 하므로 프록시를 거친다. */
export async function fetchAsDataUrl(url) {
  const res = await fetch(getProxiedImageUrl(url));
  if (!res.ok) throw new Error(`Image fetch failed (${res.status})`);
  return blobToDataUrl(await res.blob());
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image load failed'));
    img.src = src;
  });
}

/**
 * 투명 여백을 잘라낸다. 누끼 뒤에는 원본 사진의 흰 여백만큼 빈 칸이 남는데,
 * 이걸 두면 "바닥에 붙이기"가 여백 높이만큼 떠 버린다 — 제품의 실제 발끝이
 * 이미지 하단이 되어야 영역 바닥·그림자 기준이 맞는다.
 */
export async function trimTransparent(dataUrl, alphaMin = 8) {
  const img = await loadImage(dataUrl);
  const w = img.naturalWidth, h = img.naturalHeight;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] >= alphaMin) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return { dataUrl, width: w, height: h }; // 전부 투명 — 그대로 둔다
  const tw = x1 - x0 + 1, th = y1 - y0 + 1;
  const out = document.createElement('canvas');
  out.width = tw; out.height = th;
  out.getContext('2d').drawImage(c, x0, y0, tw, th, 0, 0, tw, th);
  return { dataUrl: out.toDataURL('image/png'), width: tw, height: th };
}
