// 크롤링된 제품 이미지 중 하나를 고르는 그리드 모달.
// 07 sales template/sales-banner-builder 의 ImageGalleryModal.tsx 를 순수 JS 로 옮긴 것.
//
//   const img = await openGalleryModal({ load: () => scrapeProductImages(url) });
//   → 고른 ScrapedImage, 닫으면 null

import { getProxiedImageUrl } from './productApi.js';

/**
 * 제품컷 판정 기준.
 *
 * 누끼는 흰 배경을 테두리에서 흘려 지우는 방식이라, 배경이 흰 사진만 제대로 따진다.
 * 파일명·해상도로는 못 가른다 — 같은 갤러리 시리즈 안에도 흰 배경 컷과 연출 컷이
 * 섞여 있다. 테두리 픽셀이 흰색인 비율만이 둘을 확실히 갈랐다 (제품컷 100% / 연출 0~28%).
 */
const WHITE_MIN = 243;
const CUT_WHITE_RATIO = 0.95;
/** 이보다 작으면 아이콘·로고로 보고 제품컷으로 치지 않는다 */
const CUT_MIN_SIDE = 200;
/** 테두리를 재는 축소 캔버스 크기 — 원본을 다 읽을 필요는 없다 */
const PROBE_SIZE = 96;

/** 축소 캔버스에 그려 테두리 한 줄의 흰색 비율을 잰다. 프록시 경유라 same-origin. */
function measure(img) {
  const w = img.naturalWidth, h = img.naturalHeight;
  if (!w || !h) return null;
  const s = Math.min(1, PROBE_SIZE / Math.max(w, h));
  const cw = Math.max(2, Math.round(w * s)), ch = Math.max(2, Math.round(h * s));
  const cv = document.createElement('canvas');
  cv.width = cw; cv.height = ch;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  try {
    ctx.drawImage(img, 0, 0, cw, ch);
    const d = ctx.getImageData(0, 0, cw, ch).data;
    let white = 0, total = 0;
    const chk = (x, y) => {
      const p = (y * cw + x) * 4;
      total++;
      // 이미 투명한 배경도 "지울 수 있는 배경"으로 친다 (PNG 누끼본)
      if (d[p + 3] < 8) { white++; return; }
      if (d[p] >= WHITE_MIN && d[p + 1] >= WHITE_MIN && d[p + 2] >= WHITE_MIN) white++;
    };
    for (let x = 0; x < cw; x++) { chk(x, 0); chk(x, ch - 1); }
    for (let y = 0; y < ch; y++) { chk(0, y); chk(cw - 1, y); }
    return { w, h, white: total ? white / total : 0 };
  } catch {
    return null; // 혹시라도 캔버스가 오염되면 정렬만 포기한다
  }
}

const isCut = (m) => m.white >= CUT_WHITE_RATIO && Math.max(m.w, m.h) >= CUT_MIN_SIDE;

/**
 * @param {{ load?: () => Promise<{images: any[], error?: string}>, images?: any[] }} opts
 *   load 를 주면 모달을 먼저 띄우고 로딩 표시 → 결과로 채운다. images 를 주면 바로 보여 준다.
 * @returns {Promise<{ pick: object|null, images: any[] }>}
 */
export function openGalleryModal({ load, images: given }) {
  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.className = 'pi-backdrop';
    root.innerHTML = `
      <div class="pi-modal pi-gallery" role="dialog" aria-modal="true">
        <div class="pi-head">
          <div><strong>Select a product image</strong> <span class="pi-sub" data-ref="count"></span></div>
          <button type="button" class="pi-x" data-ref="close" aria-label="Close">×</button>
        </div>
        <div class="pi-body" data-ref="body"></div>
      </div>`;
    const $ = (r) => root.querySelector(`[data-ref="${r}"]`);
    let images = given || [];
    const meas = new Map();

    const finish = (pick) => {
      document.removeEventListener('keydown', onKey);
      root.remove();
      resolve({ pick, images });
    };
    const onKey = (e) => { if (e.key === 'Escape') finish(null); };
    document.addEventListener('keydown', onKey);
    root.addEventListener('mousedown', (e) => { if (e.target === root) finish(null); });
    $('close').addEventListener('click', () => finish(null));

    const message = (text, spinner = false) => {
      $('body').innerHTML = `<div class="pi-empty">${spinner ? '<span class="pi-spin"></span>' : ''}<p></p></div>`;
      $('body').querySelector('p').textContent = text;
    };

    /*
      제품컷 먼저, 그 안에서 해상도 높은 순.
      아직 안 잰 것은 원래 순서를 지키며 뒤에 둔다 — 로드되는 대로 제자리를 찾는다.
    */
    const reorder = () => {
      const grid = $('body').querySelector('.pi-grid');
      if (!grid) return;
      const rank = (url) => { const m = meas.get(url); return !m ? 1 : isCut(m) ? 0 : 2; };
      const tiles = [...grid.children];
      tiles.sort((a, b) => {
        const ra = rank(a.dataset.url), rb = rank(b.dataset.url);
        if (ra !== rb) return ra - rb;
        const ma = meas.get(a.dataset.url), mb = meas.get(b.dataset.url);
        if (ma && mb && mb.w * mb.h !== ma.w * ma.h) return mb.w * mb.h - ma.w * ma.h;
        return a.dataset.i - b.dataset.i;
      });
      tiles.forEach((t) => grid.append(t));
      const cuts = [...meas.values()].filter(isCut).length;
      $('count').textContent = cuts ? `${cuts} cutout-ready first` : '';
    };

    const renderGrid = () => {
      if (!images.length) return message('No images found on this page.');
      const grid = document.createElement('div');
      grid.className = 'pi-grid';
      images.forEach((im, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'pi-tile';
        b.title = im.context || im.url;
        b.dataset.url = im.url;
        b.dataset.i = i;
        const img = document.createElement('img');
        img.loading = 'lazy';
        img.draggable = false;
        img.alt = im.context || '';
        img.addEventListener('load', () => {
          const m = measure(img);
          if (!m || meas.has(im.url)) return;
          meas.set(im.url, m);
          b.insertAdjacentHTML('beforeend', `<span class="pi-dim">${m.w}×${m.h}</span>`);
          if (isCut(m)) {
            b.classList.add('cut');
            b.insertAdjacentHTML('beforeend', '<span class="pi-badge">CUTOUT</span>');
          }
          reorder();
        });
        img.src = getProxiedImageUrl(im.url);
        b.append(img);
        b.addEventListener('click', () => finish(im));
        grid.append(b);
      });
      $('body').replaceChildren(grid);
    };

    document.body.append(root);

    if (load) {
      message('Fetching images…', true);
      load().then((res) => {
        if (!root.isConnected) return;
        if (res.error) return message(res.error);
        images = res.images || [];
        renderGrid();
      });
    } else {
      renderGrid();
    }
  });
}
