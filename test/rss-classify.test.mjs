import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRss, decodeEntities } from '../scripts/lib/rss.mjs';
import { categorize, excludedTitle } from '../scripts/lib/classify.mjs';

test('4. RSS 파싱 — source 태그·제목 접미사·CDATA·엔티티 처리', () => {
  const xml = `<rss><channel>
    <item><title><![CDATA[첫 기사 제목]]></title><source url="u">연합뉴스</source><link>https://a</link><pubDate>Mon, 01 Jul 2026 01:00:00 GMT</pubDate></item>
    <item><title>구글식 제목이 길게 이어진다 - 뉴시스</title><link>https://b</link><pubDate></pubDate></item>
    <item><title>AT&amp;T &quot;quote&quot; &#44608;</title><source>BBC</source><link>https://c</link></item>
  </channel></rss>`;
  const items = parseRss(xml);
  assert.equal(items.length, 3);
  assert.deepEqual(items[0], { title: '첫 기사 제목', link: 'https://a', source: '연합뉴스', pubDate: 'Mon, 01 Jul 2026 01:00:00 GMT' });
  // Google News: 제목 끝 " - 매체명"에서 매체 분리
  assert.equal(items[1].title, '구글식 제목이 길게 이어진다');
  assert.equal(items[1].source, '뉴시스');
  // 엔티티 디코딩
  assert.equal(items[2].title, 'AT&T "quote" 김');
  assert.equal(decodeEntities('&lt;b&gt;'), '<b>');
});

test('5. 뉴스 카테고리 분류 — 키워드 규칙', () => {
  assert.equal(categorize('한국은행 기준금리 동결 결정'), 'business');
  assert.equal(categorize('생성형 AI 규제 법안 통과'), 'ai');
  assert.equal(categorize('비트코인 사상 최고가 경신'), 'crypto');
  assert.equal(categorize('국내 연구진, 신약 후보물질 논문 발표'), 'science');
  assert.equal(categorize('국회, 예산안 처리'), 'korea');
  assert.equal(categorize('알 수 없는 제목', 'world'), 'world'); // 기본값
});

test('6. 스포츠·연예·생활성 기사 제외 — 사유별 규칙 분리', () => {
  assert.deepEqual(excludedTitle('프로야구 KBO 순위 경쟁 치열'), { excluded: true, reason: 'sports' });
  assert.deepEqual(excludedTitle('인기 아이돌 그룹 컴백 발표'), { excluded: true, reason: 'entertainment' });
  assert.deepEqual(excludedTitle('오늘의 운세 — 별자리별 총운'), { excluded: true, reason: 'lifestyle' });
  // 정상 뉴스는 통과
  assert.equal(excludedTitle('미 연준 기준금리 인하').excluded, false);
  assert.equal(excludedTitle('반도체 수출 규제 완화').excluded, false);
});
