/**
 * 과부하 방지 캐시 (localStorage, 30분) + 사용자 데이터 저장.
 * 새로고침을 반복해도 30분 안에는 데이터 파일·외부 시세 API를 다시 부르지 않습니다.
 * 쿠키 대신 localStorage 사용: 용량이 크고, 매 요청마다 서버로 전송되지 않아 이 용도에 적합합니다.
 */

export const CACHE_TTL = 30 * 60 * 1000; // 30분 (수집은 하루 4회지만 시세 API 보호를 위해 유지)

const cacheKey = (k) => `sebonoon.cache.${k}`;

export function cacheGet(k, ttl = CACHE_TTL) {
  try {
    const raw = localStorage.getItem(cacheKey(k));
    if (!raw) return null;
    const { t, v } = JSON.parse(raw);
    return Date.now() - t <= ttl ? v : null; // 만료면 null
  } catch { return null; }
}

export const cacheStale = (k) => cacheGet(k, Infinity); // TTL 무시 (오프라인 폴백용)

export const cacheAge = (k) => { // 캐시 나이(ms), 없으면 null
  try { return Date.now() - JSON.parse(localStorage.getItem(cacheKey(k))).t; } catch { return null; }
};

export function cacheSet(k, v) {
  try { localStorage.setItem(cacheKey(k), JSON.stringify({ t: Date.now(), v })); } catch { /* 용량 초과 등 무시 */ }
}

/* ── 예측 노트 (키 이름은 기존 그대로 유지 — 도메인 이전 시 내보내기/가져오기 사용) ── */
export const PKEY = 'sebonoon.predictions.v1';
export const loadPreds = () => { try { return JSON.parse(localStorage.getItem(PKEY)) || []; } catch { return []; } };
export const savePreds = (p) => localStorage.setItem(PKEY, JSON.stringify(p));

/* ── 관심 키워드 ── */
const WATCH = 'sebonoon.watch';
export const loadWatch = () => { try { return JSON.parse(localStorage.getItem(WATCH)) || []; } catch { return []; } };
export const saveWatch = (a) => localStorage.setItem(WATCH, JSON.stringify(a));

/* ── 테마 ── */
export const THEME = 'sebonoon.theme';
