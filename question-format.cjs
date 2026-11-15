'use strict';

const MathGuard = require('./public/cultivation/math-guard.js');
const units = new Set([
  'm/s^2', 'm/s²', 'km/h', 'cm/s', 'm/s', 'kPa', 'kJ', 'kW', 'Pa', 'Hz',
  'mol', 'min', 'kg', 'km', 'cm', 'mm', 'ms', '°C', 'm', 's', 'h', 'g',
  'N', 'J', 'W', 'V', 'A', 'C', 'K', 'Ω'
]);
// A JSON tab escape can consume the backslash and "t" of \text.
const damagedUnit = /(?<=\d)[ \t]*(?:\\,[ \t]*)?ext[ \t]*(?:\{([^{}\r\n]{1,40})\}|(m\/s(?:\^2|²)?|km\/h|cm\/s|kPa|kJ|kW|Pa|Hz|mol|min|kg|km|cm|mm|ms|°C|[mshgNJWVACKΩ])(?![A-Za-z0-9/]))/gu;

function inspectQuestionFormat(question) {
  let damaged = false;
  let repairable = true;
  const repair = value => {
    if (typeof value !== 'string') return value;
    return value.replace(damagedUnit, (original, braced, bare) => {
      damaged = true;
      const unit = (braced ?? bare).replace(/\s+/g, '');
      if (!units.has(unit)) {
        repairable = false;
        return original;
      }
      return '\\text{ ' + unit.replace('^2', '²') + '}';
    });
  };
  const q = repair(question.q);
  const correct = repair(question.correct);
  const wrong = Array.isArray(question.wrong) ? question.wrong.map(repair) : [];
  const exp = repair(question.exp);
  if (!damaged) return { damaged, question };

  const fields = [q, correct, ...wrong, exp];
  const choices = [correct, ...wrong].map(value =>
    MathGuard.readableMath(value).replace(/[\s\\,]/g, ''));
  if (!repairable || fields.some(value => !MathGuard.inspect(value).valid) ||
      new Set(choices).size !== choices.length) {
    return { damaged, question: null };
  }
  return { damaged, question: { ...question, q, correct, wrong, exp } };
}

function confirmedFormatReport(input) {
  const { damaged } = inspectQuestionFormat({
    q: input.question, correct: input.options[input.correctIndex],
    wrong: input.options.filter((_, index) => index !== input.correctIndex), exp: input.explanation
  });
  if (!damaged) return null;
  return {
    status: 'confirmed', issueType: 'wording',
    reason: '題目的公式含有損壞的單位指令，導致作答畫面顯示錯誤。'
  };
}

module.exports = { inspectQuestionFormat, confirmedFormatReport };
