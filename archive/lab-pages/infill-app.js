// Screen Infill Builder 화면.
// 좌표는 전부 장면 이미지(처리 해상도) 픽셀 기준. 결과는 #comp 캔버스에 장면 크기로 그리고,
// 오버레이에는 화면 모서리 핸들과 보호 브러시 표시만 퍼센트로 얹는다.

import { blobToDataUrl, loadImage } from './lib/productApi.js';
import {
  readImage, dominantColor, colorFromHex, colorField, detectObjects, orderQuad, warpInfill, quadAlpha, adjustBackground, glowLayer, renderInfill, rgbCss,
} from './lib/infill.js';

const $ = (id) => document.getElementById(id);

const DEFAULTS = {
  mode: 'palette', strength: 60, saturation: 0, protectNeutrals: true, glow: 25, glowSpread: 40,
  objectAmount: 15,  // 오브젝트가 받는 색의 비율 (%)
  centerClear: 50,   // palette: 화면 주변을 비우는 반경
  vivid: 30,         // palette: 색 지도의 채도 부스트
  floorAmount: 30,   // palette: 바닥(화면 아래선 밑)이 받는 비율 (%)
};

const state = {
  scene: null,       // readImage() 결과
  infill: null,      // readImage() 결과
  quad: [],          // 화면 네 모서리 (왼위·오위·오아래·왼아래). 찍는 중엔 4개 미만
  picking: false,    // 모서리 찍는 중
  fit: 'cover',
  params: { ...DEFAULTS },
  modeTouched: false, // 사용자가 모드를 직접 고르면 자동 추천을 더 하지 않는다
  protect: null,     // 오브젝트 마스크 (장면 크기 캔버스, 알파 = 오브젝트). 없으면 전부 배경
  protecting: false,
  protectMode: 'paint',
  protectSize: 60,
  guides: true,
  target: null,      // 사용자가 고른 목표색 (#rrggbb). null 이면 인필에서 자동으로 뽑은 색
};

/** 배경을 끌어갈 목표색 — 직접 고른 색이 있으면 그것, 없으면 인필 대표색 */
const targetColor = () => (state.target ? colorFromHex(state.target) : cache.inColor);

// 계산 결과 캐시 — 바뀐 입력에 해당하는 것만 다시 계산한다
const cache = { screenKey: null, screen: null, alpha: null, bgColor: null, inColor: null, glowKey: null, glow: null, fieldKey: null, field: null };

function ensureField() {
  const key = state.infill ? `${state.infillId}:${state.params.vivid}` : null;
  if (key === cache.fieldKey) return;
  cache.fieldKey = key;
  cache.field = state.infill ? colorField(state.infill, state.scene.w, state.scene.h, state.params.vivid / 100) : null;
}

/** palette 의 "화면 주변 비우기" 원 — 화면 중심, 반경은 장면 대각선 비율 */
function centerCircle() {
  if (!quadReady() || !state.params.centerClear) return null;
  const x = state.quad.reduce((a, p) => a + p.x, 0) / 4, y = state.quad.reduce((a, p) => a + p.y, 0) / 4;
  return { x, y, r: (state.params.centerClear / 100) * 0.7 * Math.hypot(state.scene.w, state.scene.h) };
}

function setStatus(msg, isError = false) {
  $('status').textContent = msg || '';
  $('status').classList.toggle('error', isError);
}

const quadReady = () => state.quad.length === 4;

// ─── 계산 ────────────────────────────────────────────────────────────────────

/** 화면 레이어·화면 알파·대표색. quad·인필·fit 이 바뀔 때만 다시 만든다. */
function ensureScreen() {
  const key = quadReady() ? JSON.stringify([state.quad.map((p) => [p.x | 0, p.y | 0]), state.fit, !!state.infill]) : null;
  if (key === cache.screenKey) return;
  cache.screenKey = key;
  cache.screen = null;
  cache.alpha = null;
  if (quadReady()) {
    if (state.infill) {
      cache.screen = warpInfill(state.scene, state.infill, state.quad, state.fit);
      cache.alpha = cache.screen.screenAlpha;
    } else {
      cache.alpha = quadAlpha(state.scene, state.quad);
    }
  }
  // 배경 대표색은 화면 영역을 뺀 나머지에서 잰다
  const a = cache.alpha;
  cache.bgColor = dominantColor(state.scene.data, a ? (i) => a[i] > 0 : null);
  cache.glowKey = null;
}

