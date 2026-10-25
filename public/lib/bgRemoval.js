// 07 sales template/sales-banner-builder/src/app/utils/aiBgRemoval.ts 를 그대로
// JS 로 옮긴 것 (타입만 뺐다). 로직을 고칠 때는 원본과 함께 맞춘다.
//
// Conservative background removal for product images.
//
// Deliberately NOT ML-based. The `@imgly/background-removal` model kept eating
// white product bodies (a white LG washer/dryer on a white studio background):
// it makes the whole white body transparent in one border-connected sweep, so
// even a connectivity guard can't tell it apart from the real background
// (see memory: feedback_bg_remove_attempts).
//
// The shape of the thing:
//   1. Treat ONLY near-pure-white pixels as erasable background.
//   2. Flood-fill inward from the image border through those white pixels —
//      erase from the OUTSIDE in. Any white region not reachable from the
//      border (a white product panel enclosed by its own darker edges/shadows)
//      is never touched.
//   3. Repair the mask, then feather and de-fringe its edge.
//
// Step 3 is what makes a white product usable. A white body on a white backdrop
// is separated from it by nothing but a faint grey outline, and JPEG noise
// pushes that outline above and below the threshold from one pixel to the next.
// The flood leaks a few pixels into the body wherever the outline reads as
// white, which is the ragged, crinkled edge that made this unusable — not one
// big failure but hundreds of shallow bites.
//
// Those bites are narrow, so morphology closes them: dilate-then-erode bridges
// any notch thinner than twice its radius while leaving the true silhouette
// where it is. It can only ADD product back, never take more away, which is the
// property every earlier attempt at a smarter flood lacked.
//
// Falls back to the original image on any failure.

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image load failed'));
    img.src = src;
  });
}

/**
 * Flood-fill inward from every border pixel, expanding only through pixels the
 * `passable` predicate accepts. Returns a per-pixel reached/not-reached map.
 * Iterative (typed-array stack) to survive multi-million-pixel images.
 */
function floodFromBorder(w, h, passable) {
  return flood(w, h, (i) => {
    const x = i % w;
    const y = (i / w) | 0;
    return x === 0 || y === 0 || x === w - 1 || y === h - 1;
  }, passable);
}

/** Flood outward from every seed pixel, expanding only through `passable`. */
function flood(
  w, h, isSeed, passable,
) {
  const N = w * h;
  const reached = new Uint8Array(N);
  const stack = new Int32Array(N);
  let sp = 0;
  const push = (i) => {
    if (!reached[i] && passable(i)) { reached[i] = 1; stack[sp++] = i; }
  };
  for (let i = 0; i < N; i++) if (isSeed(i)) push(i);
  while (sp > 0) {
    const i = stack[--sp];
    const x = i % w;
    const y = (i / w) | 0;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (y > 0) push(i - w);
    if (y < h - 1) push(i + w);
  }
  return reached;
}

/**
 * Separable box dilate/erode on a 0/1 mask.
 *
 * Out of frame is neutral rather than empty: a product that runs off the edge
 * of the photo would otherwise be eroded away along that edge.
 */
function morph(
  mask, w, h, r, mode,
) {
  if (r <= 0) return mask;
  const want = mode === 'dilate' ? 1 : 0;
  const other = want ^ 1;
  const tmp = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let hit = false;
      for (let d = -r; d <= r; d++) {
        const xx = x + d;
        if (xx < 0 || xx >= w) continue;
        if (mask[row + xx] === want) { hit = true; break; }
      }
      tmp[row + x] = hit ? want : other;
    }
  }
  const out = new Uint8Array(mask.length);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let hit = false;
      for (let d = -r; d <= r; d++) {
        const yy = y + d;
        if (yy < 0 || yy >= h) continue;
        if (tmp[yy * w + x] === want) { hit = true; break; }
      }
      out[y * w + x] = hit ? want : other;
    }
  }
  return out;
}

const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

