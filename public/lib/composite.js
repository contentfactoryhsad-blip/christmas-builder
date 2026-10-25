// 제품 합성 — 그림자(접지·바닥·뒷벽) + 바닥 리플렉션 + 톤 매칭.
//
// 화면 미리보기와 PNG 다운로드가 **같은 함수**로 그린다. 그래야 보이는 것과 받는 것이 같다.
//
//   const bg = createBackground(bgImage);                 // 배경 픽셀을 한 번 읽어 둔다
//   drawComposite(ctx, bg, [{ image, rect, area, fx, eraser }])   // 배경 + 제품들을 순서대로
//
// eraser 는 배경 크기의 캔버스로, 알파가 칠해진 곳만큼 그 제품의 그림자·리플렉션을 지운다.
// 배경 좌표에 고정되어 있어서 제품을 옮겨도 "이 벽에는 그림자가 지면 안 된다"가 유지된다.
//
// 그림자는 제품 실루엣(누끼 알파)에서 만든다. 제품 이미지는 투명 여백이 잘린 상태라
// 이미지 맨 아래 = 제품 발끝 = 바닥선이다. 모든 그림자는 이 바닥선을 기준으로 놓인다.
//
// 블러는 canvas filter 대신 직접 구현한 박스 블러(3회)를 쓴다 — ctx.filter 는
// Safari 에서 동작이 들쭉날쭉해서 브라우저마다 결과가 달라지면 안 되기 때문이다.

/** 기본 설정. 슬라이더 값은 전부 0~100. */
export const DEFAULT_FX = {
  /*
    그림자가 떨어지는 면.
      floor — 바닥에 서 있는 제품 (냉장고, 세탁기): 접지 + 바닥 그림자 (+ 리플렉션)
      wall  — 벽에 걸린 제품 (벽걸이 TV, 에어컨): 뒷벽 그림자만, 제품 중심 기준
      both  — 벽 앞 바닥에 선 제품: 바닥 그림자 + 뒷벽 그림자, 벽 그림자는 발끝 기준
  */
  surface: 'floor',
  direction: 'center',            // 'left' | 'center' | 'right' — 그림자가 떨어지는 쪽
  contact: { on: true, strength: 70 },
  floor: { on: true, strength: 45, softness: 50, length: 30 },
  wall: { strength: 40, depth: 30, offsetY: 0 },   // offsetY: −50(위) ~ +50(아래)
  reflection: { on: false, opacity: 25, length: 30 },
  tone: { strength: 40 },
};

export const cloneFx = (fx) => JSON.parse(JSON.stringify(fx));

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
const DIR = { left: -1, center: 0, right: 1 };

/** surface 에 따라 실제로 그릴 레이어. 꺼진 면의 설정값은 남겨 두고 쓰지만 않는다. */
function layersOf(fx) {
  const floorSide = fx.surface !== 'wall';
  return {
    contact: floorSide && fx.contact.on,
    floor: floorSide && fx.floor.on,
    wall: fx.surface === 'wall' || fx.surface === 'both',
    reflection: floorSide && fx.reflection.on && fx.reflection.opacity > 0,
  };
}

// ─── 배경 ────────────────────────────────────────────────────────────────────

/** 그늘 깊이 — 그림자 알파가 1 인 곳의 밝기는 원래의 이 비율이 된다. */
const SHADE = 0.28;

/**
 * 배경 이미지를 캔버스에 올려 픽셀을 읽어 둔다. 톤 샘플링에 쓴다.
 *
 * 같이 "그늘색 지도"(shade)를 만든다. 픽셀마다 그 자리 배경의 색조는 유지하고 밝기만
 * 낮춘 색이다. 그림자는 이 지도를 그림자 모양으로 오려 multiply 로 얹으므로,
 * 바닥에 떨어진 부분은 바닥색, 벽에 떨어진 부분은 벽색, 빨간 소품 위는 짙은 빨강이 된다.
 * 한 가지 색으로 칠하면 바닥에서 따온 색이 벽에도 칠해져 어색했다.
 */
