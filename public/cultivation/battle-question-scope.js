// Shared, deterministic knowledge-range rules for ranked PvP. No browser or Firebase dependencies.
export const BATTLE_SUBJECTS = Object.freeze(['國文', '英文', '數學', '公民', '歷史', '地理', '物理', '化學', '生物']);

export function normalizeBattleSubject(input) {
  const value = String(input ?? '').trim().replace(/\\s+/g, '');
  const aliases = { 數學A: '數學', 數學B: '數學', 理化: '物理', 國語: '國文', 英語: '英文', Chinese: '國文', English: '英文', Math: '數學', Biology: '生物' };
  const subject = aliases[value] || value;
  return BATTLE_SUBJECTS.includes(subject) ? subject : '';
}

function subjectsFrom(value) {
  const raw = Array.isArray(value) ? value : String(value ?? '').split(/[,，、;；\\n]/);
  return [...new Set(raw.map(normalizeBattleSubject).filter(Boolean))];
}

function educationGrade(value) {
  const level = String(value ?? '');
  const number = level.match(/(?:第)?([一二三四五六七八九十]|1[0-2]|[1-9])(?:年級|年)/);
  const names = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  const year = number ? (names[number[1]] || Number(number[1])) : 1;
  if (/國小|小學/.test(level)) return Math.min(6, year);
  if (/高中|高職/.test(level)) return Math.min(12, 9 + year);
  if (/大學|研究所/.test(level)) return 13;
  if (/國中|初中/.test(level)) return Math.min(9, 6 + year);
  if (/^(?:[7-9]|[一二三])年級$/.test(level)) return Math.min(9, 6 + year);
  return 7; // Do not infer a higher syllabus from missing profile data.
}

function gradeLabel(grade) {
  if (grade >= 13) return '大學';
  const n = ['一', '二', '三', '四', '五', '六'];
  if (grade <= 6) return '國小' + (n[grade - 1] || '一') + '年級';
  if (grade <= 9) return '國中' + n[grade - 7] + '年級';
  return '高中' + n[grade - 10] + '年級';
}

function extractUnit(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const path = String(raw.path || '').replace(/\\\\/g, '/').slice(0, 160);
  const subject = normalizeBattleSubject(path.split('/').filter(Boolean)[0] || raw.subject);
  if (!subject) return null;
  const detail = String(raw.detail || '').trim().slice(0, 100);
  const topics = (Array.isArray(raw.sub_topics) ? raw.sub_topics : [])
    .map(value => String(value).trim().slice(0, 80)).filter(Boolean).slice(0, 8);
  const topic = [detail, topics.length ? '核心考點：' + topics.join('、') : ''].filter(Boolean).join('（') +
    (detail && topics.length ? '）' : '');
  return { subject, topic, key: subject + ':' + detail.toLowerCase() };
}

export function snapshotBattleKnowledge(data = {}) {
  const profile = data.profile || {};
  const settings = data.gameSettings || {};
  const focused = settings.sourceMode === 'focused' && Array.isArray(settings.focusedUnits) && settings.focusedUnits.length > 0;
  const units = focused ? settings.focusedUnits.map(extractUnit).filter(Boolean).slice(0, 24) : [];
  const rawDifficulty = String(settings.difficulty || 'medium');
  const difficulty = ['easy', 'medium', 'hard'].includes(rawDifficulty) ? rawDifficulty : 'medium';
  return {
    grade: educationGrade(profile.educationLevel || data.educationLevel),
    weakSubjects: subjectsFrom(profile.weakSubjects),
    focused: focused && units.length > 0,
    units,
    difficulty
  };
}

export function resolveBattleKnowledge(host = {}, guest = {}) {
  const grade = Math.min(Number(host.grade) || 7, Number(guest.grade) || 7);
  const allowed = grade <= 6 ? ['國文', '英文', '數學', '自然'] : BATTLE_SUBJECTS;
  const hostUnits = Array.isArray(host.units) ? host.units : [];
  const guestUnits = Array.isArray(guest.units) ? guest.units : [];
  const hostSubjects = host.focused ? [...new Set(hostUnits.map(u => u.subject))] : [];
  const guestSubjects = guest.focused ? [...new Set(guestUnits.map(u => u.subject))] : [];
  let commonUnits = [];
  if (host.focused && guest.focused) {
    const keys = new Set(guestUnits.map(u => u.key));
    commonUnits = hostUnits.filter(u => keys.has(u.key) && allowed.includes(u.subject) && !!u.topic);
  }
  let subjects;
  if (commonUnits.length) subjects = [...new Set(commonUnits.map(u => u.subject))];
  else if (host.focused && guest.focused) subjects = hostSubjects.filter(s => guestSubjects.includes(s) && allowed.includes(s));
  else if (host.focused || guest.focused) {
    const preferred = host.focused ? hostSubjects : guestSubjects;
    subjects = preferred.filter(s => allowed.includes(s));
  } else {
    const hostWeak = subjectsFrom(host.weakSubjects);
    const guestWeak = subjectsFrom(guest.weakSubjects);
    const overlap = hostWeak.filter(s => guestWeak.includes(s) && allowed.includes(s));
    subjects = overlap.length ? overlap : allowed.filter(s => BATTLE_SUBJECTS.includes(s));
  }
  // No mutual units/subjects: never impose either player's private focused syllabus.
  if (!subjects.length) subjects = allowed.filter(s => BATTLE_SUBJECTS.includes(s));
  const fixedDifficulty = host.difficulty === guest.difficulty && ['easy', 'medium', 'hard'].includes(host.difficulty)
    ? host.difficulty : 'medium';
  return { version: 1, grade, level: gradeLabel(grade), subjects: [...new Set(subjects)], units: commonUnits,
    difficulty: fixedDifficulty, policy: commonUnits.length ? 'common-units' : 'shared-subjects' };
}

export function pickBattleKnowledge(scope, round) {
  const index = Math.max(0, Math.floor(Number(round) || 1) - 1);
  const units = Array.isArray(scope?.units) ? scope.units : [];
  const subjects = Array.isArray(scope?.subjects) && scope.subjects.length ? scope.subjects : BATTLE_SUBJECTS;
  const unit = units.length ? units[index % units.length] : null;
  return {
    subject: unit?.subject || subjects[index % subjects.length],
    specificTopic: unit?.topic || '',
    level: scope?.level || '國中一年級',
    difficulty: scope?.difficulty || 'medium'
  };
}
