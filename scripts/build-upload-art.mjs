/**
 * UPLOAD IMAGE 사이즈별 자리 [x, y, 한 변] — 블프 빌더(08 black friday/lg-bf-builder)의 판을 그대로 쓴다.
 * 3000² 가운데 1080² (Creation Guide 의 Safe Area) 가 사이즈마다 거의 다 보이게 잡힌 판이라, 업로드 이미지가 세 빌더에서 같은 자리에 놓인다.
 *   1) 매체 사이즈: 블프 paidSlots.ts 의 S('key', w, h, [x, y, 한 변] …) — key 는 기호를 빼고 맞춘다 (google-sem ↔ sem 등 별칭 아래)
 *   2) LG.com: 블프 lgcomFrames.ts 의 MAIN (1026 보드, 블프 업로드가 실제로 쓰는 자리 — 아래 설명)
 *   3) 그래도 없으면: 이 빌더 원래 자리를 중심 그대로 두고 Safe Area 가 판 안에 들어올 만큼만 줄인다
 * 실행: node scripts/build-upload-art.mjs  (블프 판이 바뀌면 다시 돌린다). Christmas · Trade In-Up 에 같은 스크립트가 있다
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const BF = path.join(here, '../../08 black friday/lg-bf-builder/src/app/components/contenttemplate');
const DATA = path.join(here, '../public/lib/channelSlotData.js');
const OUT = path.join(here, '../public/lib/uploadArt.js');

const norm = k => k.toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9x]/g, '')
  .replace(/^googlesem/, 'sem').replace(/^plnapenezenka/, 'pinapenezenka').replace(/^pmaxd2c/, 'pmaxd2c');
const paid = new Map();
for (const m of readFileSync(path.join(BF, 'paidSlots.ts'), 'utf8').matchAll(/S\('([^']+)',\s*(\d+),\s*(\d+),\s*\[([-\d.]+),\s*([-\d.]+),\s*([-\d.]+)\]/g)) {
  paid.set(norm(m[1]), { w: +m[2], h: +m[3], art: [+m[4], +m[5], +m[6]] });
}
/*
  LG.com: 블프 업로드는 lgcomSlots.ts artFor('custom-upload') → framesFor 가 LG_FRAMES['kv-main'] (= lgcomFrames.ts 의 MAIN, 1026 보드 32 사이즈) 의 A(...) 를 쓴다.
  예전 ART['kv-main'] (7 사이즈) 는 1026 전 값이라 쓰지 않는다. A(x, y, w, h) 는 블프처럼 긴 변 정사각을 가운데 맞춰 잡는다
*/
const lg = new Map();
const frames = readFileSync(path.join(BF, 'lgcomFrames.ts'), 'utf8');
const mainBlock = frames.match(/\nconst MAIN: Frames = \{\n(.*?)\n\};/s)[1];
for (const line of mainBlock.split('\n')) {
  const id = line.match(/^\s*'([^']+)':\s*\[/)?.[1];
  const a = line.match(/\bA\(([-\d.]+),\s*([-\d.]+),\s*([-\d.]+)(?:,\s*([-\d.]+))?\)/);
  if (!id || !a) continue;
  const [x, y, w] = [+a[1], +a[2], +a[3]], h = a[4] ? +a[4] : w, s = Math.max(w, h);
  lg.set(id.toLowerCase(), [x + (w - s) / 2, y + (h - s) / 2, s]);
}

const SAFE = 1080 / 3000, LO = (1 - SAFE) / 2;
/** 원래 자리에서 Safe Area 가 판에 들어오게 — 중심은 두고 줄인 뒤, 넘치면 판 안으로 민다 */
function safeFit([ax, ay, as], W, H) {
  const s = Math.min(as, W / SAFE, H / SAFE);
  const cx = ax + as / 2, cy = ay + as / 2;
  let sx = cx - (s * SAFE) / 2, sy = cy - (s * SAFE) / 2;
  sx = Math.min(Math.max(sx, 0), Math.max(0, W - s * SAFE));
  sy = Math.min(Math.max(sy, 0), Math.max(0, H - s * SAFE));
  return [sx - s * LO, sy - s * LO, s];
}

const mod = await import(pathToFileURL(DATA));
const sets = mod.SLOT_DATA.main ? [mod.SLOT_DATA.main] : [mod.SLOT_DATA];
const out = {}, from = { bf: 0, lgcom: 0, fit: 0 };
for (const set of sets) for (const list of Object.values(set)) for (const s of list) {
  if (!s.art) continue;
  const k = norm(s.key).replace(/2$/, '');
  const p = paid.get(norm(s.key)) || paid.get(k);
  const lgId = s.key.toLowerCase().replace(/^lgcom-/, '');
  let art;
  if (p && p.w === s.w && p.h === s.h) { art = p.art; from.bf++; }
  else if (lg.has(lgId)) { art = lg.get(lgId); from.lgcom++; }
  else { art = safeFit(s.art, s.w, s.h); from.fit++; }
  out[s.key] = art.map(v => Math.round(v * 100) / 100);
}
writeFileSync(OUT, `/** UPLOAD IMAGE 사이즈별 자리 [x, y, 한 변] — scripts/build-upload-art.mjs 가 블프 빌더 판에서 뽑았다 (손으로 고치지 말 것) */\nexport const UPLOAD_ART = ${JSON.stringify(out)};\n`);
console.log(Object.keys(out).length, 'sizes', from);
