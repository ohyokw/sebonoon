/** 데이터 파일 로드 — 30분 캐시 우선, 실패 시 만료 캐시(stale) 폴백 */
import { cacheGet, cacheSet, cacheStale } from './storage.js';

/** 30분 캐시 우선 JSON 로드. 신선하면 네트워크 생략, 실패 시 만료 캐시라도 반환 */
export async function cachedJson(baseUrl, k, fallback) {
  const fresh = cacheGet(k);
  if (fresh != null) return fresh;
  try {
    const data = await (await fetch(`${baseUrl}?t=${Date.now()}`)).json();
    cacheSet(k, data);
    return data;
  } catch {
    const stale = cacheStale(k);
    return stale != null ? stale : fallback;
  }
}

/** latest / history / archive / status 를 병렬 로드 */
export function loadAll() {
  return Promise.all([
    cachedJson('data/latest.json', 'latest', null),
    cachedJson('data/history.json', 'history', []),
    cachedJson('data/news-archive.json', 'archive', []),
    cachedJson('data/status.json', 'status', null),
  ]);
}
