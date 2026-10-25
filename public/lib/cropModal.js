// 자유 비율 크롭 모달. 프레임을 끌어 옮기고 모서리·변 핸들로 크기를 바꾼다.
// 원래 빌더는 박스 비율이 고정이라 react-easy-crop 을 썼지만, 여기서는 제품이
// 영역 안에 contain 으로 맞춰지므로 비율을 묶을 이유가 없다.
//
//   const out = await openCropModal({ imageSrc, initialRect });
//   → { dataUrl, rect } (rect 는 원본 픽셀 기준, 재편집 때 복원용), 취소하면 null

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const MIN_SIZE = 8; // 원본 픽셀
const VIEW_W = 620, VIEW_H = 420;

function loadImg(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
}

export function openCropModal({ imageSrc, initialRect }) {
  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.className = 'pi-backdrop dark';
    root.innerHTML = `
      <div class="pi-modal pi-crop" role="dialog" aria-modal="true">
        <div class="pi-head">
          <div><strong>Crop Image</strong> <span class="pi-sub">Drag the frame or its handles</span></div>
          <button type="button" class="pi-x" data-ref="close" aria-label="Close">×</button>
        </div>
        <div class="pi-crop-view" data-ref="view"><div class="pi-loading">Loading image…</div></div>
        <div class="pi-foot">
          <div class="pi-row">
            <button type="button" class="pi-btn ghost" data-ref="reset">Reset</button>
            <span class="pi-sub" data-ref="size"></span>
          </div>
          <div class="pi-row">
            <button type="button" class="pi-btn ghost" data-ref="cancel">Cancel</button>
            <button type="button" class="pi-btn primary" data-ref="apply" disabled>Apply Crop</button>
          </div>
        </div>
      </div>`;
    const $ = (r) => root.querySelector(`[data-ref="${r}"]`);
    let img, scale = 1, rect, frame;

    const finish = (v) => {
      document.removeEventListener('keydown', onKey);
      root.remove();
      resolve(v);
    };
    const onKey = (e) => { if (e.key === 'Escape') finish(null); };
    document.addEventListener('keydown', onKey);
    root.addEventListener('mousedown', (e) => { if (e.target === root) finish(null); });
    $('close').addEventListener('click', () => finish(null));
    $('cancel').addEventListener('click', () => finish(null));

    const draw = () => {
      Object.assign(frame.style, {
        left: `${rect.x * scale}px`, top: `${rect.y * scale}px`,
        width: `${rect.w * scale}px`, height: `${rect.h * scale}px`,
      });
      $('size').textContent = `${Math.round(rect.w)} × ${Math.round(rect.h)}px`;
    };

    $('reset').addEventListener('click', () => {
      if (!img) return;
      rect = { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight };
      draw();
    });

    $('apply').addEventListener('click', () => {
      const r = { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.w), h: Math.round(rect.h) };
      const c = document.createElement('canvas');
      c.width = r.w; c.height = r.h;
      c.getContext('2d').drawImage(img, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
      finish({ dataUrl: c.toDataURL('image/png'), rect: r });
    });

    document.body.append(root);

    loadImg(imageSrc).then((loaded) => {
      if (!root.isConnected) return;
      img = loaded;
      const W = img.naturalWidth, H = img.naturalHeight;
      scale = Math.min(VIEW_W / W, VIEW_H / H, 1);
      rect = initialRect ? { ...initialRect } : { x: 0, y: 0, w: W, h: H };

      const stage = document.createElement('div');
      stage.className = 'pi-crop-stage';
      stage.style.width = `${W * scale}px`;
      stage.style.height = `${H * scale}px`;
      const shown = document.createElement('img');
      shown.src = imageSrc;
      shown.draggable = false;
      frame = document.createElement('div');
      frame.className = 'pi-crop-frame';
      frame.innerHTML = HANDLES.map((h) => `<span class="pi-h ${h}" data-h="${h}"></span>`).join('');
      stage.append(shown, frame);
      $('view').replaceChildren(stage);
      $('apply').disabled = false;
      draw();

      // 프레임 몸통 = 이동, 핸들 = 해당 변만 움직인다.
      let drag = null;
      frame.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        frame.setPointerCapture(e.pointerId);
        drag = { h: e.target.dataset.h || 'move', sx: e.clientX, sy: e.clientY, r0: { ...rect } };
      });
      frame.addEventListener('pointermove', (e) => {
        if (!drag) return;
        const dx = (e.clientX - drag.sx) / scale;
        const dy = (e.clientY - drag.sy) / scale;
        const r0 = drag.r0;
        let x0 = r0.x, y0 = r0.y, x1 = r0.x + r0.w, y1 = r0.y + r0.h;
        if (drag.h === 'move') {
          const nx = Math.max(0, Math.min(W - r0.w, r0.x + dx));
          const ny = Math.max(0, Math.min(H - r0.h, r0.y + dy));
          rect = { x: nx, y: ny, w: r0.w, h: r0.h };
        } else {
          if (drag.h.includes('w')) x0 = Math.max(0, Math.min(x1 - MIN_SIZE, x0 + dx));
          if (drag.h.includes('e')) x1 = Math.min(W, Math.max(x0 + MIN_SIZE, x1 + dx));
          if (drag.h.includes('n')) y0 = Math.max(0, Math.min(y1 - MIN_SIZE, y0 + dy));
          if (drag.h.includes('s')) y1 = Math.min(H, Math.max(y0 + MIN_SIZE, y1 + dy));
          rect = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
        }
        draw();
      });
      frame.addEventListener('pointerup', () => { drag = null; });
    }).catch(() => {
      $('view').innerHTML = '<div class="pi-loading">Failed to load image.</div>';
    });
  });
}
