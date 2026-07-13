/** 모듈 간 공유 상태 — 프레임워크 없이 단일 객체로 관리 */
export const state = {
  history: [],      // data/history.json (지표 OHLC)
  archive: [],      // data/news-archive.json (자유 예측 증거)
  status: null,     // data/status.json (수집 상태)
  latest: null,     // data/latest.json (스냅샷)
  allNews: [],      // 전 섹션 평탄화 (관심사·검색 대상)
  tileState: {},    // key → {value, changePct} (실시간 시세 병합)
  filterQ: '',      // 헤드라인 검색어
};
