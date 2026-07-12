/**
 * 데이터 품질 게이트 — 새 스냅샷이 이 기준을 통과할 때만 latest.json으로 승격됩니다.
 * 실패하면 기존 latest.json(마지막 정상 데이터)을 유지합니다.
 */
import { isAllowedSource } from './sources.mjs';

const CORE_MIN = { world: 3, korea: 3, business: 3 }; // 핵심 카테고리별 최소 기사 수
const norm = (t) => String(t || '').toLowerCase().replace(/\s+/g, '').slice(0, 40);

/**
 * snapshot 검증 → {passed, score(0~100), reasons[]}
 * reasons에는 감점·불합격 사유를 사람이 읽을 수 있게 기록합니다.
 */
export function evaluateSnapshot(snapshot, { now = Date.now(), totalTasks = 27 } = {}) {
  const reasons = [];
  let score = 100;
  let hardFail = false;
  const fail = (msg) => { hardFail = true; reasons.push(`불합격: ${msg}`); };
  const dock = (pts, msg) => { score -= pts; reasons.push(`-${pts} ${msg}`); };

  // ── 필수 필드·형식 ──
  if (!snapshot || typeof snapshot !== 'object') return { passed: false, score: 0, reasons: ['불합격: 스냅샷 없음'] };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshot.date || '')) fail('date 형식 오류');
  if (Number.isNaN(Date.parse(snapshot.generatedAt || ''))) fail('generatedAt 파싱 불가');
  if (!snapshot.news || typeof snapshot.news !== 'object') fail('news 필드 없음');

  const all = Object.values(snapshot.news || {}).flatMap((l) => (Array.isArray(l) ? l : []));

  // ── 항목 유효성 (title/source/link/pubDate) ──
  const invalid = all.filter((it) => !it || !String(it.title || '').trim() || !String(it.source || '').trim() || !/^https?:/.test(it.link || ''));
  if (all.length && invalid.length / all.length > 0.2) dock(20, `유효하지 않은 항목 ${invalid.length}/${all.length}`);
  const noDate = all.filter((it) => it && !it.pubDate).length;
  if (all.length && noDate / all.length > 0.5) dock(5, `발행 시각 누락 ${noDate}건`);

  // ── 최소 데이터량 ──
  if (all.length < 10) fail(`전체 기사 ${all.length}건 (<10)`);
  for (const [cat, min] of Object.entries(CORE_MIN)) {
    const n = (snapshot.news?.[cat] || []).length;
    if (n < min) dock(15, `${cat} ${n}건 (<${min})`);
  }

  // ── 신뢰 출처 수 ──
  const trusted = new Set(all.map((it) => it.source).filter((s) => isAllowedSource(s)));
  if (trusted.size < 3) dock(20, `신뢰 출처 ${trusted.size}종 (<3)`);

  // ── 시장 데이터 정상 비율 ──
  const m = snapshot.markets || {};
  const okMarkets = ['fx', 'crypto', 'indices'].filter((k) => m[k] != null).length;
  if (okMarkets === 0) dock(15, '시장 데이터 전체 실패');
  else if (okMarkets < 2) dock(8, `시장 데이터 ${okMarkets}/3`);

  // ── 수집 오류 비율 ──
  const errN = (snapshot.errors || []).length;
  if (errN / totalTasks > 0.5) dock(20, `수집 오류 ${errN}/${totalTasks}`);
  else if (errN / totalTasks > 0.25) dock(8, `수집 오류 ${errN}/${totalTasks}`);

  // ── 중복 비율 ──
  const keys = all.map((it) => norm(it?.title));
  const dup = keys.length - new Set(keys).size;
  if (keys.length && dup / keys.length > 0.15) dock(10, `중복 제목 ${dup}건`);

  // ── 오래된 기사 비율 (발행 시각이 있는 기사 기준 72시간 초과) ──
  const dated = all.filter((it) => it?.pubDate && !Number.isNaN(Date.parse(it.pubDate)));
  const stale = dated.filter((it) => now - Date.parse(it.pubDate) > 72 * 3600_000);
  if (dated.length >= 5 && stale.length / dated.length > 0.6) dock(15, `72시간 이전 기사 ${stale.length}/${dated.length}`);

  score = Math.max(0, Math.min(100, score));
  const passed = !hardFail && score >= 70;
  if (passed && !reasons.length) reasons.push('모든 품질 기준 통과');
  return { passed, score: hardFail ? 0 : score, reasons };
}
