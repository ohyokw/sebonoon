# 기준 상태 조사 (Baseline Audit)

> 작성일: 2026-07-11 (개선 작업 착수 전 스냅샷)
> 브랜치: `claude/world-insight-dashboard-nb3zdf` · 마지막 커밋: `5111d74 해외 섹션 한국어 보도 우선 (koFirst) — 클릭해도 끝까지 한국어`
> 작업 환경 Node: v22.22.2 (워크플로우는 Node 20 사용 중)

## 1. Git 상태

- `git status`: 클린 (미커밋 변경 없음)
- 현재 브랜치: `claude/world-insight-dashboard-nb3zdf` (main에서 분기, PR #2로 추적 중)
- 배포 브랜치: `main` — GitHub Pages가 main의 루트(`/`)를 서빙, cron 워크플로우도 main에서만 동작

## 2. 파일 구조

```
.
├── .github/workflows/daily-collect.yml   # 수집 워크플로우 (39줄)
├── CNAME                                 # sebanoon.koy.kr (구 도메인 — 오타 도메인)
├── README.md                             # 109줄 — 출처 정책·동작 방식·예측 판정 문서
├── data/
│   ├── latest.json                       # 오늘 스냅샷 (이 브랜치에는 sample:true 자리표시자)
│   ├── history.json                      # 지표 히스토리, 최근 120일 (이 브랜치에는 [])
│   └── news-archive.json                 # 헤드라인 아카이브, 최근 60일 (이 브랜치에는 [])
├── index.html                            # 단일 페이지 대시보드 (1,484줄 — HTML+CSS+JS 인라인)
└── scripts/collect.mjs                   # 데이터 수집기 (391줄, Node ESM)
```

- 테스트 디렉터리 없음. `package.json` 없음(의존성 0 — Node 내장 + 브라우저 표준 API만 사용).
- 빌드 단계 없음 — 저장소 파일이 그대로 서빙되는 순수 정적 구조.

## 3. 사용 기술

- **프런트엔드**: 바닐라 HTML/CSS/JS (프레임워크·번들러 없음), 단일 `index.html`에 인라인
- **수집기**: Node.js ESM 단일 파일, 내장 `fetch`/`node:fs/promises`만 사용 (npm 의존성 0)
- **호스팅**: GitHub Pages (main 브랜치 루트), 커스텀 도메인 CNAME
- **스케줄러**: GitHub Actions cron
- **폰트**: 모바일 = OS 기본, PC(≥901px) = Pretendard 동적 서브셋(jsDelivr CDN)
- **저장소**: 사용자 데이터 전부 브라우저 localStorage (서버·DB 없음)

## 4. GitHub Pages 배포 방식

- Settings → Pages → Source: `main` 브랜치 `/ (root)`
- 커스텀 도메인: `sebanoon.koy.kr` (CNAME 파일 + DNS CNAME 레코드) — **철자 오류 도메인. `sebonoon.koy.kr`로 이전 예정**
- 별도 빌드/배포 워크플로우 없음 — main에 커밋되면 Pages가 자동 반영

## 5. GitHub Actions 워크플로우 (`daily-collect.yml`)

- 트리거: `cron: '*/30 * * * *'` (30분마다, best-effort) + `workflow_dispatch`
- 러너: ubuntu-latest, `actions/checkout@v4`, `actions/setup-node@v4` + Node `'20'`
- 단계: `node scripts/collect.mjs` → `data/` 변경 시 github-actions[bot]으로 커밋·푸시
- `permissions: contents: write`, `concurrency: daily-collect` (중복 실행 방지)
- 하루 최대 ~48회 커밋 발생 (README에 부담 시 주기 완화 안내 있음)

## 6. 데이터 수집 흐름 (`scripts/collect.mjs`)

1. `main()`이 6개 수집기를 `Promise.all` + `safe()` 래퍼로 병렬 실행 — 실패는 `errors[]`에 누적하고 `null` 반환
   - `collectNews()` — 22개 피드 병렬 수집 후 섹션별 조합
   - `collectHackerNews()` — HN topstories 상위 12건
   - `collectFx()` — Frankfurter (ECB 고시환율)
   - `collectCrypto()` — CoinGecko BTC/ETH
   - `collectIndices()` — Yahoo Finance KOSPI/S&P500/NASDAQ
   - `collectTrends()` — Google Trends KR RSS 상위 10건
2. KST 날짜 기준 스냅샷 조립 → `data/latest.json` 덮어쓰기
3. `updateHistory()` — 오늘 지표값 1개(usdkrw/btc/eth/kospi/sp500/nasdaq)를 history.json에 upsert, 120일 유지
4. `updateNewsArchive()` — 섹션별 상위 6건 제목을 news-archive.json에 추가, 60일 유지

## 7. 뉴스 출처별 수집 방법

| 함수 | 방식 | 필터 |
|---|---|---|
| `fromRss(url, name, take)` | 매체 직접 RSS (연합뉴스·BBC·MIT TR·Science·Nature·CoinDesk) | 없음 — 매체명 고정 |
| `fromGnSearch(q, name, take)` | Google News 영어 검색 (`source:Reuters` 등) | 결과 source를 매체명으로 재검증 |
| `fromGnTopic(path, take)` | Google News 한국어 토픽 | `KR_TRUSTED` 화이트리스트, **단 통과분 <3건이면 비필터 전체로 폴백** |
| `fromGnSearchKo(q, take)` | Google News 한국어 키워드 검색 | 위와 같음 (**같은 폴백 존재**) |

- `KR_TRUSTED = ['연합뉴스','뉴시스','뉴스1','KBS','YTN','연합인포맥스','KTV']`
- 조합: `interleave()`(라운드로빈 + 제목 정규화 중복 제거), `koFirst()`(한국어 우선, 부족분만 영어)
- 섹션: world/korea/business/ai/tech/crypto/wealth (7개)

### ⚠️ 출처 정책 위반 지점 (개선 대상)

`fromGnTopic`·`fromGnSearchKo`의 `return (trusted.length >= 3 ? trusted : all).slice(0, take)` —
화이트리스트 통과가 3건 미만이면 **필터를 통째로 버리고 임의 매체를 노출**한다.
"공신력 있는 매체만 집계"라는 문서화된 정책과 코드가 불일치.

## 8. 시장 데이터 출처

| 지표 | 출처 | 수집 주기 |
|---|---|---|
| USD/KRW (+JPY/EUR/CNY) | Frankfurter `api.frankfurter.dev` (ECB 고시환율) | Actions 30분 + 브라우저 30분 캐시 |
| BTC/ETH (USD, 24h 변화) | CoinGecko simple/price | Actions 30분 + 브라우저 30분 캐시 |
| KOSPI/S&P500/NASDAQ | Yahoo Finance v8 chart (`^KS11`,`^GSPC`,`^IXIC`) | Actions만 (CORS로 브라우저 직접 조회 불가) |

## 9. 데이터 JSON 구조

### `data/latest.json` (매 수집마다 전체 덮어쓰기)
```jsonc
{
  "generatedAt": "ISO", "date": "YYYY-MM-DD(KST)",
  "news": { "world|korea|business|ai|tech|crypto|wealth": [{ "title","link","source","pubDate" }] },
  "hackernews": [{ "title","link","points","comments","hnLink" }],
  "markets": {
    "fx": { "date", "rates": { "KRW","JPY","EUR","CNY" } } | null,
    "crypto": { "btc": { "usd","change24h" }, "eth": {...} } | null,
    "indices": { "kospi|sp500|nasdaq": { "price","changePct" } | null } | null
  },
  "trends": [{ "title","traffic" }],
  "errors": ["라벨: 메시지", ...]          // 부분 실패 기록 (있어도 정상 배포됨)
}
```
초기 커밋본에는 `"sample": true` 필드가 있고 프런트가 이를 감지해 배너 표시.

### `data/history.json` — 하루 1행, 지표당 **단일 값**
```jsonc
[{ "date":"YYYY-MM-DD", "usdkrw":n|null, "btc":n|null, "eth":n|null, "kospi":n|null, "sp500":n|null, "nasdaq":n|null }]
```
최근 120일 유지. 같은 날 재수집 시 그날 행을 통째로 교체(마지막 수집값만 남음 — 고가/저가 정보 소실).

### `data/news-archive.json` — 하루 1행, 섹션별 상위 6건 제목
```jsonc
[{ "date":"YYYY-MM-DD", "items":[{ "t":"제목", "s":"매체", "c":"섹션" }] }]
```
최근 60일 유지. 자유 예측 판정 근거로 사용.

## 10. 브라우저 렌더링 흐름 (`index.html`)

1. 인라인 `<script>`가 즉시 실행 — 테마 초기화, 날짜 라벨, 폼 세팅, `renderPreds()` (localStorage만으로 예측 노트 즉시 렌더)
2. `main()`:
   - `cachedJson()`으로 latest/history/archive 3파일 로드 (localStorage 30분 캐시 → 만료 시 fetch → 실패 시 만료 캐시 폴백)
   - `renderNewsList()` ×7 (세계·한국·경제 10건, 나머지 5건) + `renderHN()` + `renderTrends()`
   - `fillTileStateFromSnapshot()` → `renderTiles()` (스파크라인 + `tileTrend()` 동향 한 줄)
   - `buildAllNews()` → `renderWatch()`(관심사) → `applyNewsFilter()`(검색) → `queueTranslations()`(영어 제목 MyMemory 번역, 동시 4)
   - `liveMarkets()` — Frankfurter/CoinGecko 브라우저 직접 조회 (30분 캐시)
   - `llmJudgeDue()` — 로컬 LLM 설정 시 기한 도래 자유 예측 판정
3. `setInterval(main, 30분)` — 열어둔 채로 자동 갱신 (캐시 만료 시점에만 실제 요청)

## 11. localStorage 키

| 키 | 내용 |
|---|---|
| `sebonoon.theme` | `light` / `dark` |
| `sebonoon.predictions.v1` | 예측 배열 `[{id,type,metric?,op?,target?,text,conf,due,created,resolved,autoJudged?,resolvedAt?,llmTriedAt?,llmReason?}]` |
| `sebonoon.watch` | 관심 키워드 배열 |
| `sebonoon.localLlm` | `{url, model, api?}` |
| `sebonoon.cache.latest` / `.history` / `.archive` / `.markets` | `{t: epoch_ms, v: data}` 30분 캐시 |
| `sebonoon.tr` | 번역 캐시 `{원문: 번역}` |
| `sebonoon.trOn` | 번역 토글 `on`/`off` |

## 12. 예측 자동 판정 흐름 (지표 예측)

1. `metricSeries(key)` — history.json의 일별 값 + 실시간 타일 값(오늘) 시계열
2. `autoJudge(preds)` — 미해결 metric 예측마다: 기록일~기한 사이 값 중 `satisfied()`(`>=`: v≥target, `<=`: v≤target) 하나라도 있으면 `hit`, 없이 기한 경과 시 `miss`. `autoJudged: true` 마킹, '정정' 버튼으로 뒤집기 가능
3. `renderPreds()` 호출 시마다 재판정 → 변경 시 저장

### ⚠️ 알려진 한계 (개선 대상)
- history가 **하루 1개 값**(마지막 수집 시점 종가 스냅샷)만 저장 — 장중 고가/저가로 목표를 스쳤어도 미탐지, 반대로 순간 스파이크는 실시간 값으로만 우연히 탐지. OHLC 부재.
- 데이터 공백(수집 실패 기간)과 "미도달"을 구분하지 못함 — 데이터가 없어도 기한만 지나면 `miss` 확정.

## 13. 로컬 LLM 판정 흐름 (자유 예측 — 선택 기능)

1. 설정: 예측 노트 → 🖥️ 로컬 LLM — URL·모델 저장(`sebonoon.localLlm`), '연결 테스트'가 `detectApi()`로 OpenAI 호환(`/v1/models`) vs Ollama(`/api/tags`) 감지
2. `llmJudgeDue()` — 기한 도래(`due <= today`) + 미해결 + 오늘 미시도(`llmTriedAt !== today`) 자유 예측을 순회
3. `buildEvidence()` — 기록일~기한 사이 아카이브 헤드라인(최대 120줄 균등 샘플링) → `judgePrompt()` (hit/miss/unclear, 확신 없으면 unclear 강제)
4. `callLocalJudge()` — OpenAI `/v1/chat/completions` 또는 Ollama `/api/chat`(+structured output `format`), temperature 0
5. hit/miss만 자동 확정(`autoJudged:'llm'`), unclear는 보류 표시. 폰 등 접속 불가 기기에서는 조용히 건너뜀

보조: `relatedHeadlines(p)` — 예측 문장 `keywords()`(조사 제거·불용어 필터)로 아카이브 검색, 상위 8건을 🔎 버튼으로 표시.
**알려진 문제**: 키워드 추출이 조사 1글자 제거 휴리스틱뿐이라 재현율이 낮고, 관련 기사 0건일 때 안내 문구가 빈약함.

## 14. 빌드/실행 방법

- 빌드 없음. 로컬 확인: `node scripts/collect.mjs`(수집) + `npx serve .`(정적 서버)
- 문법 검증: `node --check scripts/collect.mjs`

## 15. 현재 테스트

- **없음.** 테스트 파일·러너·CI 검증 단계 전무. 지금까지는 수동 확인(Playwright 임시 스크립트) + `node --check`만 사용.

## 16. 현재 알려진 오류·리스크

1. **출처 폴백 정책 위반** — §7. 화이트리스트 미달 시 비검증 매체가 그대로 노출.
2. **데이터 품질 게이트 부재** — 수집이 전부 실패해도(`news` 전 섹션 0건) `latest.json`을 **빈 스냅샷으로 덮어쓰고 exit 0** → 정상 커밋·배포됨. 이 샌드박스에서 실제 재현: 모든 소스 403 시 `뉴스[world:0 …] HN:0 트렌드:0`으로 "수집 완료" 출력. last-good 백업·상태 파일 없음.
3. **지표 판정 부정확성** — §12. 하루 단일 값이라 고가/저가 미반영, 데이터 공백을 miss로 오판.
4. **`관련 헤드라인()` 빈 괄호류 표시 문제** — 자유 예측에 관련 기사 0건이고 기한 전이면 아무 안내가 없음(기한 후에만 문구).
5. **도메인 철자** — CNAME이 `sebanoon.koy.kr`(오타). `sebonoon.koy.kr` 이전 필요.
6. **워크플로우 노후 버전** — checkout@v4/setup-node@v4/Node 20, 30분 cron은 커밋 이력 과다(하루 ~48회).
7. **단일 파일 구조** — index.html 1,484줄에 CSS/JS 인라인 — 수정 리스크·리뷰 부담 큼.
8. **이벤트 군집/중요도/브리핑 없음** — 헤드라인 나열만 있고 "무엇이 왜 중요한가" 구조화 없음.

## 17. 이 감사에서 실행한 명령

```
git status                       # clean
git branch --show-current        # claude/world-insight-dashboard-nb3zdf
git log -1 --oneline             # 5111d74 해외 섹션 한국어 보도 우선 (koFirst)
node --version                   # v22.22.2
node scripts/collect.mjs         # 스크래치 복사본에서 실행 (라이브 data/ 보호)
                                 # → 전 소스 403 (샌드박스 프록시 차단), 그럼에도 exit 0 + 빈 latest.json 생성 확인
```
