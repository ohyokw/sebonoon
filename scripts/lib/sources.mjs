/**
 * 출처 등급 레지스트리 — 허용 출처의 단일 기준(single source of truth).
 * README·화면 출처 정책·수집 코드가 모두 이 목록과 일치해야 합니다.
 *
 * type:
 *  - primary:    정부·기관·기업 등 당사자 발표 채널 — "사실의 최종 기준"이 아니라
 *                이해관계자의 공식 '주장'으로 취급 (confidence: primary-claim)
 *  - wire:       통신사 (사실 보도 중심)
 *  - public:     공영방송
 *  - specialist: 과학·기술 전문 매체
 *  - signal:     Hacker News·Google Trends 등 관심 신호 (뉴스 아님 — 뉴스와 합치지 않음)
 *  - unknown:    미검증 — 집계에서 제외
 */
export const SOURCES = [
  // ── 한국어 ──
  { id: 'yonhap',   name: '연합뉴스',     type: 'wire',       tier: 1, categories: ['world', 'korea', 'business', 'tech', 'science'], region: 'kr' },
  { id: 'newsis',   name: '뉴시스',       type: 'wire',       tier: 2, categories: ['korea', 'business'], region: 'kr' },
  { id: 'news1',    name: '뉴스1',        type: 'wire',       tier: 2, categories: ['korea', 'business'], region: 'kr' },
  { id: 'kbs',      name: 'KBS',          type: 'public',     tier: 1, categories: ['korea', 'world'], region: 'kr' },
  { id: 'ytn',      name: 'YTN',          type: 'public',     tier: 2, categories: ['korea', 'world'], region: 'kr' },
  { id: 'infomax',  name: '연합인포맥스', type: 'wire',       tier: 2, categories: ['business'], region: 'kr' },
  { id: 'ktv',      name: 'KTV',          type: 'primary',    tier: 3, categories: ['korea'], region: 'kr' }, // 정부 채널 — 공식 발표 관점
  // ── 국제 ──
  { id: 'reuters',  name: 'Reuters',      type: 'wire',       tier: 1, categories: ['world', 'business', 'tech', 'ai'], region: 'international' },
  { id: 'ap',       name: 'Associated Press', aliases: ['AP News'], type: 'wire', tier: 1, categories: ['world'], region: 'international' },
  { id: 'bbc',      name: 'BBC',          type: 'public',     tier: 1, categories: ['world', 'business', 'tech'], region: 'international' },
  { id: 'science',  name: 'Science',      aliases: ['Science (AAAS)'], type: 'specialist', tier: 1, categories: ['science'], region: 'international' },
  { id: 'nature',   name: 'Nature',       type: 'specialist', tier: 1, categories: ['science'], region: 'international' },
  { id: 'mittr',    name: 'MIT Tech Review', aliases: ['MIT Technology Review'], type: 'specialist', tier: 2, categories: ['tech', 'ai'], region: 'international' },
  { id: 'coindesk', name: 'CoinDesk',     type: 'specialist', tier: 3, categories: ['crypto'], region: 'international' },
  // ── 신호 (뉴스 아님 — developerSignal / publicAttentionSignal로 분리 표시) ──
  { id: 'hackernews', name: 'Hacker News',   type: 'signal', tier: 3, categories: ['developerSignal'], region: 'international' },
  { id: 'gtrends',    name: 'Google Trends', type: 'signal', tier: 3, categories: ['publicAttentionSignal'], region: 'kr' },
];

/** 매체명 문자열 → 레지스트리 항목 (부분 일치, 대소문자 무시). 미등록이면 null */
export function matchSource(name) {
  const n = String(name || '').trim().toLowerCase();
  if (!n) return null;
  return SOURCES.find(
    (s) => n.includes(s.name.toLowerCase()) || (s.aliases || []).some((a) => n.includes(a.toLowerCase()))
  ) || null;
}

export const isAllowedSource = (name) => matchSource(name) != null;

/** 매체명 → {id, type, tier}. 미등록은 type:'unknown' */
export function sourceMeta(name) {
  const s = matchSource(name);
  return s ? { id: s.id, type: s.type, tier: s.tier } : { id: null, type: 'unknown', tier: null };
}

/**
 * 허용 출처 필터 — 핵심 정책: 결과가 부족해도 절대 우회하지 않습니다.
 * 허용 출처 1건이면 1건, 0건이면 빈 배열을 반환합니다. (기준을 낮춰 임의 매체를 포함하지 않음)
 */
export function filterAllowed(items) {
  return (items || []).filter((it) => isAllowedSource(it.source));
}