export function createBackground(img) {
  // 이미지 요소뿐 아니라 캔버스(색을 입힌 배경 등)도 받는다
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, w, h).data;

  const shadeData = new ImageData(w, h);
  const sd = shadeData.data;
  for (let p = 0; p < data.length; p += 4) {
    const l = Math.max(8, lum(data[p], data[p + 1], data[p + 2]));
    // 밝기로 나눠 색조만 남기고 SHADE 를 곱한다. 무채색이면 회색 SHADE 가 된다.
    sd[p] = clamp((data[p] / l) * SHADE, 0, 1) * 255;
    sd[p + 1] = clamp((data[p + 1] / l) * SHADE, 0, 1) * 255;
    sd[p + 2] = clamp((data[p + 2] / l) * SHADE, 0, 1) * 255;
    sd[p + 3] = 255;
  }
  const shade = document.createElement('canvas');
  shade.width = w; shade.height = h;
  shade.getContext('2d').putImageData(shadeData, 0, 0);
  return { img, w, h, data, shade };
}

/** 배경 사각형 영역의 평균 색. */
function meanColor(bg, x0, y0, x1, y1) {
  x0 = clamp(Math.round(x0), 0, bg.w - 1); x1 = clamp(Math.round(x1), x0 + 1, bg.w);
  y0 = clamp(Math.round(y0), 0, bg.h - 1); y1 = clamp(Math.round(y1), y0 + 1, bg.h);
  // 큰 영역은 성기게 훑는다 — 평균에는 충분하다
  const step = Math.max(1, Math.round(Math.sqrt(((x1 - x0) * (y1 - y0)) / 4000)));
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      const p = (y * bg.w + x) * 4;
      r += bg.data[p]; g += bg.data[p + 1]; b += bg.data[p + 2]; n++;
    }
  }
  return n ? [r / n, g / n, b / n] : [200, 200, 200];
}

/**
 * 영역 기준으로 샘플링한다 (제품 위치가 아니라). 드래그하는 동안 톤이 출렁이지 않고,
 * 캐시도 유지된다.
 *   · 주변색 — 영역을 조금 넓힌 사각형 전체 (톤 매칭·라이트 랩)
 * 그림자 색은 여기서 정하지 않는다 — 픽셀마다 배경의 그늘색 지도(bg.shade)를 쓴다.
 */
function sampleAround(bg, area) {
  const mx = area.w * 0.2, my = area.h * 0.15;
  return { ambient: meanColor(bg, area.x - mx, area.y - my, area.x + area.w + mx, area.y + area.h + my) };
}

// ─── 알파 마스크 도구 ─────────────────────────────────────────────────────────

/** 가로·세로 박스 블러 3회 ≈ 가우시안. Float32 알파(0~1) 배열을 제자리에서 흐린다. */
function blurAlpha(a, w, h, r) {
  r = Math.round(r);
  if (r < 1) return a;
  const tmp = new Float32Array(a.length);
  const pass = (src, dst, len, count, stride, step) => {
    // count 줄 각각을 len 길이로 흐린다
    const k = 1 / (2 * r + 1);
    for (let line = 0; line < count; line++) {
      const base = line * stride;
      let acc = 0;
      for (let i = -r; i <= r; i++) acc += src[base + clamp(i, 0, len - 1) * step];
      for (let i = 0; i < len; i++) {
        dst[base + i * step] = acc * k;
        acc += src[base + clamp(i + r + 1, 0, len - 1) * step] - src[base + clamp(i - r, 0, len - 1) * step];
      }
    }
  };
  for (let n = 0; n < 3; n++) {
    pass(a, tmp, w, h, w, 1);   // 가로
    pass(tmp, a, h, w, 1, w);   // 세로
  }
  return a;
}

