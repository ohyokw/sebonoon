/** 예측 노트 UI — 지표 자동 판정(OHLC)·자유 예측 근거·통계·내보내기/가져오기 */
import { $, esc, fmt, todayKst } from './dom.js';
import { state } from './state.js';
import { loadPreds, savePreds } from './storage.js';
import { metricSeries, judgeMetric, predStats, exportPayload, mergeImported } from './predict-core.js';
import { searchArchive } from './archive-search.js';

export const METRICS = {
  usdkrw: { label: 'USD/KRW 환율', digits: 1 },
  kospi:  { label: 'KOSPI', digits: 2 },
  sp500:  { label: 'S&P 500', digits: 2 },
  nasdaq: { label: 'NASDAQ', digits: 2 },
  btc:    { label: '비트코인(USD)', digits: 0 },
  eth:    { label: '이더리움(USD)', digits: 0 },
};

const seriesOf = (key) =>
  metricSeries(state.history, key, state.tileState[key]?.value ?? null, todayKst());

/**
 * 지표 예측 자동 판정 — 일중 고가/저가(OHLC) 기준.
 * 데이터가 부족하면 자동 실패 대신 'data-insufficient'로 표시하고 직접 판정을 요청합니다.
 */
function autoJudge(preds) {
  const today = todayKst();
  let changed = false;
  for (const p of preds) {
    if (p.resolved || p.type !== 'metric') continue;
    const r = judgeMetric(p, seriesOf(p.metric), today);
    if (r.state === 'hit' || r.state === 'miss') {
      p.resolved = r.state;
      p.autoJudged = true;
      p.resolvedAt = new Date().toISOString();
      if (r.touchedDate) p.touchedDate = r.touchedDate;
      delete p.judgeNote;
      changed = true;
    } else if (r.state === 'data-insufficient') {
      if (p.judgeNote !== 'data-insufficient') { p.judgeNote = 'data-insufficient'; changed = true; }
    } else if (p.judgeNote) {
      delete p.judgeNote;
      changed = true;
    }
  }
  return changed;
}

/** 기록일~기한 사이 아카이브에서 예측과 관련된 헤드라인 검색 (v1·v2 스키마 지원) */
function relatedHeadlines(p) {
  const from = (p.created || '').slice(0, 10);
  const to = p.due < todayKst() ? p.due : todayKst();
  return searchArchive(state.archive, p.text, from, to, { limit: 8 });
}

function renderPredStats() {
  const s = predStats(loadPreds());
  const overconf = s.avgConf != null && s.hitRate != null ? s.avgConf - s.hitRate : null;
  const calib = overconf == null ? ''
    : overconf > 10 ? `<span class="warn" title="확신이 적중률보다 ${overconf.toFixed(0)}%p 높음 — 확신도를 낮춰 보세요">⚠ 과신 경향</span>`
    : overconf < -10 ? `<span title="확신이 적중률보다 ${(-overconf).toFixed(0)}%p 낮음">과소평가 경향</span>`
    : `<span title="확신도와 적중률이 잘 맞습니다">보정 양호 ✓</span>`;
  $('pstats').innerHTML = `
    <span title="총 ${s.total}건 기록">진행 중 <b>${s.open}</b></span>
    <span title="판정 ${s.resolved}건 기준">적중률 <b>${s.hitRate != null ? s.hitRate.toFixed(0) + '%' : '—'}</b></span>
    <span>평균 확신 <b>${s.avgConf != null ? s.avgConf.toFixed(0) + '%' : '—'}</b></span>
    <span title="0에 가까울수록 좋음 (동전 던지기 = 0.25)">브라이어 <b>${s.brier != null ? s.brier.toFixed(3) : '—'}</b></span>
    ${calib}`;
}

