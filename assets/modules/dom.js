/** DOM·포맷 유틸 — 외부 데이터는 반드시 esc()를 거쳐 HTML에 삽입합니다 */

export const $ = (id) => document.getElementById(id);

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const todayKst = () =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());

export const fmt = {
  num(v, digits = 0) {
    if (v == null || Number.isNaN(v)) return null;
    return Number(v).toLocaleString('ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  },
  pct(v) {
    if (v == null || Number.isNaN(v)) return null;
    const s = v > 0 ? '+' : '';
    return `${s}${v.toFixed(2)}%`;
  },
  rel(pubDate) {
    if (!pubDate) return '';
    const t = new Date(pubDate).getTime();
    if (Number.isNaN(t)) return '';
    const m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return '방금';
    if (m < 60) return `${m}분 전`;
    if (m < 60 * 24) return `${Math.round(m / 60)}시간 전`;
    return `${Math.round(m / 1440)}일 전`;
  },
  kstTime(iso) {
    if (!iso || Number.isNaN(Date.parse(iso))) return '';
    return new Intl.DateTimeFormat('ko-KR', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Seoul',
    }).format(new Date(iso));
  },
};
