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
