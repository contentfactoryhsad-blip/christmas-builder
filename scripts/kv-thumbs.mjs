// Main Theme 팔레트 썸네일 — 빌더 기본 글자(builder-app.js 의 text 기본값)로 그린 컷(#bannerComp)에서 타일 창을 잘라 저장한다
// 글자 기본값을 바꾸면 dev 서버(3011)를 띄운 채 node scripts/kv-thumbs.mjs 로 다시 굽는다 (build-assets.sh 는 썸네일이 있으면 두고 간다)
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const OUT = process.argv[2] || new URL('../public/assets/christmas/image', import.meta.url).pathname;
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new','--disable-gpu','--remote-debugging-port=9336','--window-size=1920,1080',`--user-data-dir=${process.env.TMPDIR}/cdp-prof4`,'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let t; for (let i = 0; i < 40; i++) { try { t = await (await fetch('http://127.0.0.1:9336/json')).json(); break; } catch { await sleep(250); } }
const ws = new WebSocket(t.find(x => x.type === 'page').webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result ?? m.error); pend.delete(m.id); } };
const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async x => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.value;
await send('Runtime.enable'); await send('Page.enable');
await send('Page.navigate', { url: 'http://localhost:3011/builder.html' }); await sleep(3000);
for (const [n, tone] of [[0, 'light'], [1, 'dark']]) {
  await ev(`document.querySelectorAll("#palette .tb-cell")[${n}].click()`); await sleep(4000);
  const url = await ev(`(async () => {
    await document.fonts.ready;
    const c = document.querySelector('#bannerComp');
    const W = c.width, H = c.height;
    const o = document.createElement('canvas'); o.width = 560; o.height = 336;
    const x = o.getContext('2d'); x.imageSmoothingQuality = 'high';
    x.drawImage(c, W * 0.319, H * 0.338, W * 0.379, H * 0.2266, 0, 0, 560, 336);
    return W + 'x' + H + '|' + o.toDataURL('image/jpeg', 0.88);
  })()`);
  const [size, data] = url.split('|');
  writeFileSync(`${OUT}/kv-${tone}-thumb.jpg`, Buffer.from(data.split(',')[1], 'base64'));
  console.log(tone, 'from', size);
}
ws.close(); chrome.kill();