/** 캔버스의 알파 채널을 0~1 배열로. */
function alphaOf(canvas) {
  const d = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height).data;
  const a = new Float32Array(canvas.width * canvas.height);
  for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3] / 255;
  return a;
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/** 실루엣의 바닥 발자국 — 맨 아래 몇 % 줄에서 불투명한 가로 범위. */
function footprint(alpha, w, h) {
  const rows = Math.max(2, Math.round(h * 0.04));
  let x0 = w, x1 = -1;
  for (let y = h - rows; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (alpha[y * w + x] > 0.5) { if (x < x0) x0 = x; if (x > x1) x1 = x; }
    }
  }
  return x1 < 0 ? { x0: 0, x1: w } : { x0, x1: x1 + 1 };
}

// ─── 제품 하나 준비 (크기별 캐시) ─────────────────────────────────────────────

const cache = new Map();
const CACHE_MAX = 40;

function remember(key, make) {
  if (cache.has(key)) return cache.get(key);
  const v = make();
  cache.set(key, v);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return v;
}

let imageIds = new WeakMap(), nextImageId = 1;
const idOf = (img) => {
  if (!imageIds.has(img)) imageIds.set(img, nextImageId++);
  return imageIds.get(img);
};

/** 제품을 놓일 크기로 다시 그리고 알파를 읽어 둔다. */
function scaledProduct(image, w, h) {
  return remember(`p:${idOf(image)}:${w}x${h}`, () => {
    const c = makeCanvas(w, h);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, 0, 0, w, h);
    return { canvas: c, alpha: alphaOf(c) };
  });
}

/**
 * 톤 매칭 + 라이트 랩을 입힌 제품.
 *   · 색 캐스트(밝기를 뺀 색 차이)는 강하게, 밝기 차이는 약하게 끌어온다 — 검은 TV 가
 *     밝은 배경에서 회색으로 뜨면 안 되므로 밝기는 조금만 움직인다.
 *   · 가장자리에는 주변색을 살짝 번지게 해 오려 붙인 경계를 지운다.
 */
function tonedProduct(base, w, h, ambient, strength) {
  const s = strength / 100;
  if (s <= 0) return base.canvas;
  return remember(`t:${base.canvas.width}x${base.canvas.height}:${idOfCanvas(base.canvas)}:${ambient.map(Math.round).join(',')}:${strength}`, () => {
    const src = base.canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h);
    const d = src.data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < w * h; i++) {
      if (d[i * 4 + 3] > 200) { r += d[i * 4]; g += d[i * 4 + 1]; b += d[i * 4 + 2]; n++; }
    }
    if (!n) return base.canvas;
    const pm = [r / n, g / n, b / n];
    const dl = lum(...ambient) - lum(...pm);
    const shift = [0, 1, 2].map((k) => s * ((ambient[k] - pm[k] - dl) * 0.8 + dl * 0.18));

    const edge = Float32Array.from(base.alpha);
    blurAlpha(edge, w, h, Math.max(1.5, Math.min(w, h) * 0.012));
    const out = new ImageData(w, h);
    const o = out.data;
    for (let i = 0; i < w * h; i++) {
      const p = i * 4;
      o[p + 3] = d[p + 3];
      if (!d[p + 3]) continue;
      // 안쪽은 0, 경계로 갈수록 1 에 가까워지는 가중치
      const wrap = clamp((1 - edge[i]) * 1.6, 0, 1) * s * 0.55;
      for (let k = 0; k < 3; k++) {
        const v = d[p + k] + shift[k];
        o[p + k] = clamp(v + (ambient[k] - v) * wrap, 0, 255);
      }
    }
    const c = makeCanvas(w, h);
    c.getContext('2d').putImageData(out, 0, 0);
    return c;
  });
}

let canvasIds = new WeakMap(), nextCanvasId = 1;
const idOfCanvas = (c) => {
  if (!canvasIds.has(c)) canvasIds.set(c, nextCanvasId++);
  return canvasIds.get(c);
};

/**
 * 그림자 스프라이트 — 접지·바닥·뒷벽 그림자를 합친 **알파 마스크**. 색은 그릴 때 배경의
 * 그늘색 지도에서 가져온다. 제품 크기보다 넉넉한 여백(pad)을 두고 그린다.
 */
