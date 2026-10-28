/**
 * 매체(Channel)를 고르면 Edit panel 이 이 Copy 패널로 바뀐다 — BF 빌더 Content Builder 의 SlotCopyEditor 를 옮겼다
 * (08 black friday/lg-bf-builder …/contenttemplate/SlotCopyEditor.tsx). KV Tagline 은 뺐다.
 *
 * 한 벌의 카피가 그 매체의 모든 사이즈에 들어간다. 매체별 사이즈가 아직 없어서 지금은 값만 들고 있다.
 * 매체에 따라 칸이 달라진다 (BF 와 같은 규칙):
 *   Disclaimer — LG.com 칸은 LG.com·ALL 에서, Media 칸은 LG.com 이 아닐 때 쓴다
 *   Indicator · Icons — LG.com·ALL 만 (히어로 사이즈 1920×720 · 720×960 에만 있다)
 *   Logo — LG.com 이 아닐 때 (LG.com 사이즈에는 LG 로고가 없다)
 */
import { ICON_LIST, iconSvg, splitLabel } from './icons.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Figma 자리 표시 문구 — 칸이 비어 있으면 이 글이 보인다 */
export const COPY_PLACEHOLDER = {
  eyebrow: 'Lorem ipsumdolor sit amet',
  headline: 'Lorem ipsum dolor sit ametap consectetur',
  subcopy: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
  cta: 'Shop now',
  disclaimer: '*T&C’s apply',
  disclaimerMedia: '*T&C’s apply',
};

const FIELDS = [
  { key: 'eyebrow', label: 'Eyebrow', hint: 'Optional', toggle: 'eyebrow' },
  { key: 'headline', label: 'Headline', hint: 'Required', rows: 2 },
  { key: 'subcopy', label: 'Subcopy', hint: 'Optional', rows: 2, toggle: 'subcopy' },
  // 버튼이 글자 폭을 따라가서 길이만 막는다
  { key: 'cta', label: 'CTA button', maxLength: 15, toggle: 'cta' },
];

/** LG 로고 — Sales Banner Builder 와 같은 세 벌. 아무것도 안 고르면 템플릿 기본(White) */
const LOGO_VARIANTS = [
  { id: 'white', label: 'LG White', src: 'assets/christmas/logo/lg-logo-white.svg', thumbBg: '#1a1a1a' },
  { id: 'og', label: 'LG OG', src: 'assets/christmas/logo/lg-logo-og.svg', thumbBg: '#eeebe6' },
  { id: 'ogwhite', label: 'LG OG_White', src: 'assets/christmas/logo/lg-logo-ogwhite.svg', thumbBg: '#1a1a1a' },
];

export function newCopyState() {
  return {
    copy: { eyebrow: '', headline: '', subcopy: '', cta: '', disclaimer: '', disclaimerMedia: '' },
    show: { eyebrow: true, subcopy: true, cta: true, disclaimer: true, logo: true, indicator: true },
    logoId: null,
    // 글자 모드 — 세일즈 배너 빌더와 같다. 버튼 이름은 글자색 기준: light = 흰 글자, dark = 검은 글자
    textMode: 'light',
    icon: {
      kind: 'none', // 'none' | 'solid' | 'line' — Solid 와 Line 은 고른 아이콘을 따로 든다
      color: 'white',
      count: 3,
      ids: { solid: ['free-delivery', 'free-disposal', 'free-installation'], line: ['free-delivery', 'free-disposal', 'free-installation'] },
      labels: { solid: [null, null, null], line: [null, null, null] },
      lastKind: 'solid', // Icons 체크를 다시 켤 때 돌아갈 종류
    },
  };
}

/**
 * 아이콘 캡션은 평균 라틴 글자 11자 폭까지 — 넘으면 줄의 아이콘끼리 부딪친다.
 * 글자 수가 아니라 그려질 폭으로 잰다 (한글은 7자 남짓에서 걸린다).
 */
