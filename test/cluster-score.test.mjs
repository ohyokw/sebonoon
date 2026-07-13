import test from 'node:test';
import assert from 'node:assert/strict';
import { normTitle, tokenize, signatureOf, similarity, clusterEvents } from '../scripts/lib/cluster.mjs';
import { scoreImportance, assessConfidence } from '../scripts/lib/score.mjs';

test('7. 동일 사건 제목 정규화 — 장식 제거·토큰화로 같은 사건이 비슷해진다', () => {
  assert.equal(normTitle('[속보] 미 연준, 기준금리 인하!'), '미 연준 기준금리 인하');
  assert.equal(normTitle('미 연준 기준금리 인하 (종합)'), '미 연준 기준금리 인하');
  const a = signatureOf('[속보] 미 연준, 기준금리 0.25%p 인하 결정');
  const b = signatureOf('미국 연준 기준금리 0.25%p 인하…시장 반응 (종합)');
  const c = signatureOf('국내 연구진 신약 후보물질 발견');
  assert.ok(similarity(a, b) > similarity(a, c), '같은 사건이 더 유사해야 함');
  assert.ok(similarity(a, b) >= 0.4, `same-event similarity ${similarity(a, b)}`);
  assert.ok(tokenize('미 연준, 기준금리 인하').has('기준금리'));
});

test('8. 사건 클러스터링 — 같은 사건 묶기 + 안정적 ID', () => {
  const articles = [
    { title: '미 연준, 기준금리 0.25%포인트 인하 결정', source: '연합뉴스', pubDate: '', category: 'world', sourceType: 'wire', tier: 1 },
    { title: '미 연준 기준금리 0.25%포인트 인하…시장 반응 주목', source: 'KBS', pubDate: '', category: 'world', sourceType: 'public', tier: 1 },
    { title: '국내 연구진, 신약 후보물질 발견', source: '연합뉴스', pubDate: '', category: 'science', sourceType: 'wire', tier: 1 },
  ];
  const events = clusterEvents(articles);
  assert.equal(events.length, 2, '연준 2건은 한 사건으로, 신약은 별도 사건으로');
  const fed = events.find((e) => e.articles.length === 2);
  assert.ok(fed, '두 기사가 묶인 사건이 있어야 함');
  assert.deepEqual(fed.articles.map((a) => a.source).sort(), ['KBS', '연합뉴스']);
  assert.match(fed.id, /^evt-world-/);
  // 안정성: 같은 입력이면 같은 ID
  const again = clusterEvents(articles);
  assert.equal(again.find((e) => e.articles.length === 2).id, fed.id);
});

test('사건 대표 기사 — 제목과 링크가 같은 기사를 가리킨다 (tier 우선)', () => {
  // 낮은 등급 기사가 먼저 수집되어도 headline과 articles[0]이 같은(tier 1) 기사여야 함
  const events = clusterEvents([
    { title: '미 연준 기준금리 0.25%포인트 인하…시장 반응', source: 'YTN', pubDate: '', category: 'world', sourceType: 'public', tier: 2, link: 'https://ytn.example/a' },
    { title: '미 연준, 기준금리 0.25%포인트 인하 결정', source: '연합뉴스', pubDate: '', category: 'world', sourceType: 'wire', tier: 1, link: 'https://yna.example/b' },
  ]);
  const ev = events.find((e) => e.articles.length === 2);
  assert.ok(ev);
  assert.equal(ev.headline, ev.articles[0].title, '카드 제목 = 첫 기사(링크 대상) 제목');
  assert.equal(ev.articles[0].source, '연합뉴스');
  assert.equal(ev.articles[0].url, 'https://yna.example/b');
});

test('고유명사 추출 — 라틴 국가 토큰은 단어 경계로만 매칭', async () => {
  const { entitiesOf } = await import('../scripts/lib/cluster.mjs');
  assert.ok(entitiesOf('EU summit reaches deal').has('eu'));
  assert.ok(!entitiesOf('Museum reopens after renovation').has('eu'), 'museum의 eu는 오탐');
  assert.ok(!entitiesOf('Reuters exclusive report').has('eu'), 'Reuters의 eu는 오탐');
});

test('9. 중요도 점수 — 다출처·파급력 사건이 높고, 이유가 저장된다', () => {
  const big = {
    category: 'world',
    headline: '미 연준 기준금리 인하',
    articles: [
      { title: '미 연준 기준금리 인하', source: '연합뉴스', sourceId: 'yonhap', sourceType: 'wire', tier: 1, publishedAt: new Date().toISOString() },
      { title: '연준 금리 인하에 시장 환영', source: 'Reuters', sourceId: 'reuters', sourceType: 'wire', tier: 1, publishedAt: new Date().toISOString() },
      { title: '금리 인하와 한국 경제', source: 'KBS', sourceId: 'kbs', sourceType: 'public', tier: 1, publishedAt: new Date().toISOString() },
    ],
  };
  const small = {
    category: 'tech',
    headline: '스타트업, 사진 앱 출시',
    articles: [{ title: '스타트업, 사진 앱 출시', source: 'CoinDesk', sourceId: 'coindesk', sourceType: 'specialist', tier: 3, publishedAt: '' }],
  };
  const sb = scoreImportance(big), ss = scoreImportance(small);
  assert.ok(sb.importanceScore > ss.importanceScore);
  assert.ok(sb.importanceReasons.includes('3개 독립 출처'));
  assert.ok(sb.importanceReasons.some((r) => r.includes('경제')));
  // 클릭 유도성 감점
  const bait = scoreImportance({ category: 'world', headline: '충격적인 소식', articles: [{ title: '충격적인 소식', source: 'YTN', sourceId: 'ytn', tier: 2, publishedAt: '' }] });
  assert.ok(bait.importanceReasons.some((r) => r.includes('클릭 유도')));
});

test('신뢰도 — 출처 수·유형에 따라 등급과 이유가 결정된다', () => {
  const mk = (arts) => assessConfidence({ articles: arts });
  const three = mk([
    { title: 't1', source: '연합뉴스', sourceId: 'yonhap', sourceType: 'wire' },
    { title: 't2', source: 'Reuters', sourceId: 'reuters', sourceType: 'wire' },
    { title: 't3', source: 'BBC', sourceId: 'bbc', sourceType: 'public' },
  ]);
  assert.equal(three.confidence, 'high');
  assert.equal(mk([
    { title: 't1', source: '연합뉴스', sourceId: 'yonhap', sourceType: 'wire' },
    { title: 't2', source: 'KBS', sourceId: 'kbs', sourceType: 'public' },
  ]).confidence, 'medium');
  assert.equal(mk([{ title: 't', source: '연합뉴스', sourceId: 'yonhap', sourceType: 'wire' }]).confidence, 'low');
  // 당사자 발표만 → primary-claim (사실 확정이 아니라 공식 주장)
  const pc = mk([{ title: '정부 정책 발표', source: 'KTV', sourceId: 'ktv', sourceType: 'primary' }]);
  assert.equal(pc.confidence, 'primary-claim');
  assert.ok(pc.confidenceReasons[0].includes('독립 검증 없음'));
  // 출처 충돌 → disputed
  const disp = mk([
    { title: 'A사, 인수 합의 발표', source: '연합뉴스', sourceId: 'yonhap', sourceType: 'wire' },
    { title: 'B사, 인수설 부인', source: 'Reuters', sourceId: 'reuters', sourceType: 'wire' },
  ]);
  assert.equal(disp.confidence, 'disputed');
});
