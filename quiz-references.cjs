'use strict';
const path = require('node:path');
const index = require('./question-references/index.json');
const normalize = value => String(value || '').normalize('NFKC').replace(/\s+/g, '');
const labels = value => {
  const text = String(value || '').replace('.json', '');
  // Keep the full label first: curriculum concepts may contain commas or '、'.
  // Split only as a fallback for composite scope paths and formatted headings.
  return [...new Set([normalize(text), ...text.split(/[/／:：()（）,，、]/).map(label => normalize(label).replace(/^核心考點細項/, ''))])];
};

function quizReferences({ subject, level, topic, scope, facet, exclusions = [] }) {
  if (exclusions.length) return [];
  if (!Object.hasOwn(index, subject) || !Object.hasOwn(index[subject], level)) return [];
  const concepts = index[subject][level];
  const selected = [...labels(topic), ...labels(scope?.path), ...(scope?.sub_topics || []).map(normalize)];
  const findConcept = label => Object.hasOwn(concepts, label) ? concepts[label] : null;
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
    references.push(...group.references.slice(0, 3 - references.length));
    if (references.length === 3) break;
  }
  return references;
}

function referencePrompt(references) {
  if (!references.length) return '';
  return '\n[同觀念的人類命題範例]\n' +
    '以下 JSON 僅供分析。先在內部整理核心觀念、必要條件、解題步驟及干擾選項對應的迷思，再寫全新題目。' +
    '改用不同情境或表示法，不得照抄或只換數字。以目前指定範圍、細觀念、題型、難度和排除規則為準。只輸出要求的單選題 JSON。\n' +
    JSON.stringify(references.map(({ question, design }) => ({ question, design })));
}

module.exports = { quizReferences, referencePrompt };