function shadowSprite(base, w, h, fx) {
  const L = layersOf(fx);
  const key = `s:${idOfCanvas(base.canvas)}:${JSON.stringify([fx.surface, fx.direction, L, fx.contact, fx.floor, fx.wall])}`;
  return remember(key, () => {
    const dir = DIR[fx.direction] ?? 0;
    const pad = Math.ceil(Math.max(w, h) * 0.7 + 40);
    const SW = w + pad * 2, SH = h + pad * 2;
    // 그림자는 어차피 흐리므로 줄인 해상도에서 계산하고 마지막에 늘린다 — 슬라이더가 끊기지 않게.
    const q = Math.min(1, 900 / Math.max(SW, SH));
    const QW = Math.max(1, Math.round(SW * q)), QH = Math.max(1, Math.round(SH * q));
    const total = new Float32Array(QW * QH);
    const ox = pad, oy = pad; // 스프라이트 안에서 제품 왼쪽 위
    const unit = Math.max(w, h);

    // 레이어 하나: draw 로 실루엣/모양을 그리고 → 블러 → 세기만큼 합친다 (겹치면 screen 합성)
    const addLayer = (draw, blur, strength) => {
      if (strength <= 0) return;
      const c = makeCanvas(QW, QH);
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.setTransform(q, 0, 0, q, 0, 0);
      draw(ctx);
      const a = blurAlpha(alphaOf(c), QW, QH, blur * q);
      for (let i = 0; i < a.length; i++) {
        const v = a[i] * strength;
        if (v > 0) total[i] = 1 - (1 - total[i]) * (1 - v);
      }
    };
    const silhouette = (ctx) => ctx.drawImage(base.canvas, 0, 0);

    // ① 뒷벽 그림자 — 제품 뒤 벽에 비친 실루엣. depth(벽과의 거리·제품 두께)가 클수록
    //    더 옆으로 밀리고, 더 퍼지고, 더 옅어진다.
    //    · both — 바닥에 선 제품: 발끝(바닥선) 기준으로 커진다. 발끝은 바닥에 붙어 있다.
    //    · wall — 벽걸이: 제품 중심 기준으로 커지고, 위쪽 조명이라 살짝 아래로 떨어진다.
    if (L.wall) {
      const dp = fx.wall.depth / 100;
      const sc = 1 + dp * 0.08;
      const dx = dir * unit * (0.04 + dp * 0.22);
      const hanging = fx.surface === 'wall';
      const ay = hanging ? h / 2 : h;                       // 커지는 기준점
      // 벽걸이는 위쪽 조명이라 기본으로 조금 아래로 떨어진다. 사용자가 위아래를 더 옮길 수 있다.
      const dy = (hanging ? unit * (0.015 + dp * 0.06) : 0) + ((fx.wall.offsetY ?? 0) / 100) * h;
      addLayer((ctx) => {
        ctx.translate(ox + w / 2 + dx, oy + ay + dy);
        ctx.scale(sc, sc);
        ctx.translate(-w / 2, -ay);
        silhouette(ctx);
      }, 2 + unit * (0.01 + dp * 0.05), (fx.wall.strength / 100) * (1 - dp * 0.35));
    }

    // ② 바닥 그림자 — 실루엣을 바닥면으로 눕혀 제품 뒤쪽 바닥에 깐다.
    //    방향에 따라 옆으로 기울어서, 제품 옆으로 삐져나온 부분이 보인다.
    if (L.floor) {
      const k = 0.06 + (fx.floor.length / 100) * 0.34;        // 눕힌 높이 비율
      const shear = dir * (0.25 + (fx.floor.length / 100) * 0.9);
      addLayer((ctx) => {
        // (x, y) → (x − shear·y + shear·h,  h(1−k) + k·y): 꼭대기는 뒤(위)로, 발끝은 제자리
        ctx.transform(1, 0, -shear, k, ox + shear * h, oy + h * (1 - k));
        silhouette(ctx);
        // 멀어질수록 옅게 — 발끝 쪽이 진하다
        ctx.setTransform(q, 0, 0, q, 0, 0);
        ctx.globalCompositeOperation = 'destination-in';
        const g = ctx.createLinearGradient(0, oy + h, 0, oy + h * (1 - k));
        g.addColorStop(0, 'rgba(0,0,0,1)');
        g.addColorStop(1, 'rgba(0,0,0,0.15)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, SW, SH);
      }, 2 + unit * 0.006 + (fx.floor.softness / 100) * unit * 0.05, fx.floor.strength / 100);

      // 주변광 그림자 — 발 밑으로 넓게 깔리는 옅은 그늘. 바닥 그림자 세기를 따른다.
      // 받침대가 좁은 제품(TV)도 위의 본체가 바닥을 가리므로, 폭은 발자국과 본체 폭 중 큰 쪽.
      const fp = footprint(base.alpha, w, h);
      const spread = Math.max((fp.x1 - fp.x0) * 0.62, w * 0.4);
      addLayer((ctx) => {
        const cx = ox + (fp.x0 + fp.x1) / 2 + dir * spread * 0.2;
        ctx.beginPath();
        ctx.ellipse(cx, oy + h, spread, Math.max(3, unit * 0.035), 0, 0, Math.PI * 2);
        ctx.fill();
      }, 3 + unit * 0.03, (fx.floor.strength / 100) * 0.75);
    }

    // ③ 접지 그림자 — 발이 바닥에 닿는 선. 얇고 진하게, 두 겹(아주 좁은 것 + 조금 넓은 것).
    if (L.contact) {
      const fp = footprint(base.alpha, w, h);
      const fw = fp.x1 - fp.x0;
      const cx = ox + (fp.x0 + fp.x1) / 2 + dir * fw * 0.03;
      const st = fx.contact.strength / 100;
      addLayer((ctx) => {
        ctx.beginPath();
        ctx.ellipse(cx, oy + h - 1, fw * 0.5, Math.max(1.5, unit * 0.008), 0, 0, Math.PI * 2);
        ctx.fill();
      }, 1 + unit * 0.004, st);
      addLayer((ctx) => {
        ctx.beginPath();
        ctx.ellipse(cx, oy + h, fw * 0.54, Math.max(2.5, unit * 0.02), 0, 0, Math.PI * 2);
        ctx.fill();
      }, 2 + unit * 0.012, st * 0.7);
    }

    const img = new ImageData(QW, QH);
    for (let i = 0; i < total.length; i++) img.data[i * 4 + 3] = Math.round(clamp(total[i], 0, 1) * 255);
    const small = makeCanvas(QW, QH);
    small.getContext('2d').putImageData(img, 0, 0);
    const c = makeCanvas(SW, SH);
    const cctx = c.getContext('2d');
    cctx.imageSmoothingQuality = 'high';
    cctx.drawImage(small, 0, 0, SW, SH);
    return { canvas: c, ox, oy };
  });
}

/** 바닥 리플렉션 — 제품을 뒤집어 발끝 아래로, 멀어질수록 사라지게. */
function reflectionSprite(product, w, h, fx) {
  const key = `r:${idOfCanvas(product)}:${fx.reflection.length}`;
  return remember(key, () => {
    const rh = Math.max(1, Math.round(h * (0.08 + (fx.reflection.length / 100) * 0.5)));
    const c = makeCanvas(w, rh);
    const ctx = c.getContext('2d');
    ctx.setTransform(1, 0, 0, -1, 0, h);
    ctx.drawImage(product, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'destination-in';
    const g = ctx.createLinearGradient(0, 0, 0, rh);
    g.addColorStop(0, 'rgba(0,0,0,0.9)');
    g.addColorStop(0.6, 'rgba(0,0,0,0.25)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, rh);
    // 바닥 질감에 살짝 퍼지게
    const a = alphaOf(c);
    const d = ctx.getImageData(0, 0, w, rh);
    blurAlpha(a, w, rh, 1 + h * 0.004);
    for (let i = 0; i < a.length; i++) d.data[i * 4 + 3] = Math.round(a[i] * 255);
    ctx.putImageData(d, 0, 0);
    return c;
  });
}

// ─── 그리기 ──────────────────────────────────────────────────────────────────

/**
 * 배경 + 제품들을 ctx 에 그린다. ctx 는 배경 원본 크기(bg.w × bg.h)여야 한다.
 * @param items [{ image: HTMLImageElement, rect: {x,y,w,h}, area: {x,y,w,h}, fx }]
 *   그림자는 모든 제품보다 먼저 깔지 않고 제품마다 바로 밑에 깐다 — 앞 번호 제품이
 *   뒤 번호 제품의 그림자에 덮일 수 있어야 실제 겹침처럼 보인다.
 */
export function drawComposite(ctx, bg, items, hooks = {}) {
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.drawImage(bg.img, 0, 0, bg.w, bg.h);
  // 배경 바로 위·제품 아래에 얹을 것 (예: 화면 빛 번짐)
  if (hooks.afterBackground) { hooks.afterBackground(ctx); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; }
  for (const it of items) drawItem(ctx, bg, it);
  ctx.restore();
}

/** 지우개를 적용하려면 스프라이트를 한 번 옮겨 그려야 한다. 매 프레임 새로 만들지 않고 재사용한다. */
const scratch = document.createElement('canvas');
const shadeScratch = document.createElement('canvas');

/**
 * 그림자 마스크를 (dx, dy) 자리의 그늘색으로 채운 캔버스.
 *   그늘색 지도에서 그 자리를 잘라 와 → 마스크 모양으로 오리고 → 지우개 자리를 뺀다.
 * multiply 로 얹으면 bg·(1−a) + bg·shade·a — 자리마다 그 배경이 그늘진 색이 된다.
 */
function shadedShadow(bg, sprite, dx, dy, eraser) {
  const c = shadeScratch;
  c.width = sprite.width;
  c.height = sprite.height;
  const sctx = c.getContext('2d');
  sctx.drawImage(bg.shade, -dx, -dy);
  sctx.globalCompositeOperation = 'destination-in';
  sctx.drawImage(sprite, 0, 0);
  if (eraser) {
    sctx.globalCompositeOperation = 'destination-out';
    sctx.drawImage(eraser, -dx, -dy);
  }
  sctx.globalCompositeOperation = 'source-over';
  return c;
}

/** sprite 를 (dx, dy) 에 그릴 때 eraser 로 지운 결과를 scratch 에 만들어 돌려준다. */
function erased(sprite, dx, dy, eraser) {
  if (!eraser) return sprite;
  scratch.width = sprite.width;
  scratch.height = sprite.height;
  const sctx = scratch.getContext('2d');
  sctx.drawImage(sprite, 0, 0);
  sctx.globalCompositeOperation = 'destination-out';
  sctx.drawImage(eraser, -dx, -dy);
  sctx.globalCompositeOperation = 'source-over';
  return scratch;
}

function drawItem(ctx, bg, { image, rect, area, fx, eraser, overlay }) {
  const w = Math.max(1, Math.round(rect.w));
  const h = Math.max(1, Math.round(rect.h));
  const x = Math.round(rect.x), y = Math.round(rect.y);
  const { ambient } = sampleAround(bg, area || rect);
  const base = scaledProduct(image, w, h);
  const product = tonedProduct(base, w, h, ambient, fx.tone.strength);

  const L = layersOf(fx);
  if (L.contact || L.floor || L.wall) {
    const s = shadowSprite(base, w, h, fx);
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(shadedShadow(bg, s.canvas, x - s.ox, y - s.oy, eraser), x - s.ox, y - s.oy);
    ctx.globalCompositeOperation = 'source-over';
  }
  if (L.reflection) {
    ctx.globalAlpha = fx.reflection.opacity / 100;
    ctx.drawImage(erased(reflectionSprite(product, w, h, fx), x, y + h, eraser), x, y + h);
    ctx.globalAlpha = 1;
  }
  ctx.drawImage(product, x, y);
  // 제품 위에 덮는 레이어 (예: TV 화면 인필). { canvas, x, y } — 배경 좌표
  if (overlay) ctx.drawImage(overlay.canvas, overlay.x, overlay.y);
}
