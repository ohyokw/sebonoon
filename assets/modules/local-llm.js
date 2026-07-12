/**
 * 로컬 LLM 자동 판정 — 선택 기능, 외부 서버·비용 없음 (oMLX·Ollama·LM Studio).
 * 안전 규칙 (단계 10):
 *  - 증거는 예측 키워드와 관련된 아카이브 항목만 전달 (전체 임의 샘플링 금지)
 *  - 직접 근거가 있을 때만 hit, 명확한 반대 결과만 miss, 무보도만으로 miss 금지
 *  - 응답 JSON 스키마 검증 — 잘못된 응답은 폐기하고 수동 판정 유지
 *  - fetch에 AbortController 타임아웃 적용
 */
import { $, todayKst } from './dom.js';
import { state } from './state.js';
import { loadPreds, savePreds } from './storage.js';
import { evidenceFor } from './archive-search.js';

const LLMCFG = 'sebonoon.localLlm';
const LLM_TIMEOUT_MS = 60_000; // 로컬 소형 모델 감안

const llmCfg = () => { try { return JSON.parse(localStorage.getItem(LLMCFG)); } catch { return null; } };
const setLlmStatus = (msg) => { $('llmStatus').textContent = msg || ''; };

const LLM_FORMAT = { // Ollama structured output (format 필드에 JSON 스키마)
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['hit', 'miss', 'unclear'] },
    reason: { type: 'string' },
  },
  required: ['verdict', 'reason'],
};

function judgePrompt(p, evidence) {
  return `너는 예측 판정관이다. 아래 예측이 기한 내에 실현되었는지, 함께 주어진 관련 뉴스 헤드라인만을 증거로 판정하라.
너의 일반 지식이나 헤드라인에 없는 정보를 사용하지 마라.

예측: "${p.text}"
기록일: ${(p.created || '').slice(0, 10)} / 판정 기한: ${p.due} / 오늘: ${todayKst()}

증거 (기간 중 수집된 이 예측 관련 헤드라인 — 전체 뉴스가 아닌 관련분만):
${evidence || '(관련 헤드라인 없음)'}

판정 규칙:
- "hit": 예측 실현을 직접 뒷받침하는 증거가 있을 때만
- "miss": 예측과 명확히 반대되는 결과가 증거로 확인될 때만
- 관련 보도가 없다는 이유만으로 "miss"를 고르지 마라
- "unclear": 그 외 전부 — 증거가 부족하거나 애매하면 반드시 unclear (사람이 직접 판정한다)

JSON으로만 답하라: {"verdict": "hit|miss|unclear", "reason": "판정에 사용한 증거 헤드라인을 인용한 근거 한두 문장(한국어)"}`;
}

/** 응답 텍스트에서 JSON 오브젝트만 추출 (모델이 앞뒤 설명을 붙여도 견딤) */
function extractJson(s) {
  const m = String(s ?? '').match(/\{[\s\S]*\}/);
  return m ? JSON.parse(m[0]) : {};
}

/** 응답 스키마 검증 — 어긋나면 null (폐기하고 수동 판정 유지) */
function validVerdict(v) {
  if (!v || typeof v !== 'object') return null;
  if (!['hit', 'miss', 'unclear'].includes(v.verdict)) return null;
  if (typeof v.reason !== 'string') return null;
  return { verdict: v.verdict, reason: v.reason.slice(0, 500) };
}

const timeoutSignal = () => AbortSignal.timeout ? AbortSignal.timeout(LLM_TIMEOUT_MS) : (() => {
  const c = new AbortController();
  setTimeout(() => c.abort(), LLM_TIMEOUT_MS);
  return c.signal;
})();

/** 서버 API 방식 감지: OpenAI 호환(oMLX·LM Studio·mlx_lm.server) 또는 Ollama 네이티브 */
async function detectApi(url) {
  try {
    const r = await fetch(`${url}/v1/models`, { signal: timeoutSignal() });
    if (r.ok) return 'openai';
  } catch { /* 다음 방식 시도 */ }
  try {
    const r = await fetch(`${url}/api/tags`, { signal: timeoutSignal() });
    if (r.ok) return 'ollama';
  } catch { /* 연결 불가 */ }
  return null;
}