function ensureGlow() {
  const key = cache.screen ? `${cache.screenKey}:${state.params.glowSpread}` : null;
  if (key === cache.glowKey) return;
  cache.glowKey = key;
  cache.glow = cache.screen ? glowLayer(cache.screen.layer, state.params.glowSpread / 100) : null;
}

/** 지금 상태로 최종 이미지를 ctx 에 그린다. 화면과 다운로드가 같이 쓴다. */
function paint(ctx) {
  ensureScreen();
  const p = state.params;
  let bgData = state.scene.data;
  if (cache.screen && targetColor()) {
    const protect = state.protect ? state.protect.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, state.scene.w, state.scene.h).data : null;
    if (p.mode === 'palette') ensureField();
    bgData = adjustBackground(state.scene, {
      mode: p.mode,
      field: cache.field,
      objectAmount: p.objectAmount / 100,
      center: centerCircle(),
      // 바닥선 = 화면 아래 변. 그 아래는 floorAmount 만큼만 물든다
      floor: quadReady() ? { y: Math.max(state.quad[2].y, state.quad[3].y), amount: p.floorAmount / 100 } : null,
      strength: p.strength / 100,
      saturation: p.saturation / 100,
      protectNeutrals: p.protectNeutrals,
      from: cache.bgColor,
      to: targetColor(),
    }, cache.alpha, protect);
    ensureGlow();
  }
  renderInfill(ctx, bgData, cache.screen, cache.glow ? { canvas: cache.glow, strength: p.glow / 100 } : null);
}

let drawQueued = false;
function scheduleDraw() {
  if (drawQueued || !state.scene) return;
  drawQueued = true;
  requestAnimationFrame(() => {
    drawQueued = false;
    paint($('comp').getContext('2d'));
    syncSwatches();
  });
}

// ─── UI 동기화 ───────────────────────────────────────────────────────────────

const pct = (v, t) => `${(v / t) * 100}%`;

const MODE_HINT = {
  palette: 'Spreads the screen\'s own colors across the scene — left colors to the left, right colors to the right. Clears around the screen.',
  tint: 'Washes one color over the scene, keeping brightness. Best for beige, white or grey scenes.',
  hue: 'Rotates the scene\'s hues toward one color. Best for colorful scenes.',
};

