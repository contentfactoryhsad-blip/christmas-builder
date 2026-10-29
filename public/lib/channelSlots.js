/**
 * 매체별 배너 사이즈 — 데이터는 lib/channelSlotData.js (Figma 에서 뽑은 값).
 * Main Theme 과 Product Type 이 각자 보드를 쓴다 (board: 'main' | 'product').
 *
 *   art   : [x, y, 한 변] — 빌더의 3000² 완성 컷을 그대로 이 자리에 놓는다
 *   fades : KV 를 바탕으로 녹이는 그라데이션 — box 안을 p0 → p1 방향으로 stops 대로 칠한다.
 *           text 표시가 붙은 건 Product Type 라이트의 텍스트 그라데이션 — 다크에서는 안 그린다
 *   rows  : Eyebrow·Headline·Subcopy — Figma 자리에서 시작해 위 줄이 늘면 그만큼 아래로 민다
 *   cta   : stack 이면 마지막 보이는 카피 아래 Figma 와 같은 간격 (줄을 끄면 당겨 붙는다), 아니면 b 자리 고정 (가로 띠)
 *   disc  : Disclaimer — 왼쪽 x, 바닥에서 bottom 위, 폭 w. 흰 빛 + 검은 그림자 두 겹 (Figma 효과 그대로, Dark 글자 모드는 반대)
 * 줄 높이는 Figma 와 같이 글자 크기의 106%, CTA 는 100%.
 */
import { SLOT_DATA } from './channelSlotData.js';

// 다크 톤 — 라이트 KV 의 베이지(#9c9185 등)로 칠한 바탕·그라데이션을 다크 KV 의 같은 자리 색으로 바꾼다
// (#182a24 — 라이트 KV 에서 그 색인 자리들을 다크 KV 에서 읽은 평균, 자리마다 차이 ±3 안쪽). 검정은 그대로
const DARK = '#182a24';
const toneColor = (hex, tone) => (tone === 'dark' && hex !== '#000000' ? DARK : hex);

/** 매체 key → 사이즈 목록. 'all' 은 모든 매체를 이어 붙인다. 아직 없는 매체는 빈 배열 */
export function slotsForChannel(key, board = 'main') {
  const set = SLOT_DATA[board] || {};
  return key === 'all' ? Object.values(set).flat() : set[key] || [];
}

const HEAD = '"LGEI Headline", sans-serif';
const TEXT = '"LGEI Text", sans-serif';
const PLACEHOLDER = {
  eyebrow: 'Lorem ipsum dolor sit amet, consectetur',
  headline: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit',
  subcopy: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit sed do eiusmod',
  cta: 'Shop now',
  disclaimer: '*T&C’s apply',
  disclaimerMedia: '*T&C’s apply',
};
const LOGOS = { white: 'assets/christmas/logo/lg-logo-white.svg', og: 'assets/christmas/logo/lg-logo-og.svg', ogwhite: 'assets/christmas/logo/lg-logo-ogwhite.svg' };

/** 글 상자 폭에 맞춰 줄을 나눈다 — 줄바꿈(Enter)은 그대로, 넘치면 단어 단위로. maxLines 를 넘으면 마지막 줄 끝을 … 로 */
function wrap(ctx, text, maxW, maxLines = Infinity) {
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(next).width > maxW) { out.push(line); line = word; } else line = next;
    }
    out.push(line);
  }
  if (out.length <= maxLines) return out;
  const kept = out.slice(0, maxLines);
  let last = `${kept[maxLines - 1]} ${out[maxLines]}`;
  while (last && ctx.measureText(`${last}…`).width > maxW) last = last.slice(0, -1).trimEnd();
  kept[maxLines - 1] = `${last}…`;
  return kept;
}

const logoCache = new Map();
function logoImage(id) {
  const src = LOGOS[id] || LOGOS.white;
  if (!logoCache.has(src)) {
    const img = new Image();
    img.src = src;
    logoCache.set(src, img);
  }
  return logoCache.get(src);
}
/** 로고 SVG 가 아직 안 읽혔으면 읽힌 뒤 한 번 더 그리게 */
export const logosReady = () => Promise.all(Object.keys(LOGOS).map(id => {
  const img = logoImage(id);
  return img.complete ? null : new Promise(r => { img.onload = img.onerror = r; });
}));

