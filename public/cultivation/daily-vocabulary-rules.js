import { WORDS } from './daily-vocabulary-words.js';

export const BANDS = Object.freeze([
  { id: 'B1', label: '簡單', exam: '英檢中級' },
  { id: 'B2', label: '中等', exam: '英檢中高級' },
  { id: 'C1', label: '困難', exam: '英檢高級' },
]);
export const WORDS_PER_BAND = 5;
export const LESSON_SIZE = BANDS.length * WORDS_PER_BAND;
export const STEPS = Object.freeze([
  { label: '辨認', formats: ['meaning', 'meaning', 'meaning', 'cloze', 'cloze'] },
  { label: '應用', formats: ['meaning', 'cloze', 'cloze', 'cloze', 'spelling'] },
  { label: '拼寫', formats: ['cloze', 'cloze', 'spelling', 'spelling', 'spelling'] },
]);
export const EVALUATION_DAYS = 3;
export const PROMOTE_AT = 80;
export const EASE_AT = 55;

const REVIEW_INTERVALS = [1, 3, 7, 14, 30];
const DAY_MS = 86_400_000;
const dateFormat = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
});
const wordsById = new Map(WORDS.map(word => [word.id, word]));
const wordsByBand = new Map(BANDS.map(({id}) => [id, WORDS.filter(word => word.band === id)]));
const alternateSpelling = { apologize: 'apologise', emphasize: 'emphasise', scrutinize: 'scrutinise' };

export function todayInTaipei(now = new Date()) {
  const parts = Object.fromEntries(dateFormat.formatToParts(now).map(({type, value}) => [type, value]));
  return [parts.year, parts.month, parts.day].join('-');
}

function addDays(date, days) {
  const time = Date.parse(date + 'T00:00:00Z');
  return new Date(time + days * DAY_MS).toISOString().slice(0, 10);
}

export function wordFor(id) {
  return wordsById.get(id);
}

export function newProgress() {
  return { level: 0, scores: [], lastEvaluation: null, review: {}, lesson: null };
}

export function openLesson(progress, date) {
  const previous = progress.lesson;
  if (previous && previous.date >= date && previous.words.every(id => wordFor(id))) return progress;

  const sequence = (previous?.sequence ?? -1) + 1;
  const words = BANDS.flatMap(({id}) => {
    const bank = wordsByBand.get(id);
    const first = (sequence * WORDS_PER_BAND) % bank.length;
    return Array.from({ length: WORDS_PER_BAND }, (_, index) => bank[(first + index) % bank.length].id);
  });
  return {
    ...progress,
    lesson: { date, sequence, words, level: progress.level, studied: {}, index: 0, answers: [], result: null },
  };
}

function shuffle(items, seed) {
  let random = 2166136261;
  for (const char of seed) random = Math.imul(random ^ char.charCodeAt(0), 16777619);
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index--) {
    random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
    const other = random % (index + 1);
    [copy[other], copy[index]] = [copy[index], copy[other]];
  }
  return copy;
}

function choicesFor(word, lessonWords, seed, format) {
  // Keep the part of speech the same and prefer distractors from the current band.
  const pool = shuffle(WORDS.filter(candidate => candidate.id !== word.id && candidate.part === word.part), seed);
  const meanings = new Set([word.meaning]);
  const distractors = [];
  for (const candidate of [
    ...pool.filter(option => option.band === word.band && lessonWords.includes(option.id)),
    ...pool.filter(option => option.band === word.band && !lessonWords.includes(option.id)),
    ...pool.filter(option => option.band !== word.band),
  ]) {
    if (meanings.has(candidate.meaning)) continue;
    distractors.push(candidate.id);
    meanings.add(candidate.meaning);
    if (distractors.length === 3) break;
  }
  return shuffle([word.id, ...distractors], seed + ':choices').map(id => ({
    id,
    label: format === 'meaning' ? wordFor(id).meaning : id,
  }));
}

export function questionsFor(lesson) {
  return BANDS.flatMap(({id}) => {
    const seed = lesson.date + ':' + id;
    const words = shuffle(lesson.words.map(wordFor).filter(word => word.band === id), seed);
    return words.map((word, index) => {
      const format = STEPS[lesson.level].formats[index];
      return {
        word,
        format,
        choices: format === 'spelling' ? [] : choicesFor(word, lesson.words, seed + ':' + word.id, format),
      };
    });
  });
}

export function dueWords(progress, date = progress.lesson.date) {
  // If a review word is already in today's 15, it can be reviewed there.
  const dailyWords = new Set(progress.lesson.words);
  return Object.entries(progress.review)
    .filter(([id, record]) => record.due <= date && wordFor(id) && !dailyWords.has(id))
    .sort((a, b) => a[1].due.localeCompare(b[1].due) || a[0].localeCompare(b[0]))
    .map(([id]) => id);
}

function scheduleReview(progress, id, familiar) {
  const date = progress.lesson.date;
  const old = progress.review[id];
  // Repeated success on the same day cannot push a word further into the future.
  if (familiar && old?.due > date) return;
  const box = familiar ? Math.min((old?.box ?? 0) + 1, REVIEW_INTERVALS.length - 1) : 0;
  progress.review[id] = { box, due: addDays(date, REVIEW_INTERVALS[box]) };
}

export function rateCard(progress, id, familiar) {
  if (!wordFor(id)) return;
  scheduleReview(progress, id, familiar);
}

function checkAnswer(question, value) {
  if (question.format !== 'spelling') return value === question.word.id;
  const spelling = value.normalize('NFKC').trim().toLowerCase();
  return spelling === question.word.id || spelling === alternateSpelling[question.word.id];
}

function finishQuiz(progress, questions) {
  const lesson = progress.lesson;
  const byBand = Object.fromEntries(BANDS.map(({id}) => [id, 0]));
  const mistakes = [];
  for (const [index, {word}] of questions.entries()) {
    const {correct} = lesson.answers[index];
    if (correct) byBand[word.band]++;
    else mistakes.push(word.id);
  }
  const score = questions.length - mistakes.length;
  lesson.result = { score, byBand, mistakes, nextLevel: progress.level };
  progress.scores.push(score);
  if (progress.scores.length < EVALUATION_DAYS) return;

  const total = progress.scores.reduce((sum, points) => sum + points, 0);
  const percent = 100 * total / (EVALUATION_DAYS * LESSON_SIZE);
  const before = progress.level;
  if (percent >= PROMOTE_AT) progress.level = Math.min(STEPS.length - 1, before + 1);
  if (percent <= EASE_AT) progress.level = Math.max(0, before - 1);
  progress.lastEvaluation = { percent: Math.round(percent), before, after: progress.level };
  lesson.result.nextLevel = progress.level;
  progress.scores = [];
}

export function submitAnswer(progress, questions, index, value) {
  const lesson = progress.lesson;
  const question = questions[index];
  if (lesson.result || !question || index !== lesson.index || index !== lesson.answers.length) return false;
  if (typeof value !== 'string') return false;
  const answer = value.trim().slice(0, 40);
  if (question.format !== 'spelling' && !question.choices.some(choice => choice.id === answer)) return false;

  const correct = checkAnswer(question, answer);
  lesson.answers.push({ value: answer, correct });
  scheduleReview(progress, question.word.id, correct);
  if (lesson.answers.length === questions.length) finishQuiz(progress, questions);
  return true;
}

export function nextQuestion(lesson) {
  if (lesson.answers[lesson.index] && lesson.index < LESSON_SIZE - 1) lesson.index++;
}
