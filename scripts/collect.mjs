#!/usr/bin/env node
/**
 * 세상을 보는 눈 — 데이터 수집기 (하루 4회, KST 06:17/12:17/18:17/23:17)
 *
 * 출처 정책 (공신력 + 중립성):
 *  - 허용 출처는 scripts/lib/sources.mjs 레지스트리가 단일 기준입니다 (등급·유형 포함).
 *  - Google News 피드는 화이트리스트 통과분만 사용하며, 결과가 부족해도 절대 우회하지 않습니다
 *    (부족 상태는 sectionMeta에 기록되어 UI가 '신뢰 출처 보도 부족'을 표시).
 *  - 시장: Frankfurter(ECB 고시환율), CoinGecko, Yahoo Finance — 1차 시장 데이터
 *  - Hacker News·Google Trends는 뉴스가 아닌 '신호'로 분리 수집됩니다.
 *
 * 품질 게이트:
 *  - 새 스냅샷이 품질 기준(lib/quality.mjs)을 통과할 때만 latest.json/last-good.json으로 승격.
 *  - 실패 시 기존 latest.json을 유지하고 status.json에 사유를 기록합니다.
 *
 * 결과: data/latest.json + data/last-good.json + data/status.json
 *      + data/history.json (지표 OHLC, 최근 120일) + data/news-archive.json (사건 아카이브, 최근 60일)
 * 실행: node scripts/collect.mjs — 소스 하나가 실패해도 나머지는 수집됩니다.
 * 테스트: SEBONOON_FIXTURES=<fixture 디렉터리> SEBONOON_DATA_DIR=<임시 디렉터리>로
 *        네트워크 없이 재현 가능한 실행이 됩니다 (test/ 참고).
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRss, tag } from './lib/rss.mjs';
import { filterAllowed, isAllowedSource, sourceMeta } from './lib/sources.mjs';
import { excludedTitle } from './lib/classify.mjs';
import { clusterEvents } from './lib/cluster.mjs';
import { scoreImportance, assessConfidence } from './lib/score.mjs';
import { buildBriefing } from './lib/briefing.mjs';
import { evaluateSnapshot } from './lib/quality.mjs';
import { mergeHistoryEntry, METRIC_KEYS } from './lib/history.mjs';
import { mergeArchiveDay } from './lib/archive.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// .env 자동 로드 (있을 때만) — API 키가 필요한 소스를 추가할 때 사용.
// 실제 값은 .env(로컬, gitignore) 또는 GitHub Actions Secrets에만 두세요 (.env.example 참고).
if (typeof process.loadEnvFile === 'function') {
  try { process.loadEnvFile(join(ROOT, '.env')); } catch { /* .env 없음 — 선택 사항 */ }
}

const DATA_DIR = process.env.SEBONOON_DATA_DIR || join(ROOT, 'data');
const FIXTURES = process.env.SEBONOON_FIXTURES || null; // 테스트용 — 네트워크 대신 fixture 파일
const UA = 'Mozilla/5.0 (compatible; sebonoon-collector/2.0)';
const TIMEOUT_MS = 20000;
const TOTAL_TASKS = 27; // 뉴스 피드 22 + HN·환율·코인·지수·트렌드 5 — 오류 비율 계산용

const errors = [];
const feedLog = []; // 출처별 성공·실패 로그 {name, ok, count}

let fixtureMap = null;
async function fixtureGet(url, as) {
  if (!fixtureMap) fixtureMap = JSON.parse(await readFile(join(FIXTURES, 'map.json'), 'utf8'));
  const hit = fixtureMap.find((m) => url.includes(m.match));
  if (!hit) throw new Error(`fixture 없음(수집 실패 시뮬레이션) — ${url}`);
  const body = await readFile(join(FIXTURES, hit.file), 'utf8');
  return as === 'json' ? JSON.parse(body) : body;
}

async function get(url, as = 'json') {
  if (FIXTURES) return fixtureGet(url, as);
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: as === 'json' ? 'application/json' : '*/*' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  return as === 'json' ? res.json() : res.text();
}

