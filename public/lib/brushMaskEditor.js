// 누끼 결과를 다듬는 모달 — 지우기 / 원본에서 복원.
// 도구: 수동 브러시 / AI(색 유사 영역) 브러시 / 자유 올가미 / 다각형 올가미.
// 올가미는 영역을 닫는 순간 Action 을 그 안(또는 밖)에 한 번에 적용한다.
// 07 sales template/sales-banner-builder 의 BrushMaskEditor.tsx 를 순수 JS 로 옮긴 것.
//
//   const result = await openBrushMaskEditor({ originalUrl, processedUrl });
//   → 다듬은 PNG dataURL, 취소하면 null

const MAX_NATIVE = 1400;
const MAX_UNDO = 10;
/** 한 번의 플러드필이 가져갈 수 있는 최대 픽셀 (허용치가 크면 브라우저가 멈추는 것 방지) */
const MAX_FF_PX = 600_000;
/** AI 브러시로 드래그할 때 다음 채우기까지 움직여야 하는 화면 거리 */
const SMART_DRAG_STEP = 22;
/** AI 브러시 색 허용치 (0~100). 원본에서 정밀 모드로 고정해 쓰던 값 */
const TOLERANCE = 5;
const MAX_DISP_W = 500, MAX_DISP_H = 440;

/** 다각형 올가미에서 시작점에 이만큼(화면 px) 가까이 찍으면 닫힌다 */
const CLOSE_PX = 9;

const TOOL_HINT = {
  brush: 'Paint over the background to erase, or restore missing parts',
  smart: 'Click or drag to let AI detect similar areas automatically',
  lasso: 'Drag around an area — release to apply the action',
  poly: 'Click to add points — click the first point, double-click or press Enter to apply',
};
const TOOL_NOTE = {
  smart: 'Automatically selects connected areas with similar colors',
  lasso: 'Freehand selection. Esc cancels.',
  poly: 'Straight-edge selection. Backspace removes the last point, Esc cancels.',
};

const ERASE_COLOR = '#f87171';
const RESTORE_COLOR = '#34d399';

function loadImg(url) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = url;
  });
}

