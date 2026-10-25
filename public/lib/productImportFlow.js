// 제품 이미지 넣기 흐름 — 원래 빌더(ProductRow)와 같은 순서로 팝업을 이어 붙인다.
//
//   URL Import → 갤러리 팝업에서 선택 ┐
//   파일 Upload ─────────────────────┴→ 누끼 → 브러시 편집 팝업 → 크롭 팝업 → 투명 여백 정리
//
// 다른 빌더로 옮길 때 public/lib 폴더(+ productImport.css)와 서버의 lib/productImport.ts 를
// 함께 가져간다. 화면 쪽은 importFromUrl / importFromFile / editProduct 세 함수만 부르면 된다.

import { removeBackgroundAI } from './bgRemoval.js';
import { scrapeProductImages, fetchAsDataUrl, blobToDataUrl, trimTransparent } from './productApi.js';
import { openGalleryModal } from './galleryModal.js';
import { openBrushMaskEditor } from './brushMaskEditor.js';
import { openCropModal } from './cropModal.js';

/**
 * 완성된 제품 이미지. 재편집을 위해 중간 단계를 같이 들고 있는다.
 * @typedef {{
 *   original: string,   // 누끼 전 원본 (브러시 Restore 소스)
 *   brushed: string,    // 누끼 + 브러시까지 끝낸 것 (크롭 소스)
 *   cropRect: {x:number,y:number,w:number,h:number}|null,
 *   src: string,        // 최종 (크롭 + 여백 정리) — 화면에 놓는 이미지
 *   w: number, h: number,
 *   meta?: { model: string, name: string },
 *   images?: any[],     // URL Import 로 받은 이미지 목록 (다른 이미지로 바꿀 때 재사용)
 * }} ProductImage
 */

/** 누끼가 도는 동안 띄우는 전체 화면 표시. */
function withBusy(message, fn) {
  const el = document.createElement('div');
  el.className = 'pi-backdrop dark';
  el.innerHTML = '<div class="pi-busy"><span class="pi-spin"></span><p></p></div>';
  el.querySelector('p').textContent = message;
  document.body.append(el);
  // 표시가 먼저 그려지도록 한 프레임 쉰 뒤 무거운 작업을 시작한다
  return new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)))
    .then(fn)
    .finally(() => el.remove());
}

/** 원본 → 브러시 → 크롭. 어느 팝업이든 취소하면 null. */
async function brushThenCrop(original, processed, prevCropRect = null) {
  const brushed = await openBrushMaskEditor({ originalUrl: original, processedUrl: processed });
  if (!brushed) return null;
  return cropAndTrim({ original, brushed, cropRect: prevCropRect });
}

async function cropAndTrim({ original, brushed, cropRect }) {
  const crop = await openCropModal({ imageSrc: brushed, initialRect: cropRect });
  if (!crop) return null;
  const t = await trimTransparent(crop.dataUrl);
  return { original, brushed, cropRect: crop.rect, src: t.dataUrl, w: t.width, h: t.height };
}

async function fromSource(src, { removeBg = true } = {}) {
  const original = src.startsWith('data:') ? src : await withBusy('Loading image…', () => fetchAsDataUrl(src));
  const processed = removeBg
    ? await withBusy('Removing background…', () => removeBackgroundAI(original))
    : original;
  return brushThenCrop(original, processed);
}

/**
 * 제품 페이지 URL → 갤러리 팝업 → 선택한 이미지로 편집 흐름.
 * `images` 를 넘기면 다시 크롤링하지 않고 그 목록으로 갤러리를 연다 ("Change image").
 * @returns {Promise<ProductImage|null>}
 */
export async function importFromUrl(url, { images, removeBg = true } = {}) {
  let meta;
  const { pick, images: list } = await openGalleryModal(
    images?.length
      ? { images }
      : {
          load: async () => {
            const res = await scrapeProductImages(url);
            meta = { model: res.modelName || '', name: res.productName || '' };
            return res;
          },
        },
  );
  if (!pick) return null;
  const out = await fromSource(pick.url, { removeBg });
  return out && { ...out, meta, images: list };
}

/** 내 파일 → 편집 흐름. */
export async function importFromFile(file, { removeBg = true } = {}) {
  return fromSource(await blobToDataUrl(file), { removeBg });
}

/** 이미 넣은 제품을 다시 다듬는다 (브러시부터, 이전 크롭 프레임 유지). */
export async function editProduct(product) {
  const out = await brushThenCrop(product.original, product.brushed, product.cropRect);
  return out && { ...product, ...out };
}

/** 크롭만 다시 한다. */
export async function recropProduct(product) {
  const out = await cropAndTrim(product);
  return out && { ...product, ...out };
}
