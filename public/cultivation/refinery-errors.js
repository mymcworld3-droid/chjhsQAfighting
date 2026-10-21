// Shared, transport-independent refinery diagnostics. Never log prompts or tokens.
(function (root) {
  'use strict';
  const TYPES = Object.freeze({
    'refinery-input': ['素材或煉製設定不符', '請檢查素材、境界與效果上下限。', false, 400],
    'refinery-refinement': ['法寶屬性無法合法提升', '請更換素材或調整效果上下限；原法寶的屬性必須保留並提升。', false, 422],
    'refinery-ai-config': ['推演服務尚未設定', '請管理員檢查生成服務設定。', false, 503],
    'refinery-ai-auth': ['推演服務驗證失敗', '請管理員檢查服務金鑰或模型權限。', false, 502],
    'refinery-ai-model': ['推演模型不存在或不支援', '請管理員檢查模型名稱與服務版本。', false, 502],
    'refinery-ai-request': ['推演服務不接受目前請求', '請管理員檢查請求格式與模型輸入限制。', false, 502],
    'refinery-ai-blocked': ['推演內容被服務攔截', '請調整煉製指導或素材描述後再試。', false, 422],
    'refinery-ai-quota': ['推演服務額度或頻率受限', '請稍後再試；持續發生時請管理員檢查生成服務額度。', true, 429],
    'refinery-ai-timeout': ['推演服務回應逾時', '請稍後再試，或請管理員檢查生成服務。', true, 504],
    'refinery-ai-network': ['推演服務連線失敗', '請稍後再試；持續發生時請管理員檢查服務連線。', true, 503],
    'refinery-ai-service': ['推演服務暫時異常', '上游服務回報錯誤，請稍後重試。', true, 503],
    'refinery-ai-json': ['推演回傳格式不正確', '生成服務沒有回傳完整的 JSON，請重新推演。', true, 502],
    'refinery-ai-artifact': ['推演結果缺少有效法寶', '生成結果缺少名稱或有效效果，請重新推演。', true, 502],
    'refinery-ai-mixed': ['多個推演服務均失敗', '各服務失敗原因不同，請將錯誤回報交給管理員。', true, 503],
    'refinery-api-network': ['無法連線至煉器服務', '請確認網路及網站服務狀態後重試。', true, 503],
    'refinery-api-timeout': ['煉器請求逾時', '請確認連線後重試；若發生在存檔階段，請先重新同步。', true, 504],
    'refinery-api-invalid-response': ['煉器服務回傳格式錯誤', '可能收到代理服務錯誤頁或不完整回應，請稍後重試。', true, 502],
    'refinery-api-response': ['煉器服務回報失敗', '請依 HTTP 狀態與追蹤編號回報管理員。', true, 503],
    'refinery-api-access': ['煉器服務拒絕存取', '請重新登入；若仍失敗，請管理員檢查網站與代理服務的存取設定。', false, 403],
    'refinery-api-route': ['找不到煉器服務', '請重新整理載入新版；若仍失敗，請管理員檢查後端部署。', false, 404],
    'refinery-request-size': ['煉器請求內容過大', '請將錯誤回報交給管理員檢查請求大小限制。', false, 413],
    'refinery-session': ['登入狀態失效', '請重新登入並同步煉製任務。', false, 401],
    'refinery-save-permission': ['法寶存檔權限被拒絕', '請將錯誤回報交給管理員修正存檔流程；連續重試無法解決權限問題。', false, 403],
    'refinery-data-quota': ['資料服務用量已達限制', '請等待資料服務額度恢復後重新同步。', true, 429],
    'refinery-data-unavailable': ['資料服務暫時無法使用', '請稍後重新同步，確認煉製任務及背包狀態。', true, 503],
    'refinery-conflict': ['煉製資料發生衝突', '請重新同步，確認是否已在其他分頁完成開爐。', true, 409],
    'refinery-job': ['煉製任務狀態已變更', '請重新同步煉製任務，確認是否到期或已領取。', false, 409],
    'refinery-image': ['法寶已入袋，圖片補製失敗', '不影響法寶與配方；圖片可由管理員稍後補製。', true, 503],
    'refinery-client-sync': ['法寶已入袋，畫面同步未完成', '請重新整理並確認背包，不要重新投入材料。', true, 500],
    'refinery-unknown': ['煉器操作未完成', '請重新同步並將錯誤回報交給管理員。', false, 500]
  });
  function clean(value, max = 500) {
    return String(value ?? '').replace(/(Bearer\s+)[^\s"'<>]+/gi, '$1[REDACTED]')
      .replace(/((?:[?&]|\b)(?:key|api[_-]?key|access[_-]?token|authorization|secret)\s*[=:]\s*["']?)[^\s&"'<>},]+/gi, '$1[REDACTED]')
      .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|AIza[A-Za-z0-9_-]{20,})\b/g, '[REDACTED]')
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, max);
  }
  function classify(error = {}, stage = '') {
    const code = String(error.code || '').replace(/^firestore\//, '');
    if (TYPES[code]) return code;
    const text = String(error.message || error || '');
    if (stage === 'image') return 'refinery-image';
    if (/unauthenticated|auth\/|token-expired/.test(code) || /尚未登入|帳號已切換/.test(text)) return 'refinery-session';
    if (/permission-denied/.test(code)) return stage === 'generation' ? 'refinery-ai-auth' : 'refinery-save-permission';
    if (/D1.*quota|D1.*用量/i.test(text)) return 'refinery-data-quota';
    if (/resource-exhausted/.test(code)) return stage === 'generation' ? 'refinery-ai-quota' : 'refinery-data-quota';
    if (/aborted|already-exists/.test(code)) return 'refinery-conflict';
    if (/本命法寶|保留.*屬性|逐項提升|屬性.*上限|四個.*詞條/.test(text)) return 'refinery-refinement';
    if (/任務已變更|沒有煉器任務|仍在煉製|尚需|玩家資料不存在|法寶已不存在/.test(text)) return 'refinery-job';
    if (/數量不足|素材.*不足|碎片不足|素材必須|缺少.*圖鑑|未知.*素材|未知煉器|上下限|境界設定|階段設定|有限數值|不支援的法寶/.test(text)) return 'refinery-input';
    if (/unavailable|deadline-exceeded/.test(code)) return stage === 'generation' ? 'refinery-ai-service' : 'refinery-data-unavailable';
    if (/No AI provider configured/i.test(text)) return 'refinery-ai-config';
    const http = Number(error.httpStatus || error.status);
    if (stage === 'generation' && [401, 403].includes(http)) return 'refinery-ai-auth';
    if (stage === 'generation' && http === 429) return 'refinery-ai-quota';
    if (/SAFETY|blocked.*content|content.*blocked|PROHIBITED_CONTENT/i.test(text)) return 'refinery-ai-blocked';
    if (stage === 'generation' && (http === 404 || /HTTP 404|model.*not found|unsupported.model/i.test(text))) return 'refinery-ai-model';
    if (stage === 'generation' && ([400, 422].includes(http) || /HTTP (400|422)|context.length|input.*too.long/i.test(text))) return 'refinery-ai-request';
    if (/\b401\b|\b403\b|UNAUTHENTICATED|PERMISSION_DENIED|invalid.api.key|API.key.*not.valid/i.test(text)) return 'refinery-ai-auth';
    if (/\b429\b|RESOURCE_EXHAUSTED|quota|rate.limit|too many requests/i.test(text)) return 'refinery-ai-quota';
    if (error.name === 'AbortError' || /timeout|timed.out|逾時/i.test(text)) return 'refinery-ai-timeout';
    if (error.name === 'SyntaxError' || /JSON|no message content/i.test(text)) return 'refinery-ai-json';
    if (/fetch failed|Failed to fetch|Load failed|NetworkError|ECONN|ENOTFOUND|socket|network/i.test(text)) return stage === 'generation' ? 'refinery-ai-network' : 'refinery-api-network';
    if (Number(error.httpStatus || error.status) >= 500 || /HTTP 5\d\d/.test(text)) return 'refinery-ai-service';
    if (/All AI providers failed/i.test(text)) return 'refinery-ai-mixed';
    return 'refinery-unknown';
  }
  function describe(error = {}, context = {}) {
    const stage = clean(error.refineryStage || context.phase || 'unknown', 50);
    const code = error.refineryAwarded === true ? 'refinery-client-sync' : classify(error, stage);
    let [title, action, retryable, status] = TYPES[code];
    if (code === 'refinery-save-permission' && stage === 'catalog-commit') title = '生成已完成，但圖鑑或配方存檔權限被拒絕';
    const committing = /commit|client-sync/.test(stage) || context.phase === 'start';
    const uncertain = committing && ['refinery-data-unavailable', 'refinery-data-quota', 'refinery-api-network', 'refinery-api-timeout', 'refinery-unknown'].includes(code);
    const outcome = ['refinery-image', 'refinery-client-sync'].includes(code) ? 'awarded' : uncertain || code === 'refinery-conflict' || code === 'refinery-job' ? 'unknown' : context.phase === 'start' ? 'not-started' : 'preserved';
    return { code, title, action, stage, retryable, outcome,
      originalCode: clean(error.originalCode || error.code || '', 100),
      httpStatus: Number(error.httpStatus || error.status) || null,
      suggestedStatus: status,
      requestId: clean(error.requestId || context.requestId || '', 100),
      jobId: clean(context.jobId || '', 120),
      endpoint: clean(error.endpoint || context.endpoint || '', 120),
      elapsedMs: Math.max(0, Number(error.elapsedMs) || 0),
      reason: clean(error.serverReason || error.message || '', 500),
      cause: clean(error.cause?.message || '', 200),
      attempts: (Array.isArray(error.attempts) ? error.attempts : []).slice(0, 12).map(a => ({
        provider: clean(a.provider, 60), model: clean(a.model, 100), code: clean(a.code, 80),
        httpStatus: Number(a.httpStatus) || null, elapsedMs: Math.max(0, Number(a.elapsedMs) || 0)
      })) };
  }
  function notice(report) {
    const state = { awarded: '法寶與配方已保存。', preserved: '煉製任務已保留。', 'not-started': '尚未開始新的煉製。', unknown: '結果尚待同步，請先確認任務與背包，勿重新投入材料。' };
    return report.title + '。' + state[report.outcome] + report.action;
  }
  const api = { TYPES, clean, classify, describe, notice };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.QARefineryErrors = api;
})(globalThis);
