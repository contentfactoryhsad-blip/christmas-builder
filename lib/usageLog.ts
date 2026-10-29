/**
 * 다운로드 사용 기록 — 블프 빌더(lg-bf-builder/usageLog.ts)를 그대로 옮긴 것. 크리스마스 빌더 하나만 쓴다.
 * 다운로드 한 번 = usage.csv 한 줄, 관리자 화면(/#stats → stats.html)이 읽는다.
 *
 * 기록 파일 위치. 기본은 프로젝트 안의 logs/ 인데, Railway 처럼 컨테이너
 * 디스크가 임시인 곳은 재배포 때 통째로 사라진다. 영구 볼륨을 붙이고
 * USAGE_DIR 을 그 경로로 지정하면 남는다. 예) USAGE_DIR=/data
 */
import fs from 'node:fs/promises';
import path from 'node:path';

/** 다운로드 한 번 = 한 줄. */
export interface UsageRecord {
  /** 'christmas' — 빌더가 하나라 고정 (블프·세일즈와 CSV 꼴을 맞춰 둔다) */
  builder: string;
  /** 비주얼 — maintheme-light · producttype-dark … */
  item: string;
  /** 받은 것 — 매체 키 (criteo · lg-com · all …), 원본 한 장이면 'visual' */
  detail: string;
  /** ZIP 에 담긴 파일 수. */
  files: number | string;
  /** 결과 썸네일 폴더 id (outputs/<id>/) — 통계 화면의 '보기'. 없으면 빈 칸. */
  output?: string;
  /** Builder Hub 에서 고른 "지역/국가" 코드 (예: ASIA/KR). 없으면 허브를 거치지 않은 것 — region=DIRECT, 국가는 IP 로 추정. */
  country?: string;
}

const USAGE_CSV = path.join(process.env.USAGE_DIR || path.join(process.cwd(), 'logs'), 'usage.csv');
const USAGE_HEADER = 'time,country,region,ip,builder,item,detail,files,output\n';
/** output 칸이 생기기 전의 헤더 — 만나면 헤더 줄만 새것으로 바꾼다 (옛 행은 칸이 하나 모자라 빈 값으로 읽힌다). */
const USAGE_HEADER_OLD = 'time,country,region,ip,builder,item,detail,files\n';

/** 프록시 뒤에 있어도 원래 클라이언트 IP 를 찾는다. */
export function clientIp(headers: Record<string, string | string[] | undefined>, fallback?: string): string {
  const fwd = headers['x-forwarded-for'];
  const first = Array.isArray(fwd) ? fwd[0] : fwd;
  const ip = (first?.split(',')[0] || (headers['x-real-ip'] as string) || fallback || '').trim();
  return ip.replace(/^::ffff:/, '');
}

/** 마지막 자리를 지운다 — IPv4 는 마지막 옥텟, IPv6 는 뒤쪽 블록. */
function maskIp(ip: string): string {
  if (ip.includes(':')) {
    const b = ip.split(':');
    return b.length > 4 ? b.slice(0, 4).join(':') + '::' : ip;
  }
  const p = ip.split('.');
  return p.length === 4 ? `${p[0]}.${p[1]}.${p[2]}.0` : ip;
}

/**
 * IP → 국가. 사설망이면 조회할 것도 없이 'local'. 외부 조회는 2초만 기다리고,
 * 실패하면 'unknown' — 조회 실패 때문에 기록 자체를 잃으면 안 된다.
 */
