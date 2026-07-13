/**
 * 예측 판정 코어 — 브라우저·Node 테스트 공용 순수 모듈 (DOM 없음).
 * 지표 예측 자동 판정(OHLC 기반)과 예측 데이터 가져오기 검증을 담당합니다.
 */

/** 저장된 하루치 지표값(구버전 숫자 | OHLC 객체 | null) → {o,h,l,c} | null — scripts/lib/history.mjs와 동일 규칙 */
export function normDay(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isNaN(v) ? null : { o: v, h: v, l: v, c: v };
  if (typeof v === 'object' && typeof v.c === 'number') {
    return { o: v.o ?? v.c, h: v.h ?? v.c, l: v.l ?? v.c, c: v.c };
  }
  return null;
}

/**
 * 히스토리 + 실시간 값(있으면) → 일별 시계열 [{date, h, l, c}]
 * 실시간 값은 오늘 날짜의 고가/저가에 병합됩니다.
 */
export function metricSeries(history, key, live = null, today = null) {
  const s = [];
  for (const row of history || []) {
    const d = normDay(row?.[key]);
    if (d) s.push({ date: row.date, h: d.h, l: d.l, c: d.c });
  }
  if (live != null && today) {
    const last = s[s.length - 1];
    if (last && last.date === today) {
      last.h = Math.max(last.h, live);
      last.l = Math.min(last.l, live);
      last.c = live;
    } else {
      s.push({ date: today, h: live, l: live, c: live });
    }
  }
  return s;
}

/**
 * 지표 예측 판정 — 일중 고가/저가 기준.
 *  - `>=` 목표: 기간 내 어느 날이든 high >= target이면 적중
 *  - `<=` 목표: 기간 내 어느 날이든 low  <= target이면 적중
 *  - 기한이 지났는데 기간 데이터가 부족하면 자동 실패가 아닌 'data-insufficient'
 * 반환: {state: 'hit'|'miss'|'open'|'data-insufficient', touchedDate?, coverage}
 */
export function judgeMetric(pred, series, today) {
  const from = (pred.created || '').slice(0, 10);
  const to = pred.due;
  const inWindow = (series || []).filter((x) => x.date >= from && x.date <= to);

  for (const day of inWindow) {
    const touched = pred.op === '>=' ? day.h >= pred.target : day.l <= pred.target;
    if (touched) return { state: 'hit', touchedDate: day.date, coverage: inWindow.length };
  }
  if (today <= to) return { state: 'open', coverage: inWindow.length };

  // 기한 경과 — 데이터가 충분할 때만 miss 확정, 아니면 직접 판정 요청.
  // 요구치는 창 길이를 넘지 않는다 (하루짜리 창은 그날 데이터 하나면 충분)
  const windowDays = Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1);
  const needed = Math.min(windowDays, Math.max(2, Math.ceil(Math.min(windowDays, 30) * 0.4)));
  if (inWindow.length < needed) return { state: 'data-insufficient', coverage: inWindow.length };
  return { state: 'miss', coverage: inWindow.length };
}

/** 적중률·평균 확신도·브라이어 점수 */
export function predStats(preds) {
  const resolved = preds.filter((p) => p.resolved);
  const hits = resolved.filter((p) => p.resolved === 'hit');
  const hitRate = resolved.length ? (hits.length / resolved.length) * 100 : null;
  const avgConf = resolved.length ? resolved.reduce((s, p) => s + p.conf, 0) / resolved.length : null;
  const brier = resolved.length
    ? resolved.reduce((s, p) => s + Math.pow(p.conf / 100 - (p.resolved === 'hit' ? 1 : 0), 2), 0) / resolved.length
    : null;
  return { total: preds.length, open: preds.length - resolved.length, resolved: resolved.length, hitRate, avgConf, brier };
}

/* ── 내보내기·가져오기 (도메인 이전 대비 — 스키마 버전 포함) ── */

export const EXPORT_SCHEMA = 'sebonoon.predictions.v1';

/** 내보내기 파일 형식 — 스키마 버전을 명시해 향후 마이그레이션 가능하게 */
export function exportPayload(preds) {
  return { schema: EXPORT_SCHEMA, exportedAt: new Date().toISOString(), predictions: preds };
}

/** 예측 항목 1건의 최소 유효성 */
export function validPrediction(p) {
  return !!(p && typeof p === 'object'
    && typeof p.id === 'string' && p.id
    && typeof p.text === 'string' && p.text
    && /^\d{4}-\d{2}-\d{2}$/.test(p.due || ''));
}

/**
 * 가져오기 파싱·병합 — 잘못된 JSON/형식은 명확한 오류로, 중복 ID는 가져온 쪽으로 갱신.
 * 지원 형식: 순수 배열(구버전 내보내기) | {schema, predictions:[...]} (신버전)
 * 반환: {merged, added, updated, skipped}
 */
export function mergeImported(existing, rawText) {
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error('JSON 파싱 실패 — 올바른 내보내기 파일인지 확인하세요');
  }
  const list = Array.isArray(parsed) ? parsed
    : (parsed && Array.isArray(parsed.predictions)) ? parsed.predictions
    : null;
  if (!list) throw new Error('형식 오류 — 예측 목록을 찾을 수 없습니다');

  const byId = new Map(existing.map((p) => [p.id, p]));
  let added = 0, updated = 0, skipped = 0;
  for (const p of list) {
    if (!validPrediction(p)) { skipped++; continue; }
    if (byId.has(p.id)) updated++; else added++;
    byId.set(p.id, p);
  }
  return { merged: [...byId.values()], added, updated, skipped };
}
