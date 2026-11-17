'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const index = require('../question-references/index.json');
const curriculum = require('../public/high_school_unit_name/humanities.json');
const knowledge = require('../public/cultivation/knowledge-points.js');
const { quizReferences, referencePrompt } = require('../quiz-references.cjs');

// All checks execute in Node tests only. The game client never scans reference files.
const coverage = {
  '國文': ['高中一年級', '高中二年級', '高中三年級'],
  '歷史': ['高中一年級', '高中二年級', '高中三年級'],
  '地理': ['高中一年級', '高中二年級', '高中三年級'],
  '公民': ['高中一年級', '高中二年級', '高中三年級']
};
for (const [subject, grades] of Object.entries(coverage)) {
  for (const level of grades) {
    test(`reference index and curriculum match: ${subject}/${level}`, () => {
      const units = Object.values(curriculum.subjects[subject][level])
        .flatMap(term => term['108課綱複習版']);
      const declared = new Map(units.flatMap(u => u.details.map(concept => [concept, u.unit])));
      const entries = index[subject]?.[level];
      assert.ok(entries, 'missing subject/grade reference index');
      assert.deepEqual(new Set(Object.keys(entries)), new Set(declared.keys()));
      const questionIds = new Set(), stems = new Set();
      for (const [concept, unit] of declared) {
        const filename = entries[concept];
        assert.match(filename, /^[^/\\]+$/, 'index value must be a local concept filename');
        const group = require(path.join(__dirname, '..', 'question-references',
          subject, level, filename + '.json'));
        assert.ok(group.units.includes(unit), `${concept}: curriculum unit mismatch`);
        assert.deepEqual(group.excludedConcepts, [], `${concept}: unexpected exclusions`);
        assert.ok(group.references.length >= 2, `${concept}: at least two independent references required`);
        const selected = quizReferences({ subject, level, topic: concept });
        assert.deepEqual(selected.map(r => r.id), group.references.slice(0, 3).map(r => r.id),
          `${concept}: runtime lazy lookup failed`);
        for (const ref of group.references) {
          const q = ref.question;
          assert.ok(!questionIds.has(ref.id), `duplicate ID: ${ref.id}`);
          questionIds.add(ref.id);
          assert.ok(!stems.has(q.q), `duplicate stem: ${concept}`);
          stems.add(q.q);
          assert.ok(ref.source && ref.design, `${concept}: missing reference provenance or design`);
          assert.doesNotMatch(JSON.stringify(ref), /https?:\/\//);
          assert.equal(q.subject, subject);
          assert.equal(q.sub_topic, concept);
          assert.ok(q.template_id && q.concept_id);
          assert.ok(['single-choice', 'multi-step'].includes(q.question_form));
          assert.ok(q.q && q.exp && q.correct);
          assert.equal(q.wrong.length, 3);
          assert.equal(new Set([q.correct, ...q.wrong]).size, 4);
          assert.deepEqual(knowledge.labels(q, subject), q.knowledge_points,
            `${concept}: knowledge-point ID/name mismatch`);
        }
        assert.match(referencePrompt(selected), /同觀念的人類命題範例/);
      }
    });
  }
}
