/**
 * 국가(법인) — Builder Hub(builder-hub.lge-d2c.com)에서 골랐거나, 이 빌더 첫 화면에서 고른 값.
 * 블프·세일즈 빌더의 hubCountry.ts + CountryPicker.tsx 를 이 빌더(모듈 JS)로 옮긴 것.
 * 팝업 모양·문구는 허브 첫 화면(12 All/public/country.js)과 같다 (스타일: countryPicker.css).
 *
 * 1) 허브의 카드 링크가 `?hub_country=ASIA/KR` (지역/국가 코드)을 붙여 보낸다.
 *    받으면 저장하고 주소창에서는 지운다. 허브를 거쳐 왔으면 늘 이 값이 이긴다.
 * 2) 허브를 거치지 않고 바로 들어오면 첫 화면에서 허브와 같은 팝업으로 묻는다.
 *    아직 나라가 없으면 고르기 전까지 닫을 수 없다 (×·바깥 클릭·Esc 없음).
 * 3) 고른 값은 이 브라우저에 기억해(localStorage) 다음부터는 묻지 않는다 — 허브와 같은 약속.
 *    잘못 골랐으면 헤더 오른쪽 국가 버튼으로 다시 열어 바꾼다 (그때는 닫을 수 있다).
 *
 * 사용 기록(usageClient.logUsage)이 getHubCountry() 값을 같이 보내고,
 * 서버는 IP 로 추정한 나라 대신 이 값을 stats 의 country 칸에 그대로 찍는다.
 */
import { REGIONS } from './regions.js';

/** 허브와 같은 이름의 열쇠 — 탭(session)에는 { country }, 브라우저(local)에는 { name, code } */
const KEY = 'builderHub.country';
const NAMES = new Map(REGIONS.flatMap(r => r.countries.map(([name, c]) => [`${r.code}/${c}`, name])));

let current = null; // { country: 'ASIA/KR', name: 'Korea' }

function load() {
  // 이 탭에서 허브가 넘겨준 값이 먼저 — 허브를 거쳐 왔으면 그 값을 쓴다
  try {
    const v = JSON.parse(sessionStorage.getItem(KEY) ?? 'null');
    if (v && typeof v.country === 'string' && v.country) return { country: v.country, name: NAMES.get(v.country) ?? v.country };
  } catch { /* 저장소를 못 쓰면 묻는 화면으로 */ }
  // 이 빌더에서 전에 고른 값 — 목록에서 빠진 코드면 버리고 다시 묻는다
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (v && NAMES.has(v.code)) return { country: v.code, name: NAMES.get(v.code) };
  } catch { /* 위와 같다 */ }
  return null;
}

/** 주소에 허브 값이 있으면 저장하고 주소에서 뺀다. 화면을 그리기 전에 한 번 부른다. */
export function captureHubCountry() {
  try {
    const url = new URL(window.location.href);
    const country = url.searchParams.get('hub_country')?.trim();
    if (country) {
      sessionStorage.setItem(KEY, JSON.stringify({ country }));
      // 목록에 있는 나라면 이 빌더에도 기억해 둔다 — 다음에 바로 들어와도 묻지 않게
      if (NAMES.has(country)) localStorage.setItem(KEY, JSON.stringify({ name: NAMES.get(country), code: country }));
      url.searchParams.delete('hub_country');
      window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    }
  } catch { /* 저장 못 해도 빌더는 그대로 쓴다 — 기록만 IP 추정으로 남는다 */ }
  current = load();
}

/** 저장된 국가 { country, name }. 아직 안 골랐으면 null. */
export const getHubCountry = () => current;

function setHubCountry(code) {
  const name = NAMES.get(code);
  if (!name) return;
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ country: code }));
    localStorage.setItem(KEY, JSON.stringify({ name, code }));
  } catch { /* 저장 못 해도 이 화면에서는 쓴다 */ }
  current = { country: code, name };
}

const PLUS = '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path class="v" d="M10 2v16"/><path d="M2 10h16"/></svg>';
const CLOSE = '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 4l12 12M16 4L4 16"/></svg>';
const GLOBE = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>';

/**
 * 팝업과 헤더 배지를 붙인다. captureHubCountry() 다음에 한 번 부른다.
 * 배지는 headerEl 맨 끝(다운로드 버튼 오른쪽)에 — 블프 빌더 헤더와 같은 자리.
 */
export function initCountryPicker(headerEl) {
  const modal = document.createElement('div');
  modal.className = 'cs-overlay';
  modal.hidden = true;
  modal.innerHTML = `
    <div class="cs-modal" role="dialog" aria-modal="true" aria-labelledby="csTitle">
      <div class="cs-head">
        <div>
          <h2 id="csTitle">Where is your subsidiary located?</h2>
          <p>Select your region, then your subsidiary.</p>
        </div>
        <button class="cs-close" type="button" aria-label="Close">${CLOSE}</button>
      </div>
      <div class="cs-list">
        ${REGIONS.map((r, i) => `
          <section class="cs-region" data-region="${r.code}">
            <button class="cs-region-head" type="button" aria-expanded="false" aria-controls="csR${i}">
              <span>${r.name}</span>${PLUS}
            </button>
            <div class="cs-region-body" id="csR${i}">
              <div class="cs-region-inner">
                <ul class="cs-countries">
                  ${r.countries.map(([name, c]) => `<li><button class="cs-country" type="button" data-code="${r.code}/${c}">${name}</button></li>`).join('')}
                </ul>
              </div>
            </div>
          </section>`).join('')}
      </div>
    </div>`;
  document.body.append(modal);

  let required = false;
  const setOpen = (sec, on) => {
    sec.classList.toggle('open', on);
    sec.querySelector('.cs-region-head').setAttribute('aria-expanded', String(on));
  };

  function open({ force = false } = {}) {
    required = force;
    modal.classList.toggle('required', force);
    // 열 때 고른 나라가 있는 지역을 펼쳐 둔다
    const region = current?.country.split('/')[0];
    modal.querySelectorAll('.cs-country').forEach(b => b.classList.toggle('on', b.dataset.code === current?.country));
    modal.querySelectorAll('.cs-region').forEach(sec => setOpen(sec, sec.dataset.region === region));
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function hide() {
    if (required) return;
    modal.hidden = true;
    document.body.style.overflow = '';
  }

  modal.addEventListener('click', e => {
    const head = e.target.closest('.cs-region-head');
    if (head) { const sec = head.parentElement; setOpen(sec, !sec.classList.contains('open')); return; }
    const pick = e.target.closest('.cs-country');
    if (pick) {
      setHubCountry(pick.dataset.code);
      required = false;
      renderBadge();
      hide();
      return;
    }
    if (e.target === modal || e.target.closest('.cs-close')) hide();
  });
  // 팝업이 떠 있는 동안 Esc 는 팝업만 닫는다 — 빌더 쪽 Esc(지우개 끄기 등)까지 가지 않게
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || modal.hidden) return;
    e.stopImmediatePropagation();
    hide();
  }, true);

  // 헤더 오른쪽 — 고른 나라 표시 + 다시 고르기
  const badge = document.createElement('button');
  badge.type = 'button';
  badge.className = 'cs-badge';
  badge.title = 'Change subsidiary';
  badge.addEventListener('click', () => open());
  headerEl?.append(badge);

  function renderBadge() {
    badge.hidden = !current;
    if (current) badge.innerHTML = `${GLOBE}<span>${current.name}</span><span class="cs-badge-code">${current.country}</span>`;
  }

  renderBadge();
  if (!current) open({ force: true });
}
