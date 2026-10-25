// 테스트 화면. 제품 N개 — 제품마다 영역 하나, 이미지 하나, 배치값 하나, 그림자·톤 설정 하나.
// 좌표는 전부 배경 이미지의 원본 픽셀 기준으로 들고 있다.
// 합성 결과는 캔버스(#comp)에 배경 원본 크기로 그리고, 그 위 오버레이에는 영역 박스와
// 제품을 끌기 위한 투명 손잡이만 퍼센트로 얹는다. 다운로드도 같은 drawComposite 로 그린다.

import { blobToDataUrl, loadImage } from './lib/productApi.js';
import { importFromUrl, importFromFile, editProduct } from './lib/productImportFlow.js';
import { DEFAULT_FX, cloneFx, createBackground, drawComposite } from './lib/composite.js';

const $ = (id) => document.getElementById(id);
const MAX_COUNT = 20;
/** 슬롯마다 영역 테두리 색 — 여러 개를 그려도 어느 게 몇 번인지 보이게 */
const COLORS = ['#FD312E', '#2F6FE4', '#1F9D6B', '#8A5CF6', '#F08C00', '#0E9AAE', '#C2307A', '#716F6A'];
const colorOf = (i) => COLORS[i % COLORS.length];

const newSlot = () => ({
  area: null,      // { x, y, w, h }
  product: null,   // ProductImage (productImportFlow.js)
  url: '',
  place: { scale: 1, dx: 0, dy: 0 },
  fx: cloneFx(DEFAULT_FX),
  eraser: null,    // 배경 크기 캔버스 — 칠한 곳만큼 이 제품의 그림자를 지운다 (처음 칠할 때 만든다)
});

const state = {
  bg: null,        // { src, w, h, px }  — px: createBackground() 결과 (픽셀 샘플링용)
  slots: [newSlot()],
  active: 0,       // Placement 가 다루는 슬롯
  drawing: null,   // 영역을 그리는 중인 슬롯 번호
  guides: true,    // 영역 박스·선택 테두리 표시. 끄면 결과물만 보인다
  erasing: false,  // 그림자 지우개 모드 (활성 제품에 칠한다)
  eraseMode: 'erase', // 'erase' | 'restore'
  eraseSize: 40,   // 브러시 지름 (배경 픽셀)
};

function setStatus(msg, isError = false) {
  $('status').textContent = msg || '';
  $('status').classList.toggle('error', isError);
}

// ─── 배치 계산 ────────────────────────────────────────────────────────────────

/**
 * 제품이 놓일 사각형 (배경 픽셀). 영역에 contain 으로 맞춰 영역 한가운데에 놓는다.
 * 크기를 바꾸면 제품 중심이 그대로인 채 커지고 작아진다.
 */
