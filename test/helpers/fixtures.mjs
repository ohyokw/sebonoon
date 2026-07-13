/**
 * 수집기 fixture 생성기 — 네트워크 없이 collect.mjs를 재현 가능하게 실행합니다.
 * buildFixtures(dir, {omit})로 fixture 디렉터리를 만들고,
 * SEBONOON_FIXTURES=dir SEBONOON_DATA_DIR=... 환경변수로 수집기를 실행하세요.
 * omit에 넣은 피드는 map.json에서 빠져 '수집 실패'가 시뮬레이션됩니다.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const rfc = (hoursAgo) => new Date(Date.now() - hoursAgo * 3600_000).toUTCString();

/** items: [{title, source?, hoursAgo?}] → RSS XML (source 태그는 Google News 형식) */
export function rssXml(items, { withSource = true } = {}) {
  const body = items.map((it) => `  <item>
    <title><![CDATA[${it.title}${!withSource && it.source ? '' : ''}]]></title>
    ${withSource && it.source ? `<source url="https://example.com">${it.source}</source>` : ''}
    <link>https://example.com/${encodeURIComponent(it.title.slice(0, 24))}</link>
    <pubDate>${rfc(it.hoursAgo ?? 2)}</pubDate>
  </item>`).join('\n');
  return `<?xml version="1.0"?><rss version="2.0"><channel>\n${body}\n</channel></rss>`;
}

export function trendsXml(items) {
  const body = items.map((t) => `  <item>
    <title>${t.title}</title>
    <ht:approx_traffic>${t.traffic}</ht:approx_traffic>
  </item>`).join('\n');
  return `<?xml version="1.0"?><rss version="2.0" xmlns:ht="https://trends.google.com"><channel>\n${body}\n</channel></rss>`;
}

