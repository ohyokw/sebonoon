/**
 * 뉴스 아카이브 병합 — 자유 예측 판정의 증거 저장소 (최근 60일).
 * v2: 사건 ID·URL·발행 시각·신뢰 등급을 보존하고,
 *     같은 날짜를 덮어쓰지 않고 사건 업데이트를 누적(중복 제거)합니다.
 * 항목: {id: 사건ID, t: 제목, s: 출처, u: URL, p: 발행시각, c: 카테고리, tr: tier}
 * (아카이브 검색은 브라우저와 공유하는 assets/modules/archive-search.js에 있습니다)
 */

const norm = (t) => String(t || '').toLowerCase().replace(/\s+/g, '').slice(0, 40);
const keyOf = (it) => it.id || norm(it.t);

/**
 * 아카이브에 오늘 항목을 병합 — 같은 날짜가 이미 있으면 덮어쓰지 않고 누적.
 * 같은 사건(id)이 다시 오면 최신 항목으로 교체(사건 업데이트), 새 사건은 추가.
 */
export function mergeArchiveDay(archive, date, items, { keepDays = 60, maxPerDay = 120 } = {}) {
  const list = Array.isArray(archive) ? [...archive] : [];
  const idx = list.findIndex((d) => d.date === date);
  const byKey = new Map();
  if (idx >= 0) for (const it of list[idx].items || []) byKey.set(keyOf(it), it);
  for (const it of items || []) {
    if (!it || !it.t) continue;
    byKey.set(keyOf(it), it); // 같은 사건은 최신 수집분으로 갱신
  }
  const day = { date, items: [...byKey.values()].slice(0, maxPerDay) };
  if (idx >= 0) list[idx] = day; else if (day.items.length) list.push(day);
  list.sort((a, b) => a.date.localeCompare(b.date));
  return list.slice(-keepDays);
}
