/**
 * Christmas Builder 서버 — 정적 페이지(public)와 크롤링·이미지 프록시 API 를 함께 서빙한다.
 *
 * 브라우저에서 LG.com 을 직접 부르면 CORS 에 막히므로 크롤링·이미지는 반드시
 * 서버를 거친다. 빌드 단계 없이 public 폴더를 그대로 내보낸다.
 *
 *   npm start   →  http://localhost:3011  (빌더)
 */
import express from 'express';
import compression from 'compression';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crawlPage, fetchProxyImage, isImageDomainAllowed } from './lib/productImport';
import {
  appendUsage, checkUsageKey, clientIp, listOutput, OUTPUT_MAX_BYTES, outputFilePath, readUsageIn, readUsageRows,
  resetUsage, saveOutputImage,
} from './lib/usageLog';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT) || 3011;

app.use(compression());
app.use(express.json({ limit: '2mb' }));

// ─── /api/proxy-image ────────────────────────────────────────────────────────

app.get('/api/proxy-image', async (req, res) => {
  const imageUrl = req.query.url as string | undefined;
  if (!imageUrl) return res.status(400).json({ error: 'Missing url parameter' });

  let parsed: URL;
  try { parsed = new URL(imageUrl); }
  catch { return res.status(400).json({ error: 'Invalid URL' }); }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return res.status(400).json({ error: 'Only HTTP(S) URLs allowed' });
  }
  if (!isImageDomainAllowed(parsed.hostname)) {
    return res.status(403).json({ error: 'Domain not allowed' });
  }

  try {
    const { contentType, buffer } = await fetchProxyImage(imageUrl);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    // 누끼 처리가 캔버스로 픽셀을 읽으므로 ACAO 가 없으면 tainted 되어 실패한다.
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.send(buffer);
  } catch (err: any) {
    return res.status(err?.status ?? 500).json({ error: err?.message ?? 'Failed to fetch image' });
  }
});

// ─── /api/crawl-page ─────────────────────────────────────────────────────────

app.post('/api/crawl-page', async (req, res) => {
  const { url } = req.body || {};
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Missing url in request body' });
  }

  let parsed: URL;
  try { parsed = new URL(url); }
  catch { return res.status(400).json({ error: 'Invalid URL' }); }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return res.status(400).json({ error: 'Only HTTP(S) URLs allowed' });
  }

  try {
    return res.status(200).json(await crawlPage(url));
  } catch (err: any) {
    return res.status(err?.status ?? 500).json({ error: err?.message ?? 'Failed to crawl page' });
  }
});

// ─── 사용 기록 (lib/usageLog.ts — 블프·세일즈 빌더와 같은 구조) ───────────────

/* 다운로드 한 번을 한 줄로 남긴다. 실패해도 사용자에게 영향이 없게 항상 200 — 다운로드가 끝난 뒤에 부른다 */
app.post('/api/log-usage', async (req, res) => {
  try {
    await appendUsage(req.body || {}, clientIp(req.headers, req.socket.remoteAddress));
  } catch (err) {
    console.warn('usage log failed:', err);
  }
  return res.status(200).json({ ok: true });
});

/* 통계 조회·내려받기·리셋 — key 가 USAGE_KEY 환경변수와 맞아야 한다. 값이 없으면 아예 닫아 둔다 */
const guard = (req: express.Request, res: express.Response): boolean => {
  const k = checkUsageKey(req.query.key);
  if (k === 'no-key') { res.status(503).json({ error: 'USAGE_KEY not set on server' }); return false; }
  if (k !== 'ok') { res.status(403).json({ error: 'Forbidden' }); return false; }
  return true;
};

app.get('/api/usage.json', async (req, res) => {
  if (!guard(req, res)) return;
  return res.json({ rows: await readUsageRows() });
});

app.post('/api/usage/reset', async (req, res) => {
  if (!guard(req, res)) return;
  return res.json({ ok: true, backup: await resetUsage() });
});

app.get('/api/usage.csv', async (req, res) => {
  if (!guard(req, res)) return;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="christmas-usage.csv"');
  // 엑셀이 UTF-8 로 열도록 BOM
  return res.send('\uFEFF' + (await readUsageIn((req.query.tz as string) || 'Asia/Seoul')));
});

/* 결과 썸네일 — 다운로드가 끝난 뒤 브라우저가 파일별 JPEG 를 한 장씩 올린다. 열쇠 없이 받되 형식·크기·장수는 usageLog 가 막는다 */
app.post('/api/output', express.raw({ type: 'image/jpeg', limit: OUTPUT_MAX_BYTES }), async (req, res) => {
  try {
    await saveOutputImage(req.query.id, req.query.name, Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0));
    return res.status(200).json({ ok: true });
  } catch (err: any) {
    return res.status(err?.status ?? 500).json({ error: err?.message ?? 'Failed to save' });
  }
});

app.get('/api/output', async (req, res) => {
  if (!guard(req, res)) return;
  return res.json({ files: await listOutput(req.query.id) });
});

app.get('/api/output/file', async (req, res) => {
  if (!guard(req, res)) return;
  const file = outputFilePath(req.query.id, req.query.name);
  if (!file) return res.status(400).json({ error: 'Bad id or name' });
  res.setHeader('Cache-Control', 'private, max-age=86400');
  return res.sendFile(file, (err) => { if (err && !res.headersSent) res.status(404).end(); });
});

// ─── 정적 파일 ───────────────────────────────────────────────────────────────

// 첫 화면 = Christmas Builder (/builder 도 같은 페이지).
// 예전 테스트 페이지(제품 합성·인필·스튜디오)는 archive/lab-pages/ 에 보관 — 서빙하지 않는다.
const sendBuilder = (_req: express.Request, res: express.Response) => res.sendFile(path.join(__dirname, 'public', 'builder.html'));
app.get('/', sendBuilder);
app.get('/builder', sendBuilder);

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
