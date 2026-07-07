#!/usr/bin/env node
/**
 * 세상을 보는 눈 — 일일 데이터 수집기
 *
 * 무료 공개 API/RSS만 사용 (API 키 불필요):
 *  - Google News RSS  : 세계 / 한국 / 경제 / 기술·과학 헤드라인
 *  - Hacker News API  : 글로벌 테크 커뮤니티 트렌드
 *  - Frankfurter API  : 환율 (USD 기준)
 *  - CoinGecko API    : 암호화폐 시세
 *  - Yahoo Finance    : 주요 주가지수 (KOSPI, S&P500, NASDAQ)
 *  - Google Trends RSS: 한국 실시간 검색 트렌드
 *
 * 결과: data/latest.json (오늘 스냅샷) + data/history.json (지표 히스토리, 최근 120일)
 *
 * 실행: node scripts/collect.mjs
 * 소스 하나가 실패해도 나머지는 수집됩니다 (부분 실패 허용).
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = join(ROOT, 'data');
const UA = 'Mozilla/5.0 (compatible; sebonoon-collector/1.0)';
const TIMEOUT_MS = 20000;

async function get(url, as = 'json') {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: as === 'json' ? 'application/json' : '*/*' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  return as === 'json' ? res.json() : res.text();
}

function decodeEntities(s) {
  return s
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .trim();
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? decodeEntities(m[1]) : '';
}

/** RSS 문자열 → [{title, link, source, pubDate}] */
function parseRss(xml, limit = 12) {
  const items = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = m[1];
    let title = tag(block, 'title');
    let source = tag(block, 'source');
    // Google News는 제목 끝에 " - 매체명"을 붙인다
    if (!source) {
      const dash = title.lastIndexOf(' - ');
      if (dash > 10) {
        source = title.slice(dash + 3);
        title = title.slice(0, dash);
      }
    } else {
      const suffix = ` - ${source}`;
      if (title.endsWith(suffix)) title = title.slice(0, -suffix.length);
    }
    const link = tag(block, 'link');
    const pubDate = tag(block, 'pubDate');
    if (title) items.push({ title, link, source, pubDate });
    if (items.length >= limit) break;
  }
  return items;
}

// ---------- 수집기들 ----------

const GN = (path) =>
  `https://news.google.com/rss${path}${path.includes('?') ? '&' : '?'}hl=ko&gl=KR&ceid=KR:ko`;

async function collectNews() {
  const sections = {
    world: GN('/headlines/section/topic/WORLD'),
    korea: GN(''),
    business: GN('/headlines/section/topic/BUSINESS'),
    tech: GN('/headlines/section/topic/TECHNOLOGY'),
    science: GN('/headlines/section/topic/SCIENCE'),
  };
  const out = {};
  await Promise.all(
    Object.entries(sections).map(async ([key, url]) => {
      out[key] = parseRss(await get(url, 'text'), key === 'korea' ? 14 : 10);
    })
  );
  return out;
}

async function collectHackerNews() {
  const ids = await get('https://hacker-news.firebaseio.com/v0/topstories.json');
  const items = await Promise.all(
    ids.slice(0, 12).map((id) =>
      get(`https://hacker-news.firebaseio.com/v0/item/${id}.json`).catch(() => null)
    )
  );
  return items
    .filter(Boolean)
    .map((it) => ({
      title: it.title,
      link: it.url || `https://news.ycombinator.com/item?id=${it.id}`,
      points: it.score,
      comments: it.descendants ?? 0,
      hnLink: `https://news.ycombinator.com/item?id=${it.id}`,
    }));
}

async function collectFx() {
  const j = await get('https://api.frankfurter.dev/v1/latest?base=USD&symbols=KRW,JPY,EUR,CNY');
  return { date: j.date, rates: j.rates };
}

async function collectCrypto() {
  const j = await get(
    'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd&include_24hr_change=true'
  );
  return {
    btc: { usd: j.bitcoin?.usd, change24h: j.bitcoin?.usd_24h_change },
    eth: { usd: j.ethereum?.usd, change24h: j.ethereum?.usd_24h_change },
  };
}

async function yahooQuote(symbol) {
  const j = await get(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`
  );
  const meta = j.chart?.result?.[0]?.meta;
  if (!meta) throw new Error(`no meta for ${symbol}`);
  const price = meta.regularMarketPrice;
  const prev = meta.chartPreviousClose ?? meta.previousClose;
  return {
    price,
    changePct: prev ? ((price - prev) / prev) * 100 : null,
  };
}

async function collectIndices() {
  const symbols = { kospi: '^KS11', sp500: '^GSPC', nasdaq: '^IXIC' };
  const out = {};
  await Promise.all(
    Object.entries(symbols).map(async ([key, sym]) => {
      out[key] = await yahooQuote(sym).catch(() => null);
    })
  );
  return out;
}

async function collectTrends() {
  const xml = await get('https://trends.google.com/trending/rss?geo=KR', 'text');
  const items = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const title = tag(m[1], 'title');
    const traffic = tag(m[1], 'ht:approx_traffic');
    if (title) items.push({ title, traffic });
    if (items.length >= 10) break;
  }
  return items;
}

// ---------- 히스토리 ----------

async function updateHistory(snapshot) {
  const file = join(DATA_DIR, 'history.json');
  let history = [];
  try {
    history = JSON.parse(await readFile(file, 'utf8'));
  } catch {
    /* 첫 실행 */
  }
  const today = snapshot.date;
  const entry = {
    date: today,
    usdkrw: snapshot.markets.fx?.rates?.KRW ?? null,
    btc: snapshot.markets.crypto?.btc?.usd ?? null,
    kospi: snapshot.markets.indices?.kospi?.price ?? null,
    sp500: snapshot.markets.indices?.sp500?.price ?? null,
    nasdaq: snapshot.markets.indices?.nasdaq?.price ?? null,
  };
  history = history.filter((h) => h.date !== today);
  history.push(entry);
  history.sort((a, b) => a.date.localeCompare(b.date));
  history = history.slice(-120);
  await writeFile(file, JSON.stringify(history, null, 1) + '\n');
  return history;
}

// ---------- 메인 ----------

async function main() {
  await mkdir(DATA_DIR, { recursive: true });
  const errors = [];
  const safe = (label, p) =>
    p.catch((e) => {
      errors.push(`${label}: ${e.message}`);
      return null;
    });

  const [news, hackernews, fx, crypto, indices, trends] = await Promise.all([
    safe('news', collectNews()),
    safe('hackernews', collectHackerNews()),
    safe('fx', collectFx()),
    safe('crypto', collectCrypto()),
    safe('indices', collectIndices()),
    safe('trends', collectTrends()),
  ]);

  const now = new Date();
  const kstDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(now);

  const snapshot = {
    generatedAt: now.toISOString(),
    date: kstDate,
    news: news ?? {},
    hackernews: hackernews ?? [],
    markets: { fx, crypto, indices },
    trends: trends ?? [],
    errors,
  };

  await writeFile(join(DATA_DIR, 'latest.json'), JSON.stringify(snapshot, null, 1) + '\n');
  await updateHistory(snapshot);

  const counts = Object.entries(snapshot.news)
    .map(([k, v]) => `${k}:${v.length}`)
    .join(' ');
  console.log(`✔ ${kstDate} 수집 완료 — 뉴스[${counts}] HN:${snapshot.hackernews.length} 트렌드:${snapshot.trends.length}`);
  if (errors.length) console.warn('부분 실패:', errors.join(' | '));
}

main().catch((e) => {
  console.error('수집 실패:', e);
  process.exit(1);
});