function productRect(slot) {
  const { area, product, place } = slot;
  if (!area || !product) return null;
  const fit = Math.min(area.w / product.w, area.h / product.h) * place.scale;
  const w = product.w * fit;
  const h = product.h * fit;
  const cx = area.x + area.w / 2 + place.dx;
  const cy = area.y + area.h / 2 + place.dy;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/** 영역 없이 제품부터 넣으면 배경을 제품 수만큼 가로로 나눠 기본 영역을 잡아 준다. */
function ensureArea(i) {
  const slot = state.slots[i];
  if (slot.area || !state.bg) return;
  const { w, h } = state.bg;
  const n = state.slots.length;
  const cell = (w * 0.8) / n;
  slot.area = { x: Math.round(w * 0.1 + cell * i + cell * 0.1), y: Math.round(h * 0.3), w: Math.round(cell * 0.8), h: Math.round(h * 0.6) };
}

// ─── 제품 수 ─────────────────────────────────────────────────────────────────

function setCount(n) {
  n = Math.max(1, Math.min(MAX_COUNT, Math.round(Number(n)) || 1));
  $('count').value = n;
  // 숫자를 친 뒤 Draw 를 누르면 blur 로 change 가 또 온다. 그때 목록을 다시 만들면
  // 누르던 버튼이 사라져 클릭이 먹힌다 — 개수가 그대로면 아무것도 하지 않는다.
  if (n === state.slots.length) return;
  while (state.slots.length < n) state.slots.push(newSlot());
  // 줄일 때 뒤쪽 슬롯은 버린다 — 이미지까지 넣은 슬롯이면 한 번 묻는다
  if (n < state.slots.length) {
    const dropped = state.slots.slice(n).filter((s) => s.product).length;
    if (dropped && !confirm(`${dropped} product image(s) will be removed. Continue?`)) {
      $('count').value = state.slots.length;
      return;
    }
    state.slots.length = n;
  }
  state.active = Math.min(state.active, n - 1);
  if (state.drawing !== null && state.drawing >= n) state.drawing = null;
  $('count').value = n;
  buildLists();
  render();
}

$('count').addEventListener('change', (e) => setCount(e.target.value));
$('countMinus').addEventListener('click', () => setCount(state.slots.length - 1));
$('countPlus').addEventListener('click', () => setCount(state.slots.length + 1));

// ─── 패널 목록 (제품 수가 바뀔 때만 다시 만든다) ──────────────────────────────

/** 행 목록을 제품 수에 맞춘다. 있는 행은 건드리지 않고 모자라면 붙이고 남으면 뗀다. */
function syncRows(list, make) {
  const n = state.slots.length;
  while (list.children.length > n) list.lastElementChild.remove();
  for (let i = list.children.length; i < n; i++) list.append(make(i));
}

function buildLists() {
  // 3. 영역
  syncRows($('areaList'), (i) => {
    const row = document.createElement('div');
    row.className = 'item';
    row.dataset.i = i;
    row.innerHTML = `
      <div class="item-head">
        <span class="tag" style="--c:${colorOf(i)}">${i + 1}</span>
        <button type="button" class="draw">Draw</button>
        <button type="button" class="ghost clear">Clear</button>
      </div>`;
    row.querySelector('.draw').addEventListener('click', () => {
      if (!state.bg) return setStatus('Upload a background image first.', true);
      state.drawing = state.drawing === i ? null : i;
      state.erasing = false;
      state.active = i;
      render();
    });
    row.querySelector('.clear').addEventListener('click', () => { state.slots[i].area = null; render(); });
    return row;
  });

  // 4. 제품 이미지
  syncRows($('productList'), (i) => {
    const slot = state.slots[i];
    const row = document.createElement('div');
    row.className = 'item product-row';
    row.dataset.i = i;
    row.innerHTML = `
      <div class="thumb">
        <span class="tag" style="--c:${colorOf(i)}">${i + 1}</span>
        <img alt="" hidden />
        <div class="thumb-actions" hidden>
          <button type="button" class="edit" title="Edit (brush + crop)">Edit</button>
          <button type="button" class="remove" title="Remove">×</button>
        </div>
      </div>
      <div class="product-inputs">
        <form class="row url-form">
          <input type="url" placeholder="LG.com product URL" required />
          <button type="submit">Import</button>
        </form>
        <div class="row">
          <label class="file-btn ghost-btn">Upload<input type="file" accept="image/*" /></label>
          <button type="button" class="link change" hidden>Change from imported images</button>
        </div>
        <p class="muted meta"></p>
      </div>`;
    const urlInput = row.querySelector('input[type=url]');
    urlInput.value = slot.url;
    urlInput.addEventListener('input', () => {
      state.slots[i].url = urlInput.value;
      // URL 을 바꾸면 이전 크롤링 목록은 더 이상 이 URL 것이 아니다
      if (state.slots[i].product) state.slots[i].product.images = null;
      render();
    });
    row.querySelector('.url-form').addEventListener('submit', (e) => {
      e.preventDefault();
      runImport(i, () => importFromUrl(urlInput.value.trim()));
    });
    row.querySelector('.change').addEventListener('click', () => {
      const prev = state.slots[i].product;
      runImport(i, () => importFromUrl(state.slots[i].url, { images: prev?.images }), prev);
    });
    row.querySelector('input[type=file]').addEventListener('change', (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (file) runImport(i, () => importFromFile(file));
    });
    row.querySelector('.edit').addEventListener('click', () => {
      const prev = state.slots[i].product;
      if (prev) runImport(i, () => editProduct(prev), prev);
    });
    row.querySelector('.remove').addEventListener('click', () => {
      state.slots[i].product = null;
      render();
    });
    return row;
  });
}

/**
 * 팝업 흐름 하나를 돌려 슬롯에 넣는다. 취소하면 아무것도 안 바꾼다.
 * keep 을 주면 결과에 빠진 정보(메타·이미지 목록)를 이전 것에서 이어받는다.
 */
async function runImport(i, flow, keep) {
  if (!state.bg) return setStatus('Upload a background image first.', true);
  setStatus('');
  try {
    const out = await flow();
    if (!out) return;
    const slot = state.slots[i];
    if (!slot) return; // 그새 제품 수를 줄였다
    // 합성 엔진은 이미지 요소로 그리므로 미리 디코드해 둔다
    const img = await loadImage(out.src);
    slot.product = { ...out, img, meta: out.meta ?? keep?.meta, images: out.images ?? keep?.images };
    if (!keep) Object.assign(slot.place, { dx: 0, dy: 0 });
    ensureArea(i);
    state.active = i;
    render();
    const m = slot.product.meta;
    setStatus(`Product ${i + 1} placed · ${out.w} × ${out.h}px${m?.model ? ` · ${m.model}` : ''}`);
  } catch (err) {
    console.error(err);
    setStatus(`Image processing failed: ${err.message}`, true);
  }
}

// ─── 렌더 ────────────────────────────────────────────────────────────────────

function pct(v, total) { return `${(v / total) * 100}%`; }

function placeEl(el, r) {
  const { w, h } = state.bg;
  Object.assign(el.style, { left: pct(r.x, w), top: pct(r.y, h), width: pct(r.w, w), height: pct(r.h, h) });
}

const boxEls = [];
const productEls = [];

/** 요소 배열을 n 개로 맞춘다. 영역 박스는 모든 제품보다 아래에 깔리도록 앞쪽에 넣는다. */
function syncStageEls(list, n, make) {
  const overlay = $('overlay');
  while (list.length < n) {
    const el = make();
    if (list === boxEls) overlay.insertBefore(el, productEls[0] || null);
    else overlay.append(el);
    list.push(el);
  }
  while (list.length > n) list.pop().remove();
}

function render() {
  const { bg, slots } = state;
  $('stage').classList.toggle('empty', !bg);
  $('download').disabled = !bg;

  // 스테이지: 영역 박스 + 제품. 드래그 중에도 매 프레임 불리므로 요소는 재사용한다
  // (큰 dataURL 이미지를 매번 새로 만들면 깜빡이고 느려진다).
  $('overlay').classList.toggle('drawing', state.drawing !== null);
  // 영역을 그리는 동안에는 가이드가 꺼져 있어도 보여야 무엇을 그리는지 안다
  $('overlay').classList.toggle('guides-off', !state.guides && state.drawing === null);
  $('toggleGuides').setAttribute('aria-pressed', String(state.guides));
  syncStageEls(boxEls, slots.length, () => {
    const el = document.createElement('div');
    el.className = 'area-box';
    return el;
  });
  syncStageEls(productEls, slots.length, () => {
    const el = document.createElement('div');
    el.className = 'product';
    return el;
  });
  slots.forEach((slot, i) => {
    const box = boxEls[i];
    box.hidden = !bg || !slot.area;
    if (!box.hidden) {
      box.style.setProperty('--c', colorOf(i));
      placeEl(box, slot.area);
      box.dataset.label = `${i + 1} · ${Math.round(slot.area.w)}×${Math.round(slot.area.h)}`;
    }
    const handle = productEls[i];
    const r = bg && productRect(slot);
    handle.hidden = !r;
    if (r) {
      handle.dataset.i = i;
      handle.classList.toggle('active', i === state.active);
      handle.style.setProperty('--c', colorOf(i));
      placeEl(handle, r);
    }
  });
  scheduleDraw();

  // 영역 목록
  $('areaList').querySelectorAll('.item').forEach((row) => {
    const i = Number(row.dataset.i);
    const area = slots[i]?.area;
    const btn = row.querySelector('.draw');
    btn.classList.toggle('active', state.drawing === i);
    btn.textContent = state.drawing === i ? 'Drag on canvas…' : area ? 'Redraw' : 'Draw';
  });

  // 제품 목록
  $('productList').querySelectorAll('.item').forEach((row) => {
    const slot = slots[Number(row.dataset.i)];
    const p = slot?.product;
    const img = row.querySelector('.thumb img');
    img.hidden = !p;
    if (p && img.getAttribute('src') !== p.src) img.src = p.src;
    row.querySelector('.thumb-actions').hidden = !p;
    row.querySelector('.change').hidden = !(p?.images?.length);
    row.querySelector('.meta').textContent = p?.meta ? [p.meta.name, p.meta.model].filter(Boolean).join(' · ') : '';
  });

  // 배치 탭 + 컨트롤 (활성 슬롯 값)
  $('placeTabs').replaceChildren(...slots.map((slot, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tab' + (i === state.active ? ' on' : '');
    b.style.setProperty('--c', colorOf(i));
    b.textContent = i + 1;
    b.title = slot.product ? `Product ${i + 1}` : `Product ${i + 1} (empty)`;
    if (!slot.product) b.classList.add('empty');
    b.addEventListener('click', () => { state.active = i; render(); });
    return b;
  }));
  const ap = slots[state.active].place;
  $('scale').value = Math.round(ap.scale * 100);
  $('scaleOut').textContent = `${Math.round(ap.scale * 100)}%`;
  syncFxPanel();
}

/** 합성 캔버스 다시 그리기 — 한 프레임에 한 번만. */
let drawQueued = false;
function scheduleDraw() {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(() => {
    drawQueued = false;
    if (!state.bg) return;
    const c = $('comp');
    drawComposite(c.getContext('2d'), state.bg.px, compositeItems());
  });
}

/** 그릴 제품 목록 (번호 순 = 겹치는 순서). 화면과 다운로드가 같이 쓴다. */
function compositeItems() {
  return state.slots
    .map((slot) => ({ slot, rect: productRect(slot) }))
    .filter(({ slot, rect }) => rect && slot.product.img)
    .map(({ slot, rect }) => ({ image: slot.product.img, rect, area: slot.area, fx: slot.fx, eraser: slot.eraser }));
}

// ─── 1. 배경 ─────────────────────────────────────────────────────────────────

async function setBackground(file) {
  if (!file || !file.type.startsWith('image/')) return;
  const src = await blobToDataUrl(file);
  const img = await loadImage(src);
  state.bg = { src, w: img.naturalWidth, h: img.naturalHeight, px: createBackground(img) };
  $('comp').width = $('eraseView').width = state.bg.w;
  $('comp').height = $('eraseView').height = state.bg.h;
  // 지운 자리는 배경 좌표라 다른 배경에서는 의미가 없다
  state.slots.forEach((s) => { s.eraser = null; });
  // 크기가 다른 배경이면 이전 영역 좌표는 의미가 없다
  state.slots.forEach((s, i) => { s.area = null; if (s.product) ensureArea(i); });
  $('bgInfo').textContent = `${file.name} · ${state.bg.w} × ${state.bg.h}`;
  render();
}

$('bgFile').addEventListener('change', (e) => setBackground(e.target.files[0]));

const stage = $('stage');
stage.addEventListener('dragover', (e) => { e.preventDefault(); stage.classList.add('dragover'); });
stage.addEventListener('dragleave', () => stage.classList.remove('dragover'));
stage.addEventListener('drop', (e) => {
  e.preventDefault();
  stage.classList.remove('dragover');
  setBackground(e.dataTransfer.files[0]);
});

// ─── 스테이지 포인터: 영역 그리기 / 제품 끌기 ────────────────────────────────

/** 화면 좌표 → 배경 픽셀 좌표 */
function toBg(e) {
  const rect = $('overlay').getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(state.bg.w, (e.clientX - rect.left) * (state.bg.w / rect.width))),
    y: Math.max(0, Math.min(state.bg.h, (e.clientY - rect.top) * (state.bg.h / rect.height))),
  };
}

