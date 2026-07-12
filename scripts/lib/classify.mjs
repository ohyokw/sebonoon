/**
 * 분류 규칙 — 카테고리 추정 + 핵심 브리핑 제외(스포츠·연예·생활) 필터.
 * 제외 규칙은 향후 별도 카테고리로 확장할 수 있도록 사유(reason)별로 분리되어 있습니다.
 */

export const EXCLUDE_RULES = [
  {
    reason: 'sports',
    re: /(야구|축구|농구|배구|골프|테니스|올림픽|월드컵|K리그|KBO|MLB|NBA|EPL|프리미어리그|홈런|승부차기|결승골|국가대표 평가전|손흥민|이강인|경기 하이라이트)/,
  },
  {
    reason: 'entertainment',
    re: /(아이돌|걸그룹|보이그룹|컴백|열애설?|결별|예능|드라마 시청률|콘서트|팬미팅|화보 공개|뮤직비디오|음원차트|팬덤|출연 확정)/,
  },
  {
    reason: 'lifestyle',
    re: /(오늘의 운세|별자리 운세|맛집 추천|레시피|다이어트 비법|여행 코스 추천|핫플레이스)/,
  },
];

/** 제목이 핵심 브리핑에서 제외 대상인지 — {excluded, reason} */
export function excludedTitle(title) {
  const t = String(title || '');
  for (const r of EXCLUDE_RULES) {
    if (r.re.test(t)) return { excluded: true, reason: r.reason };
  }
  return { excluded: false, reason: null };
}

/** 제목 키워드로 카테고리 추정 (피드 카테고리가 없거나 교차 검증할 때 사용) */
const CATEGORY_RULES = [
  ['ai',       /\bAI\b|인공지능|생성형 ?AI|챗GPT|거대언어모델|LLM/i],
  ['crypto',   /(비트코인|이더리움|암호화폐|가상자산|블록체인|스테이블코인)/],
  ['business', /(금리|환율|증시|코스피|나스닥|주가|물가|인플레이션|수출|무역|관세|GDP|실적 발표|매출)/],
  ['tech',     /(반도체|스마트폰|소프트웨어|플랫폼|해킹|보안 취약점|클라우드|데이터센터|전기차 배터리)/],
  ['science',  /(연구진|논문|우주|위성 발사|로켓|신약|백신 개발|기후 변화|유전자|망원경)/],
  ['korea',    /(국회|대통령실|여야|총선|대선|검찰|헌법재판소|정부 부처)/],
];

export function categorize(title, fallback = 'world') {
  const t = String(title || '');
  for (const [cat, re] of CATEGORY_RULES) {
    if (re.test(t)) return cat;
  }
  return fallback;
}
