// 화면 인필 교체 + 배경 색감 맞추기.
//
//   1. 장면 이미지의 TV 화면 네 모서리(quad)에 인필 이미지를 원근 변형으로 끼운다.
//   2. 인필의 대표 색을 뽑아 배경(화면 밖)의 색감을 그쪽으로 옮긴다.
//        · hue  — 배경 대표 hue 와 인필 대표 hue 의 차이만큼 hue 를 돌린다.
//                 채도가 있는 배경에서 자연스럽다. 무채색 배경은 거의 안 바뀐다.
//        · tint — 밝기는 그대로 두고 인필 색을 덧입힌다. 베이지·회색 배경에 맞다.
//        · palette — 인필의 색 배치를 크게 흐려 장면 전체에 펼친다 (왼쪽 주황 → 배경 왼쪽 주황).
//                 화면 주변은 비우고, 오브젝트는 조금만 물들인다.
//   3. 화면 빛이 주변으로 번지는 glow 를 screen 합성으로 얹는다.
//
// 화면 미리보기와 PNG 다운로드가 같은 renderInfill() 로 그린다.

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ─── 색 변환 (0~1 범위 HSL, h 는 0~360) ───────────────────────────────────────

function rgb2hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h;
  if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

function hue2rgb(p, q, t) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

function hsl2rgb(h, s, l) {
  h = (((h % 360) + 360) % 360) / 360;
  if (s <= 0) { const v = l * 255; return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue2rgb(p, q, h + 1 / 3) * 255, hue2rgb(p, q, h) * 255, hue2rgb(p, q, h - 1 / 3) * 255];
}