/**
 * 사이즈 하나를 ctx 에 slot.w × slot.h 좌표로 그린다 (미리보기는 바깥에서 ctx 를 줄여 둔다).
 * art: 3000² 완성 컷 캔버스(또는 이미지), cs: lib/channelCopy.js 의 Copy 상태, tone: 'light' | 'dark'
 */
/**
 * opts.imageOnly: LG.com 다운로드용 — 카피·CTA 없이 (이미지 업로드 가이드: 아이콘·디스클레이머만 남긴다)
 */
export function drawSlot(ctx, slot, art, cs, tone = 'light', opts = {}) {
  const { w: W, h: H } = slot;
  const show = cs.show;
  const val = k => (cs.copy[k] ?? '').trim() || PLACEHOLDER[k];
  // 글자 모드 — Light 는 흰 글자, Dark 는 검은 글자 (카피·동그란 CTA·Disclaimer)
  const ink = cs.textMode === 'dark' ? '#000' : '#fff';
  ctx.save();
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = toneColor(slot.bg || '#000000', tone);
  ctx.fillRect(0, 0, W, H);
  if (art && slot.art) {
    const [ax, ay, as] = slot.art;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(art, ax, ay, as, as);
  }
  for (const f of slot.fades || []) {
    if (f.text && tone === 'dark') continue;
    const alpha = (hex, a) => `${hex}${Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0')}`;
    if (f.stops.length === 1) ctx.fillStyle = alpha(toneColor(f.stops[0][1], tone), f.stops[0][2]);
    else {
      const g = ctx.createLinearGradient(f.p0[0], f.p0[1], f.p1[0], f.p1[1]);
      f.stops.forEach(([pos, hex, a]) => g.addColorStop(pos, alpha(toneColor(hex, tone), a)));
      ctx.fillStyle = g;
    }
    ctx.fillRect(...f.box);
  }

  // 로고 — 고른 게 없으면 템플릿 기본(White)
  if (slot.logo && show.logo) {
    const [lx, ly, lw, lh] = slot.logo;
    const img = logoImage(cs.logoId || 'white');
    if (img.complete && img.naturalWidth) ctx.drawImage(img, lx, ly, lw, lh);
  }

  // 카피 — Figma 자리에서 시작해 위에서부터 쌓는다. 줄 수가 달라지면 아래 줄을 그만큼 민다
  // 높이가 낮은 띠 배너(120 이하)는 Figma 줄 수를 넘으면 말줄임
  const rows = opts.imageOnly ? [] : slot.rows || [];
  const FACE = { eyebrow: [TEXT, 400], headline: [HEAD, 600], subcopy: [TEXT, 400] };
  const on = { eyebrow: show.eyebrow, headline: true, subcopy: show.subcopy };
  ctx.fillStyle = ink;
  ctx.textBaseline = 'top';
  let shift = 0, lastEnd = null, lastFigmaEnd = null;
  rows.forEach(r => {
    if (!on[r.k]) return;
    const [face, weight] = FACE[r.k];
    ctx.font = `${weight} ${r.sz}px ${face}`;
    ctx.textAlign = r.al === 'C' ? 'center' : r.al === 'R' ? 'right' : 'left';
    const tx = r.al === 'C' ? r.x + r.w / 2 : r.al === 'R' ? r.x + r.w : r.x;
    const lh = r.sz * 1.06;
    // 낮은 띠 배너(120 이하)와 줄 수를 고정한 칸(clamp)은 Figma 줄 수를 넘으면 말줄임 — CTA 가 밀리지 않게
    const lines = wrap(ctx, val(r.k), r.w, H <= 120 || r.clamp ? r.lines : Infinity);
    // 앞 줄이 숨겨졌으면 그 자리만큼 당긴다 — 첫 줄은 Figma 의 첫 줄 자리에서
    const y = lastEnd == null ? rows[0].y : lastEnd + (r.y - lastFigmaEnd);
    lines.forEach((l, n) => ctx.fillText(l, tx, y + n * lh + (lh - r.sz) / 2));
    lastEnd = y + lines.length * lh;
    lastFigmaEnd = r.y + r.h;
    shift = lastEnd - lastFigmaEnd;
  });
  // 세로로 쌓는 CTA 는 마지막 보이는 줄 아래에 Figma 의 (마지막 줄 → CTA) 간격으로 — 줄을 꺼도 오토레이아웃처럼 당겨 붙는다
  const lastRow = rows[rows.length - 1];
  const ctaY = fy => (lastEnd != null && lastRow ? lastEnd + (fy - (lastRow.y + lastRow.h)) : fy + shift);

  // CTA — 세로 배치는 카피 아래 Figma 간격, 가로 띠는 고정 자리
  if (!opts.imageOnly && slot.cta && show.cta && slot.cta.round) {
    // LG.com 일부 사이즈 — 글자 없는 동그란 화살표 버튼 (흰 테두리)
    const [fx, fy, , fh] = slot.cta.b;
    const by = slot.cta.stack ? ctaY(fy) : fy;
    const r = fh / 2, cx = fx + r, cy = by + r;
    ctx.strokeStyle = ink;
    ctx.lineWidth = Math.max(1, fh * 0.03);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.arc(cx, cy, r - ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.stroke();
    const a = fh * 0.16;
    ctx.beginPath();
    ctx.moveTo(cx - a, cy); ctx.lineTo(cx + a, cy);
    ctx.moveTo(cx + a * 0.35, cy - a * 0.65); ctx.lineTo(cx + a, cy); ctx.lineTo(cx + a * 0.35, cy + a * 0.65);
    ctx.stroke();
  } else if (!opts.imageOnly && slot.cta && show.cta) {
    const b = slot.cta;
    const [fx, fy, fw, fh] = b.b;
    ctx.font = `400 ${b.sz}px ${TEXT}`;
    const bw = ctx.measureText(val('cta')).width + b.pad * 2;
    const head = rows.find(r => r.k === 'headline') || rows[0];
    const centered = b.stack && head?.al === 'C';
    const bx = centered ? fx + fw / 2 - bw / 2 : fx;
    const by = b.stack ? ctaY(fy) : fy;
    ctx.fillStyle = '#FD312E';
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, fh, b.rad);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(val('cta'), bx + bw / 2, by + fh / 2 + b.sz * 0.04);
  }

  // Disclaimer — 바닥 기준, 흰 빛과 검은 그림자 두 겹
  if (slot.disc && show.disclaimer) {
    const d = slot.disc;
    ctx.font = `400 ${d.sz}px ${TEXT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    // LG.com 사이즈는 Copy 패널의 LG.com 칸, 나머지 매체는 Media 칸
    const lines = wrap(ctx, val(slot.label === 'LG.com' ? 'disclaimer' : 'disclaimerMedia'), d.w);
    const lh = d.sz * 1.2;
    const draw = () => lines.forEach((l, n) => ctx.fillText(l, d.x, H - d.bottom - (lines.length - 1 - n) * lh));
    // 그림자 흐림은 변환을 안 따라가서 줄여 그리는 배율만큼 곱한다
    const k = Math.hypot(ctx.getTransform().a, ctx.getTransform().b);
    // 흰 글자는 흰 빛 + 검은 그림자, 검은 글자는 반대로
    const dark = cs.textMode === 'dark';
    ctx.fillStyle = ink;
    ctx.shadowColor = dark ? 'rgba(0,0,0,1)' : 'rgba(255,255,255,1)';
    ctx.shadowBlur = d.sz * 1.5 * k;
    draw();
    ctx.shadowColor = dark ? 'rgba(255,255,255,1)' : 'rgba(0,0,0,1)';
    ctx.shadowBlur = d.sz * 0.5 * k;
    draw();
  }
  ctx.restore();
}