export function openBrushMaskEditor({ originalUrl, processedUrl, doneLabel = 'Done → Crop', footNote = 'Proceeds to crop after completion' }) {
  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.className = 'pi-backdrop dark';
    root.innerHTML = `
      <div class="pi-modal pi-brush" role="dialog" aria-modal="true">
        <div class="pi-head">
          <div>
            <strong>Background Brush Editor</strong>
            <p class="pi-sub" data-ref="hint"></p>
          </div>
          <button type="button" class="pi-x" data-ref="close" aria-label="Close">×</button>
        </div>
        <div class="pi-brush-body">
          <div class="pi-brush-canvas-wrap" data-ref="wrap">
            <div class="pi-loading">Loading image…</div>
          </div>
          <div class="pi-side">
            <section>
              <p class="pi-label">Brush Mode</p>
              <button type="button" class="pi-opt" data-ref="tool" data-v="brush">Manual Brush</button>
              <button type="button" class="pi-opt" data-ref="tool" data-v="smart">AI Brush <span class="pi-ai">AI</span></button>
              <button type="button" class="pi-opt" data-ref="tool" data-v="lasso">Lasso</button>
              <button type="button" class="pi-opt" data-ref="tool" data-v="poly">Polygonal Lasso</button>
              <p class="pi-note" data-ref="toolNote"></p>
            </section>
            <section data-ref="selSec">
              <p class="pi-label">Apply to</p>
              <div class="pi-row">
                <button type="button" class="pi-opt" data-ref="selArea" data-v="inside">Inside</button>
                <button type="button" class="pi-opt" data-ref="selArea" data-v="outside">Outside</button>
              </div>
              <p class="pi-note">Tip: trace the product, then Outside + Erase removes everything around it.</p>
            </section>
            <section>
              <p class="pi-label">Action</p>
              <div class="pi-row">
                <button type="button" class="pi-opt erase" data-ref="erase">Erase</button>
                <button type="button" class="pi-opt restore" data-ref="restore">Restore</button>
              </div>
              <p class="pi-note" data-ref="actionNote"></p>
            </section>
            <section data-ref="sizeSec">
              <p class="pi-label">Brush Size · <span data-ref="sizeOut"></span>px</p>
              <input type="range" min="4" max="160" data-ref="size" />
            </section>
            <section>
              <p class="pi-label">Zoom · <span data-ref="zoomOut"></span>×</p>
              <div class="pi-row">
                <button type="button" class="pi-mini" data-ref="zoomMinus">−</button>
                <input type="range" min="0.5" max="5" step="0.5" data-ref="zoom" />
                <button type="button" class="pi-mini" data-ref="zoomPlus">+</button>
              </div>
            </section>
            <section>
              <button type="button" class="pi-opt" data-ref="undo">Undo</button>
              <button type="button" class="pi-opt" data-ref="compare">Compare Original (Hold)</button>
            </section>
          </div>
        </div>
        <div class="pi-foot">
          <p class="pi-sub" data-ref="foot"></p>
          <div class="pi-row">
            <button type="button" class="pi-btn ghost" data-ref="cancel">Cancel</button>
            <button type="button" class="pi-btn primary" data-ref="done"></button>
          </div>
        </div>
      </div>`;
    const $ = (r) => root.querySelector(`[data-ref="${r}"]`);
    $('foot').textContent = footNote;
    $('done').textContent = doneLabel;

    const st = {
      mode: 'erase',      // 'erase' | 'restore'
      tool: 'brush',      // 'brush' | 'smart' | 'lasso' | 'poly'
      selArea: 'inside',  // 올가미 적용 범위: 'inside' | 'outside'
      brushSize: 30,
      zoom: 1,
      loading: true,
      processing: false,
      showOrig: false,
    };
    let working = null;   // ImageData — 작업 중인 누끼
    let original = null;  // ImageData — 복원 소스(누끼 전)
    let undoStack = [];
    let nw = 0, nh = 0;   // 축소 후 캔버스 실제 크기
    let dispW = MAX_DISP_W, dispH = MAX_DISP_H;
    let canvas, ctx, stageEl, cursorEl, ringEl, badgeEl;
    let painting = false, lastNative = null, lastSmartDisp = null;
    let dirty = null, raf = null;
    let sel = null;       // 올가미 진행 중 { pts: [{x,y}] (원본 좌표) }
    let hover = null;     // 다각형 올가미에서 다음 점이 될 마우스 위치
    let selSvg;
    const isSmart = () => st.tool === 'smart';
    const isLasso = () => st.tool === 'lasso' || st.tool === 'poly';

    const finish = (result) => {
      document.removeEventListener('keydown', onKey);
      if (raf !== null) cancelAnimationFrame(raf);
      root.remove();
      resolve(result);
    };
    const onKey = (e) => {
      // 올가미를 그리는 중이면 키는 올가미 몫이다 — Esc 가 창을 닫아 버리면 안 된다
      if (sel) {
        if (e.key === 'Escape') { e.preventDefault(); sel = null; hover = null; renderSel(); return; }
        if (e.key === 'Enter' && st.tool === 'poly') { e.preventDefault(); applySelection(); return; }
        if (e.key === 'Backspace' && st.tool === 'poly') {
          e.preventDefault();
          sel.pts.pop();
          if (!sel.pts.length) sel = null;
          renderSel();
          return;
        }
      }
      if (e.key === 'Escape') finish(null);
    };
    document.addEventListener('keydown', onKey);
    root.addEventListener('mousedown', (e) => { if (e.target === root) finish(null); });
    $('close').addEventListener('click', () => finish(null));
    $('cancel').addEventListener('click', () => finish(null));
    $('done').addEventListener('click', () => { if (canvas && !st.processing) finish(canvas.toDataURL('image/png')); });

    // ── 렌더 ────────────────────────────────────────────────────────────────
    const renderCanvas = () => {
      const data = st.showOrig ? original : working;
      if (ctx && data) ctx.putImageData(data, 0, 0);
      dirty = null;
    };
    const markDirty = (x0, y0, x1, y1) => {
      if (!dirty) dirty = { x0, y0, x1, y1 };
      else {
        if (x0 < dirty.x0) dirty.x0 = x0;
        if (y0 < dirty.y0) dirty.y0 = y0;
        if (x1 > dirty.x1) dirty.x1 = x1;
        if (y1 > dirty.y1) dirty.y1 = y1;
      }
    };
    /** 브러시 한 획마다 전체를 다시 그리지 않고, 프레임당 한 번 바뀐 사각형만 그린다. */
    const scheduleRender = () => {
      if (raf !== null) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        const d = dirty;
        dirty = null;
        if (!ctx) return;
        if (d && !st.showOrig) ctx.putImageData(working, 0, 0, d.x0, d.y0, d.x1 - d.x0 + 1, d.y1 - d.y0 + 1);
        else ctx.putImageData(st.showOrig ? original : working, 0, 0);
      });
    };

    const modeColor = () => (st.mode === 'erase' ? ERASE_COLOR : RESTORE_COLOR);

    const syncUi = () => {
      $('hint').textContent = TOOL_HINT[st.tool];
      root.querySelectorAll('[data-ref="tool"]').forEach((b) => b.classList.toggle('on', b.dataset.v === st.tool));
      $('toolNote').textContent = TOOL_NOTE[st.tool] || '';
      $('toolNote').hidden = !TOOL_NOTE[st.tool];
      $('selSec').hidden = !isLasso();
      root.querySelectorAll('[data-ref="selArea"]').forEach((b) => b.classList.toggle('on', b.dataset.v === st.selArea));
      $('erase').classList.toggle('on', st.mode === 'erase');
      $('restore').classList.toggle('on', st.mode === 'restore');
      $('actionNote').textContent = st.mode === 'erase' ? 'Remove remaining background' : 'Restore missing subject from original';
      $('sizeSec').hidden = st.tool !== 'brush';
      $('sizeOut').textContent = st.brushSize;
      $('size').value = st.brushSize;
      $('zoomOut').textContent = st.zoom.toFixed(1);
      $('zoom').value = st.zoom;
      $('zoomMinus').disabled = st.zoom <= 0.5;
      $('zoomPlus').disabled = st.zoom >= 5;
      $('undo').disabled = undoStack.length === 0;
      $('done').disabled = st.loading || st.processing;
      if (!stageEl) return;
      const zw = Math.round(dispW * st.zoom), zh = Math.round(dispH * st.zoom);
      stageEl.style.width = canvas.style.width = `${zw}px`;
      stageEl.style.height = canvas.style.height = `${zh}px`;
      canvas.style.opacity = st.processing ? 0.75 : 1;
      // 올가미는 정확한 점을 찍어야 하므로 시스템 십자 커서를 쓴다
      cursorEl.hidden = st.showOrig || isLasso();
      stageEl.style.cursor = isLasso() ? 'crosshair' : 'none';
      const r = !isSmart() && nw > 0 ? st.brushSize * (dispW / nw) * st.zoom : 0;
      Object.assign(ringEl.style, { left: `${-r}px`, top: `${-r}px`, width: `${r * 2}px`, height: `${r * 2}px`, borderColor: modeColor() });
      ringEl.hidden = isSmart();
      cursorEl.querySelector('.pi-arrow').hidden = !isSmart();
      const glyph = cursorEl.querySelector('.pi-glyph');
      glyph.style.color = glyph.style.borderColor = modeColor();
      glyph.textContent = st.mode === 'erase' ? '−' : '+';
      // AI 모드는 누른 한 점이 기준이므로 글리프를 기준점에서 비켜 둔다
      glyph.style.left = isSmart() ? '16px' : '2px';
      glyph.style.top = isSmart() ? '18px' : '2px';
      cursorEl.querySelector('.pi-dot').style.background = modeColor();
      cursorEl.querySelector('.pi-dot').hidden = !isSmart();
      renderSel();
      stageEl.querySelector('.pi-orig-badge').hidden = !st.showOrig;
      stageEl.querySelector('.pi-proc-badge').hidden = !st.processing;
    };

    // ── 수동 브러시 ──────────────────────────────────────────────────────────
    const applyBrushAt = (cx, cy) => {
      const px = working.data, ox = original.data;
      const r = st.brushSize;
      const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(nw - 1, Math.ceil(cx + r));
      const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(nh - 1, Math.ceil(cy + r));
      const r2 = r * r;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const dx = x - cx, dy = y - cy;
          const d2 = dx * dx + dy * dy;
          if (d2 > r2) continue;
          const strength = (1 - (Math.sqrt(d2) / r) ** 1.5) * 0.88;
          const i = (y * nw + x) * 4;
          if (st.mode === 'erase') {
            px[i + 3] = Math.round(px[i + 3] * (1 - strength));
          } else {
            px[i] = Math.round(px[i] + (ox[i] - px[i]) * strength);
            px[i + 1] = Math.round(px[i + 1] + (ox[i + 1] - px[i + 1]) * strength);
            px[i + 2] = Math.round(px[i + 2] + (ox[i + 2] - px[i + 2]) * strength);
            px[i + 3] = Math.round(px[i + 3] + (ox[i + 3] - px[i + 3]) * strength);
          }
        }
      }
      markDirty(x0, y0, x1, y1);
      scheduleRender();
    };
    const paintLine = (x0, y0, x1, y1) => {
      const dist = Math.hypot(x1 - x0, y1 - y0);
      const steps = Math.max(1, Math.ceil(dist / Math.max(1, st.brushSize * 0.2)));
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        applyBrushAt(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
      }
    };

    // ── AI 브러시 (색 유사 영역 플러드필) ──────────────────────────────────────
    /**
     * 누른 점에서 시작해 **원본 이미지** 기준으로 비슷한 색이 이어진 영역을 채운다.
     * 이미 일부 지운 작업본이 아니라 원본 색으로 경계를 잡아야 결과가 흔들리지 않는다.
     */
    const floodFillAt = (seedX, seedY) => {
      const px = working.data, ox = original.data;
      const sx = Math.max(0, Math.min(nw - 1, Math.round(seedX)));
      const sy = Math.max(0, Math.min(nh - 1, Math.round(seedY)));
      const si = (sy * nw + sx) * 4;
      const sr = ox[si], sg = ox[si + 1], sb = ox[si + 2];
      const tDist = (TOLERANCE / 100) * 340;
      const tSq = tDist * tDist;
      const visited = new Uint8Array(nw * nh);
      const stack = [sy * nw + sx];
      visited[sy * nw + sx] = 1;
      let count = 0;
      while (stack.length > 0 && count < MAX_FF_PX) {
        const pos = stack.pop();
        const x = pos % nw;
        const y = (pos - x) / nw;
        const i = pos * 4;
        if (st.mode === 'erase') px[i + 3] = 0;
        else { px[i] = ox[i]; px[i + 1] = ox[i + 1]; px[i + 2] = ox[i + 2]; px[i + 3] = ox[i + 3]; }
        count++;
        const nb = [x < nw - 1 ? pos + 1 : -1, x > 0 ? pos - 1 : -1, y < nh - 1 ? pos + nw : -1, y > 0 ? pos - nw : -1];
        for (const np of nb) {
          if (np < 0 || visited[np]) continue;
          visited[np] = 1;
          const ni = np * 4;
          const dr = ox[ni] - sr, dg = ox[ni + 1] - sg, db = ox[ni + 2] - sb;
          if (dr * dr + dg * dg + db * db <= tSq) stack.push(np);
        }
      }
      renderCanvas();
      return count;
    };
    const smartFill = (pos) => {
      st.processing = true;
      syncUi();
      // 처리 중 표시가 먼저 그려지도록 다음 틱에 돌린다
      setTimeout(() => {
        const n = floodFillAt(pos.x, pos.y);
        st.processing = false;
        badgeEl.textContent = `${n.toLocaleString()} px ${st.mode === 'erase' ? 'removed' : 'restored'}`;
        badgeEl.hidden = n === 0;
        syncUi();
      }, 0);
    };

    // ── 실행 취소 ────────────────────────────────────────────────────────────
    const saveUndo = () => {
      undoStack = [...undoStack.slice(-(MAX_UNDO - 1)), new ImageData(new Uint8ClampedArray(working.data), nw, nh)];
    };
    $('undo').addEventListener('click', () => {
      if (!undoStack.length) return;
      working = undoStack.pop();
      renderCanvas();
      syncUi();
    });

    // ── 좌표 ─────────────────────────────────────────────────────────────────
    const coords = (e) => {
      const rect = canvas.getBoundingClientRect();
      return {
        native: { x: ((e.clientX - rect.left) / rect.width) * nw, y: ((e.clientY - rect.top) / rect.height) * nh },
        display: { x: e.clientX - rect.left, y: e.clientY - rect.top },
      };
    };

    // ── 포인터 (마우스·터치 공용) ────────────────────────────────────────────
    const onDown = (e) => {
      e.preventDefault();
      if (st.showOrig || st.processing) return;
      if (isLasso()) return lassoDown(e);
      canvas.setPointerCapture(e.pointerId);
      saveUndo();
      syncUi();
      painting = true;
      const { native, display } = coords(e);
      if (isSmart()) { lastSmartDisp = display; smartFill(native); }
      else { lastNative = native; applyBrushAt(native.x, native.y); }
    };
    const onMove = (e) => {
      const { native, display } = coords(e);
      if (isLasso()) return lassoMove(native, display);
      cursorEl.style.transform = `translate3d(${display.x}px, ${display.y}px, 0)`;
      cursorEl.style.opacity = '1';
      if (!painting || st.showOrig || st.processing) return;
      if (isSmart()) {
        const last = lastSmartDisp;
        if (last && (display.x - last.x) ** 2 + (display.y - last.y) ** 2 >= SMART_DRAG_STEP ** 2) {
          lastSmartDisp = display;
          smartFill(native);
        }
      } else {
        if (lastNative) paintLine(lastNative.x, lastNative.y, native.x, native.y);
        lastNative = native;
      }
    };
    const stop = () => {
      // 자유 올가미는 손을 떼는 순간 닫힌다
      if (st.tool === 'lasso' && sel && painting) {
        if (sel.pts.length >= 3) applySelection();
        else { sel = null; renderSel(); }
      }
      painting = false; lastNative = null; lastSmartDisp = null;
    };

    // ── 올가미 ───────────────────────────────────────────────────────────────
    /** 원본 좌표 두 점의 화면상 거리 */
    const dispDist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) * (canvas.getBoundingClientRect().width / nw);

    const lassoDown = (e) => {
      const { native } = coords(e);
      if (st.tool === 'lasso') {
        canvas.setPointerCapture(e.pointerId);
        painting = true;
        sel = { pts: [native] };
      } else if (!sel) {
        sel = { pts: [native] };
      } else if (sel.pts.length >= 3 && dispDist(native, sel.pts[0]) < CLOSE_PX) {
        applySelection();   // 시작점을 다시 누르면 닫힌다
        return;
      } else if (dispDist(native, sel.pts[sel.pts.length - 1]) > 2) {
        sel.pts.push(native); // 더블클릭의 두 번째 클릭이 같은 점을 또 찍지 않게
      }
      renderSel();
    };

    const lassoMove = (native, display) => {
      if (!sel) return;
      if (st.tool === 'lasso') {
        if (painting && dispDist(native, sel.pts[sel.pts.length - 1]) > 2) sel.pts.push(native);
      } else {
        hover = native;
      }
      renderSel();
    };

    /** 진행 중인 올가미 선을 그린다. 닫히기 전이라도 채움을 옅게 보여줘 범위를 가늠하게 한다. */
    function renderSel() {
      if (!selSvg) return;
      const pts = sel ? (st.tool === 'poly' && hover ? [...sel.pts, hover] : sel.pts) : [];
      const d = pts.length ? 'M' + pts.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L') + ' Z' : '';
      selSvg.querySelectorAll('path').forEach((p) => p.setAttribute('d', d));
      const start = selSvg.querySelector('circle');
      const showStart = sel && st.tool === 'poly' && sel.pts.length >= 3;
      start.style.display = showStart ? '' : 'none';
      if (showStart) {
        const k = nw / canvas.getBoundingClientRect().width; // 화면 1px = 원본 k px
        start.setAttribute('cx', sel.pts[0].x);
        start.setAttribute('cy', sel.pts[0].y);
        start.setAttribute('r', CLOSE_PX * k * 0.6);
        start.classList.toggle('hot', !!hover && dispDist(hover, sel.pts[0]) < CLOSE_PX);
      }
    }

    /** 닫힌 올가미 안(또는 밖)에 Action 을 한 번에 적용한다. */
    function applySelection() {
      if (!sel || sel.pts.length < 3) return;
      saveUndo();
      const m = document.createElement('canvas');
      m.width = nw; m.height = nh;
      const mctx = m.getContext('2d', { willReadFrequently: true });
      mctx.beginPath();
      sel.pts.forEach((p, i) => (i ? mctx.lineTo(p.x, p.y) : mctx.moveTo(p.x, p.y)));
      mctx.closePath();
      mctx.fill();
      const ma = mctx.getImageData(0, 0, nw, nh).data;
      const px = working.data, ox = original.data;
      const inside = st.selArea === 'inside';
      for (let i = 0; i < nw * nh; i++) {
        // 경계의 안티에일리어싱 값을 그대로 써서 가장자리가 계단지지 않게 한다
        let a = ma[i * 4 + 3] / 255;
        if (!inside) a = 1 - a;
        if (a <= 0) continue;
        const p = i * 4;
        if (st.mode === 'erase') {
          px[p + 3] = Math.round(px[p + 3] * (1 - a));
        } else {
          for (let k = 0; k < 4; k++) px[p + k] = Math.round(px[p + k] + (ox[p + k] - px[p + k]) * a);
        }
      }
      sel = null;
      hover = null;
      renderCanvas();
      syncUi();
    }

    // ── 컨트롤 ───────────────────────────────────────────────────────────────
    root.querySelectorAll('[data-ref="tool"]').forEach((b) => b.addEventListener('click', () => {
      st.tool = b.dataset.v;
      sel = null; hover = null;   // 도구를 바꾸면 그리던 올가미는 버린다
      syncUi();
    }));
    root.querySelectorAll('[data-ref="selArea"]').forEach((b) => b.addEventListener('click', () => { st.selArea = b.dataset.v; syncUi(); }));
    $('erase').addEventListener('click', () => { st.mode = 'erase'; syncUi(); });
    $('restore').addEventListener('click', () => { st.mode = 'restore'; syncUi(); });
    $('size').addEventListener('input', (e) => { st.brushSize = Number(e.target.value); syncUi(); });
    $('zoom').addEventListener('input', (e) => { st.zoom = Number(e.target.value); syncUi(); });
    $('zoomMinus').addEventListener('click', () => { st.zoom = Math.max(0.5, +(st.zoom - 0.5).toFixed(1)); syncUi(); });
    $('zoomPlus').addEventListener('click', () => { st.zoom = Math.min(5, +(st.zoom + 0.5).toFixed(1)); syncUi(); });
    const setOrig = (v) => { if (st.showOrig === v) return; st.showOrig = v; renderCanvas(); syncUi(); };
    $('compare').addEventListener('pointerdown', () => setOrig(true));
    $('compare').addEventListener('pointerup', () => setOrig(false));
    $('compare').addEventListener('pointerleave', () => setOrig(false));

    document.body.append(root);
    syncUi();

    // ── 두 이미지 불러오기 ───────────────────────────────────────────────────
    Promise.all([loadImg(originalUrl), loadImg(processedUrl)]).then(([orig, proc]) => {
      if (!root.isConnected) return;
      const ds = Math.min(1, MAX_NATIVE / Math.max(proc.naturalWidth, proc.naturalHeight));
      nw = Math.round(proc.naturalWidth * ds);
      nh = Math.round(proc.naturalHeight * ds);
      const tmp = document.createElement('canvas');
      tmp.width = nw; tmp.height = nh;
      const tctx = tmp.getContext('2d', { willReadFrequently: true });
      tctx.drawImage(proc, 0, 0, nw, nh);
      working = tctx.getImageData(0, 0, nw, nh);
      tctx.clearRect(0, 0, nw, nh);
      tctx.drawImage(orig, 0, 0, nw, nh);
      original = tctx.getImageData(0, 0, nw, nh);

      dispW = MAX_DISP_W;
      dispH = Math.round(MAX_DISP_W * nh / nw);
      if (dispH > MAX_DISP_H) { dispH = MAX_DISP_H; dispW = Math.round(MAX_DISP_H * nw / nh); }

      $('wrap').innerHTML = `
        <div class="pi-brush-stage">
          <canvas></canvas>
          <div class="pi-cursor" style="opacity:0">
            <div class="pi-ring"></div>
            <svg class="pi-arrow" width="16" height="18" viewBox="0 0 16 18" style="overflow:visible">
              <path d="M0 0 L0 14 L3.6 10.6 L6.2 16.4 L8.8 15.2 L6.2 9.6 L11 9.4 Z" fill="#fff" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
            </svg>
            <div class="pi-dot"></div>
            <div class="pi-glyph"></div>
          </div>
          <svg class="pi-sel" viewBox="0 0 ${nw} ${nh}" preserveAspectRatio="none">
            <path class="pi-sel-fill" /><path class="pi-sel-white" /><path class="pi-sel-ants" />
            <circle class="pi-sel-start" style="display:none" />
          </svg>
          <div class="pi-orig-badge"><span>Original Preview</span></div>
          <div class="pi-proc-badge"><span>Analyzing area…</span></div>
        </div>
        <div class="pi-fill-badge" hidden></div>`;
      stageEl = $('wrap').querySelector('.pi-brush-stage');
      canvas = stageEl.querySelector('canvas');
      cursorEl = stageEl.querySelector('.pi-cursor');
      ringEl = stageEl.querySelector('.pi-ring');
      selSvg = stageEl.querySelector('.pi-sel');
      badgeEl = $('wrap').querySelector('.pi-fill-badge');
      canvas.width = nw;
      canvas.height = nh;
      ctx = canvas.getContext('2d');
      canvas.addEventListener('pointerdown', onDown);
      canvas.addEventListener('pointermove', onMove);
      canvas.addEventListener('pointerup', stop);
      canvas.addEventListener('pointerleave', () => {
        // 다각형 올가미는 캔버스 밖으로 나가도 이어서 찍을 수 있어야 한다
        if (st.tool !== 'poly') stop();
        hover = null;
        renderSel();
        cursorEl.style.opacity = '0';
      });
      canvas.addEventListener('dblclick', () => { if (st.tool === 'poly' && sel) applySelection(); });

      st.loading = false;
      renderCanvas();
      syncUi();
    }).catch((err) => {
      console.error('BrushMaskEditor load:', err);
      $('wrap').innerHTML = '<div class="pi-loading">Failed to load image.</div>';
    });
  });
}