export const rgbCss = ([r, g, b]) => `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;

// ─── 이미지 → 픽셀 ───────────────────────────────────────────────────────────

/** 이미지를 캔버스에 올려 픽셀을 읽는다. 너무 큰 장면은 maxSide 로 줄인다 (처리 속도). */
export function readImage(img, maxSide = 2600) {
  const s = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * s));
  const h = Math.max(1, Math.round(img.naturalHeight * s));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  return { canvas: c, w, h, data: ctx.getImageData(0, 0, w, h) };
}

// ─── 대표 색 ─────────────────────────────────────────────────────────────────

/**
 * 대표 색. 채도(정확히는 chroma) 가 높은 픽셀일수록 크게 쳐서 hue 를 원 위의 벡터로
 * 평균 낸다 — 검정·흰색이 대부분인 화면이라도 실제 색에 끌려가게.
 * skip(i) 가 true 인 픽셀은 뺀다 (배경을 잴 때 화면 영역 제외).
 * @returns {{ h, s, l, chroma, rgb }}  chroma 가 낮으면 "무채색에 가깝다"는 뜻.
 */
export function dominantColor(imageData, skip) {
  const d = imageData.data;
  const n = d.length / 4;
  const step = Math.max(1, Math.floor(n / 120000));
  let x = 0, y = 0, sw = 0, ss = 0, sl = 0, cnt = 0, lAll = 0;
  for (let i = 0; i < n; i += step) {
    if (d[i * 4 + 3] < 128 || (skip && skip(i))) continue;
    const [h, s, l] = rgb2hsl(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
    const w = s * (1 - Math.abs(2 * l - 1)); // chroma
    const rad = (h * Math.PI) / 180;
    x += Math.cos(rad) * w; y += Math.sin(rad) * w;
    sw += w; ss += s * w; sl += l * w; cnt++; lAll += l;
  }
  if (!cnt) return { h: 0, s: 0, l: 0.5, chroma: 0, rgb: [128, 128, 128] };
  const chroma = sw / cnt;
  const h = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  const s = sw ? ss / sw : 0;
  const l = sw ? sl / sw : lAll / cnt;
  return { h, s, l, chroma, rgb: hsl2rgb(h, s, clamp(l, 0.3, 0.7)) };
}

/** 사용자가 고른 #rrggbb 를 dominantColor 와 같은 모양으로. */
export function colorFromHex(hex) {
  const n = parseInt(hex.slice(1), 16);
  const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const [h, s, l] = rgb2hsl(...rgb);
  return { h, s, l, chroma: s * (1 - Math.abs(2 * l - 1)), rgb };
}

/** a → b 로 가는 가장 짧은 hue 각도 (−180 ~ 180) */
const hueDelta = (a, b) => ((((b - a) % 360) + 540) % 360) - 180;

// ─── 원근 변형 ───────────────────────────────────────────────────────────────

/**
 * 단위 정사각형 (0,0)(1,0)(1,1)(0,1) → quad 로 보내는 호모그래피 (Heckbert).
 * quad 순서: 왼위, 오위, 오아래, 왼아래.
 */
function squareToQuad(q) {
  const [p0, p1, p2, p3] = q;
  const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y, dy3 = p0.y - p1.y + p2.y - p3.y;
  let g = 0, h = 0;
  if (Math.abs(dx3) > 1e-9 || Math.abs(dy3) > 1e-9) {
    const den = dx1 * dy2 - dx2 * dy1;
    g = (dx3 * dy2 - dx2 * dy3) / den;
    h = (dx1 * dy3 - dx3 * dy1) / den;
  }
  return [
    p1.x - p0.x + g * p1.x, p3.x - p0.x + h * p3.x, p0.x,
    p1.y - p0.y + g * p1.y, p3.y - p0.y + h * p3.y, p0.y,
    g, h, 1,
  ];
}

function invert3(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    A / det, -(b * i - c * h) / det, (b * f - c * e) / det,
    B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
    C / det, -(a * h - b * g) / det, (a * e - b * d) / det,
  ];
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** quad 의 대략적인 가로세로비 — 위·아래 변 평균 폭 / 좌·우 변 평균 높이 */
function quadAspect(q) {
  return ((dist(q[0], q[1]) + dist(q[3], q[2])) / 2) / Math.max(1, (dist(q[0], q[3]) + dist(q[1], q[2])) / 2);
}

/**
 * 네 점을 왼위 → 오위 → 오아래 → 왼아래 순서로 정렬한다.
 * 사용자가 아무 순서로 찍어도 되게 — 중심 기준 각도로 돌려 세우고, x+y 가 가장 작은 점을 왼위로.
 */
export function orderQuad(pts) {
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const sorted = [...pts].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  let k = 0;
  sorted.forEach((p, i) => { if (p.x + p.y < sorted[k].x + sorted[k].y) k = i; });
  return [...sorted.slice(k), ...sorted.slice(0, k)];
}

/**
 * 인필을 quad 에 끼운 레이어 (장면 크기, quad 밖은 투명).
 * fit: 'cover' — 화면 비율에 맞게 가운데를 잘라 채운다 / 'stretch' — 그대로 늘린다.
 * 역변환으로 장면 픽셀마다 인필 좌표를 구해 쌍선형 보간한다. 경계는 캔버스가 안티에일리어싱한
 * 다각형 마스크를 곱해 계단이 지지 않게 한다.
 */
export function warpInfill(scene, infill, quad, fit = 'cover') {
  const W = scene.w, H = scene.h;
  const src = infill.data.data, sw = infill.w, sh = infill.h;

  // 쓸 원본 범위 (cover 면 가운데 크롭)
  let cx0 = 0, cy0 = 0, cw = sw, ch = sh;
  if (fit === 'cover') {
    const qa = quadAspect(quad), ia = sw / sh;
    if (ia > qa) { cw = sh * qa; cx0 = (sw - cw) / 2; } else { ch = sw / qa; cy0 = (sh - ch) / 2; }
  }

  const inv = invert3(squareToQuad(quad));
  const xs = quad.map((p) => p.x), ys = quad.map((p) => p.y);
  const bx0 = clamp(Math.floor(Math.min(...xs)) - 1, 0, W - 1), bx1 = clamp(Math.ceil(Math.max(...xs)) + 1, 0, W - 1);
  const by0 = clamp(Math.floor(Math.min(...ys)) - 1, 0, H - 1), by1 = clamp(Math.ceil(Math.max(...ys)) + 1, 0, H - 1);

  // 안티에일리어싱된 다각형 마스크
  const mask = document.createElement('canvas');
  mask.width = W; mask.height = H;
  const mctx = mask.getContext('2d', { willReadFrequently: true });
  mctx.beginPath();
  quad.forEach((p, i) => (i ? mctx.lineTo(p.x, p.y) : mctx.moveTo(p.x, p.y)));
  mctx.closePath();
  mctx.fill();
  const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1;
  const ma = mctx.getImageData(bx0, by0, bw, bh).data;

  const out = new ImageData(bw, bh);
  const o = out.data;
  const sample = (fx, fy, k) => {
    // 쌍선형 보간
    const x0 = clamp(Math.floor(fx), 0, sw - 1), y0 = clamp(Math.floor(fy), 0, sh - 1);
    const x1 = Math.min(sw - 1, x0 + 1), y1 = Math.min(sh - 1, y0 + 1);
    const tx = clamp(fx - x0, 0, 1), ty = clamp(fy - y0, 0, 1);
    const a = src[(y0 * sw + x0) * 4 + k], b = src[(y0 * sw + x1) * 4 + k];
    const c = src[(y1 * sw + x0) * 4 + k], d = src[(y1 * sw + x1) * 4 + k];
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  };
  for (let y = by0; y <= by1; y++) {
    for (let x = bx0; x <= bx1; x++) {
      const li = ((y - by0) * bw + (x - bx0)) * 4;
      const m = ma[li + 3];
      if (!m) continue;
      const px = x + 0.5, py = y + 0.5;
      const w = inv[6] * px + inv[7] * py + inv[8];
      const u = clamp((inv[0] * px + inv[1] * py + inv[2]) / w, 0, 1);
      const v = clamp((inv[3] * px + inv[4] * py + inv[5]) / w, 0, 1);
      const fx = cx0 + u * cw - 0.5, fy = cy0 + v * ch - 0.5;
      o[li] = sample(fx, fy, 0);
      o[li + 1] = sample(fx, fy, 1);
      o[li + 2] = sample(fx, fy, 2);
      o[li + 3] = m;
    }
  }
  const layer = document.createElement('canvas');
  layer.width = W; layer.height = H;
  layer.getContext('2d').putImageData(out, bx0, by0);
  // 화면 영역 알파 (배경 색 보정에서 화면 안은 건너뛰려고)
  const screenAlpha = new Uint8Array(W * H);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) screenAlpha[(y + by0) * W + x + bx0] = ma[(y * bw + x) * 4 + 3];
  return { layer, screenAlpha };
}

/** quad 안쪽 알파만 (인필이 아직 없을 때 배경 대표색을 잴 때 쓴다) */
export function quadAlpha(scene, quad) {
  const c = document.createElement('canvas');
  c.width = scene.w; c.height = scene.h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.beginPath();
  quad.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
  ctx.fill();
  const d = ctx.getImageData(0, 0, scene.w, scene.h).data;
  const a = new Uint8Array(scene.w * scene.h);
  for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3];
  return a;
}

// ─── 배경 색 보정 ────────────────────────────────────────────────────────────

/**
 * 컬러 필드 — 인필을 아주 작게 줄였다 장면 크기로 늘린 "색 지도".
 * 화면 왼쪽이 주황이면 장면 왼쪽이 주황, 오른쪽이 초록이면 오른쪽이 초록이 되도록
 * 인필의 색 배치를 그대로 크게 펼친다. vivid(0~1)만큼 채도를 올린다.
 * @returns Uint8ClampedArray (장면 크기 RGBA)
 */
export function colorField(infill, W, H, vivid = 0.3) {
  // 가로세로비를 유지한 아주 작은 격자 (긴 쪽 6칸)
  const gw = infill.w >= infill.h ? 6 : Math.max(2, Math.round((6 * infill.w) / infill.h));
  const gh = infill.h > infill.w ? 6 : Math.max(2, Math.round((6 * infill.h) / infill.w));
  const tiny = document.createElement('canvas');
  tiny.width = gw; tiny.height = gh;
  const tctx = tiny.getContext('2d', { willReadFrequently: true });
  // 한 번에 줄이면 몇 픽셀만 집어 와서 얼룩진다 — 단계적으로 줄여 평균을 낸다
  let src = infill.canvas;
  while (src.width / 2 > gw * 2) {
    const half = document.createElement('canvas');
    half.width = Math.max(gw, Math.round(src.width / 2)); half.height = Math.max(gh, Math.round(src.height / 2));
    half.getContext('2d').drawImage(src, 0, 0, half.width, half.height);
    src = half;
  }
  tctx.imageSmoothingQuality = 'high';
  tctx.drawImage(src, 0, 0, gw, gh);
  const td = tctx.getImageData(0, 0, gw, gh);
  /*
    칸마다 색만 남기고 밝기는 고르게 맞춘다. 화면의 검은 부분(OLED 로고 여백 등)이나 흰 부분이
    그대로 내려오면 배경이 거기만 탁하게 어두워진다. 무채색 칸은 화면 전체의 대표색으로 채운다.
  */
  const cells = [];
  let vx = 0, vy = 0, ws = 0, ss = 0;
  for (let i = 0; i < gw * gh; i++) {
    const q = i * 4;
    const [h, sat, l] = rgb2hsl(td.data[q], td.data[q + 1], td.data[q + 2]);
    const c = sat * (1 - Math.abs(2 * l - 1));
    cells.push({ h, sat, c });
    vx += Math.cos((h * Math.PI) / 180) * c; vy += Math.sin((h * Math.PI) / 180) * c; ws += c; ss += sat * c;
  }
  const domH = (Math.atan2(vy, vx) * 180) / Math.PI;
  const domS = ws ? ss / ws : 0;
  cells.forEach(({ h, sat, c }, i) => {
    const t = smoothstep(0.03, 0.18, c); // 0 = 무채색 칸 → 대표색으로
    const rad = (x) => (x * Math.PI) / 180;
    const hx = Math.cos(rad(h)) * t + Math.cos(rad(domH)) * (1 - t);
    const hy = Math.sin(rad(h)) * t + Math.sin(rad(domH)) * (1 - t);
    const hh = (Math.atan2(hy, hx) * 180) / Math.PI;
    const s2 = clamp((sat * t + domS * (1 - t)) * (1 + vivid * 1.5), 0, 1);
    const rgb = hsl2rgb(hh, s2, 0.6);
    const q = i * 4;
    td.data[q] = rgb[0]; td.data[q + 1] = rgb[1]; td.data[q + 2] = rgb[2];
  });
  tctx.putImageData(td, 0, 0);
  // 단계적으로 키워야 칸 경계 없이 매끈한 그라데이션이 된다
  let cur = tiny;
  while (cur.width * 4 < W) {
    const up = document.createElement('canvas');
    up.width = cur.width * 4; up.height = cur.height * 4;
    const uctx = up.getContext('2d');
    uctx.imageSmoothingQuality = 'high';
    uctx.drawImage(cur, 0, 0, up.width, up.height);
    cur = up;
  }
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const octx = out.getContext('2d', { willReadFrequently: true });
  octx.imageSmoothingQuality = 'high';
  // 가장자리 칸이 늘어나며 끝이 뭉개지지 않게 살짝 크게 그린다
  octx.drawImage(cur, -W * 0.06, -H * 0.06, W * 1.12, H * 1.12);
  return octx.getImageData(0, 0, W, H).data;
}

/**
 * 배경 자동 감지 — 스튜디오 컷처럼 배경이 매끈한 그라데이션일 때.
 * 테두리에서 출발해 "밝기 변화가 작은" 픽셀만 따라 번져 나간 곳을 배경으로 본다.
 * 오브젝트는 윤곽(밝기 변화)이 있어서 번짐이 거기서 멈춘다.
 * 작업용으로 줄인 해상도에서 계산하고, 경계를 부드럽게 해서 장면 크기로 늘린다.
 * @returns 장면 크기 캔버스 — 알파가 오브젝트(1) / 배경(0)
 */
export function detectObjects(scene, screenAlpha) {
  const S = Math.min(1, 640 / Math.max(scene.w, scene.h));
  const w = Math.max(8, Math.round(scene.w * S)), h = Math.max(8, Math.round(scene.h * S));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(scene.canvas, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const N = w * h;
  const L = new Float32Array(N);
  for (let i = 0; i < N; i++) L[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  // 기울기 크기 (인접 픽셀 차) + 색 차이도 같이 본다 — 밝기가 비슷한 빨간 받침대도 잡히게
  const G = new Float32Array(N);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      let g = Math.abs(L[i + 1] - L[i - 1]) + Math.abs(L[i + w] - L[i - w]);
      for (const j of [i + 1, i - 1, i + w, i - w]) {
        const cd = Math.abs(d[i * 4] - d[j * 4]) + Math.abs(d[i * 4 + 1] - d[j * 4 + 1]) + Math.abs(d[i * 4 + 2] - d[j * 4 + 2]);
        if (cd / 2 > g) g = cd / 2;
      }
      G[i] = g;
    }
  }
  const T = 7; // 이보다 변화가 작으면 매끈한 배경으로 통과
  const bg = new Uint8Array(N);
  const stack = new Int32Array(N);
  let sp = 0;
  const push = (i) => { if (!bg[i] && G[i] < T) { bg[i] = 1; stack[sp++] = i; } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (sp) {
    const i = stack[--sp];
    const x = i % w, y = (i / w) | 0;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (y > 0) push(i - w);
    if (y < h - 1) push(i + w);
  }
  /*
    가는 선은 지운다 — 바닥과 벽이 만나는 수평선, 그림자 경계 같은 것도 "변화가 큰 곳"이라
    오브젝트로 잡히는데, 그러면 그 줄만 색을 덜 받아 밝은 줄이 생긴다.
    열기(침식 → 팽창)로 폭이 2r 보다 가는 것만 없애고 단상·소품 같은 덩어리는 남긴다.
  */
  const obj = new Uint8Array(N);
  for (let i = 0; i < N; i++) obj[i] = bg[i] ? 0 : 1;
  const morph = (m, r, want) => {
    const tmp = new Uint8Array(N), res = new Uint8Array(N);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let hit = false;
      for (let d = -r; d <= r && !hit; d++) { const xx = x + d; if (xx >= 0 && xx < w && m[y * w + xx] === want) hit = true; }
      tmp[y * w + x] = hit ? want : 1 - want;
    }
    for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) {
      let hit = false;
      for (let d = -r; d <= r && !hit; d++) { const yy = y + d; if (yy >= 0 && yy < h && tmp[yy * w + x] === want) hit = true; }
      res[y * w + x] = hit ? want : 1 - want;
    }
    return res;
  };
  const R = Math.max(2, Math.round(Math.min(w, h) / 150));
  const opened = morph(morph(obj, R, 0), R, 1);
  for (let i = 0; i < N; i++) bg[i] = opened[i] ? 0 : 1;

  // 오브젝트 알파: 배경이 아닌 곳. 화면 영역은 항상 오브젝트.
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const octx = out.getContext('2d', { willReadFrequently: true });
  const od = octx.createImageData(w, h);
  for (let i = 0; i < N; i++) od.data[i * 4 + 3] = bg[i] ? 0 : 255;
  octx.putImageData(od, 0, 0);
  if (screenAlpha) {
    const sx = scene.w / w, sy = scene.h / h;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (screenAlpha[Math.min(scene.h - 1, Math.round(y * sy)) * scene.w + Math.min(scene.w - 1, Math.round(x * sx))]) od.data[(y * w + x) * 4 + 3] = 255;
    }
    octx.putImageData(od, 0, 0);
  }
  // 장면 크기로 늘리면 경계가 부드러워진다 (가장자리 계단 방지)
  const full = document.createElement('canvas');
  full.width = scene.w; full.height = scene.h;
  const fctx = full.getContext('2d');
  fctx.imageSmoothingQuality = 'high';
  fctx.drawImage(out, 0, 0, scene.w, scene.h);
  return full;
}

/**
 * 배경 픽셀마다 색을 옮긴다.
 * @param p {
 *   mode: 'hue' | 'tint' | 'palette', strength 0~1, saturation −1~1, protectNeutrals,
 *   from, to,            배경 대표색 / 목표색 (hue·tint)
 *   field,               palette 모드의 컬러 필드 (colorField 결과)
 *   objectAmount 0~1,    오브젝트가 받는 비율 (0 = 전혀 안 받음)
 *   center: { x, y, r }  palette 에서 화면 주변을 비우는 반경 (r=0 이면 끔)
 *   floor: { y, amount } palette 에서 바닥선(y) 아래가 받는 비율 — 벽에 색이 몰리고 바닥은 중립에 가깝게
 *   weightMap            referenceWeight 결과 — 주면 center·floor 대신 이 분포를 쓴다
 * }
 * @param screenAlpha 화면 영역 (덮일 곳이라 계산을 건너뛴다)
 * @param objects     오브젝트 마스크의 픽셀(알파) 또는 null — null 이면 전부 배경으로 본다
 */
export function adjustBackground(scene, p, screenAlpha, objects) {
  const src = scene.data.data;
  const out = new ImageData(new Uint8ClampedArray(src), scene.w, scene.h);
  const o = out.data;
  if (p.strength <= 0 && !p.saturation) return out;
  const dh = hueDelta(p.from.h, p.to.h);
  const tintS = clamp(p.to.s, 0, 0.75);
  const satF = 1 + p.saturation;
  const objAmt = p.objectAmount ?? 1;
  const W = scene.w, n = scene.w * scene.h;
  const field = p.mode === 'palette' ? p.field : null;
  const cr = p.center && p.center.r > 0 ? p.center : null;
  const floorCfg = field && p.floor ? p.floor : null;
  const fade = scene.h * 0.12; // 바닥선 아래로 이만큼에 걸쳐 바닥 비율로 넘어간다
  for (let i = 0; i < n; i++) {
    if (screenAlpha && screenAlpha[i] === 255) continue;
    // 오브젝트는 objectAmount 만큼만, 배경은 온전히 받는다
    const obj = objects ? objects[i * 4 + 3] / 255 : 0;
    const share = 1 - obj + obj * objAmt;
    if (share <= 0) continue;
    let w = p.strength * share;
    const sf = 1 + (satF - 1) * share;
    if (w <= 0 && sf === 1) continue;
    const q = i * 4;
    const r = src[q], g = src[q + 1], b = src[q + 2];
    let res;
    if (field) {
      // 화면 주변은 비우고 멀어질수록 진하게 — 화면 빛에 하얗게 바랜 느낌
      if (p.weightMap) {
        w *= Math.min(1, p.weightMap[i] * 1.15);
      } else if (cr) {
        const dx = (i % W) - cr.x, dy = ((i / W) | 0) - cr.y;
        w *= smoothstep(cr.r * 0.25, cr.r, Math.sqrt(dx * dx + dy * dy));
      }
      if (floorCfg && !p.weightMap) {
        const t = smoothstep(floorCfg.y, floorCfg.y + fade, (i / W) | 0);
        w *= 1 - t + t * floorCfg.amount;
      }
      const l = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      // 아주 밝은 하이라이트·아주 어두운 그늘은 덜 물든다 (흰 글씨·검은 화면 테두리 보호)
      const keep = p.protectNeutrals ? 1 - smoothstep(0.86, 1, Math.abs(2 * l - 1)) : 1;
      // 필드 색을 밝기 0.88 로 맞춰 곱한다 — 장면의 명암은 그대로, 색만 그 자리 색으로 물든다
      const fr = field[q], fg = field[q + 1], fb = field[q + 2];
      const fl = Math.max(1, 0.299 * fr + 0.587 * fg + 0.114 * fb);
      const k = Math.min(3, (0.88 * 255) / fl);
      const mr = r * Math.min(1.15, (fr * k) / 255), mg = g * Math.min(1.15, (fg * k) / 255), mb = b * Math.min(1.15, (fb * k) / 255);
      const ww = w * keep;
      res = [r + (mr - r) * ww, g + (mg - g) * ww, b + (mb - b) * ww];
      if (sf !== 1) { const [h2, s2, l2] = rgb2hsl(...res); res = hsl2rgb(h2, clamp(s2 * sf, 0, 1), l2); }
    } else {
      const [h, s, l] = rgb2hsl(r, g, b);
      if (p.mode === 'hue') {
        // 무채색 보호: chroma 가 낮은 픽셀(흰 벽·회색)은 hue 를 돌려도 의미가 없고 얼룩만 생긴다
        const keep = p.protectNeutrals ? smoothstep(0.03, 0.25, s * (1 - Math.abs(2 * l - 1))) : 1;
        res = hsl2rgb(h + dh * w * keep, clamp(s * sf, 0, 1), l);
      } else {
        // 밝기 유지 + 목표색 덧입히기. 아주 밝거나 어두운 곳(하이라이트·그늘)은 덜 물든다
        const keep = p.protectNeutrals ? 1 - smoothstep(0.82, 0.98, Math.abs(2 * l - 1)) : 1;
        const ww = w * keep * 0.65;
        const tinted = hsl2rgb(p.to.h, clamp(tintS * sf, 0, 1), l);
        const base = sf !== 1 ? hsl2rgb(h, clamp(s * sf, 0, 1), l) : [r, g, b];
        res = [base[0] + (tinted[0] - base[0]) * ww, base[1] + (tinted[1] - base[1]) * ww, base[2] + (tinted[2] - base[2]) * ww];
      }
    }
    o[q] = res[0]; o[q + 1] = res[1]; o[q + 2] = res[2];
  }
  return out;
}

/**
 * 레퍼런스 이미지(배경에 색이 들어간 완성 예시)에서 "어디에 얼마나 색이 들어갔는지"만 뽑는다.
 * 픽셀마다 chroma(채도×중간 밝기 정도)를 재고 크게 흐려 0~1 로 정규화한 지도.
 * 색 자체는 인필에서 가져오고, 이 지도는 세기 분포(위 양옆 진하게·가운데 비움·바닥 옅게)로만 쓴다.
 * 레퍼런스와 장면의 비율이 달라도 장면 크기로 늘려 맞춘다.
 * @returns Float32Array (장면 크기)
 */
export function referenceWeight(refImg, W, H) {
  const gw = 48, gh = Math.max(4, Math.round((48 * refImg.naturalHeight) / refImg.naturalWidth));
  // 단계적으로 줄여 평균을 낸다
  let src = refImg, sw = refImg.naturalWidth, sh = refImg.naturalHeight;
  while (sw / 2 > gw * 2) {
    const half = document.createElement('canvas');
    half.width = Math.round(sw / 2); half.height = Math.round(sh / 2);
    half.getContext('2d').drawImage(src, 0, 0, half.width, half.height);
    src = half; sw = half.width; sh = half.height;
  }
  const g = document.createElement('canvas');
  g.width = gw; g.height = gh;
  const gctx = g.getContext('2d', { willReadFrequently: true });
  gctx.imageSmoothingQuality = 'high';
  gctx.drawImage(src, 0, 0, gw, gh);
  const d = gctx.getImageData(0, 0, gw, gh).data;
  const c = new Float32Array(gw * gh);
  let mx = 0;
  for (let i = 0; i < c.length; i++) {
    const [, s, l] = rgb2hsl(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
    c[i] = s * (1 - Math.abs(2 * l - 1));
  }
  // 상위 5% 를 1 로 — 소품의 쨍한 색 몇 점에 전체가 눌리지 않게
  const sorted = Float32Array.from(c).sort();
  mx = Math.max(1e-3, sorted[Math.floor(sorted.length * 0.95)]);
  const img = gctx.createImageData(gw, gh);
  for (let i = 0; i < c.length; i++) { const v = clamp(c[i] / mx, 0, 1) * 255; img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
  gctx.putImageData(img, 0, 0);
  // 단계적으로 키워 매끈하게
  let cur = g;
  while (cur.width * 4 < W) {
    const up = document.createElement('canvas');
    up.width = cur.width * 4; up.height = cur.height * 4;
    const uctx = up.getContext('2d');
    uctx.imageSmoothingQuality = 'high';
    uctx.drawImage(cur, 0, 0, up.width, up.height);
    cur = up;
  }
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const octx = out.getContext('2d', { willReadFrequently: true });
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(cur, 0, 0, W, H);
  const od = octx.getImageData(0, 0, W, H).data;
  const wmap = new Float32Array(W * H);
  for (let i = 0; i < wmap.length; i++) wmap[i] = od[i * 4] / 255;
  return wmap;
}

// ─── glow ────────────────────────────────────────────────────────────────────

/**
 * 화면 빛 번짐. 인필 레이어를 아주 작게 줄였다 늘리는 걸 반복해 크게 흐린다 —
 * 화면 색 그대로(가장자리 쪽 색이 그쪽으로) 번지므로 단색 빛보다 자연스럽다.
 */
export function glowLayer(layer, spread) {
  const W = layer.width, H = layer.height;
  const f = clamp(Math.round(8 + spread * 40), 8, 48);   // 축소 배율 = 퍼지는 정도
  const small = document.createElement('canvas');
  small.width = Math.max(1, Math.round(W / f)); small.height = Math.max(1, Math.round(H / f));
  const sctx = small.getContext('2d');
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(layer, 0, 0, small.width, small.height);
  // 한 번 더 흐려서 사각 경계 없애기
  const mid = document.createElement('canvas');
  mid.width = Math.max(1, Math.round(small.width / 2)); mid.height = Math.max(1, Math.round(small.height / 2));
  const mctx = mid.getContext('2d');
  mctx.imageSmoothingQuality = 'high';
  mctx.drawImage(small, 0, 0, mid.width, mid.height);
  sctx.clearRect(0, 0, small.width, small.height);
  sctx.drawImage(mid, 0, 0, small.width, small.height);
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const octx = out.getContext('2d');
  octx.imageSmoothingQuality = 'high';
  // 늘리면서 살짝 키워 화면 밖으로 퍼지게
  const grow = 1 + spread * 0.25;
  octx.drawImage(small, (W - W * grow) / 2, (H - H * grow) / 2, W * grow, H * grow);
  return out;
}

// ─── 최종 합성 ───────────────────────────────────────────────────────────────

/**
 * @param ctx      장면 크기 캔버스
 * @param bgData   adjustBackground 결과 ImageData
 * @param screen   warpInfill 결과 (없으면 원래 화면 그대로)
 * @param glow     { canvas, strength 0~1 } 또는 null
 */
export function renderInfill(ctx, bgData, screen, glow) {
  ctx.putImageData(bgData, 0, 0);
  if (glow && glow.strength > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = glow.strength;
    ctx.drawImage(glow.canvas, 0, 0);
    ctx.restore();
  }
  if (screen) ctx.drawImage(screen.layer, 0, 0);
}
