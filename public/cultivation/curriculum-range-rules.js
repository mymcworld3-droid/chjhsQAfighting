// Pure rules for chapter splitting and portable study lists.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CurriculumRangeRules = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const MAX_UNITS = 24, MAX_DETAIL = 90, MAX_INPUT = 2400, MAX_SHARE = 64000;
  const SCHEMA = 'qingyun-study-scopes';
  const subjects = new Set(['國文','國語','英文','數學','數學A','數學B','數學甲','數學乙','生物','物理','化學','地球科學','歷史','地理','公民','自然','自然科學','社會','生活','藝術','健康與體育','本土語文','綜合活動','綜合']);
  const brackets = new Map([['(',')'],['（','）'],['[',']'],['【','】'],['{','}'],['〔','〕'],['「','」'],['『','』'],['“','”'],['"','"']]);
  // Verified publisher contents may be selected without certifying every reference question.
  function selectableBook(book) {
    if(!book)return false;
    if(book.legacyVisible || book.releaseStatus === 'released')return true;
    // A separately labelled 114 school-year transcription is selectable for practice,
    // not a raw-document-verified or officially released book. Keep grade 11 gates intact.
    if(book.scopeSelectionStatus === 'source-reviewed-crosswalk'){
      const e=book.scopeEvidence;
      const subjects=['數學','物理','化學'], publishers=['龍騰','翰林','南一','泰宇','三民','全華'];
      if(book.grade!=='高中一年級'||!subjects.includes(book.subject)||!publishers.includes(book.publisher)||
        book.edition!==book.publisher+'版'||book.schoolYear!==114||book.releaseStatus!=='blocked'||
        book.verificationStatus!=='source-reviewed-crosswalk'||!/^\d{4}-\d{2}-\d{2}$/.test(book.verifiedAt||'')||
        e?.kind!=='publisher-crosswalk-transcription'||e.publisher!==book.publisher||e.schoolYear!==114||
        e.columnPolicy!=='publisher-left-only'||e.rawFileHashStatus!=='unavailable'||
        !['page-and-text','structured-text'].includes(e.reviewMethod)||!Number.isInteger(e.page)||e.page<1||e.page>6)return false;
      const expectedFile=book.subject==='數學'?(book.term==='第一學期'?'10-1_comparison_math_114.pdf':book.term==='第二學期'?'10-2_comparison_math_114.pdf':''):
        book.term==='必修'+book.subject?(book.subject==='物理'?'10-1_comparison_physical_114.pdf':'10-1_comparison_chemistry_114.pdf'):'';
      const table=book.publisher+(book.subject==='數學'?'數學高一'+(book.term==='第一學期'?'上':'下'):'必修'+book.subject);
      return !!expectedFile&&!!book.sources?.some(s=>s.type==='third-party-curriculum-crosswalk'&&s.schoolYear===114&&s.page===e.page&&
        s.publisherTable===table&&s.reviewMethod===e.reviewMethod&&s.url==='https://www.go100.com.tw/file/108_comparison_table/senior/'+expectedFile+'?v=20250901')&&
        !!book.units?.length&&book.units.every(u=>u.details?.length>0&&new Set(u.details).size===u.details.length&&
          Array.isArray(u.concepts)&&u.concepts.length===u.details.length&&u.concepts.every((c,i)=>c.name===u.details[i]&&Array.isArray(c.allowedContent)&&c.allowedContent.length>0&&Array.isArray(c.excludedContent)));
    }
    if(book.grade !== '高中二年級' || !['數學A','數學B','物理','化學'].includes(book.subject) ||
      !book.verifiedAt || !book.units?.length || !book.units.every(u=>u.details?.length > 0))return false;
    if(book.scopeSelectionStatus === 'verified-toc')return book.verificationStatus === 'verified-complete-toc' &&
      !!book.sources?.some(s=>['official-toc','official-product-toc'].includes(s.type));
    const evidence=book.scopeEvidence;
    return book.scopeSelectionStatus === 'verified-crosswalk' && book.verificationStatus === 'verified-complete-crosswalk' &&
      evidence?.kind === 'publisher-crosswalk' && evidence.publisher === book.publisher &&
      evidence.columnPolicy === 'publisher-left-only' && evidence.schoolYear === book.schoolYear &&
      Number.isInteger(book.schoolYear) && !!book.sources?.some(s=>s.type === 'third-party-curriculum-crosswalk' &&
        /^https:\/\/www\.go100\.com\.tw\/file\/108_(?:comparison_table|version_compare)\/senior\//.test(s.url) &&
        s.schoolYear === book.schoolYear && s.page === evidence.page && Number.isInteger(s.page) && s.page > 0 &&
        String(s.publisherTable||'').startsWith(book.publisher) && /^[0-9a-f]{64}$/.test(s.documentSha256||''));
  }
  function curriculumMetadata(raw) {
    if(raw===undefined)return undefined;
    if(!raw||typeof raw!=='object'||Array.isArray(raw)||
      !['bookId','edition','term'].every(k=>typeof raw[k]==='string'&&raw[k].length>0&&raw[k].length<=100)||
      raw.schoolYear!=null&&(!Number.isInteger(raw.schoolYear)||raw.schoolYear<100||raw.schoolYear>200)||
      !Array.isArray(raw.conceptIds)||raw.conceptIds.length>24||raw.conceptIds.some(id=>typeof id!=='string'||!/^[-a-zA-Z0-9\u3400-\u9fff_]{1,100}$/.test(id)))
      throw Error('教材版本或觀念資料格式有誤。');
    return {bookId:raw.bookId,edition:raw.edition,term:raw.term,schoolYear:raw.schoolYear??null,
      conceptIds:[...new Set(raw.conceptIds)].sort()};
  }
  const key = u => JSON.stringify([u.path, u.detail || '', Array.isArray(u.sub_topics) ? u.sub_topics : [],
    ...(u.curriculum?[curriculumMetadata(u.curriculum)]:[])]);

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
        if (String(unit?.path || '').split('/')[0] === '資訊科技') continue; // retired range
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
      return { path:unit.path.trim(), detail:(unit.detail || '').trim(), sub_topics:(unit.sub_topics || []).map(v => v.trim()),
        ...(unit.curriculum!==undefined?{curriculum:curriculumMetadata(unit.curriculum)}:{}) };
    });
  }

  function shareSelection(list) {
    try {
      const units = validateUnits(list);
      const code = JSON.stringify({ schema:SCHEMA, version:units.some(u=>u.curriculum)?2:1, units });
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
      if (!data || typeof data !== 'object' || Array.isArray(data) || data.schema !== SCHEMA ||
        ![1,2].includes(data.version)||data.version===2&&(!Array.isArray(data.units)||!data.units.some(u=>u?.curriculum))) throw Error('這不是支援的青雲問道清單分享碼。');
      const units = validateUnits(data.units);
      return organizeSelection(units);
    } catch (error) { return { ok:false, message:error instanceof SyntaxError ? '分享碼不完整或格式有誤，請重新複製。' : error.message }; }
  }

  function validateShareTitle(value) {
    if (value != null && typeof value !== 'string') return { ok:false, message:'請輸入清單標題。' };
    const title = (value || '').trim();
    const length = typeof Intl.Segmenter === 'function'
      ? Array.from(new Intl.Segmenter('zh-Hant', { granularity:'grapheme' }).segment(title)).length
      : Array.from(title).length;
    if (length > 20 || /[\u0000-\u001f\u007f]/.test(title)) return { ok:false, length, message:'清單標題最多 20 字，請使用單行文字。' };
    return { ok:true, length, title:title || '我的修習清單' };
  }

  function createChatShare(list, value) {
    const title = validateShareTitle(value);
    if (!title.ok) return title;
    const shared = shareSelection(list);
    if (!shared.ok) return shared;
    return { ok:true, message:{ type:'curriculum-share', scopeTitle:title.title,
      scopeCode:shared.code, text:'分享了修習清單' } };
  }

  function readChatShare(message) {
    if (message?.type !== 'curriculum-share') return { ok:false, message:'這不是修習清單。' };
    const title = validateShareTitle(message.scopeTitle);
    if (!title.ok) return title;
    const parsed = readSharedSelection(message.scopeCode);
    return parsed.ok ? { ...parsed, title:title.title } : parsed;
  }

  return { parseChapters, mergeSelection, organizeSelection, shareSelection, readSharedSelection, curriculumMetadata, selectableBook,
    validateShareTitle, createChatShare, readChatShare };
});
