/**
 * UPLOAD IMAGE 배치 데이터 — Trade In-Up 빌더(10 Trade In-Up/public/lib/channelSlotData.js, Wide)의 사이즈별 art 자리를
 * 크리스마스 사이즈 key 에 맞춰 public/lib/uploadArt.js 로 뽑는다. 업로드 이미지가 두 빌더에서 같은 자리·크기로 놓이게.
 * 실행: node scripts/build-upload-art.mjs  (Trade In-Up 데이터가 바뀌면 다시 돌린다)
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const here = path.dirname(fileURLToPath(import.meta.url));
const ti = (await import(pathToFileURL(path.join(here, '../../10 Trade In-Up/public/lib/channelSlotData.js')))).SLOT_DATA;
const xm = (await import(pathToFileURL(path.join(here, '../public/lib/channelSlotData.js')))).SLOT_DATA.main;
const norm = k => k.toLowerCase().replace(/[^a-z0-9x]/g, '');
const byKey = new Map(), bySize = new Map();
for (const list of Object.values(ti)) for (const s of list) if (s.art) {
  byKey.set(norm(s.key), s.art);
  if (!bySize.has(`${s.w}x${s.h}`)) bySize.set(`${s.w}x${s.h}`, s.art);
}
const out = {};
let missing = [];
for (const list of Object.values(xm)) for (const s of list) {
  const art = byKey.get(norm(s.key)) || bySize.get(`${s.w}x${s.h}`);
  if (art) out[s.key] = art.map(v => Math.round(v * 100) / 100); else missing.push(s.key);
}
writeFileSync(path.join(here, '../public/lib/uploadArt.js'),
  `/** UPLOAD IMAGE 사이즈별 자리 [x, y, 한 변] — scripts/build-upload-art.mjs 가 Trade In-Up 데이터에서 뽑았다 (손으로 고치지 말 것). 없는 사이즈는 원래 art 를 쓴다 */\nexport const UPLOAD_ART = ${JSON.stringify(out)};\n`);
console.log('sizes', Object.keys(out).length, 'missing', missing.join(' ') || 'none');
