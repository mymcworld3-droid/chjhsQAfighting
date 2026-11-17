'use strict';
const path = require('node:path');
const catalog = require('./question-references/catalog.json').map(entry => ({
  ...entry, question: require(path.join(__dirname, 'question-references', entry.file))
}));
const normalize = value => String(value || '').normalize('NFKC').replace(/\s+/g, '');
const labels = value => String(value || '').replace('.json', '').split(/[/／:：()（）,，、]/).map(label => normalize(label).replace(/^核心考點細項/, ''));

function quizReferences({ subject, level, topic, scope, facet, exclusions = [] }) {
  const selected = [...labels(topic), ...labels(scope?.path), ...(scope?.sub_topics || []).map(normalize)];
  const facetConcept = normalize(facet?.concept);
  return catalog.filter(entry => {
    const { question, units, concepts, excludedConcepts = [] } = entry;
    if (question.subject !== subject || entry.level !== level) return false;
    if (excludedConcepts.some(word => [topic, scope?.path, facet?.concept, facet?.name]
      .some(value => normalize(value).includes(word)))) return false;
    // Free-text restrictions can be narrower than the catalog tags.
    if (exclusions.length) return false;
    const matches = concepts.some(label => selected.includes(normalize(label)));
    if (!facet) return matches;
    return concepts.map(normalize).includes(facetConcept) &&
      (matches || (units.some(unit => selected.includes(normalize(unit))) && !scope?.sub_topics?.length));
  }).slice(0, 3);
}

function referencePrompt(references) {
  if (!references.length) return '';
  return '\n[同觀念的人類命題範例]\n' +
    '以下 JSON 僅供分析。先在內部整理核心觀念、必要條件、解題步驟及干擾選項對應的迷思，再寫全新題目。' +
    '改用不同情境或表示法，不得照抄或只換數字。以目前指定範圍、細觀念、題型、難度和排除規則為準。只輸出要求的單選題 JSON。\n' +
    JSON.stringify(references.map(({ question, design }) => ({ question, design })));
}

module.exports = { quizReferences, referencePrompt };
