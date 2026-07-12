import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSnapshot } from '../scripts/lib/quality.mjs';

const mkItems = (n, src = '연합뉴스', hoursAgo = 2) =>
  Array.from({ length: n }, (_, i) => ({
    title: `기사 제목 ${src} ${i}`,
    source: src,
    link: `https://example.com/${src}/${i}`,
    pubDate: new Date(Date.now() - hoursAgo * 3600_000).toUTCString(),
  }));

const goodSnapshot = () => ({
  date: new Date().toISOString().slice(0, 10),
  generatedAt: new Date().toISOString(),
  news: {
    world: [...mkItems(4, '연합뉴스'), ...mkItems(2, 'KBS')],
    korea: [...mkItems(4, '뉴시스'), ...mkItems(2, 'YTN')],
    business: mkItems(5, '연합인포맥스'),
    tech: mkItems(3, 'Reuters'),
  },
  markets: { fx: { rates: { KRW: 1380 } }, crypto: { btc: {} }, indices: {} },
  errors: [],
});

test('10. 품질 게이트 — 정상 스냅샷은 통과, 결함 스냅샷은 불합격', () => {
  const good = evaluateSnapshot(goodSnapshot());
  assert.equal(good.passed, true, good.reasons.join(' | '));
  assert.ok(good.score >= 70);

  // 전체 실패(빈 뉴스) → 불합격
  const empty = evaluateSnapshot({ ...goodSnapshot(), news: { world: [], korea: [], business: [] } });
  assert.equal(empty.passed, false);
  assert.ok(empty.reasons.some((r) => r.includes('불합격')));

  // 필수 필드 손상 → 불합격
  const badDate = evaluateSnapshot({ ...goodSnapshot(), date: 'unknown' });
  assert.equal(badDate.passed, false);

  // 이유가 항상 기록된다
  assert.ok(good.reasons.length >= 1);
});

test('품질 게이트 — 감점 규칙 (중복·오래된 기사·시장 실패·핵심 카테고리 부족)', () => {
  // 중복 다수
  const dup = goodSnapshot();
  dup.news.world = Array.from({ length: 8 }, () => mkItems(1)[0]);
  const rd = evaluateSnapshot(dup);
  assert.ok(rd.reasons.some((r) => r.includes('중복')), rd.reasons.join(' | '));

  // 오래된 기사만 존재 (모두 5일 전)
  const stale = goodSnapshot();
  for (const k of Object.keys(stale.news)) stale.news[k] = stale.news[k].map((it) => ({ ...it, pubDate: new Date(Date.now() - 120 * 3600_000).toUTCString() }));
  const rs = evaluateSnapshot(stale);
  assert.ok(rs.reasons.some((r) => r.includes('72시간')), rs.reasons.join(' | '));

  // 시장 데이터 전체 실패 → 감점 (단독으로는 불합격 아님)
  const noMkt = { ...goodSnapshot(), markets: { fx: null, crypto: null, indices: null } };
  const rm = evaluateSnapshot(noMkt);
  assert.ok(rm.score < 100);
  assert.ok(rm.reasons.some((r) => r.includes('시장')));

  // 핵심 카테고리 최소 미달
  const thin = goodSnapshot();
  thin.news.world = mkItems(1);
  const rt = evaluateSnapshot(thin);
  assert.ok(rt.reasons.some((r) => r.includes('world')));
});
