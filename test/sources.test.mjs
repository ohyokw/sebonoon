import test from 'node:test';
import assert from 'node:assert/strict';
import { filterAllowed, isAllowedSource, matchSource, sourceMeta, SOURCES } from '../scripts/lib/sources.mjs';

test('1. 허용 출처 필터 — 화이트리스트 매체만 통과한다', () => {
  const items = [
    { title: 'a', source: '연합뉴스' },
    { title: 'b', source: 'KBS 뉴스' },
    { title: 'c', source: 'Reuters' },
    { title: 'd', source: '어딘가일보' },
  ];
  const out = filterAllowed(items);
  assert.deepEqual(out.map((i) => i.title), ['a', 'b', 'c']);
});

test('2. 허용되지 않은 출처 차단 — 미등록 매체는 모두 걸러진다', () => {
  assert.equal(isAllowedSource('아무개닷컴'), false);
  assert.equal(isAllowedSource(''), false);
  assert.equal(isAllowedSource(null), false);
  assert.equal(sourceMeta('아무개닷컴').type, 'unknown');
  // 유사 이름도 부분 일치가 아니면 차단
  assert.equal(isAllowedSource('연합'), false);
});

test('3. 출처가 부족해도 필터가 우회되지 않는다 — 1건이면 1건, 0건이면 빈 배열', () => {
  const one = [
    { title: 'ok', source: '연합뉴스' },
    { title: 'x1', source: '블로그뉴스' },
    { title: 'x2', source: '개인미디어' },
    { title: 'x3', source: '알수없음' },
  ];
  assert.deepEqual(filterAllowed(one).map((i) => i.title), ['ok']); // 3건 미만이어도 전체로 폴백하지 않음
  const zero = [{ title: 'x', source: '블로그뉴스' }];
  assert.deepEqual(filterAllowed(zero), []);
});

test('출처 레지스트리 — 모든 항목에 type/tier/categories가 있다', () => {
  const TYPES = ['primary', 'wire', 'public', 'specialist', 'signal'];
  for (const s of SOURCES) {
    assert.ok(TYPES.includes(s.type), `${s.id}: type ${s.type}`);
    assert.ok(Number.isInteger(s.tier), `${s.id}: tier`);
    assert.ok(Array.isArray(s.categories) && s.categories.length, `${s.id}: categories`);
  }
  // primary는 당사자 발표로 별도 취급됨을 보장 (KTV)
  assert.equal(matchSource('KTV')?.type, 'primary');
});