function render() {
  const { scene } = state;
  $('stage').classList.toggle('empty', !scene);
  $('download').disabled = !scene;
  $('toggleGuides').setAttribute('aria-pressed', String(state.guides));
  const ov = $('overlay');
  ov.classList.toggle('picking', state.picking);
  ov.classList.toggle('protecting', state.protecting);
  ov.classList.toggle('guides-off', !state.guides && !state.picking);

  // 모서리 핸들 + 사각형
  const handles = $('handles');
  while (handles.children.length < state.quad.length) {
    const h = document.createElement('div');
    h.className = 'handle';
    handles.append(h);
  }
  while (handles.children.length > state.quad.length) handles.lastElementChild.remove();
  if (scene) {
    state.quad.forEach((p, i) => {
      const h = handles.children[i];
      h.dataset.i = i;
      h.textContent = quadReady() ? i + 1 : '';
      h.style.left = pct(p.x, scene.w);
      h.style.top = pct(p.y, scene.h);
    });
    $('quadSvg').setAttribute('viewBox', `0 0 ${scene.w} ${scene.h}`);
    $('quadSvg').querySelector('polygon').setAttribute('points', state.quad.map((p) => `${p.x},${p.y}`).join(' '));
  }

  $('setCorners').classList.toggle('active', state.picking);
  $('setCorners').textContent = state.picking ? `Click corner ${state.quad.length + 1} of 4…` : quadReady() ? 'Redo corners' : 'Set corners';
  $('cornerInfo').textContent = quadReady() ? 'Screen set — drag the numbered handles to adjust.' : '';

  // 오른쪽 패널
  document.querySelectorAll('[data-seg]').forEach((seg) => {
    const v = seg.dataset.seg === 'fit' ? state.fit : state.params[seg.dataset.seg];
    seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
  });
  document.querySelectorAll('[data-k]').forEach((input) => {
    const v = state.params[input.dataset.k];
    if (input.type === 'checkbox') input.checked = v;
    else { input.value = v; input.nextElementSibling.textContent = v; }
  });
  $('modeHint').textContent = MODE_HINT[state.params.mode];
  document.querySelector('.palette-only').hidden = state.params.mode !== 'palette';
  // palette 는 인필의 색 배치를 그대로 쓰므로 목표색 지정과는 상관이 없다
  $('targetCustom').disabled = state.params.mode === 'palette';

  $('protectToggle').classList.toggle('active', state.protecting);
  $('protectToggle').textContent = state.protecting ? 'Done (Esc)' : 'Fix with brush';
  $('protectMode').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === state.protectMode));
  $('protectSize').value = state.protectSize;
  $('protectSize').nextElementSibling.textContent = state.protectSize;
  $('protectClear').hidden = !state.protect;
  $('brushCursor').classList.toggle('erase', state.protectMode === 'erase');
  drawProtectView();

  scheduleDraw();
}

function syncSwatches() {
  const show = (id, c) => {
    $(id).style.background = c ? rgbCss(c.rgb) : '';
    $(`${id}Txt`).textContent = c ? `H ${Math.round(c.h)}° · S ${Math.round(c.s * 100)}%` : '—';
  };
  show('swBg', state.scene ? cache.bgColor : null);
  show('swIn', state.infill ? targetColor() : null);
  $('swInLabel').textContent = state.target ? 'Target' : 'Screen';
  $('targetCustom').checked = !!state.target;
  $('targetColor').disabled = !state.target;
  let hint = '';
  if (state.params.mode === 'hue' && state.scene && cache.bgColor && cache.bgColor.chroma < 0.06) hint = 'The scene is mostly neutral — Palette or Tint will change it more than Hue shift.';
  else if (state.infill && !state.target && cache.inColor && cache.inColor.chroma < 0.06) hint = 'The screen image is mostly black, white or grey, so there is little color to match.';
  $('moodHint').textContent = hint;
}

// ─── 1. 장면 ─────────────────────────────────────────────────────────────────

async function setScene(file) {
  if (!file || !file.type.startsWith('image/')) return;
  const img = await loadImage(await blobToDataUrl(file));
  state.scene = readImage(img);
  state.quad = [];
  state.picking = true; // 장면을 올리면 바로 모서리부터 찍게
  Object.assign(cache, { screenKey: undefined });
  const { w, h } = state.scene;
  $('comp').width = $('protectView').width = w;
  $('comp').height = $('protectView').height = h;
  // 배경/오브젝트를 바로 한 번 나눠 둔다 (매끈한 스튜디오 배경일수록 잘 맞는다)
  state.protect = detectObjects(state.scene, null);
  const scaled = w !== img.naturalWidth ? ` (working at ${w} × ${h})` : '';
  $('sceneInfo').textContent = `${file.name} · ${img.naturalWidth} × ${img.naturalHeight}${scaled}`;
  setStatus('Click the four corners of the screen.');
  render();
}

$('sceneFile').addEventListener('change', (e) => { setScene(e.target.files[0]); e.target.value = ''; });
const stage = $('stage');
stage.addEventListener('dragover', (e) => { e.preventDefault(); stage.classList.add('dragover'); });
stage.addEventListener('dragleave', () => stage.classList.remove('dragover'));
stage.addEventListener('drop', (e) => {
  e.preventDefault();
  stage.classList.remove('dragover');
  // 장면이 이미 있으면 떨어뜨린 이미지는 인필로 본다
  if (state.scene && quadReady()) setInfill(e.dataTransfer.files[0]);
  else setScene(e.dataTransfer.files[0]);
});

