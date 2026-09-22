const aiRouter = require('./ai-router');

const MAX_NAME = 24;
// 只在名稱審核使用短期限；不可沿用會逐一嘗試所有模型的長時間等待。
const NAME_REVIEW_DEADLINE_MS = 8000;
const RESERVED = /九州|《\s*九州\s*》|管理员|管理員|官方|GM|Game\s*Master/i;

function cleanName(value) {
  return String(value || '').replace(/\u0000/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
}

function buildNameReviewPrompt(name) {
  return `
[任務]
你是遊戲玩家名稱審核員。請判定名稱是否適合公開顯示。

[名稱]
${name}

[必須拒絕]
- 仇恨、侮辱、露骨色情、鼓勵自傷或暴力威脅。
- 冒充官方、管理員、系統身分或含有保留稱號「九州」。
- 明顯包含電話、身分證、地址、密碼等敏感個資。
- 利用特殊字元偽裝上述內容。

[不要過度拒絕]
一般暱稱、姓名、數字、動漫或修仙風格名稱都可接受，只要沒有上述問題。

[輸出 JSON Only]
{
  "approved": true,
  "reason": "簡短理由",
  "normalizedName": "若只是多餘空白可正常化，否則保持原名稱"
}`;
}

function normalizeReview(raw, original) {
  const data = raw && typeof raw === 'object' ? raw : {};
  const normalizedName = cleanName(data.normalizedName || original);
  return {
    approved: data.approved === true && !!normalizedName && !RESERVED.test(normalizedName),
    reason: String(data.reason || '').trim().slice(0, 500),
    normalizedName
  };
}

// AI 未能及時完成時，回退到伺服器基本檢查；明確拒絕的 AI 結果不可放行。
async function reviewNameWithDeadline(name, { generateJSON = aiRouter.generateJSON, timeoutMs = NAME_REVIEW_DEADLINE_MS } = {}) {
  const checked = cleanName(name);
  if (checked.length < 2) return { approved: false, normalizedName: checked, reason: '名稱至少需要 2 個字元' };
  if (RESERVED.test(checked)) return { approved: false, normalizedName: checked, reason: '此名稱含有系統保留稱號或身分字樣' };
  let timer;
  try {
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error('名稱 AI 審核逾時');
        error.code = 'NAME_REVIEW_TIMEOUT';
        reject(error);
      }, timeoutMs);
    });
    const routed = await Promise.race([
      generateJSON(buildNameReviewPrompt(checked), { timeoutMs: NAME_REVIEW_DEADLINE_MS }),
      deadline
    ]);
    return { ...normalizeReview(routed.data, checked), provider: routed.provider, model: routed.model, reviewStatus: 'reviewed' };
  } catch (error) {
    // AI 服務的內部 timeout 和整體 deadline 都可回退；額度、配置或傳輸錯誤不能偽裝為逾時。
    if (error?.code !== 'NAME_REVIEW_TIMEOUT' && !/\\btimeout\\b|timed out|逾時|AbortError/i.test(String(error?.message || ''))) throw error;
    console.warn('[Identity review] AI timeout; applying server-side name checks');
    return { approved: true, normalizedName: checked, reason: 'AI 審核逾時，已通過基本名稱檢查', reviewStatus: 'timeout-fallback' };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = function registerIdentityApi(app) {
  app.post('/api/review-player-name', async (req, res) => {
    try {
      const name = cleanName(req.body?.name);
      if (name.length < 2) return res.status(400).json({ approved: false, error: '名稱至少需要 2 個字元' });
      if (RESERVED.test(name)) return res.status(400).json({ approved: false, error: '此名稱含有系統保留稱號或身分字樣' });
      const review = await reviewNameWithDeadline(name);
      if (!review.approved) return res.status(422).json({ ...review, error: review.reason || '名稱未通過 AI 審核' });
      res.json(review);
    } catch (error) {
      console.error('[Identity review]', error);
      res.status(500).json({ approved: false, error: error?.message || '名稱審核失敗' });
    }
  });
};

module.exports.__test = { cleanName, normalizeReview, buildNameReviewPrompt, reviewNameWithDeadline, NAME_REVIEW_DEADLINE_MS, RESERVED };
