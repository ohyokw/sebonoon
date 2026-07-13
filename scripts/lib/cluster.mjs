/**
 * 사건 클러스터링 — 유료 AI 없이 제목 특징만으로 같은 사건의 기사를 묶습니다.
 * 특징: 정규화 토큰 · 고유명사(국가·라틴 대문자어) · 숫자 · 카테고리 일치 · 발행 시각 차이
 */

/** 제목 정규화 — 사건 비교용 (소문자, 괄호·구두점 제거, 공백 정리) */
export function normTitle(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/\[[^\]]*\]|\([^)]*\)|【[^】]*】/g, ' ') // [단독]·(종합) 등 장식 제거
    .replace(/[^\p{L}\p{N}%.]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const STOP = new Set([
  '이', '가', '을', '를', '은', '는', '의', '에', '에서', '로', '으로', '와', '과', '도', '만', '및',
  '대한', '위한', '관련', '오늘', '내일', '올해', '이번', '지난', '한다', '했다', '된다', '됐다',
  'the', 'a', 'an', 'of', 'to', 'in', 'on', 'for', 'and', 'is', 'are', 'as', 'at', 'by', 'with', 'after', 'over',
]);
const PARTICLES = ['이', '가', '을', '를', '은', '는', '의', '에', '로', '와', '과', '도', '만'];

/** 정규화 제목 → 비교용 토큰 집합 (조사 제거·불용어 필터) */
export function tokenize(title) {
  const out = new Set();
  for (let tok of normTitle(title).split(' ')) {
    if (/[가-힣]/.test(tok) && tok.length > 2) {
      for (const p of PARTICLES) {
        if (tok.endsWith(p)) { tok = tok.slice(0, -1); break; }
      }
    }
    if (tok.length >= 2 && !STOP.has(tok)) out.add(tok);
  }
  return out;
}

const COUNTRIES = [
  '미국', '중국', '일본', '러시아', '우크라이나', '이스라엘', '이란', '북한', '한국', '대만', '인도',
  '영국', '프랑스', '독일', '유럽연합', 'eu', '사우디', '팔레스타인', '가자', '시리아', '베트남', '멕시코',
];

/** 고유명사·숫자 추출 — 국가명, 라틴 대문자 시작 단어(원문 기준), 숫자 */
export function entitiesOf(title) {
  const ents = new Set();
  const norm = normTitle(title);
  for (const c of COUNTRIES) {
    // 라틴 국가 토큰('eu')은 단어 경계로만 — museum·Reuters 등의 부분 문자열 오탐 방지
    const hit = /^[a-z]+$/.test(c) ? new RegExp(`(?:^| )${c}(?: |$)`).test(norm) : norm.includes(c);
    if (hit) ents.add(c);
  }
  for (const m of String(title || '').matchAll(/\b[A-Z][A-Za-z]{2,}\b/g)) ents.add(m[0].toLowerCase());
  for (const m of norm.matchAll(/\d+(?:\.\d+)?%?/g)) ents.add(m[0]);
  return ents;
}

const overlap = (a, b) => { let n = 0; for (const x of a) if (b.has(x)) n++; return n; };

/** 두 기사 시그니처의 유사도 (0~1+) — 토큰 자카드 + 고유명사 겹침 보너스 */
export function similarity(sigA, sigB) {
  const inter = overlap(sigA.tokens, sigB.tokens);
  const union = sigA.tokens.size + sigB.tokens.size - inter;
  const jac = union ? inter / union : 0;
  const entShared = overlap(sigA.ents, sigB.ents);
  return jac + Math.min(entShared, 2) * 0.12;
}

export const signatureOf = (title) => ({ tokens: tokenize(title), ents: entitiesOf(title) });

/** 안정적인 사건 ID — 카테고리 + 시그니처 상위 토큰 해시 (같은 사건이면 실행마다 동일) */
export function eventIdOf(category, sig) {
  const key = [...sig.ents, ...[...sig.tokens].sort().slice(0, 6)].sort().join('|');
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = ((h * 33) ^ key.charCodeAt(i)) >>> 0;
  return `evt-${category}-${h.toString(36)}`;
}

const HOURS = 3600_000;

/**
 * 기사 배열 → 사건 배열. 기사: {title, link, source, pubDate, category, sourceType, tier}
 * 같은 사건 판정: 토큰 유사도 + 고유명사 + 카테고리 일치 보너스 − 발행 시각 차이(>48h) 페널티
 */
export function clusterEvents(articles, { threshold = 0.5 } = {}) {
  const clusters = [];
  for (const a of articles || []) {
    const sig = signatureOf(a.title);
    const at = Date.parse(a.pubDate) || null;
    let best = null, bestScore = 0;
    for (const c of clusters) {
      let s = similarity(sig, c.sig);
      if (a.category === c.category) s += 0.1;
      if (at && c.at && Math.abs(at - c.at) > 48 * HOURS) s -= 0.2;
      if (s > bestScore) { best = c; bestScore = s; }
    }
    if (best && bestScore >= threshold) {
      best.articles.push(a);
      for (const t of sig.tokens) best.sig.tokens.add(t);
      for (const e of sig.ents) best.sig.ents.add(e);
    } else {
      clusters.push({ sig: { tokens: new Set(sig.tokens), ents: new Set(sig.ents) }, seedSig: sig, category: a.category, at, articles: [a] });
    }
  }
  return clusters.map((c) => {
    // 대표 기사(등급 높은 순 → 먼저 수집된 순)를 articles[0]에 두어
    // 카드의 제목과 링크가 항상 같은 기사를 가리키게 한다
    const arts = [...c.articles].sort((x, y) => (x.tier ?? 9) - (y.tier ?? 9));
    const rep = arts[0];
    return {
      id: eventIdOf(c.category, c.seedSig), // 시드 기사 기준 — 클러스터 병합 순서와 무관하게 안정적
      category: c.category,
      headline: rep.title,
      status: 'new', // 이전 스냅샷과 비교해 developing 승격은 수집기에서 수행
      articles: arts.map((a) => ({
        title: a.title,
        source: a.source || '',
        sourceType: a.sourceType || 'unknown',
        url: a.link || '',
        publishedAt: a.pubDate || '',
      })),
    };
  });
}