let gesture = null; // { kind: 'draw', i, start } | { kind: 'move', i, from, dx, dy }

$('overlay').addEventListener('pointerdown', (e) => {
  if (!state.bg) return;
  if (state.erasing) {
    e.preventDefault();
    $('overlay').setPointerCapture(e.pointerId);
    const p = toBg(e);
    gesture = { kind: 'erase', last: p };
    paintEraser(p, p);
    return;
  }
  if (state.drawing !== null) {
    e.preventDefault();
    $('overlay').setPointerCapture(e.pointerId);
    const start = toBg(e);
    gesture = { kind: 'draw', i: state.drawing, start };
    state.slots[gesture.i].area = { x: start.x, y: start.y, w: 1, h: 1 };
    render();
    return;
  }
  const target = e.target.closest('.product');
  if (!target) return;
  e.preventDefault();
  $('overlay').setPointerCapture(e.pointerId);
  const i = Number(target.dataset.i);
  const { dx, dy } = state.slots[i].place;
  gesture = { kind: 'move', i, from: toBg(e), dx, dy };
  state.active = i;
  render();
});

$('overlay').addEventListener('pointermove', (e) => {
  if (state.erasing && state.bg) moveBrushCursor(e);
  if (!gesture) return;
  const p = toBg(e);
  if (gesture.kind === 'erase') {
    paintEraser(gesture.last, p);
    gesture.last = p;
    return;
  }
  const slot = state.slots[gesture.i];
  if (gesture.kind === 'draw') {
    const s = gesture.start;
    slot.area = { x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.max(1, Math.abs(p.x - s.x)), h: Math.max(1, Math.abs(p.y - s.y)) };
  } else {
    slot.place.dx = gesture.dx + (p.x - gesture.from.x);
    slot.place.dy = gesture.dy + (p.y - gesture.from.y);
  }
  render();
});

