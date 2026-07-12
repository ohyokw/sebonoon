/** 뉴스 렌더링 — 섹션 리스트·신호·번역·관심사·검색 필터 */
import { $, esc, fmt } from './dom.js';
import { state } from './state.js';
import { loadWatch, saveWatch } from './storage.js';

export const SECTION_LABELS = {
  world: '세계', korea: '한국', business: '경제', ai: 'AI',
  tech: '기술', science: '과학', crypto: '블록체인', wealth: '재테크', hackernews: 'HN',
};

/** data.news + 개발자 신호 → [{title, link, source, pubDate, sec}] (관심사·검색의 대상) */
export function buildAllNews(data) {
  const out = [];
  for (const [k, list] of Object.entries(data?.news || {})) {
    for (const it of (list || [])) out.push({ ...it, sec: SECTION_LABELS[k] || k });
  }
  for (const it of (data?.developerSignal || data?.hackernews || [])) {
    out.push({ title: it.title, link: it.link, source: 'Hacker News', pubDate: '', sec: 'HN' });
  }
  return out;
}

/* ── 영어 제목 한국어 번역 (무료 MyMemory API, 캐시) ────────────────
   해외 소스를 그대로 유지하면서 한국어로 읽히게. 원문은 마우스오버(title)로 확인. */
const TRKEY = 'sebonoon.tr', TRON = 'sebonoon.trOn';
let TR = {}; try { TR = JSON.parse(localStorage.getItem(TRKEY)) || {}; } catch { /* 손상 무시 */ }
let trOn = localStorage.getItem(TRON) !== 'off'; // 기본 켜짐

export function isEnglish(s) {
  const t = String(s).replace(/\s/g, '');
  if (!t) return false;
  const han = (t.match(/[가-힣]/g) || []).length;
  return han / t.length < 0.15 && /[A-Za-z]{3,}/.test(s); // 한글 비율 낮고 영단어 있음
}
const trText = (t) => (trOn && TR[t] && TR[t] !== t) ? TR[t] : t; // 표시 제목
const trCls = (t) => (trOn && TR[t] && TR[t] !== t) ? ' tr' : '';

