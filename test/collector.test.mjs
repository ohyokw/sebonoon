/**
 * 수집기 통합 테스트 — fixture로 네트워크 없이 collect.mjs 전체를 실행합니다.
 * 단계 13 수집 시나리오: 전체 성공 / 일부 소스 실패 / Google News 실패 /
 * 시장 API 일부 실패 / 트렌드 실패 / 전체 실패 / 허용 출처 0건 / 중복 다수 / 오래된 기사만
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFixtures, defaultFeeds, rssXml } from './helpers/fixtures.mjs';

const run = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COLLECT = join(ROOT, 'scripts', 'collect.mjs');

async function collect(fixtures, dataDir) {
  return run(process.execPath, [COLLECT], {
    env: { ...process.env, SEBONOON_FIXTURES: fixtures, SEBONOON_DATA_DIR: dataDir },
  });
}
const readJson = async (dir, f) => JSON.parse(await readFile(join(dir, f), 'utf8'));
const tmp = () => mkdtemp(join(tmpdir(), 'sebonoon-'));

test('수집 전체 성공 — latest/last-good/status/history/archive 생성 + 출처 정책 준수', async () => {
  const fix = await buildFixtures(await tmp());
  const data = await tmp();
  const { stdout } = await collect(fix, data);
  assert.match(stdout, /품질: 통과/);

  const latest = await readJson(data, 'latest.json');
  const status = await readJson(data, 'status.json');
  assert.equal(latest.schemaVersion, 2);
  assert.equal(status.status, 'ok');
  assert.equal(status.quality.passed, true);
  assert.ok(status.lastSuccessAt);

  // 허용 출처만 포함 (한국어 GN 피드의 미등록 매체는 걸러짐)
  const krSections = ['world', 'korea', 'business', 'tech', 'science', 'ai', 'crypto', 'wealth'];
  const badSources = ['스포츠서울', 'OSEN', '여행매거진', '조선일보'];
  for (const cat of krSections) {
    for (const it of latest.news[cat] || []) {
      assert.ok(!badSources.includes(it.source), `${cat}에 미등록 매체 ${it.source} 포함`);
    }
  }
  // 스포츠·연예 제목 제외
  const allTitles = Object.values(latest.news).flat().map((it) => it.title).join(' ');
  assert.ok(!allTitles.includes('열애설'));
  assert.ok(!allTitles.includes('KBO'));

  // 사건·브리핑·신호 분리
  assert.ok(Array.isArray(latest.events) && latest.events.length > 0);
  const ev = latest.events[0];
  assert.ok(ev.id && ev.headline && ev.briefing);
  assert.ok(typeof ev.importanceScore === 'number' && Array.isArray(ev.importanceReasons));
  assert.ok(['high', 'medium', 'low', 'primary-claim', 'disputed'].includes(ev.confidence));
  assert.ok(latest.top5.length >= 1 && latest.top5.length <= 5);
  assert.ok(Array.isArray(latest.developerSignal) && latest.developerSignal.length === 3);
  assert.ok(Array.isArray(latest.publicAttentionSignal) && latest.publicAttentionSignal.length === 2);

  // OHLC 히스토리
  const history = await readJson(data, 'history.json');
  const day = history[history.length - 1];
  assert.equal(typeof day.usdkrw.c, 'number');
  assert.ok(day.usdkrw.h >= day.usdkrw.l);

  // 아카이브 v2 (사건 ID·URL 보존)
  const archive = await readJson(data, 'news-archive.json');
  assert.ok(archive[0].items.every((it) => it.id && it.t));
});

test('11. 부분 실패 시 정상 데이터 보존 — 품질 불합격이면 latest.json을 덮어쓰지 않는다', async () => {
  const data = await tmp();
  // 1차: 전체 성공
  await collect(await buildFixtures(await tmp()), data);
  const before = await readJson(data, 'latest.json');
  const successAt = (await readJson(data, 'status.json')).lastSuccessAt;

  // 2차: 전체 실패 (fixture 전부 제거 = 모든 소스 다운)
  const emptyFix = await tmp();
  await mkdir(emptyFix, { recursive: true });
  await writeFile(join(emptyFix, 'map.json'), '[]');
  const { stdout } = await collect(emptyFix, data);
  assert.match(stdout, /품질: 불합격/);
  assert.match(stdout, /기존 latest\.json.*유지/);

  const after = await readJson(data, 'latest.json');
  assert.deepEqual(after, before, 'latest.json이 빈 데이터로 교체되면 안 됨');
  const status = await readJson(data, 'status.json');
  assert.equal(status.status, 'failed');
  assert.equal(status.lastSuccessAt, successAt, '마지막 정상 시각 유지');
  assert.ok(status.errors.length > 0);
  assert.ok(status.quality.reasons.length > 0, '실패 이유가 기록됨');
});

test('일부 소스 실패(BBC·트렌드·시장 일부) — 게이트 통과, 상태 partial', async () => {
  const fix = await buildFixtures(await tmp(), {
    omit: ['bbc-world', 'bbc-biz', 'bbc-tech', 'trends', 'yahoo-kospi'],
  });
  const data = await tmp();
  const { stdout } = await collect(fix, data);
  assert.match(stdout, /품질: 통과/);
  const status = await readJson(data, 'status.json');
  assert.equal(status.status, 'partial');
  const latest = await readJson(data, 'latest.json');
  assert.equal(latest.publicAttentionSignal.length, 0);
  assert.equal(latest.markets.indices.kospi, null);
  assert.ok(latest.markets.indices.sp500);
});

test('Google News 전체 실패 — 연합뉴스 직접 RSS만으로도 게이트 판단이 명확하다', async () => {
  const gnKeys = defaultFeeds().filter((f) => f.match.includes('google.com') || f.match.includes('%')).map((f) => f.key);
  const fix = await buildFixtures(await tmp(), { omit: gnKeys });
  const data = await tmp();
  const { stdout } = await collect(fix, data);
  const status = await readJson(data, 'status.json');
  // 세계/한국/경제는 연합뉴스로 최소 확보 → 통과하되 오류 다수로 partial,
  // 미달이면 failed — 어느 쪽이든 결과와 이유가 명시적이어야 한다
  assert.ok(['partial', 'failed'].includes(status.status));
  assert.ok(status.quality.reasons.length > 0);
  assert.match(stdout, /출처: 성공 \d+ \/ 실패 \d+/);
});

test('허용 출처 0건 — 필터를 우회하지 않고 불합격 처리', async () => {
  // 모든 한국어 GN 피드가 미등록 매체 기사만 반환하고, 직접 RSS는 실패
  const untrusted = rssXml([
    { title: '어떤 사건 A', source: '무명닷컴' },
    { title: '어떤 사건 B', source: '개인블로그' },
    { title: '어떤 사건 C', source: '알수없는신문' },
  ]);
  const replace = {};
  for (const k of ['gn-home', 'gn-world', 'gn-biz', 'gn-tech', 'gn-sci', 'gn-ai', 'gn-crypto', 'gn-wealth']) replace[k] = untrusted;
  const fix = await buildFixtures(await tmp(), {
    omit: ['yna-news', 'yna-intl', 'yna-econ', 'gn-reuters-ai', 'gn-reuters-biz', 'gn-reuters-world', 'gn-ap', 'bbc-world', 'bbc-biz', 'bbc-tech', 'mittr', 'science', 'nature', 'coindesk'],
    replace,
  });
  const data = await tmp();
  const { stdout } = await collect(fix, data);
  assert.match(stdout, /품질: 불합격/);
  const status = await readJson(data, 'status.json');
  assert.equal(status.status, 'failed');
  // latest.json 자체가 생성되지 않아야 함 (첫 실행이므로)
  await assert.rejects(readJson(data, 'latest.json'));
});

test('오래된 기사만 존재 — 신선도 감점이 기록된다', async () => {
  const old = (title, source) => ({ title, source, hoursAgo: 30 * 24 });
  const feeds = defaultFeeds();
  const replace = {};
  for (const f of feeds) {
    if (!f.file.endsWith('.xml') || f.key === 'trends') continue;
    replace[f.key] = rssXml([
      old(`${f.key} 오래된 기사 1`, '연합뉴스'), old(`${f.key} 오래된 기사 2`, 'KBS'), old(`${f.key} 오래된 기사 3`, '뉴시스'),
    ]);
  }
  const fix = await buildFixtures(await tmp(), { replace });
  const data = await tmp();
  await collect(fix, data);
  const status = await readJson(data, 'status.json');
  assert.ok(status.quality.reasons.some((r) => r.includes('72시간')), status.quality.reasons.join(' | '));
});

test('중복 사건 다수 — 클러스터링이 한 사건으로 묶고 중복 감점을 기록', async () => {
  const dupXml = rssXml([
    { title: '미 연준 기준금리 0.25%포인트 인하 결정', source: '연합뉴스' },
    { title: '미 연준, 기준금리 0.25%포인트 인하', source: 'KBS' },
    { title: '미 연준 기준금리 0.25%포인트 인하…시장 반응', source: 'YTN' },
  ]);
  const fix = await buildFixtures(await tmp(), { replace: { 'gn-world': dupXml } });
  const data = await tmp();
  await collect(fix, data);
  const latest = await readJson(data, 'latest.json');
  const fed = latest.events.find((e) => e.articles.length >= 2 && e.headline.includes('연준'));
  assert.ok(fed, '연준 기사들이 한 사건으로 클러스터링되어야 함');
  assert.ok(['medium', 'high'].includes(fed.confidence), `${fed.confidence} (${fed.articles.length}개 기사)`);
});
