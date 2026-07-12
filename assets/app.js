/** 세상을 보는 눈 — 앱 진입점 (모듈 연결, 프레임워크·번들러 없음) */
import { $, fmt } from './modules/dom.js';
import { state } from './modules/state.js';
import { CACHE_TTL, THEME, cacheAge } from './modules/storage.js';
import { loadAll } from './modules/data.js';
import { renderTiles, fillTileStateFromSnapshot, liveMarkets } from './modules/markets.js';
import {
  buildAllNews, renderNewsList, renderHN, renderTrends,
  renderWatch, applyNewsFilter, queueTranslations, initNewsControls,
} from './modules/news.js';
import { renderStatus, renderTop5, renderChanged } from './modules/briefing.js';
import { renderPreds, refreshTargetPlaceholder, initPredictions } from './modules/predictions.js';
import { llmJudgeDue, initLocalLlm } from './modules/local-llm.js';

/* ── 테마 ── */
(function initTheme() {
  const saved = localStorage.getItem(THEME);
  if (saved) document.documentElement.dataset.theme = saved;
  $('themeToggle').addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme ||
      (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem(THEME, next);
  });
})();

/* ── 헤더 날짜 ── */
$('todayLabel').textContent = new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'full', timeZone: 'Asia/Seoul',
}).format(new Date());

/* ── 오늘의 생각거리 ── */
const QUESTIONS = [
  '오늘 헤드라인 중 6개월 뒤에도 중요할 뉴스는 무엇이고, 왜 그런가?',
  '지금 시장(환율·지수·코인) 움직임의 원인을 한 문장으로 설명할 수 있는가?',
  '오늘 뉴스에서 서로 연결되는 두 사건을 찾아보자. 그 연결이 시사하는 것은?',
  '이번 주 가장 과대평가된 이슈와 과소평가된 이슈는 무엇인가?',
  '오늘 본 기술 뉴스 중 1년 안에 내 일/생활을 바꿀 것은 무엇인가?',
  '지금 검색 트렌드는 일시적 화제인가, 구조적 변화의 신호인가?',
  '어제의 내 예상과 오늘 실제 상황이 달랐던 부분은 어디인가?',
  '오늘 뉴스가 다루지 않는 것 중, 다뤄져야 할 이슈는 무엇인가?',
  '환율이 지금보다 5% 움직인다면 무엇이 먼저 영향을 받을까?',
  '오늘 가장 확신에 찬 전문가의 주장을 하나 골라, 반대 논리를 만들어 보자.',
  '이번 달 뉴스 흐름을 세 단어로 요약한다면?',
  '지금 세계에서 자본·인재·관심은 각각 어디로 이동하고 있는가?',
  '오늘 헤드라인 중 3개월 뒤 결과를 예측할 수 있는 것을 골라 예측 노트에 적어 보자.',
  '최근 내 예측이 틀렸다면, 어떤 정보를 놓쳤기 때문인가?',
];
(function renderQuestion() {
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
  $('question').textContent = QUESTIONS[dayOfYear % QUESTIONS.length];
})();

/* ── UI 이벤트 연결 ── */
initNewsControls();
initPredictions();
initLocalLlm(renderPreds);
renderPreds(); // localStorage만으로 예측 노트 즉시 렌더

/* ── 데이터 로드 ── */
async function main() {
  // 데이터 파일은 30분 캐시 — 새로고침을 반복해도 30분 안에는 다시 내려받지 않음
  const [data, h, arch, status] = await loadAll();
  state.history = Array.isArray(h) ? h : [];
  state.archive = Array.isArray(arch) ? arch : [];
  state.status = status;
  state.latest = data;

  renderStatus(status, data);

  if (data) {
    $('sampleBanner').hidden = !data.sample;
    if (data.generatedAt && !data.sample) {
      const age = cacheAge('latest');
      const ago = age != null && age > 60000 ? ` · ${Math.round(age / 60000)}분 전 확인` : '';
      $('updatedLabel').textContent = `수집: ${fmt.kstTime(data.generatedAt)} KST${ago}`;
    }
    renderTop5(data);
    renderChanged(data);
    // 섹션 중요도별 표시 개수 — 핵심(세계·한국·경제) 10건, 나머지 5건
    const meta = data.sectionMeta || {};
    const shortage = (k) => !!meta[k]?.shortage;
    renderNewsList('news-world', data.news?.world, 10, shortage('world'));
    renderNewsList('news-korea', data.news?.korea, 10, shortage('korea'));
    renderNewsList('news-business', data.news?.business, 10, shortage('business'));
    renderNewsList('news-tech', data.news?.tech, 5, shortage('tech'));
    // 구버전 데이터(tech에 과학 포함)와 신버전(science 분리) 모두 지원
    renderNewsList('news-science', data.news?.science, 5, shortage('science'));
    renderNewsList('news-ai', data.news?.ai, 5, shortage('ai'));
    renderNewsList('news-crypto', data.news?.crypto, 5, shortage('crypto'));
    renderNewsList('news-wealth', data.news?.wealth, 5, shortage('wealth'));
    renderHN(data.developerSignal || data.hackernews, 5);
    renderTrends(data.publicAttentionSignal || data.trends);
    fillTileStateFromSnapshot(data.markets);
    state.allNews = buildAllNews(data);
    renderWatch();       // 관심사 섹션 갱신
    applyNewsFilter();   // 검색어가 있으면 재적용
    queueTranslations(); // 영어 제목 번역(토글 켜짐 시)
  } else {
    // 캐시도 없고 네트워크도 실패 — 파일 서빙 안내
    $('sampleBanner').hidden = false;
    $('sampleBanner').innerHTML =
      '<strong>데이터 파일을 불러오지 못했습니다.</strong> 로컬에서 여는 경우 <code>npx serve</code> 등 정적 서버로 실행하거나, GitHub Pages 배포 후 접속하세요.';
  }
  renderTiles();
  refreshTargetPlaceholder();
  renderPreds(); // 수집 데이터 기준 자동 판정 + 관련 헤드라인 반영
  liveMarkets(() => { // 30분 캐시 기반 시세 갱신
    renderTiles();
    refreshTargetPlaceholder();
    renderPreds(); // 최신 값으로 지표 예측 진행 상황·자동 판정 갱신
  });
  llmJudgeDue(renderPreds); // 로컬 LLM 설정 시, 기한 도래한 자유 예측 판정
}
main();
// 페이지를 열어둔 채로도 30분마다 자동 갱신 (캐시가 만료되는 시점에만 실제 네트워크 요청)
setInterval(main, CACHE_TTL);
