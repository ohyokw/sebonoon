import test from 'node:test';
import assert from 'node:assert/strict';
import { searchArchive, predictionKeywords, evidenceFor } from '../assets/modules/archive-search.js';
import { mergeArchiveDay } from '../scripts/lib/archive.mjs';

const archive = [
  { date: '2026-07-01', items: [ // v1 스키마
    { t: '반도체 수출 규제 완화 발표', s: '연합뉴스', c: 'business' },
    { t: '프로야구 순위 변동', s: 'KBS', c: 'korea' },
  ] },
  { date: '2026-07-03', items: [ // v2 스키마
    { id: 'evt-1', t: '반도체 대기업, 신규 파운드리 투자 확정', s: 'Reuters', u: 'https://x', p: '2026-07-03T01:00:00Z', c: 'tech', tr: 1 },
    { id: 'evt-2', t: '금리 동결 결정', s: '연합인포맥스', u: 'https://y', p: '', c: 'business', tr: 2 },
  ] },
];

test('14. 뉴스 아카이브 관련 기사 검색 — 기간·키워드·중복 제거', () => {
  const hits = searchArchive(archive, '반도체 투자가 3분기에 확대된다', '2026-07-01', '2026-07-31');
  assert.equal(hits.length, 2, 'v1·v2 항목 모두 검색');
  assert.ok(hits[0].t.includes('반도체'));
  // 기간 밖 제외
  const none = searchArchive(archive, '반도체 투자', '2026-07-02', '2026-07-31');
  assert.equal(none.length, 1); // 7/1 항목은 기간 밖 → 제외, 7/3만
  // 무관한 예측은 0건
  assert.equal(searchArchive(archive, '우주 발사체 성공', '2026-07-01', '2026-07-31').length, 0);
  // 키워드 추출: 조사 제거·불용어 필터
  assert.ok(predictionKeywords('환율이 1400원을 돌파한다').includes('환율'));
  assert.ok(!predictionKeywords('환율이 1400원을 돌파한다').includes('돌파'));
});

test('LLM 증거 — 관련 사건만 시간순 전달 (전체 아카이브 임의 샘플링 금지)', () => {
  const ev = evidenceFor(archive, '반도체 투자 확대', '2026-07-01', '2026-07-31');
  assert.equal(ev.length, 2);
  assert.ok(ev[0].startsWith('[2026-07-01]'), '시간순 정렬');
  assert.ok(ev.every((l) => l.includes('반도체')), '관련 항목만 포함');
});

test('아카이브 병합 — 같은 날짜를 덮어쓰지 않고 누적, 같은 사건은 갱신', () => {
  let arch = mergeArchiveDay([], '2026-07-05', [
    { id: 'e1', t: '첫 보도', s: 'A', c: 'world' },
  ]);
  // 같은 날 두 번째 실행: 새 사건 추가 + 기존 사건 업데이트
  arch = mergeArchiveDay(arch, '2026-07-05', [
    { id: 'e1', t: '첫 보도 (업데이트)', s: 'A', c: 'world' },
    { id: 'e2', t: '새 사건', s: 'B', c: 'korea' },
  ]);
  assert.equal(arch.length, 1);
  assert.equal(arch[0].items.length, 2, '누적 (덮어쓰기 아님)');
  assert.equal(arch[0].items.find((i) => i.id === 'e1').t, '첫 보도 (업데이트)');
  // 60일 초과분은 잘려나감
  let long = [];
  for (let i = 0; i < 65; i++) {
    const d = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
    long = mergeArchiveDay(long, d, [{ t: `day ${i}`, s: 'A', c: 'world' }]);
  }
  assert.equal(long.length, 60);
});