// ─── 2. 모서리 ───────────────────────────────────────────────────────────────

function toScene(e) {
  const r = $('overlay').getBoundingClientRect();
  return {
    x: clamp((e.clientX - r.left) * (state.scene.w / r.width), 0, state.scene.w),
    y: clamp((e.clientY - r.top) * (state.scene.h / r.height), 0, state.scene.h),
  };
}
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

$('setCorners').addEventListener('click', () => {
  if (!state.scene) return setStatus('Upload a scene image first.', true);
  state.picking = !state.picking;
  if (state.picking) { state.quad = []; state.protecting = false; setStatus('Click the four corners of the screen.'); }
  render();
});
$('clearCorners').addEventListener('click', () => { state.quad = []; state.picking = false; render(); });

let gesture = null; // { kind: 'handle', i } | { kind: 'protect', last }

$('overlay').addEventListener('pointerdown', (e) => {
  if (!state.scene) return;
  const p = toScene(e);
  if (state.protecting) {
    e.preventDefault();
    $('overlay').setPointerCapture(e.pointerId);
    gesture = { kind: 'protect', last: p };
    paintProtect(p, p);
    return;
  }
  const h = e.target.closest('.handle');
  if (h && quadReady()) {
    e.preventDefault();
    $('overlay').setPointerCapture(e.pointerId);
    gesture = { kind: 'handle', i: Number(h.dataset.i) };
    return;
  }
  if (state.picking) {
    state.quad.push(p);
    if (state.quad.length === 4) {
      state.quad = orderQuad(state.quad);
      state.picking = false;
      setStatus(state.infill ? 'Screen set.' : 'Screen set. Now upload the screen image.');
    }
    render();
  }
});

$('overlay').addEventListener('pointermove', (e) => {
  if (!state.scene) return;
  if (state.protecting) moveBrushCursor(e);
  if (!gesture) return;
  const p = toScene(e);
  if (gesture.kind === 'handle') {
    state.quad[gesture.i] = p;
    render();
  } else {
    paintProtect(gesture.last, p);
    gesture.last = p;
  }
});
$('overlay').addEventListener('pointerup', () => { gesture = null; });
$('overlay').addEventListener('pointerleave', () => { $('brushCursor').hidden = true; });

// ─── 3. 인필 ─────────────────────────────────────────────────────────────────

async function setInfill(file) {
  if (!file || !file.type.startsWith('image/')) return;
  if (!state.scene) return setStatus('Upload a scene image first.', true);
  const img = await loadImage(await blobToDataUrl(file));
  state.infill = readImage(img, 2000);
  state.infillId = (state.infillId || 0) + 1;
  cache.inColor = dominantColor(state.infill.data);
  cache.screenKey = undefined;
  $('infillInfo').textContent = `${file.name} · ${img.naturalWidth} × ${img.naturalHeight}`;
  ensureScreen();
  if (!quadReady()) setStatus('Screen image loaded. Now click the four corners of the screen.');
  else setStatus('');
  render();
}
$('infillFile').addEventListener('change', (e) => { setInfill(e.target.files[0]); e.target.value = ''; });

// ─── 오른쪽 패널 ─────────────────────────────────────────────────────────────

document.querySelectorAll('[data-seg]').forEach((seg) => seg.addEventListener('click', (e) => {
  const v = e.target.closest('button')?.dataset.v;
  if (!v) return;
  if (seg.dataset.seg === 'fit') state.fit = v;
  else { state.params[seg.dataset.seg] = v; if (seg.dataset.seg === 'mode') state.modeTouched = true; }
  render();
}));
document.querySelectorAll('[data-k]').forEach((input) => input.addEventListener('input', () => {
  state.params[input.dataset.k] = input.type === 'checkbox' ? input.checked : Number(input.value);
  render();
}));
$('targetCustom').addEventListener('change', (e) => {
  state.target = e.target.checked ? $('targetColor').value : null;
  render();
});
$('targetColor').addEventListener('input', (e) => { if (state.target) { state.target = e.target.value; render(); } });

