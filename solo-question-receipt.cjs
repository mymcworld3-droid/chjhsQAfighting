'use strict';

const crypto = require('node:crypto');
const { deriveKey } = require('./raid-question-ticket.cjs');
const Knowledge = require('./public/cultivation/knowledge-points.js');

function questionOptions(question) {
  return [question.correct, ...question.wrong];
}

function signature(key, uid, receipt, question, options) {
  return crypto.createHmac('sha256', key)
    .update(JSON.stringify(['solo-question-v1', uid, receipt, question, [...options].sort()]))
    .digest('base64url');
}

function issue(uid, parsed, { difficulty, recoveryOrigin, practiceTopic } = {}, key = deriveKey()) {
  const metadata = {
    nonce: crypto.randomUUID(),
    subject: parsed.subject || '綜合',
    topic: practiceTopic || parsed.sub_topic || '綜合',
    difficulty: parsed.adaptive?.difficulty || difficulty || parsed.difficulty || 'easy',
    explanation: parsed.exp || '',
    correct: parsed.correct,
    meta: {
      ...Knowledge.metadata(parsed, parsed.subject),
      concept_id: parsed.concept_id || '',
      template_id: parsed.template_id || '',
      question_form: parsed.question_form || '',
      cognitive_level: parsed.cognitive_level || 1,
      reasoning_steps: parsed.reasoning_steps || 1
    },
    ...(parsed.adaptive ? { adaptive: parsed.adaptive } : {}),
    ...(recoveryOrigin ? { recoveryOrigin } : {})
  };
  const receipt = Buffer.from(JSON.stringify(metadata)).toString('base64url');
  return receipt + '.' + signature(key, uid, receipt, parsed.q, questionOptions(parsed));
}

function read(uid, input, key = deriveKey()) {
  const { proof, question, options } = input;
  if (typeof proof !== 'string' || proof.length > 40000 || typeof question !== 'string' ||
      !Array.isArray(options) || options.length !== 4 || options.some(value => typeof value !== 'string')) return null;
  const parts = proof.split('.');
  if (parts.length !== 2 || !/^[\w-]{43}$/.test(parts[1])) return null;
  const [receipt, received] = parts;
  const expected = signature(key, uid, receipt, question, options);
  if (!crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected))) return null;
  const meta = JSON.parse(Buffer.from(receipt, 'base64url').toString('utf8'));
  const answerIndex = options.indexOf(meta.correct);
  if (answerIndex < 0) return null;
  return { ...meta, id: 'solo-' + received, q: question, opts: options, answerIndex };
}

module.exports = { issue, read };