// ---------- 뉴스 소스 ----------

const GN_KO = (path) =>
  `https://news.google.com/rss${path}${path.includes('?') ? '&' : '?'}hl=ko&gl=KR&ceid=KR:ko`;
const GN_SEARCH_EN = (q) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
const GN_SEARCH_KO = (q) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=ko&gl=KR&ceid=KR:ko`;

/** 직접 RSS — 매체명 고정 */
async function fromRss(url, name, take) {
  try {
    const items = parseRss(await get(url, 'text')).slice(0, take).map((it) => ({ ...it, source: name }));
    feedLog.push({ name, ok: true, count: items.length });
    return items;
  } catch (e) {
    errors.push(`${name}: ${e.message}`);
    feedLog.push({ name, ok: false, count: 0 });
    return [];
  }
}

/** Google News 검색 — 특정 통신사(source:)로 한정, 결과도 매체명으로 재검증 */
async function fromGnSearch(q, name, take) {
  try {
    const items = parseRss(await get(GN_SEARCH_EN(q), 'text'))
      .filter((it) => (it.source || '').toLowerCase().includes(name.toLowerCase()))
      .slice(0, take);
    feedLog.push({ name: `GN:${name}`, ok: true, count: items.length });
    return items;
  } catch (e) {
    errors.push(`GN:${name}: ${e.message}`);
    feedLog.push({ name: `GN:${name}`, ok: false, count: 0 });
    return [];
  }
}

/**
 * Google News 한국어 피드 — 화이트리스트 통과분만 반환.
 * 통과 결과가 부족해도 필터를 우회하지 않습니다: 1건이면 1건, 0건이면 빈 배열.
 * (과거의 `trusted.length >= 3 ? trusted : all` 폴백은 출처 정책 위반으로 제거됨)
 */
async function fromGnFeed(url, label, take) {
  try {
    const all = parseRss(await get(url, 'text'));
    const trusted = filterAllowed(all).slice(0, take);
    feedLog.push({ name: label, ok: true, count: trusted.length, dropped: all.length - trusted.length });
    return trusted;
  } catch (e) {
    errors.push(`${label}: ${e.message}`);
    feedLog.push({ name: label, ok: false, count: 0 });
    return [];
  }
}
const fromGnTopic = (path, take) => fromGnFeed(GN_KO(path), `GN토픽${path || '/'}`, take);
const fromGnSearchKo = (q, take) => fromGnFeed(GN_SEARCH_KO(q), `GN검색(${q.slice(0, 14)}…)`, take);

const norm = (t) => t.toLowerCase().replace(/\s+/g, '').slice(0, 40);

/** 여러 소스를 라운드로빈으로 섞어 한 소스가 지면을 독점하지 않게 하고, 제목으로 중복 제거 */
function interleave(lists, max, seen = new Set()) {
  const out = [];
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

/** 한국어 소스로 먼저 채우고, 부족분만 영어 소스로 보충 (클릭해도 한국어 우선) */
function koFirst(koLists, enLists, max) {
  const seen = new Set();
  const ko = interleave(koLists, max, seen);
  if (ko.length >= max) return ko;
  const en = interleave(enLists, max - ko.length, seen); // 같은 seen으로 중복 제거
  return [...ko, ...en];
}

/** 스포츠·연예·생활 기사 제외 (규칙: lib/classify.mjs — 향후 별도 카테고리로 확장 가능) */
let excludedCount = 0;
function dropExcluded(items) {
  return items.filter((it) => {
    const ex = excludedTitle(it.title);
    if (ex.excluded) excludedCount++;
    return !ex.excluded;
  });
}

async function collectNews() {
  const [
    // 한국어 소스 (섹션별 우선 노출용)
    yonhap, ynaIntl, ynaEcon, gnKorea, gnWorld, gnBiz, gnTech, gnSci, gnAi, gnCrypto, gnWealth,
    // 영어 소스 (부족분 보충용 — 원문 국제 보도, 제목은 대시보드에서 번역)
    bbcWorld, reutersWorld, apWorld, bbcBiz, reutersBiz,
    mitTech, bbcTech, aaas, nature, reutersAi, coindesk,
  ] = await Promise.all([
    // ── 한국어 ──
    fromRss('https://www.yna.co.kr/rss/news.xml', '연합뉴스', 7),                 // 연합 전체
    fromRss('https://www.yna.co.kr/rss/international.xml', '연합뉴스', 6),          // 연합 국제
    fromRss('https://www.yna.co.kr/rss/economy.xml', '연합뉴스', 6),               // 연합 경제
    fromGnTopic('', 9),                                                            // GN 한국 홈
    fromGnTopic('/headlines/section/topic/WORLD', 9),                              // GN 세계(한국어)
    fromGnTopic('/headlines/section/topic/BUSINESS', 8),                           // GN 경제(한국어)
    fromGnTopic('/headlines/section/topic/TECHNOLOGY', 6),                         // GN 기술(한국어)
    fromGnTopic('/headlines/section/topic/SCIENCE', 6),                            // GN 과학(한국어)
    fromGnSearchKo('AI OR 인공지능 when:1d', 10),                                  // AI(한국어)
    fromGnSearchKo('비트코인 OR 이더리움 OR 암호화폐 OR 블록체인 when:1d', 10),      // 크립토(한국어)
    fromGnSearchKo('금리 OR 부동산 OR 청약 OR 연금 OR 재테크 OR 절세 when:1d', 10),  // 재테크(한국어)
    // ── 영어(보충) ──
    fromRss('https://feeds.bbci.co.uk/news/world/rss.xml', 'BBC', 4),
    fromGnSearch('when:1d source:Reuters', 'Reuters', 4),
    fromGnSearch('when:1d source:"Associated Press"', 'Associated Press', 3),
    fromRss('https://feeds.bbci.co.uk/news/business/rss.xml', 'BBC', 3),
    fromGnSearch('when:1d business source:Reuters', 'Reuters', 4),
    fromRss('https://www.technologyreview.com/feed/', 'MIT Tech Review', 3),
    fromRss('https://feeds.bbci.co.uk/news/technology/rss.xml', 'BBC', 3),
    fromRss('https://www.science.org/rss/news_current.xml', 'Science', 3),
    fromRss('https://www.nature.com/nature.rss', 'Nature', 3),
    fromGnSearch('when:1d "artificial intelligence" source:Reuters', 'Reuters', 3),
    fromRss('https://www.coindesk.com/arc/outboundfeeds/rss/', 'CoinDesk', 4),
  ]);

  const mitAi = mitTech.filter((it) => /\bAI\b|artificial intelligence/i.test(it.title));

  // 한국어 우선 → 영어는 부족분만. 스포츠·연예·생활 기사는 핵심 브리핑에서 제외.
  const targets = { world: 10, korea: 12, business: 10, tech: 8, science: 8, ai: 10, crypto: 8, wealth: 8 };
  const news = {
    world: koFirst([gnWorld, ynaIntl].map(dropExcluded), [reutersWorld, bbcWorld, apWorld].map(dropExcluded), targets.world),
    korea: interleave([yonhap, gnKorea].map(dropExcluded), targets.korea),
    business: koFirst([gnBiz, ynaEcon].map(dropExcluded), [reutersBiz, bbcBiz].map(dropExcluded), targets.business),
    tech: koFirst([dropExcluded(gnTech)], [mitTech, bbcTech].map(dropExcluded), targets.tech),
    science: koFirst([dropExcluded(gnSci)], [aaas, nature].map(dropExcluded), targets.science),
    ai: koFirst([dropExcluded(gnAi)], [reutersAi, mitAi].map(dropExcluded), targets.ai),
    crypto: koFirst([dropExcluded(gnCrypto)], [dropExcluded(coindesk)], targets.crypto),
    wealth: interleave([dropExcluded(gnWealth)], targets.wealth),
  };

  // 섹션별 출처 부족 상태 — 필터를 우회하는 대신 부족을 기록하고 UI가 표시
  const sectionMeta = {};
  for (const [cat, target] of Object.entries(targets)) {
    const count = news[cat].length;
    sectionMeta[cat] = { count, target, shortage: count < Math.min(3, target) };
  }
  return { news, sectionMeta };
}

// ---------- 신호 수집기 (뉴스와 분리: developerSignal / publicAttentionSignal) ----------

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
      // http(s) 외 스킴은 HN 토론 링크로 대체 (주입 방어)
      link: /^https?:\/\//i.test(it.url || '') ? it.url : `https://news.ycombinator.com/item?id=${it.id}`,
      points: it.score,
      comments: it.descendants ?? 0,
      hnLink: `https://news.ycombinator.com/item?id=${it.id}`,
    }));
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