async function callLocalJudge(prompt) {
  const cfg = llmCfg();
  const url = cfg.url.replace(/\/+$/, '');
  if (!cfg.api) { // 최초 1회 감지 후 저장
    cfg.api = await detectApi(url);
    if (!cfg.api) throw new Error('연결 불가');
    localStorage.setItem(LLMCFG, JSON.stringify(cfg));
  }
  let res;
  if (cfg.api === 'openai') {
    res = await fetch(`${url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: timeoutSignal(),
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0,
        stream: false,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    return extractJson(j.choices?.[0]?.message?.content);
  }
  res = await fetch(`${url}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: timeoutSignal(),
    body: JSON.stringify({
      model: cfg.model,
      stream: false,
      format: LLM_FORMAT,
      options: { temperature: 0 },
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  return extractJson(j.message?.content);
}

/** 기한이 도래한 자유 예측을 로컬 LLM으로 판정 (예측당 하루 1회 시도) */
export async function llmJudgeDue(onJudged) {
  const cfg = llmCfg();
  if (!cfg?.url || !cfg?.model) return;
  const today = todayKst();
  const preds = loadPreds();
  const due = preds.filter(
    (p) => !p.resolved && p.type !== 'metric' && p.due <= today && p.llmTriedAt !== today
  );
  if (!due.length) return;
  setLlmStatus(`판정 중… (${due.length}건)`);
  for (const p of due) {
    p.llmTriedAt = today;
    const from = (p.created || '').slice(0, 10);
    const evidence = evidenceFor(state.archive, p.text, from, p.due);
    if (!evidence.length) {
      // 관련 증거가 전혀 없으면 LLM을 부르지 않는다 — 무보도만으로 판정 불가, 수동 판정 유지
      p.llmReason = '기간 중 관련 헤드라인이 수집되지 않아 자동 판정 보류';
      continue;
    }
    try {
      const raw = await callLocalJudge(judgePrompt(p, evidence.join('\n')));
      const v = validVerdict(raw);
      if (!v) continue; // 스키마 위반 응답은 폐기 — 수동 판정 유지
      if (v.verdict === 'hit' || v.verdict === 'miss') {
        p.resolved = v.verdict;
        p.autoJudged = 'llm';
        p.llmReason = v.reason;
        p.llmSources = evidence.slice(0, 3); // 판정에 사용한 증거 표시용
        p.resolvedAt = new Date().toISOString();
      } else {
        p.llmReason = v.reason; // 보류 — 관련 헤드라인을 보고 직접 판정
      }
    } catch {
      // 연결 실패·타임아웃 (폰 등 다른 기기이거나 서버 꺼짐) — 조용히 건너뜀
      savePreds(preds);
      setLlmStatus('연결 안 됨');
      return;
    }
  }
  savePreds(preds);
  onJudged?.();
  setLlmStatus('판정 완료 ✓');
}

/** 설정 UI 이벤트 연결 (앱 시작 시 1회) */
export function initLocalLlm(onJudged) {
  const cfg = llmCfg();
  if (cfg?.url) $('llmUrl').value = cfg.url;
  if (cfg?.model) $('llmModel').value = cfg.model;
  if (!$('llmStatus').textContent) setLlmStatus(cfg?.url && cfg?.model ? '켜짐' : '');

  $('llmSave').addEventListener('click', () => {
    const url = $('llmUrl').value.trim().replace(/\/+$/, '');
    const model = $('llmModel').value.trim();
    if (!url) { alert('서버 주소를 입력하세요 (예: http://localhost:8080).'); return; }
    if (!model) { alert("모델명을 입력하세요 — '연결 테스트'를 누르면 목록을 확인하고 자동으로 채워줍니다."); return; }
    localStorage.setItem(LLMCFG, JSON.stringify({ url, model })); // api는 첫 판정 때 자동 감지
    setLlmStatus('켜짐');
    llmJudgeDue(onJudged);
  });
  $('llmTest').addEventListener('click', async () => {
    const url = $('llmUrl').value.trim().replace(/\/+$/, '');
    if (!url) { setLlmStatus('서버 주소를 입력하세요'); return; }
    setLlmStatus('테스트 중…');
    const api = await detectApi(url);
    if (!api) {
      setLlmStatus('연결 실패 — 서버 실행 여부와 CORS 허용 설정을 확인하세요');
      return;
    }
    try {
      let models = [];
      if (api === 'openai') {
        const j = await (await fetch(`${url}/v1/models`, { signal: timeoutSignal() })).json();
        models = (j.data || []).map((m) => m.id);
      } else {
        const j = await (await fetch(`${url}/api/tags`, { signal: timeoutSignal() })).json();
        models = (j.models || []).map((m) => m.name);
      }
      const kind = api === 'openai' ? 'OpenAI 호환' : 'Ollama';
      const want = $('llmModel').value.trim();
      if (!want && models.length) $('llmModel').value = models[0]; // 첫 모델 자동 채움
      setLlmStatus(want && models.length && !models.some((m) => m.startsWith(want))
        ? `연결됨(${kind}) — 단, '${want}' 모델 없음. 사용 가능: ${models.slice(0, 3).join(', ')}`
        : `연결됨 ✓ (${kind}, 모델 ${models.length}개)`);
    } catch {
      setLlmStatus(`연결됨 — 모델 목록은 읽지 못했습니다`);
    }
  });
  $('llmOff').addEventListener('click', () => {
    localStorage.removeItem(LLMCFG);
    $('llmUrl').value = ''; $('llmModel').value = '';
    setLlmStatus('');
  });
}