async function lookupCountry(ip: string): Promise<{ country: string; region: string }> {
  if (!ip || /^(10\.|192\.168\.|127\.|172\.(1[6-9]|2\d|3[01])\.|::1|fc|fd)/.test(ip)) {
    return { country: 'local', region: '' };
  }
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 2000);
    const res = await fetch(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=countryCode,country,regionName`, { signal: ac.signal });
    clearTimeout(t);
    if (!res.ok) return { country: 'unknown', region: '' };
    const j = (await res.json()) as { countryCode?: string; regionName?: string };
    return { country: j.countryCode || 'unknown', region: j.regionName || '' };
  } catch {
    return { country: 'unknown', region: '' };
  }
}

const csvCell = (v: unknown) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * Builder Hub 에서 고른 "지역/국가" 코드 (예: ASIA/KR) — 클라이언트가 기록에 실어 보낸다.
 * 열쇠 없이 열린 API 라 짧은 글자만 받는다 (CSV 를 깨는 따옴표·쉼표는 csvCell 이 막는다).
 */
const hubPick = (v: unknown): string =>
  typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 60) : '';

/** 한 줄 덧붙인다. 파일이 없으면 헤더부터 만든다. */
export async function appendUsage(rec: Partial<UsageRecord>, ip: string): Promise<void> {
  // 허브에서 고른 값 "ASIA/KR" 이면 region=ASIA, country=KR.
  // 빌더 주소로 바로 들어온 기록은 region=DIRECT, country 는 IP 로 추정한 나라 (불확실 — 참고용).
  const hub = hubPick(rec.country);
  const cut = hub.lastIndexOf('/');
  const region = hub ? (cut > 0 ? hub.slice(0, cut) : '') : 'DIRECT';
  const country = hub ? hub.slice(cut + 1) : (await lookupCountry(ip)).country;
  const row = [
    new Date().toISOString(), country, region, maskIp(ip),
    rec.builder ?? '', rec.item ?? '', rec.detail ?? '', rec.files ?? '',
    isOutputId(rec.output) ? rec.output : '',
  ].map(csvCell).join(',') + '\n';

  await fs.mkdir(path.dirname(USAGE_CSV), { recursive: true });
  try {
    const text = await fs.readFile(USAGE_CSV, 'utf8');
    if (text.startsWith(USAGE_HEADER_OLD)) {
      await fs.writeFile(USAGE_CSV, USAGE_HEADER + text.slice(USAGE_HEADER_OLD.length), 'utf8');
    }
  } catch {
    await fs.writeFile(USAGE_CSV, USAGE_HEADER, 'utf8');
  }
  await fs.appendFile(USAGE_CSV, row, 'utf8');
}

/*
  결과 썸네일 — sales-banner-builder 와 같은 구조.
  다운로드 한 번 = outputs/<id>/ 폴더 하나. 파일마다 긴 변 600px JPEG 를 한 장씩 둔다.
  usage.csv 의 output 칸이 이 id 를 가리킨다. 기록과 같은 USAGE_DIR 아래에 둬야
  재배포 때 지워지지 않는다. 자동 삭제는 하지 않고, 기록 리셋도 이 폴더는 건드리지 않는다.

  올리기는 열쇠 없이 열려 있다 (기록 남기기와 같다). 그래서 이름·크기·형식을 좁게 막는다.
*/
const OUTPUT_DIR = path.join(path.dirname(USAGE_CSV), 'outputs');
/** 한 장 상한 — 600px JPEG 는 보통 30~60KB 다 */
export const OUTPUT_MAX_BYTES = 512 * 1024;
/** 한 묶음 상한 — 채널 전체(ALL)나 페이지 PC+MO 를 받아도 수십 장이다 */
const OUTPUT_MAX_FILES = 200;

export const isOutputId = (v: unknown): v is string => typeof v === 'string' && /^[a-z0-9-]{8,40}$/.test(v);
const isOutputName = (v: unknown): v is string => typeof v === 'string' && /^[a-z0-9_-]{1,80}$/i.test(v);

/** 썸네일 한 장 저장. 형식이 틀리면 이유(status)를 담아 던진다. */
export async function saveOutputImage(id: unknown, name: unknown, buf: Buffer): Promise<void> {
  if (!isOutputId(id) || !isOutputName(name)) throw Object.assign(new Error('Bad id or name'), { status: 400 });
  if (buf.length === 0 || buf.length > OUTPUT_MAX_BYTES) throw Object.assign(new Error('Bad size'), { status: 413 });
  // JPEG 시작 표식(FF D8 FF)만 받는다
  if (buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) throw Object.assign(new Error('Not a JPEG'), { status: 415 });
  const dir = path.join(OUTPUT_DIR, id);
  await fs.mkdir(dir, { recursive: true });
  const existing = await fs.readdir(dir);
  if (existing.length >= OUTPUT_MAX_FILES && !existing.includes(`${name}.jpg`)) {
    throw Object.assign(new Error('Too many files'), { status: 429 });
  }
  await fs.writeFile(path.join(dir, `${name}.jpg`), buf);
}

/** 한 묶음의 파일 이름들 (확장자 뺀 것). 없으면 빈 배열. */
export async function listOutput(id: unknown): Promise<string[]> {
  if (!isOutputId(id)) return [];
  try {
    return (await fs.readdir(path.join(OUTPUT_DIR, id)))
      .filter((f) => f.endsWith('.jpg'))
      .map((f) => f.slice(0, -4))
      .sort();
  } catch {
    return [];
  }
}

/** 썸네일 한 장의 실제 경로. 이름이 틀리면 null. */
export function outputFilePath(id: unknown, name: unknown): string | null {
  if (!isOutputId(id) || !isOutputName(name)) return null;
  return path.join(OUTPUT_DIR, id, `${name}.jpg`);
}

/**
 * 기록을 처음부터 다시 센다 — 기존 CSV 는 지우지 않고 같은 폴더에
 * `usage-until-<시각>.csv` 로 옮겨 둔다. 옮긴 파일 이름을 돌려준다
 * (기록이 없었으면 null).
 */
export async function resetUsage(): Promise<string | null> {
  try { await fs.access(USAGE_CSV); }
  catch { return null; }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backup = path.join(path.dirname(USAGE_CSV), `usage-until-${stamp}.csv`);
  await fs.rename(USAGE_CSV, backup);
  await fs.writeFile(USAGE_CSV, USAGE_HEADER, 'utf8');
  return path.basename(backup);
}

/** 모인 CSV 를 통째로 (없으면 헤더만). */
export async function readUsage(): Promise<string> {
  try { return await fs.readFile(USAGE_CSV, 'utf8'); } catch { return USAGE_HEADER; }
}

/** CSV → 행 객체 배열. 통계 화면이 쓴다. */
export async function readUsageRows(): Promise<Record<string, string>[]> {
  const text = await readUsage();
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const head = lines[0].split(',');
  return lines.slice(1).map((line) => {
    const cells: string[] = [];
    let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { cells.push(cur); cur = ''; }
      else cur += ch;
    }
    cells.push(cur);
    return Object.fromEntries(head.map((h, i) => [h, cells[i] ?? '']));
  });
}

/**
 * 열쇠 검사. 'no-key' = 서버에 USAGE_KEY 미설정(아무도 못 본다),
 * 'mismatch' = 값이 다르다. 나눠야 화면에서 원인을 바로 안다.
 */
export function checkUsageKey(given: unknown): 'ok' | 'no-key' | 'mismatch' {
  const clean = (v: unknown) => String(v ?? '').trim().replace(/^["']|["']$/g, '');
  const key = clean(process.env.USAGE_KEY);
  if (!key) return 'no-key';
  return clean(given) === key ? 'ok' : 'mismatch';
}

/**
 * 내려받는 CSV 에서는 region 을 country 앞에 둔다 (ASIA, KR 순서로 읽히게).
 * 파일 안의 칸 순서는 그대로 둔다 — 예전 기록과 통계 화면이 머리줄 이름으로 읽는다.
 * 두 칸은 쉼표가 들어갈 일이 없는 앞쪽 칸이라 단순 split 으로 충분하다.
 */
const swapRegion = (cells: string[]) => {
  if (cells[1] !== undefined && cells[2] !== undefined) [cells[1], cells[2]] = [cells[2], cells[1]];
};

/**
 * 내려받을 CSV — 파일에는 UTC(ISO)로 남기고, 내려줄 때만 원하는 시간대로
 * 바꾼다. 헤더에 어느 시간대인지 적어 둔다.
 */
export async function readUsageIn(tz = 'Asia/Seoul'): Promise<string> {
  const text = await readUsage();
  const lines = text.split('\n');
  if (lines.length < 2) return text;

  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat('sv-SE', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    });
  } catch { return text; }

  const head = lines[0].split(',');
  const i = head.indexOf('time');
  if (i < 0) return text;
  head[i] = `time (${tz})`;

  const body = lines.slice(1).map((line) => {
    if (!line.trim()) return line;
    const cells = line.split(',');
    const d = new Date(cells[i]);
    if (!Number.isNaN(d.getTime())) cells[i] = fmt.format(d);
    swapRegion(cells);
    return cells.join(',');
  });
  swapRegion(head);
  return [head.join(','), ...body].join('\n');
}