const LABEL_CAP = 'nnnnnnnnnnn';
const LABEL_FONT = '600 24px "LGEI Text", sans-serif';
let measureCtx = null;
function widestLinePx(text) {
  measureCtx ??= document.createElement('canvas').getContext('2d');
  measureCtx.font = LABEL_FONT;
  const lines = text.includes('\n') ? text.split('\n') : splitLabel(text.trim());
  return Math.max(...lines.map(l => (l ? measureCtx.measureText(l).width : 0)));
}
const fitsLabelCap = text => widestLinePx(text) <= widestLinePx(LABEL_CAP) + 0.5;

const flagsFor = channelKey => {
  const lgcom = channelKey === 'lg-com';
  const all = channelKey === 'all';
  return {
    lgcomActive: lgcom || all,
    mediaActive: !lgcom,
    logo: !lgcom,
    indicator: lgcom || all,
    icons: lgcom || all,
  };
};

const iconStyle = cs => `${cs.icon.kind === 'none' ? 'solid' : cs.icon.kind}-${cs.icon.color}`;

/** 아이콘 미리보기 칸 — Line·White 는 흰 선이라 회색 바탕에 */
const iconPreview = (id, style) => `
  <span class="cc-icon-prev${style === 'line-white' ? ' dim' : ''}">${id ? iconSvg(id, style, 30) : ''}</span>`;