/** 피드 정의 — key: omit에서 쓰는 이름, match: URL 부분 일치 (구체적인 것이 먼저 오도록 배열 순서 유지) */
export function defaultFeeds() {
  return [
    { key: 'yna-news', match: 'yna.co.kr/rss/news.xml', file: 'yna-news.xml', body: rssXml([
      { title: '정부, 반도체 산업 지원 대책 발표' },
      { title: '국회, 예산안 처리 일정 합의' },
      { title: '수도권 폭우 피해 복구 지원 확대' },
      { title: '검찰, 대형 금융사기 사건 수사 착수' },
    ], { withSource: false }) },
    { key: 'yna-intl', match: 'yna.co.kr/rss/international', file: 'yna-intl.xml', body: rssXml([
      { title: '미국 연준, 기준금리 0.25%포인트 인하 결정' },
      { title: '우크라이나 휴전 협상 재개 움직임' },
      { title: '중국, 희토류 수출 규제 완화 검토' },
    ], { withSource: false }) },
    { key: 'yna-econ', match: 'yna.co.kr/rss/economy', file: 'yna-econ.xml', body: rssXml([
      { title: '원/달러 환율 1,380원대 등락' },
      { title: '코스피, 외국인 매수세에 상승 마감' },
      { title: '수출 반도체 비중 다시 확대' },
    ], { withSource: false }) },
    { key: 'gn-home', match: 'news.google.com/rss?hl=ko', file: 'gn-home.xml', body: rssXml([
      { title: '여야, 민생법안 처리 합의', source: '뉴시스' },
      { title: '전국 대중교통 요금 조정 논의', source: 'KBS' },
      { title: '식품 물가 상승세 지속', source: '뉴스1' },
      { title: '유명 배우 열애설 공개', source: '스포츠서울' },
      { title: '프로야구 KBO 순위 경쟁 치열', source: 'OSEN' },
    ]) },
    { key: 'gn-world', match: 'topic/WORLD', file: 'gn-world.xml', body: rssXml([
      { title: '미 연준 기준금리 인하…시장 반응 주목', source: 'KBS' },
      { title: '유엔, 가자 지구 휴전 결의안 표결', source: '연합뉴스' },
      { title: '유럽연합, 빅테크 규제 법안 처리', source: 'YTN' },
      { title: '해외 유명 리조트 특가 소식', source: '여행매거진' },
    ]) },
    { key: 'gn-biz', match: 'topic/BUSINESS', file: 'gn-biz.xml', body: rssXml([
      { title: '한국은행, 기준금리 동결 시사', source: '연합인포맥스' },
      { title: '대기업 3분기 실적 발표 시작', source: '뉴시스' },
      { title: '국제 유가 하락에 항공업계 화색', source: 'YTN' },
    ]) },
    { key: 'gn-tech', match: 'topic/TECHNOLOGY', file: 'gn-tech.xml', body: rssXml([
      { title: '국산 반도체 신규 공정 공개', source: '연합뉴스' },
      { title: '클라우드 보안 사고 잇따라', source: 'KBS' },
    ]) },
    { key: 'gn-sci', match: 'topic/SCIENCE', file: 'gn-sci.xml', body: rssXml([
      { title: '국내 연구진, 신약 후보물질 발견', source: '연합뉴스' },
      { title: '차세대 발사체 엔진 시험 성공', source: 'YTN' },
    ]) },
    { key: 'gn-ai', match: 'q=AI%20OR', file: 'gn-ai.xml', body: rssXml([
      { title: 'AI 반도체 수요 급증에 공급 부족', source: '연합뉴스' },
      { title: '정부, 인공지능 기본법 시행령 발표', source: '뉴스1' },
    ]) },
    { key: 'gn-crypto', match: '%EB%B9%84%ED%8A%B8%EC%BD%94%EC%9D%B8', file: 'gn-crypto.xml', body: rssXml([
      { title: '비트코인, 기관 매수세에 상승', source: '뉴시스' },
      { title: '가상자산 과세 유예 논의', source: '연합뉴스' },
    ]) },
    { key: 'gn-wealth', match: '%EA%B8%88%EB%A6%AC%20OR', file: 'gn-wealth.xml', body: rssXml([
      { title: '주택담보대출 금리 소폭 하락', source: '연합뉴스' },
      { title: '연금 개혁안 세부 내용 공개', source: 'KBS' },
    ]) },
    // ── 영어 보충 ──
    { key: 'gn-reuters-ai', match: '%22artificial%20intelligence%22', file: 'gn-reuters-ai.xml', body: rssXml([
      { title: 'Major artificial intelligence lab unveils new model', source: 'Reuters' },
    ]) },
    { key: 'gn-reuters-biz', match: 'business%20source%3AReuters', file: 'gn-reuters-biz.xml', body: rssXml([
      { title: 'Global markets rally after Fed rate cut', source: 'Reuters' },
    ]) },
    { key: 'gn-reuters-world', match: 'source%3AReuters', file: 'gn-reuters-world.xml', body: rssXml([
      { title: 'Ceasefire talks resume in Middle East', source: 'Reuters' },
    ]) },
    { key: 'gn-ap', match: 'Associated%20Press', file: 'gn-ap.xml', body: rssXml([
      { title: 'World leaders gather for climate summit', source: 'Associated Press' },
    ]) },
    { key: 'bbc-world', match: 'bbci.co.uk/news/world', file: 'bbc-world.xml', body: rssXml([
      { title: 'UN votes on ceasefire resolution' },
    ], { withSource: false }) },
    { key: 'bbc-biz', match: 'bbci.co.uk/news/business', file: 'bbc-biz.xml', body: rssXml([
      { title: 'Oil prices fall on supply outlook' },
    ], { withSource: false }) },
    { key: 'bbc-tech', match: 'bbci.co.uk/news/technology', file: 'bbc-tech.xml', body: rssXml([
      { title: 'Chip makers expand advanced packaging capacity' },
    ], { withSource: false }) },
    { key: 'mittr', match: 'technologyreview.com', file: 'mittr.xml', body: rssXml([
      { title: 'What the new AI models mean for research' },
    ], { withSource: false }) },
    { key: 'science', match: 'science.org', file: 'science.xml', body: rssXml([
      { title: 'New telescope data reshapes galaxy formation theory' },
    ], { withSource: false }) },
    { key: 'nature', match: 'nature.com', file: 'nature.xml', body: rssXml([
      { title: 'Gene therapy trial reports early success' },
    ], { withSource: false }) },
    { key: 'coindesk', match: 'coindesk.com', file: 'coindesk.xml', body: rssXml([
      { title: 'Bitcoin ETF inflows hit weekly record' },
    ], { withSource: false }) },
    // ── 신호·시장 ──
    { key: 'hn-top', match: 'topstories.json', file: 'hn-top.json', body: JSON.stringify([1, 2, 3]) },
    { key: 'hn-1', match: 'item/1.json', file: 'hn-1.json', body: JSON.stringify({ id: 1, title: 'Show HN: tiny static dashboard', url: 'https://example.com/hn1', score: 120, descendants: 45 }) },
    { key: 'hn-2', match: 'item/2.json', file: 'hn-2.json', body: JSON.stringify({ id: 2, title: 'Why RSS still matters', url: 'https://example.com/hn2', score: 98, descendants: 30 }) },
    { key: 'hn-3', match: 'item/3.json', file: 'hn-3.json', body: JSON.stringify({ id: 3, title: 'Postgres tips for small teams', score: 77, descendants: 12 }) },
    { key: 'fx', match: 'frankfurter', file: 'fx.json', body: JSON.stringify({ date: new Date().toISOString().slice(0, 10), rates: { KRW: 1382.5, JPY: 155.1, EUR: 0.92, CNY: 7.21 } }) },
    { key: 'crypto', match: 'coingecko', file: 'crypto.json', body: JSON.stringify({ bitcoin: { usd: 101250, usd_24h_change: 1.8 }, ethereum: { usd: 3410, usd_24h_change: -0.6 } }) },
    { key: 'yahoo-kospi', match: '%5EKS11', file: 'yahoo-kospi.json', body: yahooJson(2712.4, 2698.1) },
    { key: 'yahoo-sp500', match: '%5EGSPC', file: 'yahoo-sp500.json', body: yahooJson(6320.9, 6301.2) },
    { key: 'yahoo-nasdaq', match: '%5EIXIC', file: 'yahoo-nasdaq.json', body: yahooJson(21050.7, 21100.3) },
    { key: 'trends', match: 'trends.google.com', file: 'trends.xml', body: trendsXml([
      { title: '기준금리', traffic: '20K+' },
      { title: '환율', traffic: '10K+' },
    ]) },
  ];
}

function yahooJson(price, prevClose) {
  return JSON.stringify({ chart: { result: [{ meta: { regularMarketPrice: price, chartPreviousClose: prevClose } }] } });
}

/** fixture 디렉터리 생성. omit: 실패 시뮬레이션할 피드 key 배열. replace: {key: body} 내용 교체 */
export async function buildFixtures(dir, { omit = [], replace = {} } = {}) {
  await mkdir(dir, { recursive: true });
  const feeds = defaultFeeds().filter((f) => !omit.includes(f.key));
  for (const f of feeds) {
    await writeFile(join(dir, f.file), replace[f.key] ?? f.body);
  }
  await writeFile(join(dir, 'map.json'), JSON.stringify(feeds.map(({ match, file }) => ({ match, file })), null, 1));
  return dir;
}