$('overlay').addEventListener('pointerleave', () => { $('brushCursor').hidden = true; });
$('overlay').addEventListener('pointerup', () => {
  if (!gesture) return;
  if (gesture.kind === 'erase') { gesture = null; return; }
  if (gesture.kind === 'draw') {
    const slot = state.slots[gesture.i];
    // 너무 작게 찍힌 건 실수로 본다
    if (slot.area && (slot.area.w < 10 || slot.area.h < 10)) slot.area = null;
    Object.assign(slot.place, { dx: 0, dy: 0 });
    state.drawing = null;
  }
  gesture = null;
  render();
});

// ─── 가이드 표시 ─────────────────────────────────────────────────────────────

function toggleGuides() { state.guides = !state.guides; render(); }
$('toggleGuides').addEventListener('click', toggleGuides);
// G 키로도 켜고 끈다 (입력칸에 타이핑 중일 때는 제외)
document.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() !== 'g' || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target.closest('input, select, textarea, .pi-backdrop')) return;
  toggleGuides();
});

// ─── 5. 배치 ─────────────────────────────────────────────────────────────────

const activePlace = () => state.slots[state.active].place;

$('scale').addEventListener('input', (e) => { activePlace().scale = Number(e.target.value) / 100; render(); });
$('resetPos').addEventListener('click', () => { Object.assign(activePlace(), { scale: 1, dx: 0, dy: 0 }); render(); });

