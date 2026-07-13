/** 시장 타일 — 스파크라인 + 동향 한 줄 + 브라우저 실시간 시세 (30분 캐시) */
import { $, esc, fmt } from './dom.js';
import { state } from './state.js';
import { cacheGet, cacheSet } from './storage.js';
import { normDay } from './predict-core.js';

export const TILE_DEFS = [
  { key: 'usdkrw', label: 'USD/KRW 환율', digits: 1, unit: '원' },
  { key: 'kospi',  label: 'KOSPI',        digits: 2 },
  { key: 'sp500',  label: 'S&P 500',      digits: 2 },
  { key: 'nasdaq', label: 'NASDAQ',       digits: 2 },
  { key: 'btc',    label: '비트코인',      digits: 0, prefix: '$' },
  { key: 'eth',    label: '이더리움',      digits: 0, prefix: '$' },
];

/* 히스토리 행(구버전 숫자·신버전 OHLC 모두)에서 종가 시계열 추출 */
const closeSeries = (key) =>
  state.history.map((h) => normDay(h?.[key])?.c ?? null).filter((x) => x != null && !Number.isNaN(x));

/* ───── 스파크라인 (단일 계열 → 범례 없음) ───── */
export function sparkline(values, { w = 120, h = 34 } = {}) {
  const v = values.filter((x) => x != null && !Number.isNaN(x));
  if (v.length < 2) return '';
  const min = Math.min(...v), max = Math.max(...v);
  const pad = 5;
  const y = (x) => max === min ? h / 2 : pad + (h - 2 * pad) * (1 - (x - min) / (max - min));
  const step = (w - 2 * pad) / (v.length - 1);
  const pts = v.map((x, i) => `${(pad + i * step).toFixed(1)},${y(x).toFixed(1)}`);
  const [ex, ey] = pts[pts.length - 1].split(',');
  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="최근 ${v.length}일 추이" preserveAspectRatio="none">
    <polyline points="${pts.join(' ')}" fill="none" stroke="var(--series-1-de)" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
    <circle cx="${ex}" cy="${ey}" r="4" fill="var(--series-1)" stroke="var(--surface-1)" stroke-width="2"/>
  </svg>`;
}

/** 히스토리 기반 동향 한 줄 — 주간 변화율 · 연속 상승/하락 · 30일 고저 근접 (규칙 기반, LLM 불필요) */
export function tileTrend(key) {
  const hist = closeSeries(key);
  const live = state.tileState[key]?.value;
  const v = live != null ? [...hist, live] : hist;
  if (v.length < 4) return ''; // 히스토리가 쌓이면 표시
  const last = v[v.length - 1];
  const parts = [];
  const span = Math.min(7, v.length - 1);
  const base = v[v.length - 1 - span];
  if (base) {
    const pct = ((last - base) / base) * 100;
    parts.push(`${span === 7 ? '1주' : `${span}일`} ${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`);
  }
  const dir = Math.sign(last - v[v.length - 2]);
  let streak = 0;
  for (let i = v.length - 1; i > 0 && dir !== 0 && Math.sign(v[i] - v[i - 1]) === dir; i--) streak++;
  if (streak >= 3) parts.push(`${streak}일째 ${dir > 0 ? '상승' : '하락'}`);
  const win = v.slice(-30);
  if (last >= Math.max(...win) * 0.999) parts.push('30일 최고 근접');
  else if (last <= Math.min(...win) * 1.001) parts.push('30일 최저 근접');
  return parts.slice(0, 2).join(' · ');
}

export function renderTiles() {
  $('tiles').innerHTML = TILE_DEFS.map((def) => {
    const st = state.tileState[def.key] || {};
    const val = fmt.num(st.value, def.digits);
    const deltaTxt = fmt.pct(st.changePct);
    const dir = st.changePct == null ? 'flat' : st.changePct > 0 ? 'up' : st.changePct < 0 ? 'down' : 'flat';
    const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '';
    return `<div class="tile">
      <div class="top">
        <span class="label">${esc(def.label)}</span>
        <span class="delta ${dir}" title="전일 대비">${deltaTxt != null ? `${arrow} ${deltaTxt}` : ''}</span>
      </div>
      <div class="vrow">
        <span class="value">${val != null
          ? `${def.prefix ?? ''}${val}${def.unit ? `<span style="font-size:11px;font-weight:500;color:var(--text-2)"> ${def.unit}</span>` : ''}`
          : '<span class="nodata">수집 대기</span>'}</span>
        ${sparkline(closeSeries(def.key).slice(-30))}
      </div>
      ${(() => { const t = tileTrend(def.key); return t ? `<div class="trend" title="일별 히스토리 기반 추세">${t}</div>` : ''; })()}
    </div>`;
  }).join('');
}

export function fillTileStateFromSnapshot(markets) {
  if (!markets) return;
  const { fx, crypto, indices } = markets;
  const ts = state.tileState;
  if (fx?.rates?.KRW) ts.usdkrw = { value: fx.rates.KRW, changePct: ts.usdkrw?.changePct ?? null };
  if (crypto?.btc?.usd) ts.btc = { value: crypto.btc.usd, changePct: crypto.btc.change24h };
  if (crypto?.eth?.usd) ts.eth = { value: crypto.eth.usd, changePct: crypto.eth.change24h };
  for (const k of ['kospi', 'sp500', 'nasdaq']) {
    const q = indices?.[k];
    if (q?.price) ts[k] = { value: q.price, changePct: q.changePct };
  }
}

/* 브라우저에서 직접 시세 조회 (CORS 허용 API만). 30분 캐시로 과부하 방지.
   onUpdate: 갱신 후 재렌더 콜백 (타일·예측 진행 상황) */
export async function liveMarkets(onUpdate) {
  $('marketNote').textContent = '· 환율/코인은 브라우저에서 30분 캐시로 갱신, 지수·뉴스는 하루 4회 수집';
  const cached = cacheGet('markets'); // 30분 내면 API 호출 없이 캐시 사용
  if (cached) {
    Object.assign(state.tileState, cached);
    onUpdate();
    return;
  }
  let updated = false;
  try {
    const j = await (await fetch('https://api.frankfurter.dev/v1/latest?base=USD&symbols=KRW')).json();
    if (j?.rates?.KRW) {
      const prev = state.tileState.usdkrw?.value;
      state.tileState.usdkrw = {
        value: j.rates.KRW,
        changePct: prev ? ((j.rates.KRW - prev) / prev) * 100 : state.tileState.usdkrw?.changePct ?? null,
      };
      updated = true;
    }
  } catch { /* 오프라인이거나 차단됨 — 스냅샷 값 유지 */ }
  try {
    const j = await (await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd&include_24hr_change=true'
    )).json();
    if (j?.bitcoin?.usd) { state.tileState.btc = { value: j.bitcoin.usd, changePct: j.bitcoin.usd_24h_change }; updated = true; }
    if (j?.ethereum?.usd) { state.tileState.eth = { value: j.ethereum.usd, changePct: j.ethereum.usd_24h_change }; updated = true; }
  } catch { /* 유지 */ }
  if (updated) {
    cacheSet('markets', {
      usdkrw: state.tileState.usdkrw, btc: state.tileState.btc, eth: state.tileState.eth,
    });
    onUpdate();
  }
}