// ---------- 시장 수집기 ----------

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

// ---------- 사건 클러스터링 + 점수 + 브리핑 ----------

const CORE_CATEGORIES = ['world', 'korea', 'business', 'tech', 'science', 'ai'];

/** 섹션 뉴스 → 사건 배열 (점수·신뢰도·브리핑 포함) + 이전 아카이브 대비 상태 */
function buildEvents(news, prevEventIds, generatedAt) {
  const articles = [];
  for (const [cat, list] of Object.entries(news)) {
    for (const it of list) {
      const meta = sourceMeta(it.source);
      articles.push({ ...it, category: cat, sourceType: meta.type, tier: meta.tier, sourceId: meta.id });
    }
  }
  const events = clusterEvents(articles);
  for (const ev of events) {
    // 클러스터 기사에 sourceId를 실어 독립 출처 수 계산에 사용
    ev.articles = ev.articles.map((a) => ({ ...a, sourceId: sourceMeta(a.source).id }));
    Object.assign(ev, scoreImportance(ev), assessConfidence(ev));
    ev.status = prevEventIds.has(ev.id) ? 'developing' : 'new';
    ev.briefing = buildBriefing(ev);
    ev.updatedAt = generatedAt;
    // 직렬화 전에 내부 필드 정리
    for (const a of ev.articles) delete a.sourceId;
  }
  events.sort((a, b) => b.importanceScore - a.importanceScore);
  return events;
}

