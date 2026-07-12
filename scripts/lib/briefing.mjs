/**
 * 해석형 브리핑 — 규칙 기반으로만 생성합니다.
 * 원칙 (단계 6):
 *  - 출처에서 확인되지 않는 사실을 생성하지 않음 — confirmedFacts는 출처 제목 그대로
 *  - 규칙으로 만들 수 없는 해석은 빈 배열 (UI가 해당 블록을 숨김)
 *  - 추정은 '가능성', '예상', '확인 필요'로 표시
 *  - 사실과 전망을 같은 문장에 섞지 않음
 */

const TEMPLATES = [
  {
    re: /(금리|기준금리)/,
    why: '금리 변화는 대출·소비·투자 전반에 영향을 줄 가능성이 있습니다.',
    korea: '한국 가계부채 이자 부담과 부동산 금융 비용에 영향 가능성.',
    watch: '다음 한국은행 금융통화위원회·미 연준(FOMC) 발표 확인 필요.',
  },
  {
    re: /(환율|원화|달러 강세|달러 약세)/,
    why: '환율 변동은 수출입 가격과 물가에 영향을 줄 가능성이 있습니다.',
    korea: '수입 물가·해외여행 비용·수출 기업 실적에 영향 가능성.',
    watch: '원/달러 환율 추이와 외환 당국 대응 확인 필요.',
  },
  {
    re: /(관세|무역 (분쟁|협상)|수출 (규제|통제)|제재)/,
    why: '무역·제재 조치는 공급망과 기업 실적에 영향을 줄 가능성이 있습니다.',
    korea: '한국 수출 기업(반도체·자동차 등)의 판로·비용에 영향 가능성.',
    watch: '적용 시점·품목 범위·상대국 보복 조치 발표 확인 필요.',
  },
  {
    re: /(전쟁|휴전|정전|미사일|공습|교전)/,
    why: '군사적 긴장은 에너지 가격과 국제 정세 전반에 영향을 줄 가능성이 있습니다.',
    korea: '유가·환율 경로로 한국 물가에 영향 가능성.',
    watch: '휴전·협상 관련 후속 발표와 주변국 반응 확인 필요.',
  },
  {
    re: /(반도체|파운드리|HBM)/,
    why: '반도체 산업 변화는 글로벌 기술 공급망의 핵심 변수입니다.',
    korea: '한국 반도체 기업 실적·수출 비중에 직접 영향 가능성.',
    watch: '주요 기업 실적 발표와 각국 보조금·규제 정책 확인 필요.',
  },
  {
    re: /\bAI\b|인공지능|생성형 ?AI/i,
    why: 'AI 기술·정책 변화는 산업 구조와 일자리에 영향을 줄 가능성이 있습니다.',
    korea: null,
    watch: '실제 제품 출시·규제 입법의 구체 내용 확인 필요.',
  },
  {
    re: /(선거|대선|총선|탄핵)/,
    why: '정치 일정의 결과는 정책 방향 전반을 바꿀 수 있습니다.',
    korea: null,
    watch: '공식 결과 발표와 이후 정책 발표 확인 필요.',
  },
  {
    re: /(지진|태풍|폭우|산불|재난)/,
    why: '재난은 인명·기반시설 피해와 복구 비용으로 이어질 가능성이 있습니다.',
    korea: null,
    watch: '피해 집계 공식 발표와 정부 대응 확인 필요.',
  },
];

const UNCERTAINTY_BY_CONFIDENCE = {
  low: '단일 출처 보도 단계 — 교차 확인 필요.',
  'primary-claim': '당사자 공식 발표 단계 — 독립 출처 검증 필요.',
  disputed: '출처 간 내용이 엇갈림 — 사실관계 확인 중.',
};

/**
 * 사건(+점수·신뢰도) → 브리핑 필드.
 * event: {headline, category, articles[], confidence, importanceScore, ...}
 */
export function buildBriefing(event) {
  const arts = event.articles || [];
  const titles = arts.map((a) => a.title).join(' ');

  // 확인된 사실 = 신뢰 출처의 '제목 수준 보도' 그대로 (생성하지 않음)
  const confirmedFacts = arts
    .filter((a) => ['wire', 'public', 'specialist'].includes(a.sourceType))
    .slice(0, 3)
    .map((a) => `${a.title} (${a.source})`);

  const whyItMatters = [];
  const koreaImpact = [];
  const whatToWatch = [];
  for (const t of TEMPLATES) {
    if (!t.re.test(titles)) continue;
    if (t.why && !whyItMatters.includes(t.why)) whyItMatters.push(t.why);
    if (t.korea && !koreaImpact.includes(t.korea)) koreaImpact.push(t.korea);
    if (t.watch && !whatToWatch.includes(t.watch)) whatToWatch.push(t.watch);
    if (whyItMatters.length >= 2) break; // 카드가 길어지지 않게 상위 규칙만
  }

  const uncertainty = [];
  const u = UNCERTAINTY_BY_CONFIDENCE[event.confidence];
  if (u) uncertainty.push(u);

  return {
    headline: event.headline,
    whatHappened: event.headline, // 제목 수준에서 확인된 내용만 — 세부를 단정하지 않음
    confirmedFacts,
    whyItMatters,
    koreaImpact,
    uncertainty,
    whatToWatch,
  };
}
