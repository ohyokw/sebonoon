#!/usr/bin/env node
/**
 * 세상을 보는 눈 — 일일 데이터 수집기
 *
 * 출처 정책 (공신력 + 중립성):
 *  - 국제 통신사/공영: Reuters, AP(Associated Press), BBC — 사실 보도 중심의 와이어 서비스
 *  - 한국: 연합뉴스(국가기간뉴스통신사) 직접 RSS + 통신사/공영방송 화이트리스트(연합뉴스·뉴시스·뉴스1·KBS·YTN)
 *  - 과학: Science(AAAS), Nature — 학술지 뉴스
 *  - 기술: MIT Technology Review, BBC Technology
 *  - 시장: Frankfurter(ECB 고시환율), CoinGecko, Yahoo Finance — 1차 시장 데이터
 *  - 트렌드: Google Trends — 편집 개입 없는 원시 검색 데이터
 *  정파적 성향이 뚜렷한 매체는 집계에서 제외합니다. Google News 피드는 화이트리스트로 필터링해서만 사용.
 *
 * 결과: data/latest.json (오늘 스냅샷) + data/history.json (지표 히스토리, 최근 120일)
 * 실행: node scripts/collect.mjs  — 소스 하나가 실패해도 나머지는 수집됩니다.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = join(ROOT, 'data');
const UA = 'Mozilla/5.0 (compatible; sebonoon-collector/1.0)';
const TIMEOUT_MS = 20000;

const errors = [];

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
function parseRss(xml, limit = 40) {
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

// ---------- 뉴스 소스 ----------

/** 한국 매체 화이트리스트 — 통신사·공영방송만 (Google News 피드 필터용) */
const KR_TRUSTED = ['연합뉴스', '뉴시스', '뉴스1', 'KBS', 'YTN', '연합인포맥스', 'KTV'];
const isTrustedKr = (source) => KR_TRUSTED.some((t) => (source || '').includes(t));

const GN_KO = (path) =>
  `https://news.google.com/rss${path}${path.includes('?') ? '&' : '?'}hl=ko&gl=KR&ceid=KR:ko`;