// ---------- 메인 ----------

const readJson = async (file, fallback) => {
  try { return JSON.parse(await readFile(join(DATA_DIR, file), 'utf8')); } catch { return fallback; }
};
const writeJson = (file, data, pretty = 1) =>
  writeFile(join(DATA_DIR, file), JSON.stringify(data, null, pretty) + '\n');

async function main() {
  await mkdir(DATA_DIR, { recursive: true });
  const safe = (label, p) =>
    p.catch((e) => {
      errors.push(`${label}: ${e.message}`);
      return null;
    });

  const [newsResult, hackernews, fx, crypto, indices, trends] = await Promise.all([
    safe('news', collectNews()),
    safe('hackernews', collectHackerNews()),
    safe('fx', collectFx()),
    safe('crypto', collectCrypto()),
    safe('indices', collectIndices()),
    safe('trends', collectTrends()),
  ]);

  const now = new Date();
  const nowIso = now.toISOString();
  const kstDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(now);
  const news = newsResult?.news ?? {};

  // 이전 아카이브의 사건 ID — status: new/developing 판정용
  const prevArchive = await readJson('news-archive.json', []);
  const prevEventIds = new Set(
    prevArchive.flatMap((d) => (d.items || []).map((it) => it.id).filter(Boolean))
  );

  const events = buildEvents(news, prevEventIds, nowIso);
  const coreEvents = events.filter((ev) => CORE_CATEGORIES.includes(ev.category));
  const top5 = coreEvents.slice(0, 5).map((ev) => ev.id);
  const changedSinceYesterday = coreEvents
    .filter((ev) => ev.status === 'new')
    .slice(0, 6)
    .map((ev) => ev.id);

  const snapshot = {
    schemaVersion: 2,
    generatedAt: nowIso,
    date: kstDate,
    news,
    sectionMeta: newsResult?.sectionMeta ?? {},
    events,
    top5,
    changedSinceYesterday,
    // 신호 — 뉴스와 분리 (구버전 키 hackernews/trends는 캐시 호환용 별칭)
    developerSignal: hackernews ?? [],
    publicAttentionSignal: trends ?? [],
    hackernews: hackernews ?? [],
    trends: trends ?? [],
    markets: { fx, crypto, indices },
    errors,
  };

  // ── 품질 게이트 ──
  const quality = evaluateSnapshot(snapshot, { totalTasks: TOTAL_TASKS });
  const prevStatus = await readJson('status.json', {});
  const status = {
    lastAttemptAt: nowIso,
    lastSuccessAt: quality.passed ? nowIso : prevStatus.lastSuccessAt || '',
    status: quality.passed ? (errors.length ? 'partial' : 'ok') : 'failed',
    errors,
    quality,
  };
  await writeJson('status.json', status);

  if (quality.passed) {
    await writeJson('latest.json', snapshot);
    await writeJson('last-good.json', snapshot);
    // 아카이브 — 사건 단위, 같은 날짜는 덮어쓰지 않고 누적
    const archiveItems = events.flatMap((ev) =>
      ev.articles.slice(0, 3).map((a) => ({
        id: ev.id, t: a.title, s: a.source, u: a.url, p: a.publishedAt,
        c: ev.category, tr: sourceMeta(a.source).tier,
      }))
    );
    await writeJson('news-archive.json', mergeArchiveDay(prevArchive, kstDate, archiveItems), 0);
  }

  // ── 지표 히스토리 (OHLC) — 시장 데이터는 뉴스 품질과 무관하게 유효하면 누적 ──
  const values = {
    usdkrw: fx?.rates?.KRW ?? null,
    btc: crypto?.btc?.usd ?? null,
    eth: crypto?.eth?.usd ?? null,
    kospi: indices?.kospi?.price ?? null,
    sp500: indices?.sp500?.price ?? null,
    nasdaq: indices?.nasdaq?.price ?? null,
  };
  if (METRIC_KEYS.some((k) => values[k] != null)) {
    const history = await readJson('history.json', []);
    await writeJson('history.json', mergeHistoryEntry(history, kstDate, values, nowIso));
  }

  // ── Actions 로그 — 출처별 성공/실패 · 카테고리별 기사 수 · 사건 수 · 품질 점수 ──
  const okFeeds = feedLog.filter((f) => f.ok);
  const failFeeds = feedLog.filter((f) => !f.ok);
  console.log(`── ${kstDate} 수집 리포트 ──`);
  console.log(`출처: 성공 ${okFeeds.length} / 실패 ${failFeeds.length}` +
    (failFeeds.length ? ` (실패: ${failFeeds.map((f) => f.name).join(', ')})` : ''));
  console.log(`카테고리별 기사: ${Object.entries(news).map(([k, v]) => `${k}:${v.length}`).join(' ')}`);
  const trustedSources = new Set(
    Object.values(news).flat().map((it) => it.source).filter((s) => isAllowedSource(s))
  );
  console.log(`신뢰 출처 ${trustedSources.size}종 · 사건 ${events.length}건 · 제외(스포츠·연예·생활) ${excludedCount}건`);
  console.log(`품질: ${quality.passed ? '통과' : '불합격'} (점수 ${quality.score}) — ${quality.reasons.join(' | ')}`);
  console.log(quality.passed
    ? `✔ latest.json 갱신 (상태: ${status.status})`
    : `✗ 품질 게이트 불합격 — 기존 latest.json(마지막 정상 데이터) 유지, status.json만 갱신`);
  if (errors.length) console.warn('부분 실패:', errors.join(' | '));
}

main().catch((e) => {
  console.error('수집 실패:', e);
  process.exit(1);
});