export function renderCopyPanel(cs, channel) {
  const f = flagsFor(channel.key);
  const touched = Object.values(cs.copy).some(v => (v ?? '').trim() !== '');
  const check = (name, on) => `<input type="checkbox" class="cc-check" data-cc-show="${name}"${on ? ' checked' : ''} />`;
  const style = iconStyle(cs);
  const kind = cs.icon.kind === 'line' ? 'line' : 'solid';

  return `
  <div class="cc">
    <div>
      <p class="cc-title">Copy</p>
      <p class="cc-sub">Applies to every ${esc(channel.label)} size.</p>
    </div>

    <div class="cc-field">
      <span class="cc-label">Text mode</span>
      <div class="cc-mode">
        ${['light', 'dark'].map(m => `
          <button type="button" class="cc-mode-btn${(cs.textMode ?? 'light') === m ? ' on' : ''}" data-text-mode="${m}">
            <span class="cc-mode-dot ${m}"></span>${m === 'light' ? 'Light' : 'Dark'}
          </button>`).join('')}
      </div>
    </div>

    ${FIELDS.map(fd => {
      const off = fd.toggle ? !cs.show[fd.toggle] : false;
      const attrs = `data-copy="${fd.key}" placeholder="${esc(COPY_PLACEHOLDER[fd.key])}"${off ? ' disabled' : ''}`;
      return `
      <label class="cc-field">
        <span class="cc-label-row">
          <span class="cc-label">${fd.toggle ? check(fd.toggle, cs.show[fd.toggle]) : ''}${fd.label}</span>
          ${fd.hint ? `<span class="cc-hint">${fd.hint}</span>` : ''}
        </span>
        ${fd.rows
          ? `<textarea class="cc-input" rows="${fd.rows}" ${attrs}>${esc(cs.copy[fd.key])}</textarea>`
          : `<input type="text" class="cc-input" value="${esc(cs.copy[fd.key])}"${fd.maxLength ? ` maxlength="${fd.maxLength}"` : ''} ${attrs} />`}
      </label>`;
    }).join('')}

    <!-- 두 매체는 자리가 달라 Disclaimer 가 둘 — 체크 하나가 둘 다 끈다. 그 매체가 안 쓰는 칸은 흐리게 -->
    <div class="cc-field">
      <span class="cc-label">${check('disclaimer', cs.show.disclaimer)}Disclaimer</span>
      ${[
        { key: 'disclaimer', label: 'LG.com', hint: '', max: 0, on: f.lgcomActive },
        { key: 'disclaimerMedia', label: 'Media', hint: 'Max 24 · *T&C’s apply recommended, in your local language', max: 24, on: f.mediaActive },
      ].map(d => `
        <label class="cc-sub-field${d.on ? '' : ' off'}">
          <span class="cc-label-row"><span class="cc-small">${d.label}</span>${d.hint ? `<span class="cc-hint">${esc(d.hint)}</span>` : ''}</span>
          <input type="text" class="cc-input" data-copy="${d.key}" value="${esc(cs.copy[d.key])}" placeholder="${esc(COPY_PLACEHOLDER[d.key])}"${d.max ? ` maxlength="${d.max}"` : ''}${!cs.show.disclaimer || !d.on ? ' disabled' : ''} />
        </label>`).join('')}
    </div>

    ${f.indicator ? `
    <div class="cc-inline">
      <label class="cc-label">${check('indicator', cs.show.indicator)}Indicator</label>
      <span class="cc-hint">1920×720 · 720×960</span>
    </div>` : ''}

    ${f.logo ? `
    <div class="cc-section">
      <label class="cc-label">${check('logo', cs.show.logo)}Logo</label>
      <div class="cc-logos${cs.show.logo ? '' : ' off'}">
        ${LOGO_VARIANTS.map(v => {
          const on = (cs.logoId ?? 'white') === v.id;
          return `
          <button type="button" class="cc-logo${on ? ' on' : ''}" data-logo="${v.id}" title="${v.label}"${cs.show.logo ? '' : ' disabled'}>
            <span class="cc-logo-thumb" style="background:${v.thumbBg}"><img src="${v.src}" alt="${v.label}" draggable="false" /></span>
            <span class="cc-logo-label">${v.label}</span>
          </button>`;
        }).join('')}
      </div>
    </div>` : ''}

    ${f.icons ? `
    <div class="cc-section">
      <div class="cc-inline">
        <label class="cc-label"><input type="checkbox" class="cc-check" data-icons-on${cs.icon.kind !== 'none' ? ' checked' : ''} />Icons</label>
        <span class="cc-hint">1920×720 · 720×960</span>
      </div>
      ${cs.icon.kind !== 'none' ? `
        <div class="cc-seg">
          ${[['solid', 'Solid Icon'], ['line', 'Line Icon']].map(([k, l]) => `<button type="button" class="cc-seg-btn${cs.icon.kind === k ? ' on' : ''}" data-icon-kind="${k}">${l}</button>`).join('')}
        </div>
        <div class="cc-toggle">
          ${['black', 'white'].map(c => `<button type="button" class="${cs.icon.color === c ? 'on' : ''}" data-icon-color="${c}"><span class="cc-dot" style="background:${c === 'black' ? '#141414' : '#fff'}"></span>${c === 'black' ? 'Black' : 'White'}</button>`).join('')}
        </div>
        <div class="cc-inline">
          <span class="cc-small">Number of icons</span>
          <div class="cc-count">${[1, 2, 3].map(n => `<button type="button" class="cc-seg-btn${cs.icon.count === n ? ' on' : ''}" data-icon-count="${n}">${n}</button>`).join('')}</div>
        </div>
        <div class="cc-icons">
          ${Array.from({ length: cs.icon.count }, (_, i) => {
            const id = cs.icon.ids[kind][i];
            const label = ICON_LIST.find(x => x.id === id)?.label ?? '';
            return `
            <div class="cc-icon-slot">
              <div class="cc-combo" data-combo="${i}">
                <button type="button" class="cc-combo-btn" data-combo-open="${i}">${iconPreview(id, style)}<span class="cc-combo-label">${esc(label)}</span><span class="cc-chev">▾</span></button>
              </div>
              <textarea class="cc-input cc-icon-label" rows="2" data-icon-label="${i}" placeholder="${esc(label)}" aria-label="Icon label">${esc(cs.icon.labels[kind][i] ?? '')}</textarea>
            </div>`;
          }).join('')}
        </div>` : ''}
    </div>` : ''}

    <button type="button" class="cc-reset" data-copy-reset${touched ? '' : ' disabled'}>Reset to placeholder</button>
  </div>`;
}

