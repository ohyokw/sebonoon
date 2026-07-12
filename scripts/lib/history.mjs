/**
 * 지표 히스토리 (OHLC) — 하루 여러 번 수집되는 값을 일중 open/high/low/close로 누적합니다.
 * 구버전 스키마(지표당 숫자 하나)와 호환: 읽을 때 숫자는 {o=h=l=c=값}으로 해석합니다.
 */

export const METRIC_KEYS = ['usdkrw', 'btc', 'eth', 'kospi', 'sp500', 'nasdaq'];

/** 저장된 하루치 지표값(숫자 | OHLC 객체 | null) → {o,h,l,c,n,at} | null */
export function normDay(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isNaN(v) ? null : { o: v, h: v, l: v, c: v, n: 1, at: null };
  if (typeof v === 'object' && typeof v.c === 'number') {
    return { o: v.o ?? v.c, h: v.h ?? v.c, l: v.l ?? v.c, c: v.c, n: v.n ?? 1, at: v.at ?? null };
  }
  return null;
}

export const dayClose = (v) => normDay(v)?.c ?? null;
export const dayHigh = (v) => normDay(v)?.h ?? null;
export const dayLow = (v) => normDay(v)?.l ?? null;

/**
 * 히스토리에 오늘 수집값을 병합. values: {usdkrw: 1385.2, ...} (null 허용)
 * 같은 날짜에 재수집되면 h=max, l=min, c=최신값, o=최초값, n+=1로 누적합니다.
 */
export function mergeHistoryEntry(history, date, values, at = new Date().toISOString(), { keep = 120 } = {}) {
  const list = Array.isArray(history) ? [...history] : [];
  const idx = list.findIndex((h) => h.date === date);
  const row = idx >= 0 ? { ...list[idx] } : { date };

  for (const key of METRIC_KEYS) {
    const v = values[key];
    if (v == null || Number.isNaN(v)) continue;
    const prev = normDay(row[key]);
    row[key] = prev
      ? { o: prev.o, h: Math.max(prev.h, v), l: Math.min(prev.l, v), c: v, n: prev.n + 1, at }
      : { o: v, h: v, l: v, c: v, n: 1, at };
  }

  if (idx >= 0) list[idx] = row; else list.push(row);
  list.sort((a, b) => a.date.localeCompare(b.date));
  return list.slice(-keep);
}