function predRow(p) {
  const today = todayKst();
  const overdue = !p.resolved && p.due && p.due <= today;
  const isMetric = p.type === 'metric';
  const dataInsufficient = isMetric && p.judgeNote === 'data-insufficient';
  let progress = '';
  if (!p.resolved && isMetric) {
    const s = seriesOf(p.metric);
    const cur = s.length ? s[s.length - 1].c : null;
    if (cur != null) progress = ` · 현재 ${fmt.num(cur, METRICS[p.metric]?.digits ?? 2)}`;
  }
  const judgedBy = p.autoJudged === 'llm' ? ' · 🖥️ LLM 판정' : p.autoJudged ? ' · 자동 판정' : '';
  const llmHold = !p.resolved && !isMetric && p.llmReason
    ? ` · <span title="${esc(p.llmReason)}">🖥️ 보류</span>` : '';
  // 무료 판정 도우미: 기간 중 관련 헤드라인을 찾아 판정을 돕는다
  let evidBtn = '', evidBlock = '';
  if (!p.resolved && !isMetric) {
    const ev = relatedHeadlines(p);
    if (ev.length) {
      evidBtn = `<button class="pbtn" data-act="ev" title="예측 기간 중 수집된 관련 헤드라인 보기">🔎 관련 헤드라인 ${ev.length}건</button>`;
      evidBlock = `<div class="evid" hidden>${ev.map((e) =>
        `<div><span class="d">[${e.date}]</span> ${e.u ? `<a href="${esc(e.u)}" target="_blank" rel="noopener">${esc(e.t)}</a>` : esc(e.t)} <span class="d">· ${esc(e.s)}</span></div>`
      ).join('')}</div>`;
    } else if (overdue) {
      evidBtn = `<span class="pmeta" title="관련 보도가 없다는 것만으로 빗나감을 단정할 수는 없지만, 실현됐다면 크게 보도됐을 사안이라면 참고하세요">기간 중 관련 헤드라인 없음</span>`;
    }
  }
  const insufficientNote = dataInsufficient && overdue
    ? ' · <span class="pdue-over" title="기한 내 수집된 지표 데이터가 부족해 자동 판정할 수 없습니다">데이터 부족 — 직접 판정하세요</span>' : '';
  // LLM 판정은 사용한 증거 헤드라인까지 툴팁으로 표시 (판정 근거 투명성)
  const resolvedTip = p.llmReason
    ? `${p.llmReason}${p.llmSources?.length ? ` | 근거: ${p.llmSources.join(' · ')}` : ''}`
    : (p.touchedDate ? `${p.touchedDate} 도달` : '');
  const meta = p.resolved
    ? `<span title="${esc(resolvedTip)}">확신 ${p.conf}% · 기한 ${p.due}${judgedBy}</span>`
    : `<span class="${overdue ? 'pdue-over' : ''}">기한 ${p.due}${overdue && !isMetric && !p.llmReason ? ' — 판정하세요!' : ''}</span>${progress}${llmHold}${insufficientNote}`;
  // 지표 예측도 데이터 부족 시에는 직접 판정 버튼을 노출
  const manualBtns = (!isMetric || dataInsufficient)
    ? `<button class="pbtn" data-act="hit">적중</button>
       <button class="pbtn" data-act="miss">빗나감</button>` : '';
  return `<li data-id="${p.id}">
    <span class="ptext">${isMetric ? '📊 ' : ''}${esc(p.text)}</span>
    <span class="conf-meter" title="확신도 ${p.conf}%"><i style="width:${p.conf}%"></i></span>
    <span class="pmeta">${meta}</span>
    ${evidBtn}
    ${p.resolved
      ? `<span class="badge ${p.resolved}">${p.resolved === 'hit' ? '✓ 적중' : '✗ 빗나감'}</span>
         ${p.autoJudged ? '<button class="pbtn" data-act="flip" title="판정이 틀렸다면 뒤집기">정정</button>' : ''}
         <button class="pbtn del" data-act="del">삭제</button>`
      : `${manualBtns}
         <button class="pbtn del" data-act="del">삭제</button>`}
    ${evidBlock}
  </li>`;
}

export function renderPreds() {
  const preds = loadPreds();
  if (autoJudge(preds)) savePreds(preds);
  const open = preds.filter((p) => !p.resolved).sort((a, b) => a.due.localeCompare(b.due));
  const resolved = preds.filter((p) => p.resolved).sort((a, b) => (b.resolvedAt || '').localeCompare(a.resolvedAt || ''));
  $('plist-open').innerHTML = open.length ? open.map(predRow).join('')
    : '<li class="empty">아직 예측이 없습니다. 첫 예측을 기록해 보세요 — 틀려도 기록하는 것이 훈련입니다.</li>';
  $('plist-resolved').innerHTML = resolved.length ? resolved.map(predRow).join('')
    : '<li class="empty">판정 완료된 예측이 없습니다.</li>';
  $('toggleResolved').textContent = `판정 완료 보기 (${resolved.length})`;
  renderPredStats();
}

export function refreshTargetPlaceholder() {
  const key = $('pmetric').value;
  const v = state.tileState[key]?.value;
  $('ptarget').placeholder = v != null
    ? `목표값 (현재 ${fmt.num(v, METRICS[key].digits)})`
    : '목표값';
}

