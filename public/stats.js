/**
 * 사용 통계 화면 — 블프 빌더 UsageStats.tsx 를 이 빌더(모듈 JS)로 옮긴 것. 빌더가 하나라 탭은 없다.
 * 열쇠는 서버가 검사한다(USAGE_KEY). 한 번 맞으면 브라우저에 저장해 다음부터 안 묻는다.
 */
const KEY_STORE = 'usage-key';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

let key = localStorage.getItem(KEY_STORE) || '';
let rows = null;
let period = { kind: 'all' };

/* 서버는 UTC(ISO) — 화면에서는 보는 사람의 현지 시각으로 */
const p2 = n => String(n).padStart(2, '0');
const local = r => { const d = new Date(r.time ?? ''); return Number.isNaN(d.getTime()) ? null : d; };
const ym = r => { const d = local(r); return d ? `${d.getFullYear()}-${p2(d.getMonth() + 1)}` : ''; };
const day = r => { const d = local(r); return d ? `${ym(r)}-${p2(d.getDate())}` : ''; };
const stamp = r => { const d = local(r); return d ? `${day(r)} ${p2(d.getHours())}:${p2(d.getMinutes())}` : ''; };

function inPeriod(r, p) {
  if (p.kind === 'all') return true;
  if (p.kind === 'month') return ym(r) === p.ym;
  if (p.kind === 'year') return ym(r).slice(0, 4) === p.y;
  const d = local(r);
  return !!d && d.getTime() >= Date.now() - p.n * 86400000;
}
function periodLabel(p) {
  if (p.kind === 'all') return '전체';
  if (p.kind === 'days') return `최근 ${p.n}일`;
  if (p.kind === 'year') return `${p.y}년`;
  const [y, m] = p.ym.split('-');
  return `${y}년 ${Number(m)}월`;
}
/** 값별 건수, 많은 순 */
function tally(list, field) {
  const m = new Map();
  for (const r of list) { const k = (r[field] ?? '').trim() || '(없음)'; m.set(k, (m.get(k) ?? 0) + 1); }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}
/** 받은 것 이름 — 원본 한 장은 'visual' 로 남는다 */
const detailName = d => (d === 'visual' ? 'Visual PNG (3000²)' : d);

async function load(k) {
  $('#gateErr').hidden = true;
  $('#gateBtn').textContent = '확인 중…';
  try {
    const res = await fetch(`/api/usage.json?key=${encodeURIComponent(k)}`);
    if (res.status === 503) throw new Error('서버에 USAGE_KEY 가 설정되지 않았습니다. Railway Variables 를 확인하세요.');
    if (res.status === 403) { localStorage.removeItem(KEY_STORE); key = ''; throw new Error('열쇠가 맞지 않습니다.'); }
    if (!res.ok) throw new Error(`서버 오류 (${res.status})`);
    rows = (await res.json()).rows;
    key = k;
    localStorage.setItem(KEY_STORE, k);
    $('#gate').hidden = true;
    $('#main').hidden = false;
    $('#actions').hidden = false;
    $('#csv').href = `/api/usage.csv?key=${encodeURIComponent(key)}&tz=${encodeURIComponent(TZ)}`;
    render();
  } catch (e) {
    $('#gate').hidden = false;
    $('#main').hidden = true;
    $('#gateErr').textContent = e.message;
    $('#gateErr').hidden = false;
  } finally {
    $('#gateBtn').textContent = '열기';
  }
}

const bars = (title, data, total) => `
  <div class="card"><p class="card-title">${esc(title)}</p>
    ${data.length ? data.slice(0, 12).map(([k, n]) => `
      <div class="bar-row"><span title="${esc(k)}">${esc(k)}</span><div class="bar"><i style="width:${total ? (n / total) * 100 : 0}%"></i></div><span>${n}</span></div>`).join('')
    : '<p class="muted">기록 없음</p>'}
  </div>`;

