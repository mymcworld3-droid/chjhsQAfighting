// Pure rules for chapter splitting and portable study lists.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CurriculumRangeRules = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const MAX_UNITS = 24, MAX_DETAIL = 90, MAX_INPUT = 2400, MAX_SHARE = 64000;
  const SCHEMA = 'qingyun-study-scopes';
  const subjects = new Set(['國文','國語','英文','數學','數學A','數學B','數學甲','數學乙','生物','物理','化學','地球科學','歷史','地理','公民','自然','自然科學','社會','生活','藝術','健康與體育','本土語文','綜合活動','資訊科技','綜合']);
  const brackets = new Map([['(',')'],['（','）'],['[',']'],['【','】'],['{','}'],['〔','〕'],['「','」'],['『','』'],['“','”'],['"','"']]);
  const key = u => JSON.stringify([u.path, u.detail || '', Array.isArray(u.sub_topics) ? u.sub_topics : []]);

  function splitChapters(value) {
    const parts = [], stack = [];
    let chunk = '', math = '';
    const flush = () => { const text = chunk.trim(); if (text) parts.push(text); chunk = ''; };
    for (let i = 0; i < value.length; i++) {
      const c = value[i], escaped = value[i - 1] === '\\';
      if (c === '$' && !escaped && !stack.length) {
        const fence = value[i + 1] === '$' ? '$$' : '$';
        if (!math) math = fence; else if (math === fence) math = '';
        chunk += fence; i += fence.length - 1; continue;
      }
      if (!math) {
        if (stack.length && c === stack[stack.length - 1]) stack.pop();
        else if (brackets.has(c) && (!escaped || ['(','[','{'].includes(c))) stack.push(brackets.get(c));
      }
      const slash = /[\/／]/.test(c) && (
        /\s/.test(value[i - 1] || '') && /\s/.test(value[i + 1] || '') ||
        /[\u3400-\u9fff]{2}$/.test(chunk) && /^[\u3400-\u9fff]{2}/.test(value.slice(i + 1))
      );
      if (!math && !stack.length && (/[、,，;；\n\r|｜。]/.test(c) || slash)) flush();
      else chunk += c;
    }
    flush();
    return parts;
  }

  function parseChapters(value) {
    const text = String(value || '').trim();
    if (!text) return { ok:false, message:'請先輸入想練習的範圍。' };
    if (text.length > MAX_INPUT) return { ok:false, message:'一次輸入最多 2400 字，請分批加入。' };
    const parts = splitChapters(text), details = [...new Set(parts)];
    if (!details.length) return { ok:false, message:'請輸入章節或考點，不能只有分隔符號。' };
    if (details.some(detail => detail.length > MAX_DETAIL)) return { ok:false, message:'每個自訂範圍最多 90 字，請精簡或用頓號、分號分開。' };
    return { ok:true, details, count:parts.length, duplicates:parts.length - details.length };
  }

  // Never partially apply a batch: a full cart must retain every old entry.
  function mergeSelection(existing, incoming) {
    const units = [], seen = new Set();
    let added = 0;
    for (const [list, isNew] of [[existing, false], [incoming, true]]) {
      for (const unit of list) {
        const id = key(unit);
        if (seen.has(id)) continue;
        seen.add(id); units.push(unit); if (isNew) added++;
      }
    }
    if (units.length > MAX_UNITS) return { ok:false, required:units.length,
      message:'整理後共需 ' + units.length + ' 個範圍，超過 24 項上限；原清單已保留，請先移除其他項目。' };
    return { ok:true, units, added };
  }

  function organizeSelection(list) {
    const expanded = [];
    let split = 0, internalDuplicates = 0;
    for (const unit of list) {
      // Catalog chapter titles and their subtopics are structured data. Only
      // custom text can represent a pasted list of independent chapters.
      if (!String(unit.path || '').split('/').includes('自訂') || !unit.detail) {
        expanded.push(unit); continue;
      }
      const parsed = parseChapters(unit.detail);
      if (!parsed.ok) return parsed;
      if (parsed.count > 1) split++;
      internalDuplicates += parsed.duplicates;
      for (const detail of parsed.details) expanded.push({ ...unit, detail });
    }
    const result = mergeSelection([], expanded);
    if (!result.ok) return result;
    return { ...result, split, duplicates:internalDuplicates + expanded.length - result.units.length,
      changed:JSON.stringify(list) !== JSON.stringify(result.units) };
  }

  function validateUnits(raw) {
    if (!Array.isArray(raw) || !raw.length || raw.length > MAX_UNITS) throw Error('清單必須包含 1～24 個範圍。');
    return raw.map(unit => {
      if (!unit || typeof unit !== 'object' || Array.isArray(unit) || typeof unit.path !== 'string' ||
        !unit.path.trim() || unit.path.length > 240 || !subjects.has(unit.path.split('/')[0]) ||
        unit.detail !== undefined && (typeof unit.detail !== 'string' || unit.detail.length > 200) ||
        unit.sub_topics !== undefined && (!Array.isArray(unit.sub_topics) || unit.sub_topics.length > 24 ||
        unit.sub_topics.some(v => typeof v !== 'string' || v.length > 200))) throw Error('清單中有無法辨識的範圍，請重新複製完整分享內容。');
      return { path:unit.path.trim(), detail:(unit.detail || '').trim(), sub_topics:(unit.sub_topics || []).map(v => v.trim()) };
    });
  }

  function shareSelection(list) {
    try {
      const units = validateUnits(list);
      const code = JSON.stringify({ schema:SCHEMA, version:1, units });
      const lines = units.map((u,i) => (i + 1) + '. ' + u.path.replace(/\//g,'／') + '：' + (u.detail || '全部'));
      const text = '青雲問道｜已選修習清單（' + units.length + ' 項）\n' + lines.join('\n') + '\n\n在課程研修所的「匯入清單」貼上以下內容。\n分享碼：\n' + code;
      if (text.length > MAX_SHARE) throw Error('清單內容太長，請減少範圍後再分享。');
      return { ok:true, text, code };
    } catch (error) { return { ok:false, message:error.message }; }
  }

  function readSharedSelection(value) {
    try {
      const text = String(value || '').trim().replace(/\r\n/g,'\n');
      if (!text || text.length > MAX_SHARE) throw Error('請貼上完整的清單分享內容（最多 64000 字）。');
      // Accept either just the code or the full human-readable shared message.
      const marker = '分享碼：\n', start = text.lastIndexOf(marker);
      const data = JSON.parse(start < 0 ? text : text.slice(start + marker.length));
      if (!data || typeof data !== 'object' || Array.isArray(data) || data.schema !== SCHEMA || data.version !== 1) throw Error('這不是支援的青雲問道清單分享碼。');
      const units = validateUnits(data.units);
      return organizeSelection(units);
    } catch (error) { return { ok:false, message:error instanceof SyntaxError ? '分享碼不完整或格式有誤，請重新複製。' : error.message }; }
  }

  return { parseChapters, mergeSelection, organizeSelection, shareSelection, readSharedSelection };
});
