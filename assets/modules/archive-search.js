/**
 * 뉴스 아카이브 검색 — 자유 예측 판정 도우미 (브라우저·Node 테스트 공용 순수 모듈).
 * v1({t,s,c})·v2({id,t,s,u,p,c,tr}) 아카이브 스키마를 모두 지원합니다.
 */

const STOPWORDS = new Set([
  '이상', '이하', '까지', '부터', '동안', '올해', '내년', '이번', '다음',
  '넘는다', '된다', '한다', '있다', '나온다', '않는다', '못한다', '돌파', '도달',
]);
const PARTICLES = ['이', '가', '을', '를', '은', '는', '의', '에', '로', '와', '과', '도', '만'];

/** 예측 문장 → 검색 키워드 (조사 제거, 불용어 필터) */
export function predictionKeywords(text) {
  const out = new Set();
  for (let tok of String(text || '').split(/[^0-9A-Za-z가-힣%]+/)) {
    if (tok.length > 2) {
      for (const p of PARTICLES) {
        if (tok.endsWith(p)) { tok = tok.slice(0, -1); break; }
      }
    }
    if (tok.length >= 2 && !STOPWORDS.has(tok) && !/^\d+$/.test(tok)) out.add(tok);
  }
  return [...out];
}

const norm = (t) => String(t || '').toLowerCase().replace(/\s+/g, '').slice(0, 40);
const keyOf = (it) => it.id || norm(it.t);

/**
 * 기간(from~to) 아카이브에서 예측 문장과 관련된 항목 검색 — 점수순 상위 limit건.
 * 반환 항목: {date, t, s, u, id, score}
 */
export function searchArchive(archive, text, from, to, { limit = 8 } = {}) {
  const kws = predictionKeywords(text);
  if (!kws.length) return [];
  const seen = new Set();
  const hits = [];
  for (const day of archive || []) {
    if (!day?.date || day.date < from || day.date > to) continue;
    for (const it of day.items || []) {
      const score = kws.reduce((s, k) => s + (String(it.t || '').includes(k) ? 1 : 0), 0);
      if (score < 1) continue;
      const key = keyOf(it);
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({ date: day.date, t: it.t, s: it.s || '', u: it.u || '', id: it.id || null, score });
    }
  }
  hits.sort((a, b) => b.score - a.score || b.date.localeCompare(a.date));
  return hits.slice(0, limit);
}

/**
 * 로컬 LLM 판정용 증거 — 아카이브 전체를 임의 샘플링하지 않고,
 * 예측 키워드와 관련된 항목만 골라 전달합니다 (관련 사건 클러스터 한정).
 */
export function evidenceFor(archive, text, from, to, { limit = 40 } = {}) {
  return searchArchive(archive, text, from, to, { limit })
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((e) => `[${e.date}] ${e.t} (${e.s})`);
}
