/**
 * 중요도·신뢰도 계산 — 유료 LLM 없이 설명 가능한 규칙 점수.
 * 점수만이 아니라 계산 이유(reasons)를 함께 저장합니다.
 */
import { excludedTitle } from './classify.mjs';

const IMPACT_RULES = [
  { key: 'security', re: /(전쟁|미사일|핵실험|핵 합의|군사|안보|공습|휴전|정전 협정|파병|교전)/, pts: 10, label: '안보 관련' },
  { key: 'economy',  re: /(금리|물가|인플레이션|환율|유가|무역|관세|제재|경기 침체|부양책|국채)/, pts: 8, label: '경제 파급력' },
  { key: 'tech',     re: /(반도체|\bAI\b|인공지능|플랫폼 규제|데이터센터|사이버 공격|양자컴퓨팅)/i, pts: 6, label: '기술 파급력' },
  { key: 'society',  re: /(선거|대선|총선|탄핵|대규모 시위|재난|지진|태풍 (경보|피해)|전염병|팬데믹)/, pts: 8, label: '사회적 파급력' },
];
const GLOBAL_RE = /(정상회담|유엔|나토|국제사회|글로벌|세계 경제|국제 유가)/;
const KOREA_RE = /(한국|국내|정부|국회|코스피|원화|서울|한반도|남북)/;
const CLICKBAIT_RE = /(충격|경악|헉|소름|알고 보니|반전$)/;

const distinctSourceIds = (event) => new Set(
  (event.articles || []).map((a) => a.sourceId ?? a.source).filter(Boolean)
);

/** 사건 중요도 0~100 + 이유. now: 최근성 판단 기준 시각(테스트 주입용) */
export function scoreImportance(event, { now = Date.now() } = {}) {
  const reasons = [];
  let score = 0;
  const arts = event.articles || [];
  const titles = arts.map((a) => a.title).join(' ');

  // 독립 출처 수 (최대 4개까지 가산)
  const n = distinctSourceIds(event).size;
  score += Math.min(n, 4) * 12;
  if (n >= 3) reasons.push(`${n}개 독립 출처`);
  else if (n === 2) reasons.push('2개 독립 출처');

  // 출처 등급
  if (arts.some((a) => a.tier === 1)) { score += 8; reasons.push('1등급 출처 포함'); }

  // 영향 범위·파급력
  if (GLOBAL_RE.test(titles)) { score += 10; reasons.push('국제적 파급'); }
  if (KOREA_RE.test(titles) || ['korea', 'business'].includes(event.category)) {
    score += 10; reasons.push('한국 관련');
  }
  for (const r of IMPACT_RULES) {
    if (r.re.test(titles)) { score += r.pts; reasons.push(r.label); }
  }

  // 최근성 · 후속 보도 지속성
  const times = arts.map((a) => Date.parse(a.publishedAt)).filter((t) => !Number.isNaN(t));
  if (times.length) {
    if (now - Math.max(...times) < 12 * 3600_000) { score += 6; reasons.push('최신 보도'); }
    if (Math.max(...times) - Math.min(...times) > 24 * 3600_000) { score += 5; reasons.push('후속 보도 지속'); }
  }

  // 감점 — 클릭 유도·스포츠·연예·생활
  if (CLICKBAIT_RE.test(titles)) { score -= 8; reasons.push('클릭 유도성 표현 감점'); }
  const ex = excludedTitle(event.headline);
  if (ex.excluded) { score -= 30; reasons.push(`${ex.reason} 성격 감점`); }

  return { importanceScore: Math.max(0, Math.min(100, score)), importanceReasons: reasons };
}

const DISPUTE_RE = /(부인|반박|사실무근|아니라고|엇갈)/;

/** 사건 신뢰도 — high | medium | low | primary-claim | disputed (+이유) */
export function assessConfidence(event) {
  const arts = event.articles || [];
  const ids = distinctSourceIds(event);
  const n = ids.size;
  const names = [...new Set(arts.map((a) => a.source).filter(Boolean))];

  // 출처 간 내용 충돌: 한쪽은 주장·발표, 다른 쪽은 부인·반박
  if (n >= 2 && arts.some((a) => DISPUTE_RE.test(a.title)) && arts.some((a) => !DISPUTE_RE.test(a.title))) {
    return { confidence: 'disputed', confidenceReasons: ['출처 간 내용 충돌 — 사실관계 확인 중'] };
  }
  // 당사자(primary) 발표만 존재 — 공식 주장 단계, 독립 검증 없음
  if (arts.length && arts.every((a) => a.sourceType === 'primary')) {
    return { confidence: 'primary-claim', confidenceReasons: ['당사자 공식 발표만 존재 — 독립 검증 없음'] };
  }
  if (n >= 3) return { confidence: 'high', confidenceReasons: [`${names.slice(0, 4).join('·')} 교차 확인`] };
  if (n === 2) return { confidence: 'medium', confidenceReasons: [`${names.slice(0, 2).join('·')} 2개 출처 확인`] };
  return { confidence: 'low', confidenceReasons: ['단일 출처 보도 — 교차 확인 필요'] };
}