$('resetAll').addEventListener('click', () => { state.params = { ...DEFAULTS }; state.modeTouched = false; render(); });

// ─── 보호 브러시 ─────────────────────────────────────────────────────────────

function paintProtect(a, b) {
  if (!state.protect) {
    const c = document.createElement('canvas');
    c.width = state.scene.w; c.height = state.scene.h;
    state.protect = c;
  }
  const ctx = state.protect.getContext('2d', { willReadFrequently: true });
  const r = state.protectSize / 2;
  ctx.globalCompositeOperation = state.protectMode === 'paint' ? 'source-over' : 'destination-out';
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / Math.max(1, r * 0.25)));
  for (let i = 0; i <= steps; i++) {
    const x = a.x + ((b.x - a.x) * i) / steps, y = a.y + ((b.y - a.y) * i) / steps;
    const g = ctx.createRadialGradient(x, y, r * 0.55, x, y, r);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
  render();
}

function drawProtectView() {
  if (!state.scene || !state.protecting) return;
  const v = $('protectView');
  const ctx = v.getContext('2d');
  ctx.clearRect(0, 0, v.width, v.height);
  if (!state.protect) return;
  ctx.drawImage(state.protect, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = 'rgba(47, 111, 228, 0.35)';
  ctx.fillRect(0, 0, v.width, v.height);
  ctx.globalCompositeOperation = 'source-over';
}

function moveBrushCursor(e) {
  const r = $('overlay').getBoundingClientRect();
  const d = state.protectSize * (r.width / state.scene.w);
  Object.assign($('brushCursor').style, { left: `${e.clientX - r.left}px`, top: `${e.clientY - r.top}px`, width: `${d}px`, height: `${d}px` });
  $('brushCursor').hidden = false;
}

function setProtecting(on) {
  if (on && !state.scene) return setStatus('Upload a scene image first.', true);
  state.protecting = on;
  if (on) state.picking = false;
  $('brushCursor').hidden = true;
  render();
  if (on) setStatus('Blue = object (takes little color). Paint Background or Object to fix. Esc when done.');
}
$('protectToggle').addEventListener('click', () => setProtecting(!state.protecting));
$('protectMode').addEventListener('click', (e) => {
  const v = e.target.closest('button')?.dataset.v;
  if (v) { state.protectMode = v; render(); }
});
$('protectSize').addEventListener('input', (e) => { state.protectSize = Number(e.target.value); render(); });
$('protectClear').addEventListener('click', () => { state.protect = null; render(); });
$('detectBg').addEventListener('click', () => {
  if (!state.scene) return setStatus('Upload a scene image first.', true);
  ensureScreen();
  state.protect = detectObjects(state.scene, cache.alpha);
  setStatus('Background detected. Use "Fix with brush" to correct any misses.');
  if (!state.protecting) setProtecting(true);
  else render();
});

// ─── 키보드 · 가이드 · 다운로드 ───────────────────────────────────────────────

$('toggleGuides').addEventListener('click', () => { state.guides = !state.guides; render(); });
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea')) return;
  if (e.key === 'Escape') {
    if (state.protecting) setProtecting(false);
    else if (state.picking) { state.picking = false; state.quad = state.quad.length === 4 ? state.quad : []; render(); }
  } else if (e.key.toLowerCase() === 'g' && !e.metaKey && !e.ctrlKey && !e.altKey) {
    state.guides = !state.guides;
    render();
  }
});

$('download').addEventListener('click', () => {
  if (!state.scene) return;
  const c = document.createElement('canvas');
  c.width = state.scene.w;
  c.height = state.scene.h;
  paint(c.getContext('2d'));
  c.toBlob((blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'infill.png';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, 'image/png');
});

render();