/** Per-channel minimum for a pixel to count as "near-pure-white" background. */
const WHITE_MIN = 243;
/** Source alpha below this counts as already-transparent. */
const ALPHA_MIN = 8;
/**
 * Notches up to this wide, as a fraction of the shorter side, are read as
 * threshold noise and closed. Sized in image terms rather than pixels so a
 * 600px thumbnail and a 2400px hero get the same treatment; the clamp keeps it
 * from bridging a real gap on a very large photo.
 */
const CLOSE_FRACTION = 1 / 400;
const CLOSE_MAX = 3;
/**
 * Below this a partly-transparent pixel's own colour is too close to the white
 * it was shot against to un-mix reliably — dividing by that difference only
 * amplifies noise into a coloured rim. White products land here and simply keep
 * the colour they came with.
 */
const DEFRINGE_MIN_CONTRAST = 24;

async function floodWhiteBackground(dataUrl) {
  const img = await loadImage(dataUrl);
  // Keep native resolution (product photos are modest); cap only enormous ones
  // so the flood-fill stays fast.
  const MAX_SIDE = 3000;
  const nW = img.naturalWidth;
  const nH = img.naturalHeight;
  const scale = Math.min(1, MAX_SIDE / Math.max(nW, nH));
  const w = Math.max(1, Math.round(nW * scale));
  const h = Math.max(1, Math.round(nH * scale));

  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = w;
  srcCanvas.height = h;
  const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true });
  if (!srcCtx) throw new Error('Canvas context unavailable');
  srcCtx.drawImage(img, 0, 0, w, h);
  const sd = srcCtx.getImageData(0, 0, w, h).data;
  const N = w * h;

  // Erasable background = connected to the frame edge AND either near-pure-white
  // or already transparent. Without the transparency arm, re-running this on a
  // cutout would read its transparent surround as RGB(0,0,0) — "not white", so
  // "product" — and hand back a black rectangle.
  const isBackground = (i) => {
    const p = i * 4;
    if (sd[p + 3] < ALPHA_MIN) return true;
    return sd[p] >= WHITE_MIN && sd[p + 1] >= WHITE_MIN && sd[p + 2] >= WHITE_MIN;
  };
  const bgRaw = floodFromBorder(w, h, isBackground);

  /* ── Leak guard ─────────────────────────────────────────────────────── */

  // The failure that made this unusable on white products: the outline between
  // a white body and a white backdrop is a hairline, and JPEG noise pushes a
  // few of its pixels above the threshold. The flood slips through that pinhole
  // and, finding nothing but white inside, takes the ENTIRE body. One breach
  // anywhere costs the whole product — which is why raising or lowering the
  // threshold never fixed this, it only moved which photo it happened to.
  //
  // A breach is always a NECK: a couple of pixels wide, opening into a wide
  // region. Opening by reconstruction removes exactly that and nothing else —
  // erode the background so necks thinner than 2r snap, keep only what still
  // reaches the frame, then grow it back inside the original background. The
  // true backdrop is far wider than any neck, so it survives erosion and
  // reconstructs to its exact original shape; the balloon behind the breach no
  // longer has a path to the frame and stays product.
  const r = Math.max(1, Math.min(CLOSE_MAX, Math.round(Math.min(w, h) * CLOSE_FRACTION)));
  const eroded = morph(bgRaw, w, h, r, 'erode');
  const trunk = floodFromBorder(w, h, (i) => eroded[i] === 1);
  // 되팽창은 **재확장(reconstruction)이 아니라 열림(opening)** 이어야 한다.
  //
  // bgRaw 안에서 다시 흘려보내면 바늘구멍도 bgRaw 에 속해 있으므로 막았던 통로로
  // 그대로 되돌아 들어가, 결과가 bgRaw 와 비트 단위로 같아진다 — 차단이 무효가 된다.
  // (합성 검증: 흰 몸통 10000px 중 0px 생존 → 차단 전과 동일)
  // trunk 를 r 만큼 되팽창해 원본 배경과 교집합하면 목이 가는 통로는 끊긴 채
  // 진짜 배경만 원래 폭으로 복원된다. (같은 검증에서 10000px 전부 생존)
  const grown = morph(trunk, w, h, r, 'dilate');
  const bg = new Uint8Array(N);
  for (let i = 0; i < N; i++) bg[i] = grown[i] && bgRaw[i] ? 1 : 0;

  // Binary keep mask (1 = product). Transparent pixels are dropped whether or
  // not the border could reach them, so interior holes survive.
  let keep = new Uint8Array(N);
  for (let i = 0; i < N; i++) keep[i] = bg[i] || sd[i * 4 + 3] < ALPHA_MIN ? 0 : 1;

  /* ── Repair ─────────────────────────────────────────────────────────── */

  // Close: fill the bites the flood took out of the silhouette. Adds only.
  keep = morph(morph(keep, w, h, r, 'dilate'), w, h, r, 'erode');
  // Open at radius 1: drop the single-pixel flecks of background the flood
  // could not reach — the speckle left behind around a noisy outline.
  keep = morph(morph(keep, w, h, 1, 'erode'), w, h, 1, 'dilate');
  // Whatever the closing sealed off is interior, not background: a dark drum
  // ringed by product is not a hole to see through.
  const outside = floodFromBorder(w, h, (i) => keep[i] === 0);
  for (let i = 0; i < N; i++) if (!keep[i] && !outside[i]) keep[i] = 1;

  /* ── Matte ──────────────────────────────────────────────────────────── */

  const out = srcCtx.createImageData(w, h);
  const od = out.data;
  // 3×3 tent rather than a box: the extra weight on the centre keeps the
  // transition inside one pixel instead of smearing it across three, which is
  // what a plain average does to a diagonal edge.
  const WEIGHT = [1, 2, 1, 2, 4, 2, 1, 2, 1];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const p = i * 4;
      let sum = 0;
      let total = 0;
      let solidR = 0, solidG = 0, solidB = 0, solidN = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const j = yy * w + xx;
          const k = keep[j];
          const wt = WEIGHT[(dy + 1) * 3 + (dx + 1)];
          sum += k * wt;
          total += wt;
          if (k) {
            const q = j * 4;
            solidR += sd[q]; solidG += sd[q + 1]; solidB += sd[q + 2]; solidN++;
          }
        }
      }
      const cover = sum / total;

      od[p] = sd[p];
      od[p + 1] = sd[p + 1];
      od[p + 2] = sd[p + 2];
      // Scale by the source alpha rather than 255, so a semi-transparent input
      // keeps its softness instead of being forced opaque.
      od[p + 3] = Math.round(cover * sd[p + 3]);

      // De-fringe. An edge pixel is a mix of the product and the white it was
      // shot against; left as-is it is what puts a pale rim around a cutout
      // once it is composited onto a coloured canvas. Un-mix it —
      //   observed = cover × product + (1 − cover) × white
      // — and keep the product term. Skipped where the product is itself near
      // white, since there the division has nothing to recover.
      if (cover > 0 && cover < 1 && solidN > 0) {
        const pr = solidR / solidN, pg = solidG / solidN, pb = solidB / solidN;
        if (255 - Math.max(pr, pg, pb) >= DEFRINGE_MIN_CONTRAST) {
          od[p] = clamp255((sd[p] - (1 - cover) * 255) / cover);
          od[p + 1] = clamp255((sd[p + 1] - (1 - cover) * 255) / cover);
          od[p + 2] = clamp255((sd[p + 2] - (1 - cover) * 255) / cover);
        }
      }
    }
  }
  srcCtx.putImageData(out, 0, 0);
  return srcCanvas.toDataURL('image/png');
}

/**
 * Remove a near-white background from a product photo (outside-in flood, mask
 * repair, feather + de-fringe). Signature/name kept for existing callers.
 */
export async function removeBackgroundAI(
  dataUrl,
  onProgress,
) {
  try {
    onProgress?.('Removing background…');
    return await floodWhiteBackground(dataUrl);
  } catch (err) {
    console.error('Background removal failed:', err);
    return dataUrl;
  }
}
