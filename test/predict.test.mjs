import test from 'node:test';
import assert from 'node:assert/strict';
import { normDay, metricSeries, judgeMetric, predStats, mergeImported, exportPayload } from '../assets/modules/predict-core.js';
import { mergeHistoryEntry, dayHigh, dayLow, dayClose } from '../scripts/lib/history.mjs';

const hist = [
  { date: '2026-07-01', usdkrw: 1380 },                                              // 구버전(숫자) 호환
  { date: '2026-07-02', usdkrw: { o: 1382, h: 1401, l: 1379, c: 1385, n: 4, at: '' } }, // 장중 1401 도달 후 종가 미달
  { date: '2026-07-03', usdkrw: { o: 1385, h: 1390, l: 1362, c: 1370, n: 4, at: '' } },
];

test('12. 시장 예측 >=, <= 판정', () => {
  const series = metricSeries(hist, 'usdkrw');
  // >= 1395: 7/2 고가 1401로 적중
  const up = judgeMetric({ created: '2026-07-01T00:00:00Z', due: '2026-07-05', op: '>=', target: 1395 }, series, '2026-07-04');
  assert.equal(up.state, 'hit');
  assert.equal(up.touchedDate, '2026-07-02');
  // <= 1365: 7/3 저가 1362로 적중
  const down = judgeMetric({ created: '2026-07-01T00:00:00Z', due: '2026-07-05', op: '<=', target: 1365 }, series, '2026-07-04');
  assert.equal(down.state, 'hit');
  // >= 1500: 미도달 + 기한 전 → open, 기한 후 → miss
  const p = { created: '2026-07-01T00:00:00Z', due: '2026-07-03', op: '>=', target: 1500 };
  assert.equal(judgeMetric(p, series, '2026-07-03').state, 'open');
  assert.equal(judgeMetric(p, series, '2026-07-04').state, 'miss');
});

test('13. 일중 최고·최저값 판정 — 종가만 보면 놓치는 도달을 잡는다', () => {
  const series = metricSeries(hist, 'usdkrw');
  // 종가는 1385(<1400)지만 장중 고가 1401 → 적중이어야 함
  const intraday = judgeMetric({ created: '2026-07-02T00:00:00Z', due: '2026-07-02', op: '>=', target: 1400 }, series, '2026-07-05');
  assert.equal(intraday.state, 'hit');
  // 구버전 숫자 스키마는 o=h=l=c로 해석
  assert.deepEqual(normDay(1380), { o: 1380, h: 1380, l: 1380, c: 1380 });
  // 데이터 부족: 기간에 데이터가 없으면 miss가 아닌 data-insufficient
  const gap = judgeMetric({ created: '2026-06-01T00:00:00Z', due: '2026-06-20', op: '>=', target: 1400 }, series, '2026-07-05');
  assert.equal(gap.state, 'data-insufficient');
  // 실시간 값 병합: 오늘 고가에 반영
  const withLive = metricSeries(hist, 'usdkrw', 1410, '2026-07-03');
  assert.equal(withLive[withLive.length - 1].h, 1410);
});

test('OHLC 히스토리 병합 — 같은 날 재수집이 고가/저가로 누적된다', () => {
  let h = mergeHistoryEntry([], '2026-07-04', { usdkrw: 1390, btc: 100000 }, 'T1');
  h = mergeHistoryEntry(h, '2026-07-04', { usdkrw: 1402, btc: 99000 }, 'T2');
  h = mergeHistoryEntry(h, '2026-07-04', { usdkrw: 1388, btc: 101000 }, 'T3');
  const day = h.find((r) => r.date === '2026-07-04');
  assert.equal(dayHigh(day.usdkrw), 1402);
  assert.equal(dayLow(day.usdkrw), 1388);
  assert.equal(dayClose(day.usdkrw), 1388);
  assert.equal(day.usdkrw.o, 1390);
  assert.equal(day.usdkrw.n, 3);
  assert.equal(dayHigh(day.btc), 101000);
  // 구버전 행과 섞여도 병합 가능
  const mixed = mergeHistoryEntry([{ date: '2026-07-03', usdkrw: 1380 }], '2026-07-03', { usdkrw: 1400 }, 'T4');
  assert.equal(dayHigh(mixed[0].usdkrw), 1400);
  assert.equal(mixed[0].usdkrw.o, 1380);
});

test('15. 잘못된 JSON 가져오기 처리 — 파싱 실패·형식 오류·중복·불량 항목', () => {
  const existing = [{ id: 'a', text: '기존 예측', conf: 60, due: '2026-08-01', created: '2026-07-01', resolved: null }];
  // 잘못된 JSON → 명확한 오류
  assert.throws(() => mergeImported(existing, '{not json'), /JSON 파싱 실패/);
  // 배열/predictions 아님 → 형식 오류
  assert.throws(() => mergeImported(existing, '{"foo": 1}'), /형식 오류/);
  // 신버전 래핑 형식 + 중복 ID 갱신 + 불량 항목 건너뜀
  const payload = exportPayload([
    { id: 'a', text: '갱신된 예측', conf: 70, due: '2026-08-01', created: '2026-07-01', resolved: null },
    { id: 'b', text: '새 예측', conf: 55, due: '2026-09-01', created: '2026-07-02', resolved: null },
    { id: 'c', text: '기한 형식이 잘못됨', conf: 55, due: '언젠가', created: '', resolved: null },
    null,
  ]);
  const r = mergeImported(existing, JSON.stringify(payload));
  assert.equal(r.added, 1);
  assert.equal(r.updated, 1);
  assert.equal(r.skipped, 2);
  assert.equal(r.merged.length, 2);
  assert.equal(r.merged.find((p) => p.id === 'a').text, '갱신된 예측');
  // 구버전(순수 배열) 형식도 지원
  const legacy = mergeImported([], JSON.stringify([{ id: 'z', text: 't', due: '2026-08-01' }]));
  assert.equal(legacy.added, 1);
});

test('예측 통계 — 적중률·브라이어', () => {
  const s = predStats([
    { resolved: 'hit', conf: 80 },
    { resolved: 'miss', conf: 60 },
    { resolved: null, conf: 50 },
  ]);
  assert.equal(s.open, 1);
  assert.equal(s.resolved, 2);
  assert.equal(s.hitRate, 50);
  assert.ok(Math.abs(s.brier - ((0.2 ** 2 + 0.6 ** 2) / 2)) < 1e-9);
});
