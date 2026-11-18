'use strict';
const path = require('node:path');
const index = require('./question-references/index.json');
const normalize = value => String(value || '').normalize('NFKC').replace(/\s+/g, '');
const labels = value => {
  const text = String(value || '').replace('.json', '');
  // Keep the full label first: curriculum concepts may contain commas or '、'.
  // Split only as a fallback for composite scope paths and formatted headings.
  const split = pattern => text.split(pattern).map(label => normalize(label).replace(/^核心考點細項/, ''));
  return [...new Set([normalize(text), ...split(/[/／:：()（）]/), ...split(/[/／:：()（）,，、]/)])];
};

function quizReferences({ subject, level, topic, scope, facet, exclusions = [], referenceSeed = '' }) {
  if (exclusions.length) return [];
  if (!Object.hasOwn(index, subject) || !Object.hasOwn(index[subject], level)) return [];
  const concepts = index[subject][level];
  const selected = [...labels(topic), ...labels(scope?.path), ...(scope?.sub_topics || []).map(normalize)];
  // Labels are whitespace-normalized for matching. Curriculum keys may contain
  // spaces in terms such as "DNA 與基因" or "GIS 與空間資料".
  // Retain original filenames; never derive paths from normalized input.
  const normalizedConcepts = new Map(Object.entries(concepts).map(([label, filename]) => [normalize(label), filename]));
  const findConcept = label => Object.hasOwn(concepts, label) ? concepts[label] : normalizedConcepts.get(normalize(label)) || null;
  const selectedKeys = new Set(selected.map(findConcept).filter(Boolean));
  const facetKey = facet && findConcept(normalize(facet.concept));
  if (facet && !facetKey) return [];

  const scopeText = [topic, scope?.path, facet?.concept, facet?.name].map(normalize);
  const references = [];
  for (const key of facet ? [facetKey] : selectedKeys) {
    if (!selectedKeys.has(key) && scope?.sub_topics?.length) continue;
    // Node caches parsed JSON. Only the matched concept is loaded.
    const group = require(path.join(__dirname, 'question-references', subject, level, key + '.json'));
    if (!selectedKeys.has(key) && !group.units.some(unit => selected.includes(normalize(unit)))) continue;
    if (group.excludedConcepts.some(word => scopeText.some(value => value.includes(word)))) continue;
    const pool = group.references;
    let start = 0;
    if (referenceSeed && pool.length > 3) {
      const seed = String(referenceSeed) + ':' + subject + ':' + level + ':' + key;
      for (const ch of seed) start = (Math.imul(start, 33) + ch.codePointAt(0)) >>> 0;
      start %= pool.length;
    }
    references.push(...Array.from({ length: Math.min(pool.length, 3 - references.length) },
      (_, i) => pool[(start + i) % pool.length]));
    if (references.length === 3) break;
  }
  return references;
}

function referencePrompt(references) {
  if (!references.length) return '';
  return '\n[同觀念命題參考例]\n' +
    '以下 JSON 僅供分析。先在內部整理核心觀念、必要條件、解題步驟及干擾選項對應的迷思，再寫全新題目。' +
    '改用不同情境或表示法，不得照抄或只換數字。' +
    '干擾選項必須與正解同層次、在同一學習範圍內，且能對應常見而合理的迷思；不得用荒謬情節、無關領域、明顯不可能或極端絕對措辭湊出錯誤選項。' +
    '自查正解唯一、題意清晰、所有數據及事實正確，且所需前提都已在題幹交代，不得超綱。' +
    '以目前指定範圍、細觀念、題型、難度和排除規則為準。只輸出要求的單選題 JSON。\n' +
    JSON.stringify(references.map(({ question, design }) => ({ question, design })));
}

module.exports = { quizReferences, referencePrompt };
