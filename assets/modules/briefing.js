/** 데이터 상태 표시줄 + 오늘의 핵심 5가지 + 어제 이후 달라진 내용 (사건 브리핑 렌더) */
import { $, esc, fmt } from './dom.js';

const CONFIDENCE_LABEL = {
  high: '교차 확인',
  medium: '2개 출처',
  low: '단일 출처',
  'primary-claim': '당사자 발표',
  disputed: '내용 충돌',
};

/**
 * 2. 마지막 정상 업데이트 시각과 데이터 상태.
 * 상태 구분: 정상(ok) / 일부 실패(partial) / 수집 지연·실패(failed·오래됨) / 로딩 실패
 */
export function renderStatus(status, data) {
  const el = $('dataStatus');
  if (!status && !data) { el.hidden = true; return; }
  el.hidden = false;

  const lastGood = status?.lastSuccessAt || data?.generatedAt || '';
  const ageH = lastGood ? (Date.now() - Date.parse(lastGood)) / 3600_000 : null;
  const staleByAge = ageH != null && ageH > 26; // 하루 4회 수집 기준, 하루 넘게 갱신 없음

  let dot = 'ok', label = '<b>데이터 정상</b>';
  if (status?.status === 'failed' || staleByAge) {
    dot = 'crit';
    label = '<b>수집 지연</b> — 마지막 정상 데이터를 표시 중';
  } else if (status?.status === 'partial') {
    dot = 'warn';
    label = '<b>일부 출처 실패</b> — 표시 데이터는 품질 기준 통과';
  }
  const when = lastGood ? `마지막 정상 수집 ${fmt.kstTime(lastGood)} KST` : '수집 기록 없음';
  const score = status?.quality?.score;
  const reasons = (status?.quality?.reasons || []).join(' · ');
  el.innerHTML = `<span class="dot ${dot}"></span> ${label}
    <span>· ${esc(when)}</span>
    ${score != null ? `<span title="${esc(reasons)}">· 품질 ${score}점</span>` : ''}
    <span>· 하루 4회 수집 (KST 06:17·12:17·18:17·23:17)</span>`;
}

const eventById = (data) => new Map((data?.events || []).map((ev) => [ev.id, ev]));

/* 값이 있을 때만 블록을 출력 — 빈 문장을 생성하지 않음 */
const row = (k, text) => text ? `<div><span class="k">${k}</span><span>${esc(text)}</span></div>` : '';

function eventCard(ev, rank) {
  const b = ev.briefing || {};
  const rep = (ev.articles || [])[0];
  const srcN = new Set((ev.articles || []).map((a) => a.source)).size;
  const facts = (b.confirmedFacts || []).slice(0, 2);
  return `<article class="evcard">
    <div class="evhead">
      <span class="evrank">${rank}</span>
      <a class="evtitle" href="${esc(rep?.url || '#')}" target="_blank" rel="noopener">${esc(ev.headline)}</a>
      <span class="evmeta">
        <span class="cbadge ${esc(ev.confidence)}" title="${esc((ev.confidenceReasons || []).join(' · '))}">${CONFIDENCE_LABEL[ev.confidence] || esc(ev.confidence)}</span>
        <span title="중요도 ${ev.importanceScore}점 — ${esc((ev.importanceReasons || []).join(' · '))}">출처 ${srcN}</span>
        ${ev.updatedAt ? `<span>${fmt.rel(ev.updatedAt)}</span>` : ''}
      </span>
    </div>
    <div class="evrows">
      ${facts.map((f) => row('사실', f)).join('')}
      ${row('의미', (b.whyItMatters || [])[0])}
      ${row('한국', (b.koreaImpact || [])[0])}
      ${row('유의', (b.uncertainty || [])[0])}
      ${row('주시', (b.whatToWatch || [])[0])}
    </div>
    ${(ev.articles || []).length ? `<details class="evsrcs">
      <summary>출처 ${srcN}개 펼쳐보기</summary>
      ${ev.articles.map((a) => `<div>· <a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.title)}</a>
        <span class="d">${esc(a.source)}${a.sourceType === 'primary' ? ' — 당사자 발표' : ''}${a.publishedAt ? ` · ${fmt.rel(a.publishedAt)}` : ''}</span></div>`).join('')}
    </details>` : ''}
  </article>`;
}

/** 3. 오늘 반드시 알아야 할 5가지 — events/top5가 없는 구버전 데이터면 섹션 숨김 */
export function renderTop5(data) {
  const sec = $('sec-top5');
  const ids = data?.top5 || [];
  const byId = eventById(data);
  const evs = ids.map((id) => byId.get(id)).filter(Boolean);
  if (!evs.length) { sec.hidden = true; return; }
  sec.hidden = false;
  $('top5').innerHTML = evs.map((ev, i) => eventCard(ev, i + 1)).join('');
}

/** 4. 어제 이후 달라진 내용 — 새로 등장한 사건 (없으면 섹션 숨김) */
export function renderChanged(data) {
  const sec = $('sec-changed');
  const byId = eventById(data);
  const evs = (data?.changedSinceYesterday || []).map((id) => byId.get(id)).filter(Boolean);
  if (!evs.length) { sec.hidden = true; return; }
  sec.hidden = false;
  $('changedList').innerHTML = evs.map((ev) => {
    const rep = (ev.articles || [])[0];
    return `<li>
      <span class="nsec">${esc(ev.category)}</span>
      <a class="t" href="${esc(rep?.url || '#')}" target="_blank" rel="noopener" title="${esc(ev.headline)}">${esc(ev.headline)}</a>
    </li>`;
  }).join('');
}