/** 입력 폼·리스트·내보내기/가져오기 이벤트 연결 (앱 시작 시 1회) */
export function initPredictions() {
  let formMode = 'metric';

  $('pmetric').innerHTML = Object.entries(METRICS)
    .map(([k, m]) => `<option value="${k}">${esc(m.label)}</option>`).join('');
  $('pconf').innerHTML = [50, 55, 60, 65, 70, 75, 80, 85, 90, 95]
    .map((v) => `<option value="${v}"${v === 65 ? ' selected' : ''}>확신 ${v}%</option>`).join('');
  $('pmetric').addEventListener('change', refreshTargetPlaceholder);

  for (const tab of document.querySelectorAll('.ptab')) {
    tab.addEventListener('click', () => {
      formMode = tab.dataset.mode;
      document.querySelectorAll('.ptab').forEach((t) => t.classList.toggle('active', t === tab));
      $('pform').classList.toggle('mode-metric', formMode === 'metric');
      $('pform').classList.toggle('mode-free', formMode === 'free');
      (formMode === 'metric' ? $('ptarget') : $('ptext')).focus();
    });
  }

  $('newPredBtn').addEventListener('click', () => {
    const w = $('pformWrap');
    w.hidden = !w.hidden;
    $('newPredBtn').textContent = w.hidden ? '＋ 새 예측' : '접기';
    if (!w.hidden) (formMode === 'metric' ? $('ptarget') : $('ptext')).focus();
  });

  $('dueChips').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-days]');
    if (!btn) return;
    const d = btn.dataset.days === 'eoy'
      ? new Date(new Date().getFullYear(), 11, 31)
      : new Date(Date.now() + Number(btn.dataset.days) * 86400000);
    $('pdue').value = d.toISOString().slice(0, 10);
  });

  $('pform').addEventListener('submit', (e) => {
    e.preventDefault();
    const conf = Number($('pconf').value);
    const due = $('pdue').value;
    if (!due) return;
    const preds = loadPreds();
    const base = { id: crypto.randomUUID(), conf, due, created: new Date().toISOString(), resolved: null };
    if (formMode === 'metric') {
      const metric = $('pmetric').value;
      const op = $('pop').value;
      const target = Number($('ptarget').value);
      if ($('ptarget').value === '' || !Number.isFinite(target)) { $('ptarget').focus(); return; }
      const m = METRICS[metric];
      const text = `${m.label} ${fmt.num(target, m.digits)} ${op === '>=' ? '이상' : '이하'} 도달`;
      preds.push({ ...base, type: 'metric', metric, op, target, text });
      $('ptarget').value = '';
    } else {
      const text = $('ptext').value.trim();
      if (!text) { $('ptext').focus(); return; }
      preds.push({ ...base, type: 'free', text });
      $('ptext').value = '';
    }
    savePreds(preds);
    renderPreds();
  });

  for (const listId of ['plist-open', 'plist-resolved']) {
    $(listId).addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      if (btn.dataset.act === 'ev') { // 관련 헤드라인 펼치기/접기 (저장 불필요)
        const evid = btn.closest('li').querySelector('.evid');
        if (evid) evid.hidden = !evid.hidden;
        return;
      }
      const id = btn.closest('li').dataset.id;
      const act = btn.dataset.act;
      let preds = loadPreds();
      if (act === 'del') {
        if (!confirm('이 예측을 삭제할까요?')) return;
        preds = preds.filter((p) => p.id !== id);
      } else if (act === 'flip') {
        const p = preds.find((p) => p.id === id);
        if (p) { p.resolved = p.resolved === 'hit' ? 'miss' : 'hit'; p.autoJudged = false; }
      } else {
        const p = preds.find((p) => p.id === id);
        if (p) { p.resolved = act; p.resolvedAt = new Date().toISOString(); delete p.judgeNote; }
      }
      savePreds(preds);
      renderPreds();
    });
  }

  $('toggleResolved').addEventListener('click', () => {
    const ul = $('plist-resolved');
    ul.hidden = !ul.hidden;
  });

  // 내보내기 — 스키마 버전 포함 (도메인 이전 시 새 주소에서 가져오기)
  $('exportBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(exportPayload(loadPreds()), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `sebonoon-predictions-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  // 가져오기 — 구버전(배열)·신버전(래핑) 모두 지원, 잘못된 파일은 명확한 오류
  $('importFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const r = mergeImported(loadPreds(), await file.text());
      savePreds(r.merged);
      renderPreds();
      alert(`가져오기 완료 — 추가 ${r.added}건, 갱신 ${r.updated}건${r.skipped ? `, 형식 오류로 건너뜀 ${r.skipped}건` : ''} (총 ${r.merged.length}건)`);
    } catch (err) {
      alert(`가져오기 실패: ${err.message}`);
    }
    e.target.value = '';
  });

  // 판정일 기본값: 2주 뒤
  $('pdue').value = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
}
