# ◉ 세상을 보는 눈 (sebonoon)

매일의 뉴스·시장·트렌드를 **한 페이지**로 읽고, 예측을 기록하며 세상을 읽는 '보는 눈'을 기르는 개인 대시보드입니다.

## 구성

| 섹션 | 내용 | 출처 |
|---|---|---|
| 시장 지표 | USD/KRW · KOSPI · S&P 500 · NASDAQ · BTC · ETH + 추이 스파크라인 | Frankfurter(ECB 고시환율), Yahoo Finance, CoinGecko |
| 오늘의 헤드라인 | 세계 / 한국 / 경제 뉴스 | Reuters · AP · BBC · 연합뉴스 등 (아래 출처 정책) |
| 기술·과학·커뮤니티 | 기술 / 과학 뉴스 + Hacker News 인기 글 | MIT Tech Review · BBC · Science · Nature, HN API |
| 검색 트렌드 | 한국 실시간 급상승 검색어 | Google Trends |
| 오늘의 생각거리 | 매일 바뀌는 사고 훈련 질문 | 내장 |
| 예측 노트 | 확신도와 기한을 붙여 예측 기록 → 판정 → 적중률·과신 여부·브라이어 점수 | 브라우저 localStorage |

모두 **무료 공개 API/RSS**만 사용합니다. API 키 불필요. 모바일 화면에 최적화되어 있고, 상단 퀵 내비게이션으로 섹션 간 이동이 가능합니다.

## 출처 정책 — 공신력과 중립성

뉴스는 **사실 보도 중심의 통신사·공영·학술 매체**만 자동 집계합니다.

- **국제**: Reuters, AP(Associated Press) — 세계 양대 통신사, BBC — 공영방송
- **국내**: 연합뉴스(국가기간뉴스통신사) 직접 RSS + Google News 피드를 통신사·공영 화이트리스트(연합뉴스·뉴시스·뉴스1·KBS·YTN)로 필터링
- **과학**: Science(AAAS), Nature — 학술지 뉴스
- **기술**: MIT Technology Review, BBC Technology
- **시장 데이터**: ECB 고시환율(Frankfurter), CoinGecko, Yahoo Finance — 1차 데이터
- **트렌드**: Google Trends — 편집 개입이 없는 원시 검색 데이터

정파적 성향이 뚜렷한 매체는 집계에서 제외하며, 여러 소스를 라운드로빈으로 섞어 한 매체가 지면을 독점하지 않게 합니다.
소스 목록은 `scripts/collect.mjs`의 `collectNews()`와 `KR_TRUSTED`에서 수정할 수 있습니다.

## 동작 방식

1. `.github/workflows/daily-collect.yml` — GitHub Actions가 **매일 06:30 / 18:30 (KST)** 에 `scripts/collect.mjs`를 실행
2. 수집 결과를 `data/latest.json`(오늘 스냅샷)과 `data/history.json`(지표 히스토리, 최근 120일)에 커밋
3. `index.html`이 그 데이터를 읽어 렌더링 — 환율·코인 시세는 브라우저에서 실시간으로도 갱신

## 시작하기

1. **GitHub Pages 켜기**: 저장소 Settings → Pages → Source를 `main` 브랜치 `/ (root)`로 설정
2. **첫 수집 실행**: Actions 탭 → `daily-collect` → Run workflow (이후엔 매일 자동)
3. Pages 주소(`https://<계정>.github.io/sebonoon/`)를 브라우저 시작 페이지나 즐겨찾기에 등록

> 처음에는 샘플 데이터가 보입니다. 워크플로우가 한 번 실행되면 실제 데이터로 교체됩니다.
> 예약 워크플로우(cron)는 **기본 브랜치(main)** 에서만 동작합니다.

로컬 실행:

```bash
node scripts/collect.mjs   # 데이터 수집 (Node 20+)
npx serve .                # 정적 서버로 열기 → http://localhost:3000
```

## 보는 눈 훈련 루틴

1. 매일 아침 이 페이지를 5분간 훑는다
2. '오늘의 생각거리'에 스스로 답한다
3. 일주일에 2–3개, **기한이 있는 예측**을 확신도(%)와 함께 기록한다
4. 판정일이 되면 반드시 적중/빗나감을 판정한다
5. **적중률과 평균 확신도의 차이**(과신 여부)와 브라이어 점수를 보고 다음 예측을 보정한다

> 예측은 브라우저 localStorage에 저장됩니다. 기기를 옮길 땐 '내보내기/가져오기'를 사용하세요.