function render() {
  const all = rows ?? [];
  // 월별 — 항상 전체 기간
  const mm = new Map();
  for (const r of all) { const k = ym(r); if (!k) continue; const v = mm.get(k) ?? { count: 0, files: 0 }; v.count++; v.files += Number(r.files) || 0; mm.set(k, v); }
  const months = [...mm.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const years = [...new Set(months.map(([k]) => k.slice(0, 4)))].sort().reverse();
  const max = Math.max(1, ...months.map(([, v]) => v.count));

  const shown = all.filter(r => inPeriod(r, period));
  const total = shown.length;
  const files = shown.reduce((a, r) => a + (Number(r.files) || 0), 0);
  const days = new Set(shown.map(day)).size;

  const chips = [{ kind: 'all' }, { kind: 'days', n: 30 }, { kind: 'days', n: 90 }, ...years.map(y => ({ kind: 'year', y }))];
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  $('#main').innerHTML = `
    <div class="chips">
      ${chips.map(p => `<button type="button" class="chip${same(p, period) ? ' on' : ''}" data-period='${JSON.stringify(p)}'>${periodLabel(p)}</button>`).join('')}
      ${period.kind === 'month' ? `<span class="chip on" style="display:inline-flex;align-items:center">${periodLabel(period)}</span>` : ''}
    </div>
    <div class="kpis">
      ${[['다운로드 횟수', total], ['만들어진 파일', files], ['사용한 날', days]].map(([k, v]) => `
        <div class="card kpi"><span class="muted">${k} · ${periodLabel(period)}</span><b>${v}</b></div>`).join('')}
    </div>
    <div class="card">
      <p class="card-title" style="display:flex;justify-content:space-between">월별 다운로드 <span class="muted">막대를 누르면 그 달만 봅니다 · 이 표는 항상 전체 기간</span></p>
      ${months.length ? `<div class="months">${months.map(([k, v]) => `
        <button type="button" class="month${period.kind === 'month' && period.ym === k ? ' on' : ''}" data-month="${k}" title="${k} · 다운로드 ${v.count}회 · 파일 ${v.files}개">
          <em>${v.count}</em><i style="height:${(v.count / max) * 100}%"></i><em>${Number(k.slice(5))}월</em>
        </button>`).join('')}</div>` : '<p class="muted">기록 없음</p>'}
    </div>
    <div class="grid2">
      ${bars('국가별', tally(shown, 'country'), total)}
      ${bars('비주얼 (타입 · 톤)', tally(shown, 'item'), total)}
      ${bars('받은 것 (채널 / 원본)', tally(shown, 'detail').map(([k, n]) => [detailName(k), n]), total)}
      ${bars('지역', tally(shown, 'region'), total)}
    </div>
    <div class="card">
      <p class="card-title">최근 기록 <span class="muted">· ${periodLabel(period)} ${shown.length}건 · 시각은 ${esc(TZ)} 기준</span></p>
      <div style="overflow-x:auto"><table>
        <thead><tr>${['시각', '지역', '국가', '비주얼', '받은 것', '파일 수', '결과'].map(h => `<th>${h}</th>`).join('')}</tr></thead>
        <tbody>${[...shown].reverse().slice(0, 50).map(r => `
          <tr><td>${esc(stamp(r))}</td><td>${esc(r.region)}</td><td>${esc(r.country)}</td><td>${esc(r.item)}</td><td>${esc(detailName(r.detail))}</td><td>${esc(r.files)}</td>
          <td>${r.output ? `<button type="button" data-view="${esc(r.output)}">보기</button>` : '<span class="muted">—</span>'}</td></tr>`).join('')}
        </tbody>
      </table></div>
    </div>`;
}

/* 결과 보기 — 파일별 썸네일(긴 변 600px). 파일 이름 앞부분(criteo-…, lgcom-…)으로 묶는다 */
async function view(id) {
  const r = rows.find(x => x.output === id);
  const src = n => `/api/output/file?id=${encodeURIComponent(id)}&name=${encodeURIComponent(n)}&key=${encodeURIComponent(key)}`;
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `<div class="modal-box">
    <div class="modal-head"><div><p class="card-title" style="margin:0">결과 보기</p>
      <p class="muted" style="margin:4px 0 0">${esc(stamp(r))} · ${esc(r.country)} · ${esc(r.item)} · ${esc(detailName(r.detail))} · 썸네일(긴 변 600px)</p></div>
      <button type="button" class="chip" data-close>닫기</button></div>
    <div data-body><p class="muted">불러오는 중…</p></div></div>`;
  document.body.append(modal);
  const close = () => { modal.remove(); window.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') { const z = document.querySelector('.zoom'); z ? z.remove() : close(); } };
  window.addEventListener('keydown', onKey);
  modal.addEventListener('click', e => {
    if (e.target === modal || e.target.closest('[data-close]')) return close();
    const t = e.target.closest('[data-zoom]');
    if (t) {
      const z = document.createElement('div');
      z.className = 'zoom';
      z.innerHTML = `<img src="${src(t.dataset.zoom)}" alt="" /><span>${esc(t.dataset.zoom)}</span>`;
      z.addEventListener('click', () => z.remove());
      document.body.append(z);
    }
  });
  try {
    const res = await fetch(`/api/output?id=${encodeURIComponent(id)}&key=${encodeURIComponent(key)}`);
    if (!res.ok) throw new Error(`서버 오류 (${res.status})`);
    const { files } = await res.json();
    const groups = new Map();
    for (const f of files) { const g = f.split('-')[0]; groups.set(g, [...(groups.get(g) ?? []), f]); }
    modal.querySelector('[data-body]').innerHTML = files.length
      ? [...groups].map(([g, names]) => `<p style="margin:0;font-size:13px;font-weight:500">${esc(g.toUpperCase())} <span class="muted">· ${names.length}장</span></p>
          <div class="thumbs">${names.map(n => `<button type="button" data-zoom="${esc(n)}"><img src="${src(n)}" alt="" loading="lazy" /><small>${esc(n)}</small></button>`).join('')}</div>`).join('')
      : '<p class="muted">저장된 썸네일이 없습니다 (올리는 중 실패했거나 아직 올라오는 중일 수 있습니다).</p>';
  } catch (e) {
    modal.querySelector('[data-body]').innerHTML = `<p class="err">${esc(e.message)}</p>`;
  }
}

$('#gateForm').addEventListener('submit', e => { e.preventDefault(); const v = $('#keyInput').value.trim(); if (v) void load(v); });
$('#reload').addEventListener('click', () => void load(key));
$('#reset').addEventListener('click', async () => {
  if (!confirm('지금까지의 기록을 백업으로 옮기고 0부터 다시 셉니다.\n계속할까요?')) return;
  try {
    const res = await fetch(`/api/usage/reset?key=${encodeURIComponent(key)}`, { method: 'POST' });
    if (!res.ok) throw new Error(`서버 오류 (${res.status})`);
    const j = await res.json();
    alert(j.backup ? `백업 완료: ${j.backup}\n오늘부터 새로 집계합니다.` : '쌓인 기록이 없어 그대로 시작합니다.');
    period = { kind: 'all' };
    await load(key);
  } catch (e) { alert(`리셋 실패: ${e.message}`); }
});
$('#main').addEventListener('click', e => {
  const c = e.target.closest('[data-period]');
  if (c) { period = JSON.parse(c.dataset.period); return render(); }
  const m = e.target.closest('[data-month]');
  if (m) { period = period.kind === 'month' && period.ym === m.dataset.month ? { kind: 'all' } : { kind: 'month', ym: m.dataset.month }; return render(); }
  const v = e.target.closest('[data-view]');
  if (v) void view(v.dataset.view);
});

if (key) void load(key);