// ─── 6. 그림자 · 톤 ──────────────────────────────────────────────────────────

const SURFACE_HINT = {
  floor: 'Standing on the floor — fridges, washers, purifiers.',
  wall: 'Mounted on the wall — wall TVs, air conditioners.',
  both: 'Standing on the floor in front of a wall.',
};
const activeFx = () => state.slots[state.active].fx;
const getPath = (o, path) => path.split('.').reduce((v, k) => v?.[k], o);
function setPath(o, path, v) {
  const keys = path.split('.');
  const last = keys.pop();
  keys.reduce((v2, k) => v2[k], o)[last] = v;
}

/** 패널을 활성 제품의 fx 값으로 맞춘다. */
function syncFxPanel() {
  const fx = activeFx();
  const panel = $('fxPanel');
  $('fxFor').textContent = state.active + 1;
  panel.querySelectorAll('[data-seg]').forEach((seg) => {
    seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === fx[seg.dataset.seg]));
  });
  $('surfaceHint').textContent = SURFACE_HINT[fx.surface];
  panel.querySelectorAll('[data-fx]').forEach((input) => {
    const v = getPath(fx, input.dataset.fx);
    if (input.type === 'checkbox') input.checked = !!v;
    else {
      input.value = v;
      input.nextElementSibling.textContent = v;
    }
  });
  // 바닥 쪽 카드는 Wall 에서, 벽 카드는 Floor 에서 숨긴다
  panel.querySelectorAll('[data-show]').forEach((card) => {
    card.hidden = card.dataset.show === 'floor' ? fx.surface === 'wall' : fx.surface === 'floor';
  });
  panel.querySelectorAll('[data-toggle]').forEach((card) => card.classList.toggle('off', !getPath(fx, card.dataset.toggle)));

  $('eraseToggle').classList.toggle('active', state.erasing);
  $('eraseToggle').textContent = state.erasing ? 'Done erasing' : 'Paint to erase shadow';
  $('eraseMode').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === state.eraseMode));
  $('eraseSize').value = state.eraseSize;
  $('eraseSize').nextElementSibling.textContent = state.eraseSize;
  $('eraseClear').hidden = !state.slots[state.active].eraser;
  $('overlay').classList.toggle('erasing', state.erasing);
  $('brushCursor').classList.toggle('restore', state.eraseMode === 'restore');
  drawEraseView();
}