async function translateOne(text) {
  const r = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|ko`);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const ko = (await r.json())?.responseData?.translatedText;
  if (!ko || /MYMEMORY WARNING|INVALID|QUOTA/i.test(ko)) throw new Error('번역 실패');
  return ko;
}

/** 화면의 영어 제목 중 미번역분을 번역해 캐시하고 반영 (동시 4개) */
export async function queueTranslations() {
  if (!trOn) { applyTranslations(); return; }
  const need = [...new Set(
    [...document.querySelectorAll('#sec-news .t[data-o], #sec-signals .t[data-o]')]
      .map((a) => a.dataset.o).filter((o) => isEnglish(o) && !(o in TR))
  )];
  applyTranslations(); // 캐시된 건 먼저 반영
  if (!need.length) return;
  let i = 0, changed = false;
  const worker = async () => {
    while (i < need.length) {
      const o = need[i++];
      try { TR[o] = await translateOne(o); changed = true; }
      catch { /* 실패분은 캐시하지 않음 → 다음 로드에 재시도 */ }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  if (changed) { try { localStorage.setItem(TRKEY, JSON.stringify(TR)); } catch {} applyTranslations(); }
}

/** data-o(원문)를 기준으로 현재 토글/캐시 상태에 맞게 제목 텍스트 갱신 */
export function applyTranslations() {
  document.querySelectorAll('#sec-news .t[data-o], #sec-signals .t[data-o]').forEach((a) => {
    const o = a.dataset.o;
    a.textContent = trText(o);
    a.classList.toggle('tr', trOn && !!TR[o] && TR[o] !== o);
  });
}

/**
 * 섹션 뉴스 리스트. shortage: 신뢰 출처 보도 부족 상태(sectionMeta) —
 * 기준을 낮춰 임의 매체를 채우는 대신 부족을 그대로 표시합니다.
 */
export function renderNewsList(elId, items, max = 10, shortage = false) {
  const el = $(elId);
  if (!items || !items.length) {
    el.innerHTML = shortage
      ? '<li class="empty">신뢰 출처 보도 부족 — 화이트리스트 기준을 낮추지 않습니다.</li>'
      : '<li class="empty">다음 수집(하루 4회) 후 표시됩니다.</li>';
    return;
  }
  el.innerHTML = items.slice(0, max).map((it) => `<li>
    <a class="t${trCls(it.title)}" data-o="${esc(it.title)}" href="${esc(it.link)}" target="_blank" rel="noopener" title="${esc(it.title)}${it.source ? ` — ${esc(it.source)}` : ''}">${esc(trText(it.title))}</a>
    <span class="s">${esc(it.source || '')}${it.pubDate ? ` · ${fmt.rel(it.pubDate)}` : ''}</span>
  </li>`).join('') + (shortage
    ? '<li class="empty shortage" title="화이트리스트 통과 기사가 목표보다 적습니다 — 기준을 낮춰 채우지 않습니다">⚠ 신뢰 출처 보도 부족</li>'
    : '');
}

/** 개발자 커뮤니티 관심 신호 (Hacker News) */
export function renderHN(items, max = 10) {
  const el = $('news-hn');
  if (!items || !items.length) {
    el.innerHTML = '<li class="empty">다음 수집(하루 4회) 후 표시됩니다.</li>';
    return;
  }
  el.innerHTML = items.slice(0, max).map((it) => `<li>
    <a class="t${trCls(it.title)}" data-o="${esc(it.title)}" href="${esc(it.link)}" target="_blank" rel="noopener" title="${esc(it.title)}">${esc(trText(it.title))}</a>
    <span class="s hnmeta">▲${fmt.num(it.points) ?? 0} · <a href="${esc(it.hnLink)}" target="_blank" rel="noopener">💬${fmt.num(it.comments) ?? 0}</a></span>
  </li>`).join('');
}

/** 대중 관심 신호 (Google Trends) */
export function renderTrends(items) {
  const el = $('trends');
  if (!items || !items.length) {
    el.innerHTML = '<div class="empty">아직 수집된 검색 트렌드가 없습니다.</div>';
    return;
  }
  el.innerHTML = items.map((t, i) => `<span class="chip">
    <span class="rank">${i + 1}</span>${esc(t.title)}${t.traffic ? `<span class="traffic">${esc(t.traffic)}</span>` : ''}
  </span>`).join('');
}

/* ── 관심사 워치리스트 + 전체 검색 필터 ── */
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 제목에서 매칭 키워드를 <mark>로 강조 (esc 후 안전 삽입) */
function highlight(title, kws) {
  let html = esc(title);
  for (const kw of kws) {
    if (!kw) continue;
    html = html.replace(new RegExp(`(${reEsc(esc(kw))})`, 'gi'), '<mark>$1</mark>');
  }
  return html;
}

export function renderWatch() {
  const kws = loadWatch();
  const card = $('watchCard');
  if (!kws.length) { card.hidden = true; return; }
  card.hidden = false;
  $('watchChips').innerHTML = kws.map((k, i) =>
    `<span class="wchip">${esc(k)}<button data-i="${i}" title="삭제" aria-label="${esc(k)} 삭제">×</button></span>`).join('');
  const lower = kws.map((k) => k.toLowerCase());
  const hits = state.allNews
    .filter((it) => lower.some((k) => it.title.toLowerCase().includes(k)))
    .sort((a, b) => (Date.parse(b.pubDate) || 0) - (Date.parse(a.pubDate) || 0));
  const seen = new Set();
  const uniq = hits.filter((it) => { const key = it.title.slice(0, 40); return seen.has(key) ? false : seen.add(key); }).slice(0, 15);
  $('news-watch').innerHTML = uniq.length
    ? uniq.map((it) => `<li>
        <a class="t" href="${esc(it.link)}" target="_blank" rel="noopener" title="${esc(it.title)}">${highlight(it.title, kws)}</a>
        <span class="s"><span class="wsec">${esc(it.sec)}</span> · ${esc(it.source || '')}</span>
      </li>`).join('')
    : '<li class="empty">등록한 키워드에 해당하는 오늘 기사가 아직 없습니다.</li>';
}

/** ul.news 안의 항목을 검색어로 필터, 매칭 수 반환 */
function filterList(root, q) {
  let visible = 0;
  root.querySelectorAll('ul.news li').forEach((li) => {
    const t = li.querySelector('.t');
    if (!t) return; // empty-state 항목
    // 번역 제목과 원문(data-o) 양쪽으로 검색되게
    const hay = (t.textContent + ' ' + (t.dataset.o || '')).toLowerCase();
    const match = !q || hay.includes(q);
    li.hidden = !match;
    if (match) visible++;
  });
  return visible;
}

/** 전체 뉴스 검색 필터 — 일치하지 않는 항목/빈 카드 숨김 */
export function applyNewsFilter() {
  const q = state.filterQ.trim().toLowerCase();
  let anyVisible = false;
  // 섹션 카드(그리드 내부만) — 일치 없으면 카드째 숨김
  document.querySelectorAll('#sec-news .cols .card').forEach((card) => {
    const visible = filterList(card, q);
    card.hidden = !!q && visible === 0;
    if (visible > 0) anyVisible = true;
  });
  // 관심사 카드는 표시 중일 때만 필터(키워드 유무로만 노출)
  const wc = $('watchCard');
  if (!wc.hidden && filterList(wc, q) > 0) anyVisible = true;
  $('filterEmpty').hidden = !q || anyVisible;
}

/** 검색·관심사·번역 컨트롤 이벤트 연결 */
export function initNewsControls() {
  function addWatch() {
    const v = $('watchInput').value.trim();
    if (!v) return;
    const kws = loadWatch();
    if (!kws.some((k) => k.toLowerCase() === v.toLowerCase())) { kws.push(v); saveWatch(kws); }
    $('watchInput').value = '';
    renderWatch();
    applyNewsFilter();
  }
  $('watchAdd').addEventListener('click', addWatch);
  $('watchInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') addWatch(); });
  $('watchChips').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-i]');
    if (!btn) return;
    const kws = loadWatch();
    kws.splice(Number(btn.dataset.i), 1);
    saveWatch(kws);
    renderWatch();
    applyNewsFilter();
  });
  $('newsFilter').addEventListener('input', (e) => { state.filterQ = e.target.value; applyNewsFilter(); });

  function refreshTrToggle() {
    $('trToggle').textContent = trOn ? '🌐 번역 켜짐' : '🌐 번역 꺼짐';
    $('trToggle').classList.toggle('on', trOn);
  }
  $('trToggle').addEventListener('click', () => {
    trOn = !trOn;
    localStorage.setItem(TRON, trOn ? 'on' : 'off');
    refreshTrToggle();
    applyTranslations();
    if (trOn) queueTranslations();
  });
  refreshTrToggle();
}