const GN_SEARCH_EN = (q) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
const GN_SEARCH_KO = (q) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=ko&gl=KR&ceid=KR:ko`;

/** 직접 RSS — 매체명 고정 */
async function fromRss(url, name, take) {
  try {
    return parseRss(await get(url, 'text'))
      .slice(0, take)
      .map((it) => ({ ...it, source: name }));
  } catch (e) {
    errors.push(`${name}: ${e.message}`);
    return [];
  }
}

/** Google News 검색 — 특정 통신사(source:)로 한정, 결과도 매체명으로 재검증 */
async function fromGnSearch(q, name, take) {
  try {
    return parseRss(await get(GN_SEARCH_EN(q), 'text'))
      .filter((it) => (it.source || '').toLowerCase().includes(name.toLowerCase()))
      .slice(0, take);
  } catch (e) {
    errors.push(`GN:${name}: ${e.message}`);
    return [];
  }
}

/** Google News 토픽(한국어) — 화이트리스트 매체만 통과. 통과분이 3건 미만이면 비필터로 보충 */
async function fromGnTopic(path, take) {
  try {
    const all = parseRss(await get(GN_KO(path), 'text'));
    const trusted = all.filter((it) => isTrustedKr(it.source));
    return (trusted.length >= 3 ? trusted : all).slice(0, take);
  } catch (e) {
    errors.push(`GN토픽${path || '/'}: ${e.message}`);
    return [];
  }
}

/** Google News 한국어 키워드 검색 — 토픽과 같은 화이트리스트 규칙 (AI/블록체인/재테크 섹션용) */
async function fromGnSearchKo(q, take) {
  try {
    const all = parseRss(await get(GN_SEARCH_KO(q), 'text'));
    const trusted = all.filter((it) => isTrustedKr(it.source));
    return (trusted.length >= 3 ? trusted : all).slice(0, take);
  } catch (e) {
    errors.push(`GN검색(${q.slice(0, 14)}…): ${e.message}`);
    return [];
  }
}

/** 여러 소스를 라운드로빈으로 섞어 한 소스가 지면을 독점하지 않게 하고, 제목으로 중복 제거 */
function interleave(lists, max) {
  const out = [];
  const seen = new Set();
  const norm = (t) => t.toLowerCase().replace(/\s+/g, '').slice(0, 40);
  for (let i = 0; out.length < max; i++) {
    let pushedAny = false;
    for (const list of lists) {
      if (i >= list.length) continue;
      const it = list[i];
      const key = norm(it.title);
      if (!seen.has(key)) {
        seen.add(key);
        out.push(it);
        pushedAny = true;
        if (out.length >= max) break;
      }
    }
    if (!pushedAny) break;
  }
  return out;
}

async function collectNews() {
  const [
    bbcWorld, reutersWorld, apWorld, gnWorld,
    yonhap, gnKorea,
    bbcBiz, reutersBiz, gnBiz,
    mitTech, bbcTech, gnTech,
    aaas, nature, gnSci,
    gnAi, reutersAi,
    gnCrypto, coindesk,
    gnWealth,
  ] = await Promise.all([
    // 세계 — 국제 통신사/공영 + 한국어 보도(화이트리스트)
    fromRss('https://feeds.bbci.co.uk/news/world/rss.xml', 'BBC', 4),
    fromGnSearch('when:1d source:Reuters', 'Reuters', 4),
    fromGnSearch('when:1d source:"Associated Press"', 'Associated Press', 3),
    fromGnTopic('/headlines/section/topic/WORLD', 5),
    // 한국 — 연합뉴스 직접 + 화이트리스트
    fromRss('https://www.yna.co.kr/rss/news.xml', '연합뉴스', 7),
    fromGnTopic('', 9),
    // 경제·비즈니스 (거시·기업 — 개인 재테크는 별도 섹션)
    fromRss('https://feeds.bbci.co.uk/news/business/rss.xml', 'BBC', 3),
    fromGnSearch('when:1d business source:Reuters', 'Reuters', 4),
    fromGnTopic('/headlines/section/topic/BUSINESS', 5),
    // 기술·과학 (통합)
    fromRss('https://www.technologyreview.com/feed/', 'MIT Tech Review', 3),
    fromRss('https://feeds.bbci.co.uk/news/technology/rss.xml', 'BBC', 3),
    fromGnTopic('/headlines/section/topic/TECHNOLOGY', 5),
    fromRss('https://www.science.org/rss/news_current.xml', 'Science', 3),
    fromRss('https://www.nature.com/nature.rss', 'Nature', 3),
    fromGnTopic('/headlines/section/topic/SCIENCE', 4),
    // AI
    fromGnSearchKo('AI OR 인공지능 when:1d', 8),
    fromGnSearch('when:1d "artificial intelligence" source:Reuters', 'Reuters', 3),
    // 블록체인·크립토
    fromGnSearchKo('비트코인 OR 이더리움 OR 암호화폐 OR 블록체인 when:1d', 8),
    fromRss('https://www.coindesk.com/arc/outboundfeeds/rss/', 'CoinDesk', 4),
    // 재테크 — 금리·부동산·자산 관리 (경제 섹션과 역할 분리)
    fromGnSearchKo('금리 OR 부동산 OR 청약 OR 연금 OR 재테크 OR 절세 when:1d', 10),
  ]);

  // MIT Tech Review에서 AI 관련 기사만 AI 섹션에도 배치
  const mitAi = mitTech.filter((it) => /\bAI\b|artificial intelligence/i.test(it.title));

  return {
    world: interleave([gnWorld, reutersWorld, bbcWorld, apWorld], 10),
    korea: interleave([yonhap, gnKorea], 12),
    business: interleave([gnBiz, reutersBiz, bbcBiz], 10),
    ai: interleave([gnAi, reutersAi, mitAi], 10),
    tech: interleave([gnTech, gnSci, mitTech, bbcTech, aaas, nature], 10),
    crypto: interleave([gnCrypto, coindesk], 8),
    wealth: interleave([gnWealth], 8),
  };
}

// ---------- 그 외 수집기 ----------

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
  // Frankfurter는 유럽중앙은행(ECB) 고시환율 기반
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
    eth: snapshot.markets.crypto?.eth?.usd ?? null,
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

/** 뉴스 아카이브 — 자유 예측의 AI 자동 판정에 쓸 증거 (최근 60일, 섹션별 상위 6건) */
async function updateNewsArchive(snapshot) {
  const file = join(DATA_DIR, 'news-archive.json');
  let archive = [];
  try {
    archive = JSON.parse(await readFile(file, 'utf8'));
  } catch {
    /* 첫 실행 */
  }
  const items = [];
  for (const [cat, list] of Object.entries(snapshot.news || {})) {
    for (const it of (list || []).slice(0, 6)) {
      items.push({ t: it.title, s: it.source || '', c: cat });
    }
  }
  archive = archive.filter((d) => d.date !== snapshot.date);
  if (items.length) archive.push({ date: snapshot.date, items });
  archive.sort((a, b) => a.date.localeCompare(b.date));
  archive = archive.slice(-60);
  await writeFile(file, JSON.stringify(archive) + '\n');
}

// ---------- 메인 ----------

async function main() {
  await mkdir(DATA_DIR, { recursive: true });
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
  await updateNewsArchive(snapshot);

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