$('fxPanel').addEventListener('click', (e) => {
  const b = e.target.closest('[data-seg] button');
  if (!b) return;
  activeFx()[b.closest('[data-seg]').dataset.seg] = b.dataset.v;
  render();
});
$('fxPanel').addEventListener('input', (e) => {
  const path = e.target.dataset.fx;
  if (!path) return;
  setPath(activeFx(), path, e.target.type === 'checkbox' ? e.target.checked : Number(e.target.value));
  render();
});
$('fxReset').addEventListener('click', () => { state.slots[state.active].fx = cloneFx(DEFAULT_FX); render(); });
$('fxApplyAll').addEventListener('click', () => {
  const src = activeFx();
  state.slots.forEach((s) => { s.fx = cloneFx(src); });
  render();
  setStatus(`Shadow & tone settings of product ${state.active + 1} applied to all ${state.slots.length} products.`);
});

// ─── 그림자 지우개 ───────────────────────────────────────────────────────────

/** 활성 제품의 지우개 캔버스 (없으면 만든다). */
function activeEraser() {
  const slot = state.slots[state.active];
  if (!slot.eraser) {
    const c = document.createElement('canvas');
    c.width = state.bg.w;
    c.height = state.bg.h;
    slot.eraser = c;
  }
  return slot.eraser;
}

/** a → b 선을 따라 부드러운 원형 브러시로 칠한다. Erase 는 알파를 더하고, Restore 는 뺀다. */
function paintEraser(a, b) {
  const ctx = activeEraser().getContext('2d');
  const r = state.eraseSize / 2;
  ctx.globalCompositeOperation = state.eraseMode === 'erase' ? 'source-over' : 'destination-out';
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.max(1, Math.ceil(dist / Math.max(1, r * 0.25)));
  for (let i = 0; i <= steps; i++) {
    const x = a.x + ((b.x - a.x) * i) / steps;
    const y = a.y + ((b.y - a.y) * i) / steps;
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

/** 지우개 모드일 때 지운 자리를 붉게 비춰 보여준다. */
function drawEraseView() {
  const view = $('eraseView');
  if (!state.bg || !state.erasing) return;
  const ctx = view.getContext('2d');
  ctx.clearRect(0, 0, view.width, view.height);
  const er = state.slots[state.active].eraser;
  if (!er) return;
  ctx.drawImage(er, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = 'rgba(253, 49, 46, 0.35)';
  ctx.fillRect(0, 0, view.width, view.height);
  ctx.globalCompositeOperation = 'source-over';
}

function moveBrushCursor(e) {
  const rect = $('overlay').getBoundingClientRect();
  const d = state.eraseSize * (rect.width / state.bg.w);
  Object.assign($('brushCursor').style, {
    left: `${e.clientX - rect.left}px`, top: `${e.clientY - rect.top}px`, width: `${d}px`, height: `${d}px`,
  });
  $('brushCursor').hidden = false;
}

function setErasing(on) {
  if (on && !state.bg) return setStatus('Upload a background image first.', true);
  if (on && !state.slots[state.active].product) return setStatus(`Add product ${state.active + 1} first.`, true);
  state.erasing = on;
  if (on) state.drawing = null;
  $('brushCursor').hidden = true;
  render();
  if (on) setStatus(`Erasing shadow of product ${state.active + 1}. Paint on the canvas, then click Done erasing (Esc).`);
}

$('eraseToggle').addEventListener('click', () => setErasing(!state.erasing));
$('eraseMode').addEventListener('click', (e) => {
  const v = e.target.closest('button')?.dataset.v;
  if (v) { state.eraseMode = v; render(); }
});
$('eraseSize').addEventListener('input', (e) => { state.eraseSize = Number(e.target.value); render(); });
$('eraseClear').addEventListener('click', () => { state.slots[state.active].eraser = null; render(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.erasing && !document.querySelector('.pi-backdrop')) setErasing(false);
});

// ─── 다운로드 ────────────────────────────────────────────────────────────────

$('download').addEventListener('click', async () => {
  const { bg } = state;
  if (!bg) return;
  const c = document.createElement('canvas');
  c.width = bg.w;
  c.height = bg.h;
  // 화면과 같은 함수·같은 순서로 그린다 — 가이드는 캔버스에 없으므로 결과물에 안 들어간다
  drawComposite(c.getContext('2d'), bg.px, compositeItems());
  c.toBlob((blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'composite.png';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, 'image/png');
});

buildLists();
render();