/** 아이콘 고르기 목록 — 검색 + 미리보기 줄 (BF IconCombobox) */
function openCombo(root, cs, i, rerender) {
  root.querySelector('.cc-combo-pop')?.remove();
  const kind = cs.icon.kind === 'line' ? 'line' : 'solid';
  const style = iconStyle(cs);
  const pop = document.createElement('div');
  pop.className = 'cc-combo-pop';
  pop.innerHTML = `
    <div class="cc-combo-search"><input type="text" placeholder="Search icons…" /></div>
    <div class="cc-combo-list"></div>`;
  const list = pop.querySelector('.cc-combo-list');
  const fill = q => {
    const items = ICON_LIST.filter(x => !q || x.label.toLowerCase().includes(q.toLowerCase()));
    list.innerHTML = items.length
      ? items.map(x => `<button type="button" class="cc-combo-item" data-pick="${x.id}">${iconPreview(x.id, style)}<span>${esc(x.label)}</span>${cs.icon.ids[kind][i] === x.id ? '<span class="cc-tick">✓</span>' : ''}</button>`).join('')
      : '<p class="cc-combo-empty">No icon found.</p>';
  };
  fill('');
  root.querySelector(`[data-combo="${i}"]`).append(pop);
  const input = pop.querySelector('input');
  input.addEventListener('input', () => fill(input.value));
  input.focus();
  pop.addEventListener('click', e => {
    const b = e.target.closest('[data-pick]');
    if (!b) return;
    cs.icon.ids[kind][i] = b.dataset.pick;
    cs.icon.labels[kind][i] = null; // 새 아이콘은 자기 이름부터
    rerender();
  });
  const close = e => {
    if (pop.contains(e.target) || e.target.closest(`[data-combo-open="${i}"]`)) return;
    pop.remove();
    document.removeEventListener('pointerdown', close, true);
  };
  document.addEventListener('pointerdown', close, true);
}

/**
 * 패널 안 입력을 cs 에 묶는다 — 글자 입력은 패널을 다시 그리지 않고 onInput 만 (배너 미리보기를 다시 그린다),
 * 구조가 바뀌는 것은 rerender
 */
export function bindCopyPanel(root, cs, rerender, onInput = () => {}) {
  const syncReset = () => {
    const btn = root.querySelector('[data-copy-reset]');
    if (btn) btn.disabled = !Object.values(cs.copy).some(v => (v ?? '').trim() !== '');
  };
  root.addEventListener('input', e => {
    const el = e.target;
    if (el.dataset.copy) { cs.copy[el.dataset.copy] = el.value; syncReset(); onInput(); return; }
    if (el.dataset.iconLabel !== undefined) {
      const kind = cs.icon.kind === 'line' ? 'line' : 'solid';
      const i = Number(el.dataset.iconLabel);
      const v = el.value;
      // 두 줄까지, 캡 폭까지 — 넘치면 들어가던 글자를 되돌린다
      if (v.split('\n').length > 2 || (v !== '' && !fitsLabelCap(v))) { el.value = cs.icon.labels[kind][i] ?? ''; return; }
      cs.icon.labels[kind][i] = v === '' ? null : v;
      onInput();
    }
  });
  root.addEventListener('change', e => {
    const el = e.target;
    if (el.dataset.ccShow) { cs.show[el.dataset.ccShow] = el.checked; rerender(); return; }
    if (el.hasAttribute('data-icons-on')) {
      if (cs.icon.kind !== 'none') cs.icon.lastKind = cs.icon.kind;
      cs.icon.kind = el.checked ? cs.icon.lastKind : 'none';
      rerender();
    }
  });
  root.addEventListener('click', e => {
    const t = e.target.closest('button');
    if (!t || !root.contains(t)) return;
    if (t.dataset.textMode) { cs.textMode = t.dataset.textMode; rerender(); }
    else if (t.dataset.logo) {
      const on = (cs.logoId ?? 'white') === t.dataset.logo;
      cs.logoId = on || t.dataset.logo === 'white' ? null : t.dataset.logo;
      rerender();
    } else if (t.dataset.iconKind) { cs.icon.kind = t.dataset.iconKind; cs.icon.lastKind = cs.icon.kind; rerender(); }
    else if (t.dataset.iconColor) { cs.icon.color = t.dataset.iconColor; rerender(); }
    else if (t.dataset.iconCount) { cs.icon.count = Number(t.dataset.iconCount); rerender(); }
    else if (t.dataset.comboOpen !== undefined) {
      const open = root.querySelector(`[data-combo="${t.dataset.comboOpen}"] .cc-combo-pop`);
      if (open) open.remove(); else openCombo(root, cs, Number(t.dataset.comboOpen), rerender);
    } else if (t.hasAttribute('data-copy-reset')) {
      Object.keys(cs.copy).forEach(k => { cs.copy[k] = ''; });
      rerender();
    }
  });
}
